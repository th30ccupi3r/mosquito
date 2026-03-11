from alembic import op
import sqlalchemy as sa

revision = "0001_create_threats"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "threats",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("technology", sa.String(), nullable=True),
        sa.Column("threat_category", sa.String(), nullable=False),
        sa.Column("question", sa.String(), nullable=False),
        sa.Column("typical_threat", sa.String(), nullable=False),
        sa.Column("impact", sa.String(), nullable=False),
        sa.Column("easiness_of_attack", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("threats")
