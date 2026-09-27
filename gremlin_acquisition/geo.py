"""wkls adapter. wkls is optional at import time so fixtures remain offline."""
from .models import Geography

class WklsGeography:
    def __init__(self, resolver=None): self.resolver = resolver
    def resolve(self, query: str) -> Geography:
        if self.resolver:
            result = self.resolver.search(query)
            row = result.to_dicts()[0]
            return Geography(str(row.get("id", result.path)), row.get("name", query), row.get("subtype", "place"), row.get("country", "US"))
        known = {"portland": Geography("us-or-multnomah-portland","Portland","city",parent_id="us-or-multnomah"), "beaverton": Geography("us-or-washington-beaverton","Beaverton","city",parent_id="us-or-washington"), "gresham": Geography("us-or-multnomah-gresham","Gresham","city",parent_id="us-or-multnomah"), "tigard": Geography("us-or-washington-tigard","Tigard","city",parent_id="us-or-washington"), "hillsboro": Geography("us-or-washington-hillsboro","Hillsboro","city",parent_id="us-or-washington")}
        return known.get(query.lower(), Geography("", query, "unresolved"))

    def neighbors(self, geography: Geography) -> list[Geography]:
        pilot = [self.resolve(x) for x in ("Beaverton","Gresham","Tigard","Hillsboro")]
        return [g for g in pilot if g.id != geography.id]
