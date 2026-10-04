---
"@jev-kit/cli": minor
---

Record permission-review start and finish events, elapsed time, returned model and token usage, and config/input/normalization failure metadata alongside the existing status aggregate. Preserve existing counts and hook outputs; telemetry failures do not change decisions or exit behavior, and raw inputs and error text are not stored.
