"""Typed adapter for the pinned WKLS dependency.

WKLS metadata lookup is intentionally separated from geometry retrieval: the
latter may require the remote Overture parquet view, while IDs and hierarchy
are still useful from cached metadata. Unknown and ambiguous searches remain
unresolved.
"""
import os, sys, json
from .models import Geography

WKLS_REVISION = "966257fa9dfaed338e82e2ed2d03c9791f47e204"

def _load_wkls():
    try:
        import wkls
        return wkls
    except ImportError:
        root = os.path.join(os.path.dirname(os.path.dirname(__file__)), "vendor", "wkls")
        if root not in sys.path: sys.path.insert(0, root)
        try:
            import wkls
            return wkls
        except ImportError:
            return None

class WklsGeography:
    def __init__(self, resolver=None, neighbor_provider=None):
        self.resolver = resolver
        self.neighbor_provider = neighbor_provider
    def resolve(self, query: str) -> Geography:
        if self.resolver:
            result = self.resolver.search(query); rows = result.to_dicts()
            if len(rows) != 1: return Geography("", query, "ambiguous" if rows else "unresolved")
            row = rows[0]
            return self._from_row(row, result.path)
        upstream = _load_wkls()
        if upstream:
            scope = upstream
            rows = scope.search(query).to_dicts()
            if len(rows) != 1: return Geography("", query, "ambiguous" if rows else "unresolved")
            row = rows[0]
            return self._from_row(row, "")
        return Geography("", query, "unresolved")

    def neighbors(self, geography: Geography) -> list[Geography]:
        provider = self.neighbor_provider
        if provider is None and self.resolver is not None:
            provider = getattr(self.resolver, "neighbors", None)
        if provider is None:
            return []
        candidates = provider(geography)
        return [candidate for candidate in candidates if candidate.id and candidate.id != geography.id]

    @staticmethod
    def _from_row(row, fallback_id=""):
        bbox=row.get('bbox')
        if isinstance(bbox, dict): bbox=(bbox.get('xmin'),bbox.get('ymin'),bbox.get('xmax'),bbox.get('ymax'))
        return Geography(str(row.get('id',fallback_id)),row.get('name') or row.get('name_primary') or row.get('name_en') or '',row.get('subtype','place'),row.get('country','US'),row.get('parent_id'),bbox=bbox,source_revision=WKLS_REVISION)

    def verified_neighbors(self, geography: Geography, candidates):
        """Return candidates whose verified bboxes touch/overlap the target.

        This is a conservative prefilter only; callers must use WKLS geometry
        intersection for final adjacency when publishing a graph edge.
        """
        if not geography.bbox: return []
        ax1,ay1,ax2,ay2=geography.bbox
        return [c for c in candidates if c.id and c.id != geography.id and c.bbox and not (c.bbox[2] < ax1 or c.bbox[0] > ax2 or c.bbox[3] < ay1 or c.bbox[1] > ay2)]

    def verified_adjacent(self, query, names, scope=None):
        """Resolve and geometry-check named candidates within an explicit scope."""
        upstream=_load_wkls()
        if not upstream: return []
        root_scope = scope or upstream
        root=root_scope.search(query); rows=root.to_dicts()
        if len(rows)!=1: return []
        root_shape=json.loads(root.geojson())
        try:
            from shapely.geometry import shape
            root_geom=shape(root_shape)
        except (ImportError, ValueError, TypeError): return []
        result=[]
        for name in names:
            found=root_scope.search(name).to_dicts()
            if len(found)!=1 or found[0].get('id')==rows[0].get('id'): continue
            candidate=root_scope.search(name)
            try:
                if root_geom.touches(shape(json.loads(candidate.geojson()))) or root_geom.intersects(shape(json.loads(candidate.geojson()))):
                    result.append(self._from_row(found[0], candidate.path))
            except (ValueError, TypeError): continue
        return result
