---
"@jev-kit/agent-review": minor
"@jev-kit/hook-adapters": minor
---

Preserve earlier user constraints separately from current requests, exclude Codex Page metadata, and attach role-separated assistant explanations to permission reviews. Do not infer originating commands from transcript output or read scripts referenced by command paths. Direct agent-review callers may supply optional related-action and source evidence, which is covered by the existing sensitive-input check before any provider call.
