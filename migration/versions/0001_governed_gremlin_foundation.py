"""Create the governed Gremlin Lab foundation.

Revision ID: 0001_governed_gremlin_foundation
Revises:
Create Date: 2026-08-04
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from app.models.types import Geometry


revision = "0001_governed_gremlin_foundation"
down_revision = None
branch_labels = None
depends_on = None


source_type = sa.Enum("api", "csv", "web_scrape", "database", name="source_type")
run_status = sa.Enum("pending", "running", "success", "failed", "partial", name="run_status")


def upgrade() -> None:
    """Create registry, audit, raw memory, and GIS entity tables."""
    bind = op.get_bind()
    source_type.create(bind, checkfirst=True)
    run_status.create(bind, checkfirst=True)
    op.create_table(
        "sources",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("source_type", source_type, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "source_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_id", sa.Integer(), sa.ForeignKey("sources.id"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("status", run_status, nullable=False),
        sa.Column("records_found", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("records_validated", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("records_failed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_source_runs_source_id", "source_runs", ["source_id"])
    op.create_table(
        "raw_payloads",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_run_id", sa.Integer(), sa.ForeignKey("source_runs.id"), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_raw_payloads_source_run_id", "raw_payloads", ["source_run_id"])
    op.create_table(
        "places",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("address", sa.String(length=255)),
        sa.Column("city", sa.String(length=128)),
        sa.Column("state", sa.String(length=64)),
        sa.Column("postal_code", sa.String(length=20)),
        sa.Column("latitude", sa.Float()),
        sa.Column("longitude", sa.Float()),
        sa.Column("geometry", Geometry("POINT", srid=4326)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_places_geometry_gist", "places", ["geometry"], postgresql_using="gist")
    op.create_table(
        "place_categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.UniqueConstraint("name"),
    )


def downgrade() -> None:
    """Remove the foundation tables in dependency order."""
    op.drop_table("place_categories")
    op.drop_index("ix_places_geometry_gist", table_name="places")
    op.drop_table("places")
    op.drop_index("ix_raw_payloads_source_run_id", table_name="raw_payloads")
    op.drop_table("raw_payloads")
    op.drop_index("ix_source_runs_source_id", table_name="source_runs")
    op.drop_table("source_runs")
    op.drop_table("sources")
    run_status.drop(op.get_bind(), checkfirst=True)
    source_type.drop(op.get_bind(), checkfirst=True)
