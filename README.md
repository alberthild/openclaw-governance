# @vainplex/openclaw-governance

Contextual, learning, cross-agent governance for AI agents. An OpenClaw plugin.

## Features

- **Contextual Policies (USP1):** Time-aware, conversation-aware, metadata-aware policy evaluation
- **Learning Guardrails (USP2):** Trust scores (0-100) with 5 tiers, agents earn autonomy through successful operation
- **Cross-Agent Governance (USP3):** Policy inheritance across agent boundaries, sub-agent trust propagation
- **Compliance-ready Audit Trail (USP4):** Append-only JSONL, ISO 27001 control mapping, sensitive data redaction

## Installation

```bash
npm install @vainplex/openclaw-governance
```

## Configuration

Add to your `openclaw.json`:

```json
{
  "plugins": {
    "openclaw-governance": {
      "enabled": true,
      "timezone": "Europe/Berlin",
      "policies": [],
      "trust": {
        "defaults": {
          "main": 60,
          "forge": 45,
          "*": 10
        }
      },
      "builtinPolicies": {
        "nightMode": { "after": "23:00", "before": "08:00" },
        "credentialGuard": true,
        "productionSafeguard": true,
        "rateLimiter": { "maxPerMinute": 15 }
      },
      "audit": {
        "retentionDays": 90,
        "level": "standard"
      }
    }
  }
}
```

## Built-in Policies

| Policy | Description |
|--------|-------------|
| **Night Mode** | Restricts non-critical operations during off-hours |
| **Credential Guard** | Prevents access to credential files and secrets |
| **Production Safeguard** | Blocks production-impacting operations |
| **Rate Limiter** | Prevents excessive tool calls per agent |

## Policy Example

```json
{
  "id": "forge-no-deploy",
  "name": "Forge Cannot Deploy",
  "version": "1.0.0",
  "scope": { "agents": ["forge"] },
  "rules": [
    {
      "id": "block-push",
      "conditions": [
        {
          "type": "tool",
          "name": "exec",
          "params": { "command": { "matches": "git push.*(main|master)" } }
        }
      ],
      "effect": { "action": "deny", "reason": "Forge cannot push to main" }
    }
  ]
}
```

## Condition Types

| Type | Description |
|------|-------------|
| `tool` | Match tool name and parameters (exact, glob, regex) |
| `time` | Time-of-day, day-of-week, named time windows |
| `agent` | Agent ID, trust tier, score range |
| `context` | Conversation history, message content, metadata, channel |
| `risk` | Risk level range |
| `frequency` | Rate limiting (max actions per time window) |
| `any` | OR logic (at least one sub-condition matches) |
| `not` | Negation (sub-condition must NOT match) |

## Trust Tiers

| Tier | Score | Description |
|------|-------|-------------|
| `untrusted` | 0-19 | New or misbehaving agent |
| `restricted` | 20-39 | Limited track record |
| `standard` | 40-59 | Normal operation |
| `trusted` | 60-79 | Proven track record |
| `privileged` | 80-100 | Highest autonomy |

## Commands

```
/governance          — Show engine status
```

## Requirements

- Node.js >= 22.0.0
- OpenClaw gateway
- Zero runtime dependencies

## License

MIT
