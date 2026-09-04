"""Add optional images to AI chat messages.

Revision ID: 20260903_0002
Revises: 20260902_0001
Create Date: 2026-09-03
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260903_0002"
down_revision: str | None = "20260902_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "ai_chat_messages",
        sa.Column("image_data_url", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ai_chat_messages", "image_data_url")
