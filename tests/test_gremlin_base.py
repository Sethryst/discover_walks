"""Unit tests for the governed Gremlin lifecycle."""

import logging
import unittest
from unittest.mock import MagicMock

from app.gremlins.base import BaseGremlin
from app.models.source import RunStatus, Source


class ExampleGremlin(BaseGremlin[dict[str, str], dict[str, str]]):
    def scrape(self) -> list[dict[str, str]]:
        return [{"name": "valid"}, {"name": ""}]

    def transform(self, raw_records: list[dict[str, str]]) -> list[dict[str, str]]:
        return raw_records

    def validate_record(self, record: dict[str, str]) -> str | None:
        return None if record["name"] else "name is required"

    def save(self, records: list[dict[str, str]]) -> None:
        self.saved = records


class BaseGremlinTests(unittest.TestCase):
    def test_execute_records_partial_run_and_raw_payloads(self) -> None:
        session = MagicMock()
        session.query().filter_by().one_or_none.return_value = Source(id=1, name="example", url="https://example.test", source_type="api")
        gremlin = ExampleGremlin("example", {}, session, MagicMock(), logging.getLogger("test"))

        run = gremlin.execute()

        self.assertEqual(run.status, RunStatus.PARTIAL)
        self.assertEqual(run.records_found, 2)
        self.assertEqual(run.records_validated, 1)
        self.assertEqual(run.records_failed, 1)
        self.assertEqual(gremlin.saved, [{"name": "valid"}])
        self.assertTrue(session.commit.called)


if __name__ == "__main__":
    unittest.main()
