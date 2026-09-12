"""Host-only deterministic evaluation tests; no network or model calls."""
import unittest
from evaluate_topic_clustering import evaluate_groups, project_relations


class TopicGroupingTest(unittest.TestCase):
    def test_projection_preserves_raw_multirelations(self):
        edges = [{"from": "a", "to": "b", "kind": "supports", "weight": 1},
                 {"from": "b", "to": "a", "kind": "contradicts", "weight": 2}]
        self.assertEqual(project_relations(edges), [("a", "b", 3)])
        self.assertEqual(len(edges), 2)
        self.assertEqual(edges[1]["kind"], "contradicts")

    def test_separated_counterargument_is_not_counted_as_preserved(self):
        notes = [{"id": "a", "source": "s", "claim": "A", "condition": "When A"},
                 {"id": "b", "source": "t", "claim": "Not A", "counterargumentTo": "a"}]
        same = evaluate_groups(notes, [["a", "b"]], 4000)
        split = evaluate_groups(notes, [["a"], ["b"]], 4000)
        self.assertEqual(same["counterargumentPairsTogether"], 1)
        self.assertEqual(split["counterargumentPairsTogether"], 0)
        self.assertEqual(split["supportedClaimItems"], 2)

    def test_budget_drops_whole_items_and_flags_partial(self):
        result = evaluate_groups([{"id": "a", "claim": "x" * 5000, "source": "s"}], [["a"]], 4000)
        self.assertEqual(result["selectedItems"], 0)
        self.assertTrue(result["partial"])


if __name__ == "__main__":
    unittest.main()
