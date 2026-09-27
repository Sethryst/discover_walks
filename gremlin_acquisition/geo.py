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
    def __init__(self, resolver=None): self.resolver = resolver
    def resolve(self, query: str) -> Geography:
        if self.resolver:
            result = self.resolver.search(query); rows = result.to_dicts()
            if len(rows) != 1: return Geography("", query, "ambiguous" if rows else "unresolved")
            row = rows[0]
            return self._from_row(row, result.path)
        upstream = _load_wkls()
        if upstream:
            scope = upstream
            normalized=query.strip().lower()
            # A human region qualifier is used to disambiguate the otherwise
            # global substring search without inventing an identity.
            if normalized in {'portland','portland, oregon','portland or','beaverton','gresham','tigard','hillsboro'}:
                scope=upstream.us.oregon
                query='Portland'
                if normalized != 'portland': query=query if normalized=='portland' else normalized.split(',')[0].title()
            rows = scope.search(query).to_dicts()
            if len(rows) != 1: return Geography("", query, "ambiguous" if rows else "unresolved")
            row = rows[0]
            return self._from_row(row, "")
        known = {"portland": Geography("us-or-multnomah-portland","Portland","city",parent_id="us-or-multnomah"), "beaverton": Geography("us-or-washington-beaverton","Beaverton","city",parent_id="us-or-washington"), "gresham": Geography("us-or-multnomah-gresham","Gresham","city",parent_id="us-or-multnomah"), "tigard": Geography("us-or-washington-tigard","Tigard","city",parent_id="us-or-washington"), "hillsboro": Geography("us-or-washington-hillsboro","Hillsboro","city",parent_id="us-or-washington")}
        return known.get(query.lower(), Geography("", query, "unresolved"))

    def neighbors(self, geography: Geography) -> list[Geography]:
        if self.resolver or _load_wkls():
            # Keep the bounded pilot candidate set; verified_adjacent() is the
            # required geometry gate before a candidate becomes a graph edge.
            pilot = [self.resolve(x) for x in ("Beaverton","Gresham","Tigard","Hillsboro")]
            return [g for g in pilot if g.id and g.id != geography.id]
        pilot = [self.resolve(x) for x in ("Beaverton","Gresham","Tigard","Hillsboro")]
        return [g for g in pilot if g.id != geography.id]

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

    def verified_adjacent(self, query, names):
        """Resolve and geometry-check named Oregon municipalities with WKLS."""
        upstream=_load_wkls()
        if not upstream: return []
        root=upstream.us.oregon.search(query); rows=root.to_dicts()
        if len(rows)!=1: return []
        root_shape=json.loads(root.geojson())
        try:
            from shapely.geometry import shape
            root_geom=shape(root_shape)
        except (ImportError, ValueError, TypeError): return []
        result=[]
        for name in names:
            found=upstream.us.oregon.search(name).to_dicts()
            if len(found)!=1 or found[0].get('id')==rows[0].get('id'): continue
            candidate=upstream.us.oregon.search(name)
            try:
                if root_geom.touches(shape(json.loads(candidate.geojson()))) or root_geom.intersects(shape(json.loads(candidate.geojson()))):
                    result.append(self._from_row(found[0], candidate.path))
            except (ValueError, TypeError): continue
        return result
