from fastapi.testclient import TestClient
import pytest

from app import main as main_module
from app.main import app

def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_public_auth_and_health_with_account_protected_routes() -> None:
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/docs").status_code == 200
        assert client.get("/openapi.json").status_code == 200
        assert client.get("/api/canvases").status_code == 401
        assert client.post(
            "/api/latex/layout", json={"latex": "x"}
        ).status_code == 401

        preflight = client.options(
            "/api/auth/login",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert preflight.status_code == 200


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

    async def fake_request_qwen(
        prompt: str,
        image: bytes,
        mime_type: str,
        *,
        request_id: str,
    ) -> str:
        assert len(request_id) == 12
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


def test_ai_chat_history_is_saved_and_private() -> None:
    with TestClient(app) as client:
        alice = client.post(
            "/api/auth/register",
            json={"username": "history-alice", "password": "password-one"},
        )
        bob = client.post(
            "/api/auth/register",
            json={"username": "history-bob", "password": "password-two"},
        )
        alice_token = alice.json()["access_token"]
        bob_token = bob.json()["access_token"]

        created = client.post(
            "/api/ai/chats",
            headers=auth_header(alice_token),
            json={"title": "Решение интеграла"},
        )
        assert created.status_code == 201
        chat = created.json()
        assert chat["title"] == "Решение интеграла"
        assert chat["messages"] == []

        user_message = client.post(
            f"/api/ai/chats/{chat['id']}/messages",
            headers=auth_header(alice_token),
            json={
                "role": "user",
                "content": "Реши задачу",
                "image_data_url": "data:image/png;base64,c2VsZWN0aW9u",
            },
        )
        assistant_message = client.post(
            f"/api/ai/chats/{chat['id']}/messages",
            headers=auth_header(alice_token),
            json={"role": "assistant", "content": "**Ответ:** 42"},
        )
        assert user_message.status_code == 201
        assert assistant_message.status_code == 201

        history = client.get("/api/ai/chats", headers=auth_header(alice_token))
        assert history.status_code == 200
        assert history.json()[0]["id"] == chat["id"]
        assert [message["content"] for message in history.json()[0]["messages"]] == [
            "Реши задачу",
            "**Ответ:** 42",
        ]
        assert history.json()[0]["messages"][0]["image_data_url"] == (
            "data:image/png;base64,c2VsZWN0aW9u"
        )
        assert history.json()[0]["messages"][1]["image_data_url"] is None

        assert client.get("/api/ai/chats", headers=auth_header(bob_token)).json() == []
        assert client.post(
            f"/api/ai/chats/{chat['id']}/messages",
            headers=auth_header(bob_token),
            json={"role": "user", "content": "Чужая история"},
        ).status_code == 404


def test_latex_layout_is_calculated_by_backend() -> None:
    with TestClient(app) as client:
        registered = client.post(
            "/api/auth/register",
            json={"username": "latex-user", "password": "password-latex"},
        )
        token = registered.json()["access_token"]

        response = client.post(
            "/api/latex/layout",
            headers=auth_header(token),
            json={
                "latex": r"\frac{x^2}{2}",
                "fontSize": 44,
                "maxWidth": 714,
                "maxHeight": 963,
            },
        )

        assert response.status_code == 200
        layout = response.json()
        assert layout["width"] <= 714
        assert layout["height"] <= 963
        assert any(
            item["kind"] == "line" and item["role"] == "fraction-bar"
            for item in layout["objects"]
        )
        assert "fontSize" in next(
            item for item in layout["objects"] if item["kind"] == "text"
        )

        integral = client.post(
            "/api/latex/layout",
            headers=auth_header(token),
            json={"latex": r"\int_0^1 x\,dx"},
        ).json()
        integral_symbol = next(
            item
            for item in integral["objects"]
            if item["kind"] == "text" and item["text"] == "∫"
        )
        assert "KaTeX_Size2" in integral_symbol["fontFamily"]

        invalid = client.post(
            "/api/latex/layout",
            headers=auth_header(token),
            json={"latex": r"\matrix{1}"},
        )
        assert invalid.status_code == 422
        assert invalid.json()["detail"] == r"Unsupported command \matrix"


def test_canvases_are_saved_updated_listed_and_private() -> None:
    with TestClient(app) as client:
        alice_token = client.post(
            "/api/auth/register",
            json={"username": "canvas-alice", "password": "password-one"},
        ).json()["access_token"]
        bob_token = client.post(
            "/api/auth/register",
            json={"username": "canvas-bob", "password": "password-two"},
        ).json()["access_token"]

        created = client.post(
            "/api/canvases",
            headers=auth_header(alice_token),
            json={
                "title": "Алгебра",
                "content": {
                    "schemaVersion": 2,
                    "pages": [
                        {
                            "id": "page-1",
                            "width": 794,
                            "height": 1123,
                            "pageTemplate": "grid",
                            "appleDrawingData": "cGtEcmF3aW5n",
                            "elements": [
                                {
                                    "id": "stroke-1",
                                    "kind": "stroke",
                                    "mode": "draw",
                                    "samples": [
                                        {
                                            "x": 1,
                                            "y": 2,
                                            "timeOffset": 0,
                                            "size": {"width": 4.5, "height": 4.5},
                                            "opacity": 1,
                                            "force": 0.7,
                                            "azimuth": 0.2,
                                            "altitude": 1.1,
                                        },
                                        {
                                            "x": 3,
                                            "y": 4,
                                            "timeOffset": 0.01,
                                            "size": {"width": 5, "height": 5},
                                            "opacity": 0.9,
                                            "force": 0.8,
                                        },
                                    ],
                                    "strokeWidth": 4.5,
                                    "stroke": "#111827",
                                    "tool": "pen",
                                    "transform": {
                                        "a": 1,
                                        "b": 0,
                                        "c": 0,
                                        "d": 1,
                                        "tx": 0,
                                        "ty": 0,
                                    },
                                    "randomSeed": 42,
                                }
                            ],
                        },
                        {
                            "id": "page-2",
                            "width": 794,
                            "height": 1123,
                            "pageTemplate": "ruled",
                            "elements": [
                                {
                                    "id": "text-1",
                                    "kind": "text",
                                    "x": 10,
                                    "y": 20,
                                    "width": 200,
                                    "text": "x = 42",
                                    "fontSize": 30,
                                }
                            ],
                        },
                    ],
                },
            },
        )
        assert created.status_code == 201
        canvas = created.json()
        assert canvas["title"] == "Алгебра"
        assert canvas["content"]["schemaVersion"] == 2
        assert len(canvas["content"]["pages"]) == 2
        assert canvas["content"]["pages"][0]["elements"][0]["points"] == [
            1.0,
            2.0,
            3.0,
            4.0,
        ]

        summaries = client.get(
            "/api/canvases", headers=auth_header(alice_token)
        ).json()
        assert summaries[0]["id"] == canvas["id"]
        assert summaries[0]["elementCount"] == 2

        updated = client.patch(
            f"/api/canvases/{canvas['id']}",
            headers=auth_header(alice_token),
            json={
                "title": "Новая алгебра",
                "content": {
                    "schemaVersion": 2,
                    "pages": [
                        {
                            "id": "page-1",
                            "width": 794,
                            "height": 1123,
                            "pageTemplate": "plain",
                            "elements": [],
                        }
                    ],
                },
            },
        )
        assert updated.status_code == 200
        assert updated.json()["title"] == "Новая алгебра"
        assert updated.json()["content"]["pages"][0]["elements"] == []

        assert client.get(
            f"/api/canvases/{canvas['id']}", headers=auth_header(bob_token)
        ).status_code == 404
        assert client.delete(
            f"/api/canvases/{canvas['id']}", headers=auth_header(bob_token)
        ).status_code == 404

        deleted = client.delete(
            f"/api/canvases/{canvas['id']}", headers=auth_header(alice_token)
        )
        assert deleted.status_code == 204
        assert client.get(
            "/api/canvases", headers=auth_header(alice_token)
        ).json() == []


def test_legacy_canvas_content_is_upgraded_to_one_v2_page() -> None:
    with TestClient(app) as client:
        token = client.post(
            "/api/auth/register",
            json={"username": "legacy-canvas", "password": "password-one"},
        ).json()["access_token"]

        created = client.post(
            "/api/canvases",
            headers=auth_header(token),
            json={
                "title": "Старая заметка",
                "content": {
                    "schemaVersion": 1,
                    "pageWidth": 794,
                    "pageHeight": 1123,
                    "elements": [
                        {
                            "id": "stroke-1",
                            "kind": "stroke",
                            "mode": "draw",
                            "points": [1, 2, 3, 4],
                            "strokeWidth": 4.5,
                        }
                    ],
                },
            },
        )

        assert created.status_code == 201
        content = created.json()["content"]
        assert content["schemaVersion"] == 2
        assert content["pages"][0]["id"] == "page-1"
        assert content["pages"][0]["pageTemplate"] == "plain"
        assert len(content["pages"][0]["elements"]) == 1
