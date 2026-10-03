import json
import tempfile
import unittest
from pathlib import Path
from app.scout.candidate_capture import import_capture

class CandidateCaptureTests(unittest.TestCase):
    def test_import_preserves_provenance_and_rejects_unknown_query(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / "expansion-queues").mkdir()
            (root / "expansion-queues/national-region-search-queue.json").write_text(json.dumps({"queries": [{"queryId": "q-1"}]}))
            capture = root / "capture.json"
            capture.write_text(json.dumps({"kind": "national-candidate-capture", "candidates": [{"market":"boston","place":"Boston","queryId":"q-1","sourceUrl":"https://city.gov/events?x=1#top","providerName":"City","sourceType":"events","coverageScope":"city","discoveryEvidence":"official feed","confidence":0.9},{"market":"boston","place":"Boston","queryId":"missing","sourceUrl":"https://city.gov/events","providerName":"City","sourceType":"events","coverageScope":"city","discoveryEvidence":"no result","confidence":0.2}]}))
            result = import_capture(root, capture, root / "out.json")
            self.assertEqual(result["summary"], {"candidateCount": 1, "negativeCount": 0, "errorCount": 1})
            self.assertEqual(result["candidates"][0]["queryId"], "q-1")
            self.assertEqual(result["candidates"][0]["canonicalDomain"], "city.gov")
            self.assertEqual(result["candidates"][0]["canonicalUrl"], "https://city.gov/events?x=1")

if __name__ == "__main__": unittest.main()
