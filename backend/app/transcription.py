"""Authenticated proxy for OpenAI realtime speech transcription."""
from __future__ import annotations

import base64
from collections import deque
import hashlib
import asyncio
import json
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from websockets.asyncio.client import connect as openai_connect
from websockets.exceptions import ConnectionClosed

from .config import settings
from .database import SessionLocal
from .models import User
from .security import decode_access_token

router = APIRouter()

SAMPLE_RATE = 24_000
BYTES_PER_SAMPLE = 2
MAX_RECORDING_SECONDS = 120 * 60
MAX_RECORDING_BYTES = SAMPLE_RATE * BYTES_PER_SAMPLE * MAX_RECORDING_SECONDS
SEGMENT_SECONDS = 15
SEGMENT_BYTES = SAMPLE_RATE * BYTES_PER_SAMPLE * SEGMENT_SECONDS
MAX_CLIENT_MESSAGE_BYTES = SAMPLE_RATE * BYTES_PER_SAMPLE


async def authenticated_user(websocket: WebSocket) -> User | None:
    authorization = websocket.headers.get("authorization", "")
    user_id = decode_access_token(authorization.removeprefix("Bearer "))
    if user_id is None:
        return None
    async with SessionLocal() as session:
        return await session.get(User, user_id)


async def send_error(websocket: WebSocket, message: str) -> None:
    try:
        await websocket.send_json({"type": "error", "message": message})
    except (RuntimeError, WebSocketDisconnect):
        pass


def parse_start(message: str) -> tuple[str, str, int]:
    try:
        payload = json.loads(message)
        if payload.get("type") != "start":
            raise ValueError
        record_id = str(UUID(payload["recordId"]))
        language = payload.get("language", "en")
        if language != "en":
            raise ValueError
        start_offset = int(payload.get("startOffset", 0))
        if start_offset < 0 or start_offset > MAX_RECORDING_BYTES:
            raise ValueError
        return record_id, language, start_offset
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise ValueError("Invalid transcription start message") from error


async def receive_openai_event(upstream) -> dict:
    raw = await upstream.recv()
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    event = json.loads(raw)
    if not isinstance(event, dict) or not isinstance(event.get("type"), str):
        raise ValueError("Invalid OpenAI event")
    return event


@router.websocket("/ws/transcriptions")
async def realtime_transcription(websocket: WebSocket) -> None:
    user = await authenticated_user(websocket)
    if user is None:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    if not settings.openai_api_key:
        await send_error(websocket, "OpenAI transcription is not configured")
        await websocket.close(code=1011)
        return

    try:
        record_id, language, start_offset = parse_start(await websocket.receive_text())
    except (ValueError, WebSocketDisconnect) as error:
        if isinstance(error, ValueError):
            await send_error(websocket, str(error))
        await websocket.close(code=1008)
        return

    safety_id = hashlib.sha256(f"aibook:{user.id}".encode()).hexdigest()
    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "OpenAI-Safety-Identifier": safety_id,
    }
    pending_boundaries: deque[int] = deque()
    item_boundaries: dict[str, int] = {}
    received_bytes = 0
    buffered_bytes = 0
    stopping = False

    try:
        async with openai_connect(
            f"{settings.openai_realtime_url}?intent=transcription",
            additional_headers=headers,
            max_size=2 * 1024 * 1024,
            ping_interval=20,
            ping_timeout=20,
        ) as upstream:
            await upstream.send(json.dumps({
                "type": "session.update",
                "session": {
                    "type": "transcription",
                    "audio": {
                        "input": {
                            "format": {"type": "audio/pcm", "rate": SAMPLE_RATE},
                            "transcription": {
                                "model": settings.openai_transcription_model,
                                "language": language,
                            },
                            "turn_detection": None,
                        }
                    },
                },
            }))

            client_receive = None
            upstream_receive = None
            try:
                while True:
                    if client_receive is None and not stopping:
                        client_receive = asyncio.create_task(websocket.receive())
                    if upstream_receive is None:
                        upstream_receive = asyncio.create_task(receive_openai_event(upstream))
                    active = {task for task in (client_receive, upstream_receive) if task is not None}
                    done, _ = await asyncio.wait(active, return_when=asyncio.FIRST_COMPLETED)

                    if client_receive in done:
                        incoming = client_receive.result()
                        client_receive = None
                        if incoming["type"] == "websocket.disconnect":
                            raise WebSocketDisconnect(incoming.get("code", 1000))
                        if incoming.get("bytes") is not None:
                            audio = incoming["bytes"]
                            if not audio or len(audio) > MAX_CLIENT_MESSAGE_BYTES:
                                raise ValueError("Invalid audio chunk")
                            received_bytes += len(audio)
                            buffered_bytes += len(audio)
                            if start_offset + received_bytes > MAX_RECORDING_BYTES:
                                raise ValueError("Recording exceeds 120 minutes")
                            await upstream.send(json.dumps({
                                "type": "input_audio_buffer.append",
                                "audio": base64.b64encode(audio).decode("ascii"),
                            }))
                            if buffered_bytes >= SEGMENT_BYTES:
                                boundary = start_offset + received_bytes
                                await upstream.send(json.dumps({"type": "input_audio_buffer.commit"}))
                                pending_boundaries.append(boundary)
                                buffered_bytes = 0
                        elif incoming.get("text") is not None:
                            payload = json.loads(incoming["text"])
                            if payload.get("type") != "stop":
                                raise ValueError("Invalid transcription command")
                            stopping = True
                            if buffered_bytes:
                                boundary = start_offset + received_bytes
                                await upstream.send(json.dumps({"type": "input_audio_buffer.commit"}))
                                pending_boundaries.append(boundary)
                                buffered_bytes = 0

                    if upstream_receive in done:
                        event = upstream_receive.result()
                        upstream_receive = None
                        event_type = event["type"]
                        if event_type == "session.updated":
                            await websocket.send_json({"type": "ready", "recordId": record_id})
                        elif event_type == "input_audio_buffer.committed":
                            if pending_boundaries:
                                item_boundaries[event["item_id"]] = pending_boundaries.popleft()
                        elif event_type == "conversation.item.input_audio_transcription.delta":
                            await websocket.send_json({
                                "type": "partial",
                                "itemId": event.get("item_id"),
                                "text": event.get("delta", ""),
                            })
                        elif event_type == "conversation.item.input_audio_transcription.completed":
                            item_id = event.get("item_id")
                            boundary = item_boundaries.pop(item_id, None)
                            await websocket.send_json({
                                "type": "final",
                                "itemId": item_id,
                                "text": event.get("transcript", ""),
                                "committedBytes": boundary,
                            })
                        elif event_type == "error":
                            detail = event.get("error", {})
                            raise RuntimeError(detail.get("message", "OpenAI transcription failed"))

                    if stopping and not pending_boundaries and not item_boundaries and buffered_bytes == 0:
                        await websocket.send_json({"type": "complete", "recordId": record_id})
                        break
            finally:
                remaining = [
                    task for task in (client_receive, upstream_receive)
                    if task is not None and not task.done()
                ]
                for task in remaining:
                    task.cancel()
                if remaining:
                    await asyncio.gather(*remaining, return_exceptions=True)
    except WebSocketDisconnect:
        return
    except (ConnectionClosed, OSError, RuntimeError, ValueError, json.JSONDecodeError) as error:
        await send_error(websocket, str(error) or "Transcription connection failed")
        try:
            await websocket.close(code=1011)
        except RuntimeError:
            pass
