import unittest

from app.pipeline.contracts import ContractError
from app.pipeline.story_contracts import validate_story


class StoryContractTests(unittest.TestCase):
    def story(self, **overrides):
        story = {
            "id": "east-potomac-park-rebuild",
            "headline": "A place is changing: East Potomac Park",
            "regionId": "washington-dc",
            "status": "changing",
            "editorialStatus": "draft",
            "footprint": {"type": "Polygon", "coordinates": [[[-77.03, 38.86], [-77.02, 38.86], [-77.02, 38.87], [-77.03, 38.86]]]},
            "timeline": [{"date": "2026-09-23", "summary": "Rebuild work is underway."}],
            "route": {"journeyId": "east-potomac-walk", "durationMinutes": 22},
            "chapters": [{"id": "orientation", "title": "The first sixty trees", "narration": "This place is changing.", "sources": [{"name": "Example source", "url": "https://example.com/report"}]}],
        }
        story.update(overrides)
        return story

    def test_valid_story_supports_walkable_documentary_shape(self):
        validate_story(self.story())

    def test_resolved_story_requires_resolution(self):
        with self.assertRaises(ContractError):
            validate_story(self.story(status="resolved"))

    def test_duplicate_chapters_are_rejected(self):
        story = self.story()
        story["chapters"].append(dict(story["chapters"][0]))
        with self.assertRaises(ContractError):
            validate_story(story)


if __name__ == "__main__":
    unittest.main()
