from __future__ import annotations
from urllib.parse import urlsplit
from .geo import WklsGeography
from .models import AcquisitionPlan, ScoreBreakdown
from .ledger import AcquisitionLedger
from .package_intelligence import FeatureRequirement, RegionalNeed, needs_from_discoveries, discover_regions
from .source_search import generate_search_lines, classify_search_result, search_feedback

class AcquisitionPlanner:
    def __init__(self, geo=None, ledger=None): self.geo=geo or WklsGeography(); self.ledger=ledger or AcquisitionLedger()
    def score(self, geography, seen_domains=(), failures=(), empty=False, duplicate_count=0):
        loop = min(5.0, duplicate_count * 1.5)
        return ScoreBreakdown(geographic_novelty=2.0 if geography.id not in seen_domains else 0.0, publisher_novelty=2.0, expected_event_yield=2.0, freshness_likelihood=1.5, authority=2.0, adapter_confidence=1.0, fallback_success=0.5, duplicate_risk=min(4,duplicate_count), recent_failure_penalty=min(3,len(failures)), empty_calendar_penalty=2.0 if empty else 0.0, loop_penalty=loop, explanation=f"{geography.name}: expand because novelty is {max(0,2-duplicate_count):.1f}; duplicate domains={duplicate_count}, failures={len(failures)}")
    def plan(self, run_id="acquisition", root="Portland", max_batches=3, budget=30, needs=None, cooldown_attempts=1):
        root_geo=self.geo.resolve(root); candidates=[root_geo]+self.geo.neighbors(root_geo); plans=[]
        if not root_geo.id:
            self.ledger.record_search_feedback(run_id, "", root, "UNRESOLVED GEOGRAPHY", notes="WKLS did not return one canonical identity")
            return []
        prior_attempts = [row for row in self.ledger.attempts if row.get("geography_id") in {candidate.id for candidate in candidates}]
        failed_by_geo = {candidate.id: sum(1 for row in prior_attempts if row.get("geography_id") == candidate.id and row.get("result") in {"failed", "temporary failure"}) for candidate in candidates}
        duplicate_by_geo = {candidate.id: sum(1 for row in prior_attempts if row.get("geography_id") == candidate.id and row.get("result") == "duplicate") for candidate in candidates}
        recent_attempts = self.ledger.attempts[-max(0, cooldown_attempts):] if cooldown_attempts else []
        cooling_down = {row.get("geography_id") for row in recent_attempts if row.get("result") in {"failed", "temporary failure", "permanent failure"}}
        for g in candidates:
            if not g.id:
                continue
            if g.id in cooling_down:
                self.ledger.record_decision(run_id, g.id, self.score(g, seen_domains={root_geo.id}, failures=["cooldown"]), "excluded during deterministic recent-failure cooldown", [r.canonical_category for r in (needs.requirements if needs else ())])
                continue
            if not self.ledger.budget_available(budget):
                self.ledger.record_search_feedback(run_id, g.id, g.name, "BUDGET EXHAUSTED", notes=f"global attempt budget={budget}")
                continue
            requirement_categories=[r.canonical_category for r in (needs.requirements if needs else ())]
            score=self.score(g, seen_domains={root_geo.id}, failures=["prior failure"] * failed_by_geo.get(g.id, 0), duplicate_count=duplicate_by_geo.get(g.id, 0))
            lines=[line.query for line in generate_search_lines(RegionalNeed(g.name, g.id, tuple(needs.requirements) if needs else ()))][:9]
            lines += [f"official events {g.name}", f"{g.name} calendar events", f"site:.gov {g.name} events"]
            if requirement_categories:
                lines=[f"official {category} source {g.name}" for category in requirement_categories] + lines
                score.explanation += f"; unmet package categories={','.join(requirement_categories)}"
            p=AcquisitionPlan(run_id,g,lines,"at least one new canonical domain or publisher or unmet package category",budget,score,score.explanation); plans.append(p)
        ranked = sorted(plans,key=lambda p:(-p.score.priority,p.geography.id))
        selected = ranked[:max_batches]
        selected_ids = {plan.geography.id for plan in selected}
        for plan in ranked:
            reason = plan.reason if plan.geography.id in selected_ids else f"excluded after ranking: batch limit {max_batches}"
            self.ledger.record_decision(run_id,plan.geography.id,plan.score,reason,[r.canonical_category for r in (needs.requirements if needs else ())])
        return selected

    def plan_package(self, run_id, need: RegionalNeed, max_batches=3, budget=30):
        """Plan a package requirement without assuming the region is Portland."""
        return self.plan(run_id=run_id, root=need.geography_query, max_batches=max_batches, budget=budget, needs=need)

    def plan_discovered_regions(self, run_id, discoveries, max_batches=3, budget=30):
        """Turn only verified NEW discoveries into deterministic package plans."""
        plans = []
        for need in needs_from_discoveries(discoveries):
            plans.extend(self.plan_package(run_id, need, max_batches=max_batches, budget=budget))
        return sorted(plans, key=lambda p: (-p.score.priority, p.geography.id))

    def plan_region_queries(self, run_id, queries, known_ids=(), max_batches=3, budget=30, requirements=None):
        """Resolve arbitrary system region candidates, then plan only verified NEW scopes."""
        discoveries = discover_regions(queries, self.geo, known_ids=known_ids)
        for discovery in discoveries:
            self.ledger.record_region_discovery(run_id, discovery)
        selected_requirements = tuple(requirements or ())
        plans = []
        discovered_needs = needs_from_discoveries(discoveries, selected_requirements) if selected_requirements else needs_from_discoveries(discoveries)
        for need in discovered_needs:
            plans.extend(self.plan_package(run_id, need, max_batches=max_batches, budget=budget))
        return discoveries, sorted(plans, key=lambda p: (-p.score.priority, p.geography.id))

    def search_sources(self, run_id, need: RegionalNeed, adapter, *, max_lines=None):
        """Run deterministic search lines and persist every provider outcome.

        Search is deliberately separate from acquisition: a result can suggest
        a source without authorizing a fetch or publication.
        """
        lines = generate_search_lines(need)
        if max_lines is not None:
            lines = lines[:max_lines]
        results = []
        for line in lines:
            result = classify_search_result(adapter.search(line))
            feedback = search_feedback(result)
            self.ledger.record_search_feedback(
                run_id, need.geography_id, line.query, result.status,
                feedback["categories_found"],
                notes=json_reason(feedback),
            )
            results.append(result)
        return results


def json_reason(feedback):
    """Stable human-readable search evidence for the ledger notes field."""
    domains = ','.join(feedback["domains"]) or 'none'
    sources = ','.join(feedback["source_urls"]) or 'none'
    reason = feedback.get("reason") or 'no provider explanation'
    return f"domains={domains}; sources={sources}; reason={reason}"

def canonical_domain(url): return (urlsplit(url).hostname or "").lower().removeprefix("www.")
