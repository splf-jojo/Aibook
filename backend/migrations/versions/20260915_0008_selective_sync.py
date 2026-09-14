"""Current sync revisions and separate voice storage; preserve existing canvases."""
import json
import sqlalchemy as sa
from alembic import op

revision = "20260915_0008"
down_revision = "20260910_0007"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("canvases", sa.Column("revision", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("canvases", sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"))
    connection = op.get_bind()
    canvases = sa.table("canvases", sa.column("id", sa.String()), sa.column("title", sa.String()),
                        sa.column("content", sa.JSON()), sa.column("size_bytes", sa.Integer()))
    last_id = None
    while True:
        query = sa.select(canvases.c.id, canvases.c.title, canvases.c.content).order_by(canvases.c.id).limit(1)
        if last_id is not None:
            query = query.where(canvases.c.id > last_id)
        row = connection.execute(query).first()
        if row is None:
            break
        last_id = row.id
        size = len(json.dumps(row.content, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) + len(row.title.encode("utf-8"))
        connection.execute(canvases.update().where(canvases.c.id == row.id).values(size_bytes=size))
    op.create_table("voice_records", sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False), sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("record", sa.JSON(), nullable=False), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_voice_records_user_id", "voice_records", ["user_id"])
    op.create_table("voice_clips", sa.Column("record_id", sa.String(36), sa.ForeignKey("voice_records.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("file_name", sa.String(40), primary_key=True), sa.Column("data", sa.LargeBinary(), nullable=False))


def downgrade():
    op.drop_table("voice_clips")
    op.drop_table("voice_records")
    op.drop_column("canvases", "size_bytes")
    op.drop_column("canvases", "revision")
