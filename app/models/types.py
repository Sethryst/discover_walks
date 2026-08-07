"""Small PostGIS type support without a second ORM extension."""

from __future__ import annotations

from sqlalchemy.ext.compiler import compiles
from sqlalchemy.types import UserDefinedType


class Geometry(UserDefinedType[str]):
    """PostGIS geometry column, constrained to the supplied geometry type and SRID."""

    cache_ok = True

    def __init__(self, geometry_type: str, srid: int = 4326) -> None:
        self.geometry_type = geometry_type
        self.srid = srid

    def get_col_spec(self, **_: object) -> str:
        """Return PostgreSQL's geometry declaration."""
        return f"geometry({self.geometry_type},{self.srid})"


@compiles(Geometry, "postgresql")
def compile_geometry(type_: Geometry, _compiler: object, **_: object) -> str:
    """Compile a PostGIS geometry declaration on PostgreSQL."""
    return type_.get_col_spec()
