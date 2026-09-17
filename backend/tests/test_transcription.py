import asyncio
import base64
import json
from types import SimpleNamespace

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app
from app import transcription as transcription_module


class FakeOpenAI:
    def __init__(self):
        self.events = asyncio.Queue()
        self.item = 0
        self.audio = b""

    async def send(self, raw: str):
        event = json.loads(raw)
        if event["type"] == "session.update":
            assert event["session"]["type"] == "transcription"
            assert event["session"]["audio"]["input"]["format"] == {
                "type": "audio/pcm", "rate": 24000
            }
            assert event["session"]["audio"]["input"]["transcription"] == {
                "model": "gpt-realtime-whisper", "language": "en"
            }
            assert event["session"]["audio"]["input"]["turn_detection"] is None
            await self.events.put(json.dumps({"type": "session.updated"}))
        elif event["type"] == "input_audio_buffer.append":
            self.audio += base64.b64decode(event["audio"])
            await self.events.put(json.dumps({
                "type": "conversation.item.input_audio_transcription.delta",
                "item_id": f"item-{self.item + 1}",
                "delta": "Hello",
            }))
        elif event["type"] == "input_audio_buffer.commit":
            self.item += 1
            item_id = f"item-{self.item}"
            await self.events.put(json.dumps({
                "type": "input_audio_buffer.committed", "item_id": item_id,
            }))
            await self.events.put(json.dumps({
                "type": "conversation.item.input_audio_transcription.completed",
                "item_id": item_id,
                "transcript": "Hello world.",
            }))

    async def recv(self):
        return await self.events.get()


class FakeConnection:
    def __init__(self, upstream: FakeOpenAI):
        self.upstream = upstream

    async def __aenter__(self):
        return self.upstream

    async def __aexit__(self, *_):
        return False


def register(client: TestClient) -> str:
    response = client.post(
        "/api/auth/register",
        json={"username": "voice-user", "password": "password-voice"},
    )
    return response.json()["access_token"]


def test_authenticated_realtime_transcription_proxy(monkeypatch) -> None:
    upstream = FakeOpenAI()
    monkeypatch.setattr(transcription_module, "settings", SimpleNamespace(
        openai_api_key="test-openai-key",
        openai_realtime_url="wss://example.invalid/v1/realtime",
        openai_transcription_model="gpt-realtime-whisper",
    ))
    def connect(url: str, **_):
        assert url == "wss://example.invalid/v1/realtime?intent=transcription"
        return FakeConnection(upstream)

    monkeypatch.setattr(transcription_module, "openai_connect", connect)

    with TestClient(app) as client:
        token = register(client)
        with client.websocket_connect(
            "/ws/transcriptions", headers={"Authorization": "Bearer " + token}
        ) as websocket:
            websocket.send_json({
                "type": "start",
                "recordId": "101fd51b-e27d-4a79-89fd-10bfb8859f03",
                "language": "en",
                "startOffset": 0,
            })
            assert websocket.receive_json()["type"] == "ready"
            audio = b"\x00\x00" * 2400
            websocket.send_bytes(audio)
            websocket.send_json({"type": "stop"})
            messages = [websocket.receive_json() for _ in range(3)]

    assert upstream.audio == audio
    assert [message["type"] for message in messages] == ["partial", "final", "complete"]
    assert messages[1]["text"] == "Hello world."
    assert messages[1]["committedBytes"] == len(audio)


def test_transcription_rejects_unauthenticated_connection() -> None:
    with TestClient(app) as client:
        try:
            with client.websocket_connect("/ws/transcriptions"):
                raise AssertionError("unauthenticated websocket was accepted")
        except WebSocketDisconnect as error:
            assert error.code == 1008
