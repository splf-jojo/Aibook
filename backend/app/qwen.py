from __future__ import annotations

import base64
from typing import Any

from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI

from .config import settings


class QwenNotConfiguredError(RuntimeError):
    pass


class QwenRequestError(RuntimeError):
    pass


def _message_text(content: str | list[str | dict[str, Any]]) -> str:
    if isinstance(content, str):
        return content.strip()
    parts: list[str] = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict) and block.get("type") in {"text", "output_text"}:
            text = block.get("text")
            if isinstance(text, str):
                parts.append(text)
    return "\n".join(part for part in parts if part).strip()


async def request_qwen(prompt: str, image: bytes, mime_type: str) -> str:
    if not settings.qwen_api_key:
        raise QwenNotConfiguredError("API_KEY is not configured")

    encoded_image = base64.b64encode(image).decode("ascii")
    message = HumanMessage(
        content=[
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:{mime_type};base64,{encoded_image}",
                },
            },
            {"type": "text", "text": prompt},
        ]
    )
    model = ChatOpenAI(
        api_key=settings.qwen_api_key,
        base_url=settings.qwen_base_url,
        model=settings.qwen_model,
        temperature=0,
        timeout=60,
        max_retries=1,
        extra_body={"enable_thinking": False},
    )

    try:
        response = await model.ainvoke([message])
    except Exception as error:
        raise QwenRequestError("Qwen request failed") from error

    content = _message_text(response.content)
    if not content:
        raise QwenRequestError("Qwen returned an empty response")
    return content
