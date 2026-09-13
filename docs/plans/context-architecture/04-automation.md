---
id: context-architecture-automation
kind: implementation-contract
description: Bound guidance repair and evaluate an optional read-only small librarian.
keywords: [feedback, mistake, librarian, ONNX, memory, offline]
parent: README.md
previous: 03-routing.md
next: 05-evaluation.md
---
# 4. Automation

Group failures by rule ID/version, task kind and failure code.
Two distinct tasks trigger a candidate; retries/redeliveries are not new failures.
Allow verified links/aliases, redundant prose removal, examples of existing rules,
and missing discovery descriptions. New duties/prohibitions/access/meaning need review.
Pin failure evidence, old rule, expected effect and regression; preview/apply/reread.
One automatic amendment per rule version; another failure escalates to review.

## Librarian boundary

Read-only intent classification/candidate selection/need-more-context signal.
No access decisions, translation, truth certification, writes or tool execution.
Input <=8 visible cards and original query, preserving Korean identifiers.
Return only allowed intent, supplied candidate IDs and expansion signal.
Server validates output and fresh ACL/revisions; no confidence-based grants.
<=1536 input tokens, <=128 output tokens, zero regeneration. Failure -> baseline.

## Experiments

Compare no added generator against SmolLM2-360M-Instruct q8 ONNX and
onnx-community/Qwen3-0.6B-ONNX CPU q4 with thinking disabled.
Reuse Transformers.js/ONNX. Unsupported variant is failed, not an engine swap.
Pin repository commit/files/tokenizer/quantization/runtime/license in manifests.
Explicit download only; offline inference, no remote code or automatic downloads.
Synthetic/approved public data only. No private-content training.
One model worker, 2 CPU threads; no concurrent build/full tests/large reindex.
Start free RAM >=3.8GiB; stop own work below2.3GiB or model memory >1.5GiB.
Warm deadline2s; cold30s. Ordinary reads never wait for cold loading.
Idle unload120s; cache keys bind actor/access/catalog/document/model versions.
Report actual results and recommendation. Production librarian stays OFF.
No new paid API, generator daemon, engine or GPU setting.
