# @jev-kit/cli

## 0.3.1

### Patch Changes

- Updated dependencies [d82174b]
  - @jev-kit/agent-review@0.3.0
  - @jev-kit/hook-adapters@0.2.0

## 0.3.0

### Minor Changes

- 457d0c2: Record permission-review start and finish events, elapsed time, returned model and token usage, and config/input/normalization failure metadata alongside the existing status aggregate. Preserve existing counts and hook outputs; telemetry failures do not change decisions or exit behavior, and raw inputs and error text are not stored.

## 0.2.0

### Minor Changes

- 7852459: Add JSON stdin/stdout commands for caller-defined evidence checks and semantic diffs.

## 0.1.1

### Patch Changes

- Updated dependencies [56a5cb5]
  - @jev-kit/decision-contract@0.2.0
  - @jev-kit/agent-review@0.2.0
  - @jev-kit/hook-adapters@0.1.1

## 0.1.0

### Minor Changes

- 7d8b954: Publish the first public Jev Kit packages with versioned decision contracts, routing, evaluation, semantic comparison, evidence checking and agent hook adapters.

### Patch Changes

- Updated dependencies [7d8b954]
  - @jev-kit/agent-review@0.1.0
  - @jev-kit/decision-contract@0.1.0
  - @jev-kit/hook-adapters@0.1.0
