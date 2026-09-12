"""Opt-in offline grouping diagnostic. No model/network/Vault access.

Run with an isolated Python containing pinned igraph/leidenalg. This measures
information available to a summarizing agent, NOT generated-summary quality.
"""
import hashlib
import importlib.metadata
import json
from pathlib import Path
import time


def project_relations(relations):
    """Unsigned undirected clustering projection; authored kinds stay in input."""
    projected = {}
    for edge in relations:
        pair = tuple(sorted((edge["from"], edge["to"])))
        weight = edge["weight"]
        if not isinstance(weight, (float, int)) or weight <= 0:
            raise ValueError("Clustering weights must be positive")
        projected[pair] = projected.get(pair, 0) + weight
    return [(a, b, weight) for (a, b), weight in sorted(projected.items())]


def evaluate_groups(notes, groups, max_chars):
    by_id = {note["id"]: note for note in notes}
    flattened = [item for group in groups for item in group]
    if len(by_id) != len(notes) or len(flattened) != len(set(flattened)) or set(flattened) != set(by_id):
        raise ValueError("Groups must partition the same complete input corpus")
    packed = []
    for group in groups:
        selected = []
        packed.append(selected)
        for key in group[:8]:
            candidate = by_id[key]
            selected.append(candidate)
            if len(json.dumps(packed, ensure_ascii=False, separators=(",", ":"))) > max_chars:
                selected.pop()
    selected_notes = [note for group in packed for note in group]
    selected_group = {note["id"]: index for index, group in enumerate(packed) for note in group}
    pairs = [n for n in notes if "counterargumentTo" in n]
    return {
        "budgetChars": max_chars,
        "packedChars": len(json.dumps(packed, ensure_ascii=False, separators=(",", ":"))),
        "selectedItems": len(selected_notes), "partial": len(selected_notes) != len(notes),
        "supportedClaimItems": sum(bool(n.get("claim") and n.get("source")) for n in selected_notes),
        "conditionItems": sum(bool(n.get("condition")) for n in selected_notes),
        "openQuestionItems": sum(bool(n.get("question")) for n in selected_notes),
        "counterargumentPairs": len(pairs),
        "counterargumentPairsTogether": sum(n["id"] in selected_group and n["counterargumentTo"] in selected_group
            and selected_group[n["id"]] == selected_group[n["counterargumentTo"]] for n in pairs),
        "groups": [[n["id"] for n in group] for group in packed],
    }


def main():
    import igraph
    import leidenalg
    repo = Path(__file__).resolve().parent.parent
    fixture = repo / "tests/fixtures/topic-clustering.json"
    raw = fixture.read_bytes()
    corpus = json.loads(raw)
    notes = corpus["notes"]
    ids = [note["id"] for note in notes]
    indices = {key: i for i, key in enumerate(ids)}
    projected = project_relations(corpus["relations"])
    graph = igraph.Graph(n=len(ids), edges=[(indices[a], indices[b]) for a, b, _ in projected], directed=False)
    graph.es["weight"] = [weight for _, _, weight in projected]
    mocs = {}
    for note in notes:
        mocs.setdefault(note["moc"], []).append(note["id"])
    timings, partitions = [], []
    for _ in range(3):
        started = time.perf_counter()
        partition = leidenalg.find_partition(graph, leidenalg.ModularityVertexPartition,
            weights="weight", seed=42, n_iterations=-1)
        timings.append((time.perf_counter() - started) * 1000)
        partitions.append(sorted([sorted(ids[i] for i in group) for group in partition]))
    if any(p != partitions[0] for p in partitions):
        raise RuntimeError("Seeded repeated partitions differed")
    report = {
        "version": 1, "fixtureSha256": hashlib.sha256(raw).hexdigest(),
        "kind": "structural_context_preservation_not_llm_quality",
        "modelCalls": 0, "seed": 42, "objective": "weighted_modularity",
        "tools": {name: importlib.metadata.version(name) for name in ("igraph", "leidenalg", "texttable")},
        "rawRelations": corpus["relations"],
        "clusteringProjection": projected,
        "projectionNotice": "Undirected positive weights measure grouping affinity, not truth, confidence or signed argument support.",
        "firstAndRepeatedPartitionMs": timings,
        "cells": [dict(grouping=name, **evaluate_groups(notes, groups, budget))
            for budget in (4000, 12000)
            for name, groups in (("explicit_moc", list(mocs.values())), ("leiden", partitions[0]))],
        "qualityStatus": "Current-agent source-grounded summary review is separate; no automatic promotion from these metrics.",
    }
    output = repo / ".mcpvault/deployments/20260912-graph-p2/offline-clustering.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    # One derived evaluation artifact only. Never an authoritative Wiki write.
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k not in ("rawRelations", "clusteringProjection")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
