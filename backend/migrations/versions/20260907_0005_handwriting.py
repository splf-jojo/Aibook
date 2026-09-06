"""Account handwriting library, binary assets, persistent jobs and publications.

Handwriting processing runs in Node; Alembic owns the shared database schema.
No account is promoted by its username during migration.
"""
from alembic import op
import sqlalchemy as sa

revision = "20260907_0005"
down_revision = "20260905_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("role", sa.String(16), nullable=False, server_default="user"))
    op.create_check_constraint("ck_users_role", "users", "role IN ('user', 'dev')")
    statements = """
        CREATE TABLE handwriting_datasets (
            id varchar(64) PRIMARY KEY,
            owner_id varchar(36) NOT NULL REFERENCES users(id),
            fingerprint varchar(64) NOT NULL,
            name varchar(160) NOT NULL,
            candidates jsonb NOT NULL,
            source jsonb,
            review jsonb NOT NULL,
            version integer NOT NULL DEFAULT 0,
            summary jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE(owner_id, fingerprint)
        );
        CREATE INDEX ix_handwriting_owner ON handwriting_datasets(owner_id);
        CREATE TABLE handwriting_assets (
            dataset_id varchar(64) NOT NULL REFERENCES handwriting_datasets(id) ON DELETE CASCADE,
            sha256 varchar(64) NOT NULL,
            mime varchar(100) NOT NULL,
            data bytea NOT NULL,
            PRIMARY KEY(dataset_id, sha256)
        );
        CREATE TABLE handwriting_jobs (
            id varchar(64) PRIMARY KEY,
            dataset_id varchar(64) NOT NULL REFERENCES handwriting_datasets(id) ON DELETE CASCADE,
            source_version integer NOT NULL,
            status varchar(16) NOT NULL CHECK(status IN ('queued','running','complete','partial','failed')),
            progress jsonb NOT NULL DEFAULT '{"completed": 0,"total": 0}',
            result jsonb,
            error text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE(dataset_id, source_version)
        );
        CREATE INDEX ix_handwriting_jobs_queue ON handwriting_jobs(status, created_at);
        CREATE TABLE handwriting_publications (
            id varchar(64) PRIMARY KEY,
            dataset_id varchar(64) NOT NULL REFERENCES handwriting_datasets(id),
            source_version integer NOT NULL,
            published_by varchar(36) NOT NULL REFERENCES users(id),
            payload jsonb NOT NULL,
            summary jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE(dataset_id, source_version)
        );
    """
    for statement in statements.split(";"):
        if statement.strip():
            op.execute(statement)


def downgrade() -> None:
    for name in ("handwriting_publications", "handwriting_jobs", "handwriting_assets", "handwriting_datasets"):
        op.drop_table(name)
    op.drop_constraint("ck_users_role", "users", type_="check")
    op.drop_column("users", "role")
