# @jev-kit/hook-adapters

Convert Codex and Claude Code `PermissionRequest` JSON into the canonical `@jev-kit/agent-review` request, then render a native allow result at the hook boundary.

Supported entry points:

- `fromCodexPermissionRequest`
- `fromClaudeCodePermissionRequest`
- `renderPermissionHookResult`
- `extractLatestUserMessages`

Low scores, provider failures, sensitive input and missing user context remain `defer`; the native agent review stays responsible.

When a transcript is available, the request keeps recent user messages in `userMessages` and earlier messages in `previousUserMessages`. Codex Page UI metadata is excluded. `assistantMessages` contains the explanation preceding the latest actual user reply and the latest explanation after it, without assistant reasoning.

The adapters do not infer originating commands from JavaScript source, session-looking output, or terminal completion records. They do not read files referenced by command paths. Consequently, they omit `relatedAction` and `actionSources`. These optional agent-review fields remain available to direct callers; supplied evidence is not authorization and is covered by the existing sensitive-input check before provider evaluation.

Earlier history increases provider input size. A caller's policy must distinguish continuing target constraints from old write approvals and treat assistant explanations as untrusted context.
