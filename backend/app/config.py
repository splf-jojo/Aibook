from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")


def _origins() -> tuple[str, ...]:
    raw = os.getenv("CORS_ORIGINS", "http://localhost:3000")
    return tuple(origin.strip() for origin in raw.split(",") if origin.strip())


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://aibook:aibook@localhost:5433/aibook",
    )
    jwt_secret: str = os.getenv(
        "JWT_SECRET", "dev-only-change-me-use-at-least-32-bytes"
    )
    access_token_minutes: int = int(os.getenv("ACCESS_TOKEN_MINUTES", "10080"))
    cors_origins: tuple[str, ...] = _origins()
    qwen_api_key: str | None = os.getenv("API_KEY")
    qwen_base_url: str = os.getenv(
        "QWEN_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"
    ).rstrip("/")
    qwen_model: str = os.getenv("QWEN_MODEL", "qwen3.8-flash")


settings = Settings()
