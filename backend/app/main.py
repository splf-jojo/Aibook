from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime
import hashlib
import logging
import struct
import base64
from typing import Literal
from uuid import uuid4

from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Response,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .config import settings
from .database import Base, SessionLocal, engine, get_session
from .dependencies import get_current_user
from .latex import LatexParseError, layout_latex
from .models import AiChat, AiChatMessage, CanvasDocument, ImageTransfer, User, utc_now
from .qwen import QwenNotConfiguredError, QwenRequestError, request_qwen, request_canvas_solution
from .realtime import manager
from .schemas import (
    AiSidebarResponse,
    AiCanvasResponse,
    AiChatCreate,
    AiChatMessageCreate,
    AiChatMessageResponse,
    AiChatResponse,
    CanvasCreate,
    CanvasResponse,
    CanvasSummaryResponse,
    CanvasUpdate,
    Credentials,
    ImageMetadata,
    LatexLayoutRequest,
    LatexLayoutResponse,
    TokenResponse,
    UserResponse,
)
from .security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)

MAX_IMAGE_BYTES = 20 * 1024 * 1024
AI_PROMPTS = {
    "ru": "Реши математическую задачу",
    "en": "Solve the math problem",
    "zh": "解答这道数学题",
}
logger = logging.getLogger("uvicorn.error")


def png_dimensions(payload: bytes) -> tuple[int, int] | None:
    if (
        len(payload) >= 24
        and payload[:8] == b"\x89PNG\r\n\x1a\n"
        and payload[12:16] == b"IHDR"
    ):
        return struct.unpack(">II", payload[16:24])
    return None


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


app = FastAPI(title="Canvas Transfer API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def token_for(user: User) -> TokenResponse:
    return TokenResponse(access_token=create_access_token(user.id))


def canvas_element_count(content: dict[str, object]) -> int:
    pages = content.get("pages")
    if isinstance(pages, list):
        return sum(
            len(page.get("elements", []))
            for page in pages
            if isinstance(page, dict) and isinstance(page.get("elements", []), list)
        )
    elements = content.get("elements", [])
    return len(elements) if isinstance(elements, list) else 0


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/auth/register", response_model=TokenResponse, status_code=201)
async def register(
    credentials: Credentials, session: AsyncSession = Depends(get_session)
) -> TokenResponse:
    existing = await session.scalar(
        select(User).where(User.username == credentials.username)
    )
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT)
    user = User(
        username=credentials.username,
        password_hash=hash_password(credentials.password),
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return token_for(user)


@app.post("/api/auth/login", response_model=TokenResponse)
async def login(
    credentials: Credentials, session: AsyncSession = Depends(get_session)
) -> TokenResponse:
    user = await session.scalar(
        select(User).where(User.username == credentials.username)
    )
    if user is None or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return token_for(user)


@app.get("/api/auth/me", response_model=UserResponse)
async def me(user: User = Depends(get_current_user)) -> User:
    return user


async def owned_canvas(
    canvas_id: str, user: User, session: AsyncSession
) -> CanvasDocument:
    canvas = await session.get(CanvasDocument, canvas_id)
    if canvas is None or canvas.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return canvas


@app.get("/api/canvases", response_model=list[CanvasSummaryResponse])
async def list_canvases(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[CanvasSummaryResponse]:
    result = await session.scalars(
        select(CanvasDocument)
        .where(CanvasDocument.user_id == user.id)
        .order_by(CanvasDocument.updated_at.desc())
    )
    return [
        CanvasSummaryResponse(
            id=canvas.id,
            title=canvas.title,
            element_count=canvas_element_count(canvas.content),
            created_at=canvas.created_at,
            updated_at=canvas.updated_at,
        )
        for canvas in result
    ]


@app.post("/api/canvases", response_model=CanvasResponse, status_code=201)
async def create_canvas(
    payload: CanvasCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CanvasDocument:
    canvas = CanvasDocument(
        user_id=user.id,
        title=payload.title,
        content=payload.content.model_dump(mode="json", by_alias=True),
    )
    session.add(canvas)
    await session.commit()
    await session.refresh(canvas)
    return canvas


@app.get("/api/canvases/{canvas_id}", response_model=CanvasResponse)
async def get_canvas(
    canvas_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CanvasDocument:
    return await owned_canvas(canvas_id, user, session)


@app.patch("/api/canvases/{canvas_id}", response_model=CanvasResponse)
async def update_canvas(
    canvas_id: str,
    payload: CanvasUpdate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CanvasDocument:
    canvas = await owned_canvas(canvas_id, user, session)
    if payload.title is not None:
        canvas.title = payload.title
    if payload.content is not None:
        canvas.content = payload.content.model_dump(mode="json", by_alias=True)
    canvas.updated_at = utc_now()
    await session.commit()
    await session.refresh(canvas)
    return canvas


@app.delete("/api/canvases/{canvas_id}", status_code=204)
async def delete_canvas(
    canvas_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    canvas = await owned_canvas(canvas_id, user, session)
    await session.delete(canvas)
    await session.commit()
    return Response(status_code=204)


@app.post("/api/latex/layout", response_model=LatexLayoutResponse)
async def create_latex_layout(
    payload: LatexLayoutRequest,
    _user: User = Depends(get_current_user),
) -> LatexLayoutResponse:
    try:
        result = layout_latex(
            payload.latex,
            payload.font_size,
            max_width=payload.max_width,
            max_height=payload.max_height,
        )
    except LatexParseError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
    return LatexLayoutResponse.model_validate(result)


@app.post("/api/ai/canvas", response_model=AiCanvasResponse)
async def canvas_ai(
    language: Literal["ru", "en", "zh"] = Form(),
    prompt: str = Form(min_length=1, max_length=20_000),
    chat_id: str = Form(),
    image: UploadFile | None = File(default=None),
    previous_solution: str | None = Form(default=None, max_length=100_000),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AiCanvasResponse:
    await owned_chat(chat_id, user, session)
    messages = list(await session.scalars(
        select(AiChatMessage).where(AiChatMessage.chat_id == chat_id)
        .order_by(AiChatMessage.created_at.desc()).limit(16)
    ))
    messages.reverse()
    payload = None
    mime_type = "image/png"
    if image:
        if image.content_type not in {"image/png", "image/jpeg"}:
            raise HTTPException(status_code=415)
        payload = await image.read(MAX_IMAGE_BYTES + 1)
        if not payload or len(payload) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413)
        mime_type = image.content_type
    else:
        image_message = await session.scalar(
            select(AiChatMessage).where(
                AiChatMessage.chat_id == chat_id,
                AiChatMessage.role == "user",
                AiChatMessage.image_data_url.is_not(None),
            ).order_by(AiChatMessage.created_at.desc()).limit(1)
        )
        for message in [image_message] if image_message else []:
            if message.image_data_url and message.image_data_url.startswith(("data:image/png;base64,", "data:image/jpeg;base64,")):
                prefix, encoded = message.image_data_url.split(",", 1)
                try:
                    payload = base64.b64decode(encoded, validate=True)
                except ValueError:
                    raise HTTPException(status_code=422, detail="Invalid task image")
                if len(payload) > MAX_IMAGE_BYTES:
                    raise HTTPException(status_code=413)
                mime_type = prefix[5:].split(";", 1)[0]
                break
    history = [(message.role, message.content[:8_000]) for message in messages]
    if history and history[-1] == ("user", prompt):
        history.pop()
    try:
        return await request_canvas_solution(
            prompt, payload, mime_type, language=language, history=history,
            previous_solution=previous_solution, request_id=uuid4().hex[:12],
        )
    except QwenNotConfiguredError as error:
        raise HTTPException(status_code=503, detail="Qwen API is not configured") from error
    except QwenRequestError as error:
        raise HTTPException(status_code=502, detail="Could not prepare a canvas solution") from error


@app.post("/api/ai/sidebar", response_model=AiSidebarResponse)
async def sidebar_ai(
    image: UploadFile = File(),
    language: Literal["ru", "en", "zh"] = Form(),
    prompt: str | None = Form(default=None, max_length=100_000),
    user: User = Depends(get_current_user),
) -> AiSidebarResponse:
    if image.content_type != "image/png":
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE)
    payload = await image.read(MAX_IMAGE_BYTES + 1)
    if not payload or len(payload) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
    request_id = uuid4().hex[:12]
    resolved_prompt = prompt.strip() if prompt and prompt.strip() else AI_PROMPTS[language]
    dimensions = png_dimensions(payload)
    logger.info(
        "[ai:%s] Incoming sidebar request user_id=%s username=%r language=%s "
        "prompt=%r filename=%r mime=%s image_bytes=%d image_dimensions=%s sha256=%s",
        request_id,
        user.id,
        user.username,
        language,
        resolved_prompt,
        image.filename,
        image.content_type,
        len(payload),
        f"{dimensions[0]}x{dimensions[1]}" if dimensions else "unknown",
        hashlib.sha256(payload).hexdigest(),
    )
    try:
        answer = await request_qwen(
            resolved_prompt,
            payload,
            image.content_type,
            request_id=request_id,
        )
    except QwenNotConfiguredError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Qwen API is not configured",
        ) from error
    except QwenRequestError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Qwen API request failed",
        ) from error
    logger.info(
        "[ai:%s] Sidebar response answer_chars=%d answer=%r",
        request_id,
        len(answer),
        answer,
    )
    return AiSidebarResponse(text=answer)


async def owned_chat(
    chat_id: str, user: User, session: AsyncSession
) -> AiChat:
    chat = await session.get(AiChat, chat_id)
    if chat is None or chat.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return chat


@app.get("/api/ai/chats", response_model=list[AiChatResponse])
async def list_ai_chats(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[AiChat]:
    result = await session.scalars(
        select(AiChat)
        .options(selectinload(AiChat.messages))
        .where(AiChat.user_id == user.id)
        .order_by(AiChat.created_at.asc())
    )
    return list(result.unique())


@app.post("/api/ai/chats", response_model=AiChatResponse, status_code=201)
async def create_ai_chat(
    payload: AiChatCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AiChat:
    chat = AiChat(user_id=user.id, title=payload.title)
    session.add(chat)
    await session.commit()
    await session.refresh(chat, attribute_names=["messages"])
    return chat


@app.post(
    "/api/ai/chats/{chat_id}/messages",
    response_model=AiChatMessageResponse,
    status_code=201,
)
async def create_ai_chat_message(
    chat_id: str,
    payload: AiChatMessageCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AiChatMessage:
    await owned_chat(chat_id, user, session)
    message = AiChatMessage(
        chat_id=chat_id,
        role=payload.role,
        content=payload.content,
        image_data_url=payload.image_data_url,
    )
    session.add(message)
    await session.commit()
    await session.refresh(message)
    return message


@app.post("/api/images", response_model=ImageMetadata, status_code=201)
async def upload_image(
    image: UploadFile = File(),
    width: int = Form(gt=0),
    height: int = Form(gt=0),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ImageTransfer:
    if image.content_type != "image/png":
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE)
    payload = await image.read(MAX_IMAGE_BYTES + 1)
    if not payload or len(payload) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)

    created_at = datetime.now().astimezone()
    transfer = ImageTransfer(
        user_id=user.id,
        filename=f"canvas-{created_at.strftime('%Y%m%d-%H%M%S')}.png",
        mime_type="image/png",
        width=width,
        height=height,
        size_bytes=len(payload),
        image_data=payload,
    )
    session.add(transfer)
    await session.commit()
    await session.refresh(transfer)

    await manager.send_to_user(
        user.id,
        {"type": "image", "image": ImageMetadata.model_validate(transfer).model_dump(mode="json")},
    )
    return transfer


async def owned_transfer(
    image_id: str, user: User, session: AsyncSession
) -> ImageTransfer:
    transfer = await session.get(ImageTransfer, image_id)
    if transfer is None or transfer.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return transfer


@app.get("/api/images/{image_id}/content")
async def image_content(
    image_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    transfer = await owned_transfer(image_id, user, session)
    return Response(
        content=transfer.image_data,
        media_type=transfer.mime_type,
        headers={"Content-Disposition": f'inline; filename="{transfer.filename}"'},
    )


@app.get("/api/images", response_model=list[ImageMetadata])
async def pending_images(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ImageTransfer]:
    result = await session.scalars(
        select(ImageTransfer)
        .where(ImageTransfer.user_id == user.id)
        .order_by(ImageTransfer.created_at.asc())
    )
    return list(result)


@app.post("/api/images/{image_id}/ack", status_code=204)
async def acknowledge_image(
    image_id: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    transfer = await owned_transfer(image_id, user, session)
    await session.delete(transfer)
    await session.commit()
    return Response(status_code=204)


@app.websocket("/ws")
async def websocket_channel(websocket: WebSocket) -> None:
    authorization = websocket.headers.get("authorization", "")
    token = authorization.removeprefix("Bearer ")
    user_id = decode_access_token(token)
    if user_id is None:
        await websocket.close(code=1008)
        return
    async with SessionLocal() as session:
        if await session.get(User, user_id) is None:
            await websocket.close(code=1008)
            return

    await manager.connect(user_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(user_id, websocket)
