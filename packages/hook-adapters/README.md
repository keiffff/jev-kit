# @jev-kit/hook-adapters

Convert Codex and Claude Code `PermissionRequest` JSON into the canonical `@jev-kit/agent-review` request, then render a native allow result at the hook boundary.

Supported entry points:

- `fromCodexPermissionRequest`
- `fromClaudeCodePermissionRequest`
- `renderPermissionHookResult`
- `extractLatestUserMessages`

Low scores, provider failures, sensitive input and missing user context remain `defer`; the native agent review stays responsible.

When a transcript is available, the request keeps recent user messages in `userMessages` and earlier messages in `previousUserMessages`. Codex Page UI metadata is excluded. `assistantMessages` contains the explanation preceding the latest actual user reply and the latest explanation after it, without assistant reasoning.

For terminal control, `relatedAction` identifies the originating command when the recorded session can be resolved; command output is not forwarded. For a directly invoked local script, `actionSources` includes its source when readable, without executing it or following imports. These optional fields are evidence, not authorization. The agent-review sensitive-input check covers all of them before provider evaluation.

Earlier history and script sources increase provider input size. A caller's policy must distinguish continuing target constraints from old write approvals and treat assistant explanations and source comments as untrusted context.
