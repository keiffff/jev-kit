# @jev-kit/hook-adapters

Convert Codex and Claude Code `PermissionRequest` JSON into the canonical `@jev-kit/agent-review` request, then render a native allow result at the hook boundary.

Supported entry points:

- `fromCodexPermissionRequest`
- `fromClaudeCodePermissionRequest`
- `renderPermissionHookResult`
- `extractLatestUserMessages`

Low scores, provider failures, sensitive input and missing user context remain `defer`; the native agent review stays responsible.
