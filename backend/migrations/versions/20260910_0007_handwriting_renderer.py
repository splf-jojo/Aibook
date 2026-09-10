"""Keep old handwriting publications while publishing new source metrics."""
from alembic import op

revision = "20260910_0007"
down_revision = "20260907_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE handwriting_publications ADD COLUMN renderer_version integer NOT NULL DEFAULT 1")
    op.execute("ALTER TABLE handwriting_publications DROP CONSTRAINT handwriting_publications_dataset_id_source_version_key")
    op.execute("ALTER TABLE handwriting_publications ADD CONSTRAINT uq_handwriting_publication_renderer UNIQUE(dataset_id, source_version, renderer_version)")


def downgrade() -> None:
    # Refuse a lossy downgrade: old and new published IDs may both be in use.
    op.execute("ALTER TABLE handwriting_publications ADD CONSTRAINT handwriting_publications_dataset_id_source_version_key UNIQUE(dataset_id, source_version)")
    op.execute("ALTER TABLE handwriting_publications DROP CONSTRAINT uq_handwriting_publication_renderer")
    op.execute("ALTER TABLE handwriting_publications DROP COLUMN renderer_version")
