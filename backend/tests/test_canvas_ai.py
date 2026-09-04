import asyncio
import base64

import pytest
from fastapi.testclient import TestClient

from app import main as main_module, qwen
from app.main import app
from app.schemas import AiCanvasResponse, CanvasContent
from pydantic import ValidationError


SOLUTION = {
    "status": "solution", "explanation": "Isolate the unknown.",
    "steps": [{"latex": r"x=\frac{18}{3}=6", "explanation": "Divide both sides by three."}],
}


def test_canvas_ai_uses_owned_chat_context_without_saving_canvas(monkeypatch):
    calls = []

    async def fake_solution(prompt, image, mime_type, **kwargs):
        calls.append((prompt, image, mime_type, kwargs))
        return AiCanvasResponse.model_validate(SOLUTION)

    monkeypatch.setattr(main_module, "request_canvas_solution", fake_solution)
    with TestClient(app) as client:
        def account(name):
            token = client.post("/api/auth/register", json={"username": name, "password": "test-password"}).json()["access_token"]
            return {"Authorization": f"Bearer {token}"}

        alice, bob = account("canvas-ai-alice"), account("canvas-ai-bob")
        canvas = client.post("/api/canvases", headers=alice, json={"title": "Task"}).json()
        chat = client.post("/api/ai/chats", headers=alice, json={"title": "Task"}).json()
        original_image = b"original-task-image"
        image_url = "data:image/png;base64," + base64.b64encode(original_image).decode()
        client.post(f"/api/ai/chats/{chat['id']}/messages", headers=alice,
                    json={"role": "user", "content": "Solve this", "image_data_url": image_url})
        client.post(f"/api/ai/chats/{chat['id']}/messages", headers=alice,
                    json={"role": "assistant", "content": "Divide both sides."})
        request = {"language": "ru", "prompt": "Explain the last step", "chat_id": chat["id"], "previous_solution": '{"draft":true}'}
        assert client.post("/api/ai/canvas", data=request).status_code == 401
        assert client.post("/api/ai/canvas", headers=bob, data=request).status_code == 404
        response = client.post("/api/ai/canvas", headers=alice, data=request)
        assert response.status_code == 200
        assert response.json()["steps"][0]["latex"] == SOLUTION["steps"][0]["latex"]
        assert calls[0][1] == original_image
        assert calls[0][3]["language"] == "ru"
        assert calls[0][3]["history"][-1] == ("assistant", "Divide both sides.")
        assert calls[0][3]["previous_solution"] == '{"draft":true}'
        assert client.get(f"/api/canvases/{canvas['id']}", headers=alice).json()["content"] == canvas["content"]
        assert client.post("/api/ai/canvas", headers=alice, data=request,
                           files={"image": ("bad.svg", b"svg", "image/svg+xml")}).status_code == 415


def test_structured_response_is_repaired_once(monkeypatch):
    answers = iter(["not json", __import__("json").dumps(SOLUTION)])
    calls = []

    async def fake_request(*args, **kwargs):
        calls.append(kwargs)
        return next(answers)

    monkeypatch.setattr(qwen, "request_qwen", fake_request)
    result = asyncio.run(qwen.request_canvas_solution("solve", None, "image/png", language="en", history=[]))
    assert result.status == "solution"
    assert len(calls) == 2
    assert "plain English" in calls[0]["system_prompt"]
    assert calls[1]["history"] == [("assistant", "not json")]


def test_invalid_solution_never_becomes_a_draft(monkeypatch):
    async def bad_request(*args, **kwargs):
        return '{"status":"solution","explanation":"done","steps":[]}'

    monkeypatch.setattr(qwen, "request_qwen", bad_request)
    with pytest.raises(qwen.QwenRequestError):
        asyncio.run(qwen.request_canvas_solution("solve", None, "image/png", language="ru", history=[]))


def test_accepted_formula_metadata_survives_schema_round_trip():
    content = CanvasContent.model_validate({"schemaVersion": 2, "pages": [{"id": "page-1", "elements": [{
        "id": "formula-1", "kind": "image", "x": 36, "y": 100, "width": 350, "height": 80,
        "dataUrl": "data:image/png;base64,eA==", "source": "latex", "latex": r"x=\frac{1}{2}",
        "formulaInstanceId": "formula-1", "solutionId": "solution-1",
    }]}]})
    formula = content.model_dump(by_alias=True)["pages"][0]["elements"][0]
    assert formula["latex"] == r"x=\frac{1}{2}"
    assert formula["solutionId"] == "solution-1"
    assert formula["dataUrl"].startswith("data:image/png;")


def test_chart_only_steps_are_valid_but_empty_steps_are_not():
    chart = {"bars": [{"label": "0", "value": 0.5}, {"label": "1", "value": 0.5}]}
    assert AiCanvasResponse.model_validate({**SOLUTION, "steps": [
        {"latex": "", "explanation": "Draw the distribution.", "chart": chart},
    ]}).steps[0].chart is not None
    with pytest.raises(ValidationError):
        AiCanvasResponse.model_validate({**SOLUTION, "steps": [{"latex": "", "explanation": "Empty"}]})
    with pytest.raises(ValidationError):
        AiCanvasResponse.model_validate({**SOLUTION, "steps": [{"latex": "\frac{1}{2}", "explanation": "Bad escaping"}]})
