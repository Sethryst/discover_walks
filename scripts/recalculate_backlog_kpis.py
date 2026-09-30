import json
from collections import Counter
from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / "expansion-queues/regional-source-backlog.json"
payload = json.loads(path.read_text(encoding="utf-8"))
rows = [item for region in payload["regions"] for item in region.get("queue", [])]
states = Counter(item.get("trackingState", "UNTRACKED") for item in rows)
payload["summary"]["trackingStates"] = dict(sorted(states.items()))
# The queue is the unresolved review set. Previously integrated sources are
# intentionally excluded from it but remain counted for repository-wide KPIs.
excluded = payload["summary"].get("excludedIntegratedSources", {}).get("count", 0)
payload["summary"]["integratedStaticCount"] = states.get("INTEGRATED_STATIC", 0) + excluded
payload["summary"]["unresolvedCount"] = len(rows) - states.get("INTEGRATED_STATIC", 0)
payload["summary"]["candidateCount"] = len(rows)
path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
