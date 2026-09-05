"""User-owned note groups; deleting a group keeps its notes."""
from alembic import op
import sqlalchemy as sa

revision = "20260905_0004"
down_revision = "20260904_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "note_groups",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_note_groups_user_id", "note_groups", ["user_id"])
    with op.batch_alter_table("canvases") as batch:
        batch.add_column(sa.Column("group_id", sa.String(36), nullable=True))
        batch.create_foreign_key("fk_canvases_group_id", "note_groups", ["group_id"], ["id"], ondelete="SET NULL")
        batch.create_index("ix_canvases_group_id", ["group_id"])


def downgrade() -> None:
    with op.batch_alter_table("canvases") as batch:
        batch.drop_index("ix_canvases_group_id")
        batch.drop_constraint("fk_canvases_group_id", type_="foreignkey")
        batch.drop_column("group_id")
    op.drop_index("ix_note_groups_user_id", table_name="note_groups")
    op.drop_table("note_groups")
