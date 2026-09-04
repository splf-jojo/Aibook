"""Upgrade canvas JSON documents to the multipage schema.

Revision ID: 20260904_0003
Revises: 20260903_0002
Create Date: 2026-09-04
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260904_0003"
down_revision: str | None = "20260903_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


canvases = sa.table(
    "canvases",
    sa.column("id", sa.String(length=36)),
    sa.column("content", sa.JSON()),
)


def upgrade() -> None:
    connection = op.get_bind()
    rows = connection.execute(sa.select(canvases.c.id, canvases.c.content)).all()
    for canvas_id, content in rows:
        if not isinstance(content, dict) or "pages" in content:
            continue
        if content.get("schemaVersion", content.get("schema_version", 1)) != 1:
            continue
        upgraded = {
            "schemaVersion": 2,
            "pages": [
                {
                    "id": f"page-{canvas_id}",
                    "width": content.get("pageWidth", content.get("page_width", 794)),
                    "height": content.get("pageHeight", content.get("page_height", 1123)),
                    "pageTemplate": "plain",
                    "elements": content.get("elements", []),
                }
            ],
        }
        connection.execute(
            sa.update(canvases)
            .where(canvases.c.id == canvas_id)
            .values(content=upgraded)
        )


def downgrade() -> None:
    # Multipage documents cannot be reduced to v1 without data loss.
    pass
