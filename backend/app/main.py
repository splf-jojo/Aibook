from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime
from typing import Literal

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

from .config import settings
from .database import Base, SessionLocal, engine, get_session
from .dependencies import get_current_user
from .models import ImageTransfer, User
from .qwen import QwenNotConfiguredError, QwenRequestError, request_qwen
from .realtime import manager
from .schemas import (
    AiSidebarResponse,
    Credentials,
    ImageMetadata,
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


@app.post("/api/ai/sidebar", response_model=AiSidebarResponse)
async def sidebar_ai(
    image: UploadFile = File(),
    language: Literal["ru", "en", "zh"] = Form(),
    _user: User = Depends(get_current_user),
) -> AiSidebarResponse:
    if image.content_type != "image/png":
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE)
    payload = await image.read(MAX_IMAGE_BYTES + 1)
    if not payload or len(payload) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
    try:
        answer = await request_qwen(AI_PROMPTS[language], payload, image.content_type)
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
    return AiSidebarResponse(text=answer)


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
