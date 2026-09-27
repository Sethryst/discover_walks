from __future__ import annotations
from urllib.parse import urlsplit
from .geo import WklsGeography
from .models import AcquisitionPlan, ScoreBreakdown
from .ledger import AcquisitionLedger
from .package_intelligence import FeatureRequirement, RegionalNeed, needs_from_discoveries
from .source_search import generate_search_lines

class AcquisitionPlanner:
    def __init__(self, geo=None, ledger=None): self.geo=geo or WklsGeography(); self.ledger=ledger or AcquisitionLedger()
    def score(self, geography, seen_domains=(), failures=(), empty=False, duplicate_count=0):
        loop = min(5.0, duplicate_count * 1.5)
        return ScoreBreakdown(geographic_novelty=2.0 if geography.id not in seen_domains else 0.0, publisher_novelty=2.0, expected_event_yield=2.0, freshness_likelihood=1.5, authority=2.0, adapter_confidence=1.0, fallback_success=0.5, duplicate_risk=min(4,duplicate_count), recent_failure_penalty=min(3,len(failures)), empty_calendar_penalty=2.0 if empty else 0.0, loop_penalty=loop, explanation=f"{geography.name}: expand because novelty is {max(0,2-duplicate_count):.1f}; duplicate domains={duplicate_count}, failures={len(failures)}")
    def plan(self, run_id="acquisition", root="Portland", max_batches=3, budget=30, needs=None):
        root_geo=self.geo.resolve(root); candidates=[root_geo]+self.geo.neighbors(root_geo); plans=[]
        for g in candidates:
            if len(plans) >= max_batches or not self.ledger.budget_available(budget): break
            if not g.id: continue
            requirement_categories=[r.canonical_category for r in (needs.requirements if needs else ())]
            score=self.score(g, seen_domains={root_geo.id}, duplicate_count=1 if g.id==root_geo.id else 0)
            lines=[line.query for line in generate_search_lines(RegionalNeed(g.name, g.id, tuple(needs.requirements) if needs else ()))][:9]
            lines += [f"official events {g.name} Oregon",f"{g.name} calendar events",f"site:.gov {g.name} events"]
            if requirement_categories:
                lines=[f"official {category} source {g.name}" for category in requirement_categories] + lines
                score.explanation += f"; unmet package categories={','.join(requirement_categories)}"
            p=AcquisitionPlan(run_id,g,lines,"at least one new canonical domain or publisher or unmet package category",budget,score,score.explanation); plans.append(p); self.ledger.record_decision(run_id,g.id,score,score.explanation,requirement_categories)
        return sorted(plans,key=lambda p:(-p.score.priority,p.geography.id))

    def plan_package(self, run_id, need: RegionalNeed, max_batches=3, budget=30):
        """Plan a package requirement without assuming the region is Portland."""
        return self.plan(run_id=run_id, root=need.geography_query, max_batches=max_batches, budget=budget, needs=need)

    def plan_discovered_regions(self, run_id, discoveries, max_batches=3, budget=30):
        """Turn only verified NEW discoveries into deterministic package plans."""
        plans = []
        for need in needs_from_discoveries(discoveries):
            plans.extend(self.plan_package(run_id, need, max_batches=max_batches, budget=budget))
        return sorted(plans, key=lambda p: (-p.score.priority, p.geography.id))

def canonical_domain(url): return (urlsplit(url).hostname or "").lower().removeprefix("www.")
