# @jev-kit/hook-adapters

## 0.2.0

### Minor Changes

- d82174b: Preserve earlier user constraints separately from current requests, exclude Codex Page metadata, and attach role-separated assistant explanations to permission reviews. Do not infer originating commands from transcript output or read scripts referenced by command paths. Direct agent-review callers may supply optional related-action and source evidence, which is covered by the existing sensitive-input check before any provider call.

### Patch Changes

- Updated dependencies [d82174b]
  - @jev-kit/agent-review@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [56a5cb5]
  - @jev-kit/agent-review@0.2.0

## 0.1.0

### Minor Changes

- 7d8b954: Publish the first public Jev Kit packages with versioned decision contracts, routing, evaluation, semantic comparison, evidence checking and agent hook adapters.

### Patch Changes

- Updated dependencies [7d8b954]
  - @jev-kit/agent-review@0.1.0
