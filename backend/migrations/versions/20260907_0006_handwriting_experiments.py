"""Versioned handwriting mean-shape and augmentation experiments."""
from alembic import op

revision = "20260907_0006"
down_revision = "20260907_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE handwriting_experiments (
            dataset_id varchar(64) NOT NULL REFERENCES handwriting_datasets(id) ON DELETE CASCADE,
            source_version integer NOT NULL,
            analysis_key varchar(64) NOT NULL,
            latex varchar(200) NOT NULL,
            alignment varchar(16) NOT NULL CHECK (alignment IN ('centered','aligned')),
            revision integer NOT NULL CHECK (revision > 0),
            payload jsonb NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (dataset_id, analysis_key, latex, alignment)
        )
    """)


def downgrade() -> None:
    op.drop_table("handwriting_experiments")
