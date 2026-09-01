from fastapi.testclient import TestClient
import pytest

from app import main as main_module
from app.main import app


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_personal_image_delivery_and_acknowledgement() -> None:
    with TestClient(app) as client:
        alice = client.post(
            "/api/auth/register",
            json={"username": "alice", "password": "password-one"},
        )
        bob = client.post(
            "/api/auth/register",
            json={"username": "bob-user", "password": "password-two"},
        )
        assert alice.status_code == 201
        assert bob.status_code == 201
        alice_token = alice.json()["access_token"]
        bob_token = bob.json()["access_token"]

        me = client.get("/api/auth/me", headers=auth_header(alice_token))
        assert me.status_code == 200
        assert me.json()["username"] == "alice"

        with client.websocket_connect(
            "/ws", headers=auth_header(alice_token)
        ) as websocket:
            uploaded = client.post(
                "/api/images",
                headers=auth_header(alice_token),
                files={"image": ("canvas.png", b"small-png-payload", "image/png")},
                data={"width": "120", "height": "80"},
            )
            assert uploaded.status_code == 201
            metadata = uploaded.json()
            event = websocket.receive_json()
            assert event["type"] == "image"
            assert event["image"]["id"] == metadata["id"]

        pending = client.get("/api/images", headers=auth_header(alice_token))
        assert [item["id"] for item in pending.json()] == [metadata["id"]]

        forbidden = client.get(
            f"/api/images/{metadata['id']}/content", headers=auth_header(bob_token)
        )
        assert forbidden.status_code == 404

        content = client.get(
            f"/api/images/{metadata['id']}/content", headers=auth_header(alice_token)
        )
        assert content.status_code == 200
        assert content.content == b"small-png-payload"

        acknowledged = client.post(
            f"/api/images/{metadata['id']}/ack", headers=auth_header(alice_token)
        )
        assert acknowledged.status_code == 204
        assert client.get("/api/images", headers=auth_header(alice_token)).json() == []


@pytest.mark.parametrize(
    ("language", "expected_prompt"),
    [
        ("ru", "Реши математическую задачу"),
        ("en", "Solve the math problem"),
        ("zh", "解答这道数学题"),
    ],
)
def test_sidebar_ai_uses_language_prompt(
    monkeypatch: pytest.MonkeyPatch,
    language: str,
    expected_prompt: str,
) -> None:
    calls: list[tuple[str, bytes, str]] = []

    async def fake_request_qwen(prompt: str, image: bytes, mime_type: str) -> str:
        calls.append((prompt, image, mime_type))
        return f"Qwen: {prompt}"

    monkeypatch.setattr(main_module, "request_qwen", fake_request_qwen)

    with TestClient(app) as client:
        registered = client.post(
            "/api/auth/register",
            json={"username": f"qwen-{language}", "password": "password-qwen"},
        )
        token = registered.json()["access_token"]
        response = client.post(
            "/api/ai/sidebar",
            headers=auth_header(token),
            files={"image": ("selection.png", b"selected-area", "image/png")},
            data={"language": language},
        )

    assert response.status_code == 200
    assert response.json() == {"text": f"Qwen: {expected_prompt}"}
    assert calls == [(expected_prompt, b"selected-area", "image/png")]
