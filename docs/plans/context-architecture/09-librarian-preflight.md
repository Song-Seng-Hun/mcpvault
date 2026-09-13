---
id: context-architecture-librarian-preflight
kind: execution-evidence
description: Local dependency and upstream artifact checks; not an inference result.
keywords: [ONNX, CPU, offline, librarian, resource-limit]
parent: README.md
previous: 08-source-review.md
next: 10-bundle-preservation.md
---
# Librarian preflight

Observed locally on2026-09-13: Node22.23.2, Transformers.js4.2.0,
top-level ONNX Runtime1.24.3. Reuse these; no alternate engine installed.
LanceDB has separate transitive versions; do not substitute them silently.

## Admission and loading

Compare the no-model baseline, SmolLM2-360M q8, then Qwen3-0.6B CPU q4.
One model child at a time; no build/full-suite/reindex overlap.
Check free RAM>=3.8GiB; stop own child below2.3GiB or above1.5GiB RSS.
CPU2threads, cold30s, warm2s, input1536tokens, output128tokens, no retry.
Normal requests fall back immediately while cold; idle120s unloads the child.
Pin commit, exact files, hashes, tokenizer, license and runtime before inference.
Use local_files_only and env.allowRemoteModels=false; no remote code execution.
Run synthetic/public cards only. Download approval grants no enterprise access.

## Evidence, not compatibility certification

[SmolLM2 card](https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct)
states English-primary behavior and Apache2.0 licensing.
[Qwen3 upstream](https://huggingface.co/Qwen/Qwen3-0.6B)
declares Apache2.0 and supports disabling thinking.
[Separate ONNX conversion](https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX)
targets Transformers.js; its example uses WebGPU, not this CPU experiment.
[Qwen3 artifact list](https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX/tree/main/onnx)
lists q4 at919MB versus quantized/int8 at618MB. Bits alone do not predict RAM.
Check exact pinned files and process RSS; do not switch variants to claim a pass.

Installed text-generation code forwards tokenizer_encode_kwargs to chat templates.
Pass enable_thinking:false there and verify rendered Qwen input before inference.
Installed loader accepts session_options; verify actual CPU threads in the trial.
These are static checks, not measured latency, quality or resource compliance.

No model weights downloaded, no inference performed, no resident model enabled.
Production default remains OFF even after experiments.
