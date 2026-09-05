import base64
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app import main as main_module
from app.main import app
from app.qwen import QwenNotConfiguredError, QwenRequestError


PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhXcAAAAASUVORK5CYII="
)
IMAGE = "data:image/png;base64," + base64.b64encode(PNG).decode()


def account(client):
    response = client.post("/api/auth/register", json={
        "username": "chat-" + uuid4().hex[:14], "password": "test-password",
    })
    assert response.status_code == 201
    return {"Authorization": "Bearer " + response.json()["access_token"]}


def question(**overrides):
    return {"request_id": str(uuid4()), "prompt": "Explain this", "language": "en", **overrides}


def test_missing_chat_is_distinguishable_from_missing_route_without_disclosing_owner():
    with TestClient(app) as client:
        alice, bob = account(client), account(client)
        chat = client.post("/api/ai/chats", headers=alice, json={"title": "Private"}).json()
        for chat_id in [chat["id"], str(uuid4())]:
            path = f"/api/ai/chats/{chat_id}"
            for response in [client.get(path, headers=bob),
                             client.post(path + "/reply", headers=bob, json=question())]:
                assert response.status_code == 404
                assert response.json()["detail"]["code"] == "chat_not_found"
        missing_route = client.get("/api/no-such-route", headers=alice)
        assert missing_route.status_code == 404
        assert missing_route.json() == {"detail": "Not Found"}


def test_reply_uses_owned_history_and_latest_selection_and_persists_both_messages(monkeypatch):
    calls = []

    async def reply(prompt, image, mime_type, **kwargs):
        calls.append((prompt, image, mime_type, kwargs))
        return "Divide both sides by three."

    monkeypatch.setattr(main_module, "request_qwen", reply)
    with TestClient(app) as client:
        alice, bob = account(client), account(client)
        chat = client.post("/api/ai/chats", headers=alice, json={"title": "Algebra"}).json()
        path = f"/api/ai/chats/{chat['id']}"
        body = question(prompt="  Solve 3x=18  ", image_data_url=IMAGE, language="ru")
        assert client.post(path + "/reply", json=body).status_code == 401
        assert client.post(path + "/reply", headers=bob, json=body).status_code == 404
        assert client.get(path, headers=bob).status_code == 404
        response = client.post(path + "/reply", headers=alice, json=body)
        assert response.status_code == 200, response.text
        assert response.json()["user_message"]["content"] == "Solve 3x=18"
        assert calls[0][1] == PNG
        assert calls[0][2] == "image/png"
        assert calls[0][3]["history"] == []
        assert "Russian" in calls[0][3]["system_prompt"]
        followup = client.post(path + "/reply", headers=alice, json=question(prompt="Why divide?"))
        assert followup.status_code == 200
        assert calls[1][1] == PNG
        assert calls[1][3]["history"] == [
            ("user", "Solve 3x=18"), ("assistant", "Divide both sides by three."),
        ]
        saved = client.get(path, headers=alice).json()["messages"]
        assert [m["role"] for m in saved] == ["user", "assistant", "user", "assistant"]
        assert saved[0]["image_data_url"] == IMAGE
        assert saved[2]["image_data_url"] is None


def test_retry_after_lost_response_replays_without_another_model_call(monkeypatch):
    calls = []

    async def reply(*args, **kwargs):
        calls.append(args)
        return "Hello."

    monkeypatch.setattr(main_module, "request_qwen", reply)
    with TestClient(app) as client:
        headers = account(client)
        chat = client.post("/api/ai/chats", headers=headers, json={"title": "Notes"}).json()
        path = f"/api/ai/chats/{chat['id']}"
        body = question()
        first = client.post(path + "/reply", headers=headers, json=body)
        retry = client.post(path + "/reply", headers=headers, json=body)
        assert first.status_code == retry.status_code == 200
        assert first.json()["assistant_message"]["id"] == retry.json()["assistant_message"]["id"]
        assert calls[0][1] is None  # Text-only chat does not require a canvas image.
        assert len(calls) == 1
        assert len(client.get(path, headers=headers).json()["messages"]) == 2
        assert client.post(path + "/reply", headers=headers,
                           json={**body, "prompt": "A different question"}).status_code == 409


def test_history_order_is_stable_when_clock_ticks_are_identical(monkeypatch):
    fixed_time = datetime(2026, 9, 5, tzinfo=timezone.utc)
    monkeypatch.setattr(main_module, "utc_now", lambda: fixed_time)
    histories = []

    async def reply(prompt, *args, **kwargs):
        histories.append(kwargs["history"])
        return "Answer to " + prompt

    monkeypatch.setattr(main_module, "request_qwen", reply)
    with TestClient(app) as client:
        headers = account(client)
        chat = client.post("/api/ai/chats", headers=headers, json={"title": "Order"}).json()
        path = f"/api/ai/chats/{chat['id']}"
        for role, content in [("user", "First"), ("assistant", "Initial answer")]:
            response = client.post(path + "/messages", headers=headers,
                                   json={"role": role, "content": content})
            assert response.status_code == 201
        for prompt in ["Second", "Third"]:
            assert client.post(path + "/reply", headers=headers, json=question(prompt=prompt)).status_code == 200
        saved = client.get(path, headers=headers).json()["messages"]
        assert [m["content"] for m in saved] == [
            "First", "Initial answer", "Second", "Answer to Second", "Third", "Answer to Third",
        ]
        assert histories[1] == [(m["role"], m["content"]) for m in saved[:4]]
        times = [datetime.fromisoformat(m["created_at"]) for m in saved]
        assert all(before < after for before, after in zip(times, times[1:]))


@pytest.mark.parametrize("error, status", [(QwenRequestError("offline"), 502),
                                           (QwenNotConfiguredError("missing"), 503)])
def test_model_failure_leaves_history_unchanged_and_request_can_be_retried(monkeypatch, error, status):
    async def fail(*args, **kwargs):
        raise error

    async def succeed(*args, **kwargs):
        return "Recovered."

    monkeypatch.setattr(main_module, "request_qwen", fail)
    with TestClient(app) as client:
        headers = account(client)
        chat = client.post("/api/ai/chats", headers=headers, json={"title": "Notes"}).json()
        path = f"/api/ai/chats/{chat['id']}"
        body = question()
        assert client.post(path + "/reply", headers=headers, json=body).status_code == status
        assert client.get(path, headers=headers).json()["messages"] == []
        monkeypatch.setattr(main_module, "request_qwen", succeed)
        assert client.post(path + "/reply", headers=headers, json=body).status_code == 200
        assert len(client.get(path, headers=headers).json()["messages"]) == 2


@pytest.mark.parametrize("fields, status", [
    ({"prompt": " \n "}, 422), ({"prompt": "x" * 20001}, 422), ({"language": "bad"}, 422),
    ({"image_data_url": "data:image/svg+xml;base64,PHN2Zz4="}, 415),
    ({"image_data_url": "data:image/png;base64,!!!!"}, 422),
    ({"image_data_url": "data:image/png;base64,eA=="}, 415),
])
def test_invalid_requests_do_not_reach_model_or_mutate_chat(monkeypatch, fields, status):
    async def unexpected(*args, **kwargs):
        pytest.fail("Invalid input reached the model")

    monkeypatch.setattr(main_module, "request_qwen", unexpected)
    with TestClient(app) as client:
        headers = account(client)
        chat = client.post("/api/ai/chats", headers=headers, json={"title": "Notes"}).json()
        path = f"/api/ai/chats/{chat['id']}"
        assert client.post(path + "/reply", headers=headers, json=question(**fields)).status_code == status
        assert client.get(path, headers=headers).json()["messages"] == []
