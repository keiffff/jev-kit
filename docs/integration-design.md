# Integration design

## Goal

Expose one versioned Jev decision protocol to different AI agents without making their hook payloads part of the policy contract.

## External precedents

- Open Policy Agent separates a JSON input document and named decision from its CLI, HTTP and embedded integration methods. Its CLI accepts stdin JSON and emits JSON for programmatic use. `jev-kit` follows the same separation between canonical review data and transport. <https://www.openpolicyagent.org/docs/integration> <https://www.openpolicyagent.org/docs/cli>
- Claude Code command hooks receive JSON on stdin and return event-specific JSON on stdout. A PermissionRequest hook may allow or deny; returning no decision leaves the normal permission flow in control. `hook-adapters` uses that edge contract while keeping Jev's result limited to allow or defer. <https://code.claude.com/docs/en/hooks>
- OpenCode loads JavaScript or TypeScript plugins and exposes `tool.execute.before` plus permission events. TypeScript users can call `@jev-kit/agent-review` directly; other runtimes can call the normalized CLI. <https://opencode.ai/docs/plugins/>
- MCP tools can declare JSON input and output schemas, and clients are expected to validate structured output. The exported review schemas provide the same machine-readable boundary without requiring an MCP server. <https://modelcontextprotocol.io/specification/2025-06-18/server/tools>

## Boundary

`AgentReviewRequest` is the only input understood by the policy layer. It contains:

- agent and event identity;
- the proposed tool and its JSON-compatible input;
- actual user messages selected by the adapter;
- the operator-owned standing policy.

Agent adapters own transcript parsing and native hook output. They do not own thresholds or Jev questions. The review policy owns questions and thresholds. The decision client owns transport and response conformance.

## Outcomes

The protocol has two outcomes:

- `allow`: all configured policy conditions passed;
- `defer`: the native agent review remains responsible.

There is no Jev-generated deny. Deterministic hooks, sandboxing and agent-native approval remain authoritative.

## Failure behavior

| Condition | Normalized result | Permission-hook output |
| --- | --- | --- |
| Policy passes | `allow` | Native allow JSON |
| Policy score does not pass | `defer` | No decision |
| Credential-like input | `defer` before network | No decision |
| Missing actual user context | `defer` before network | No decision |
| Missing key or provider failure | `defer` | No decision |
| Invalid Jev response | `defer` | No decision |
| Invalid config or malformed hook input | CLI exit 2 | Hook runtime handles the invalid hook |

## Compatibility

Protocol changes require a new `schemaVersion`. Policy question changes require a new policy version. Threshold changes are policy changes and remain visible in configuration. Agent hook format changes are isolated to `hook-adapters` and do not alter the canonical protocol.
