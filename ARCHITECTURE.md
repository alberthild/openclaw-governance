# ARCHITECTURE.md — @vainplex/openclaw-governance

**Companion to:** RFC.md (normative specification)  
**Purpose:** Implementation blueprint for Forge (developer agent) and Cerberus (review agent)  
**Version:** 0.1.0  
**Date:** 2026-02-17  

---

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [Type Definitions](#2-type-definitions)
3. [Module Specifications](#3-module-specifications)
4. [Data Flow](#4-data-flow)
5. [Configuration Resolution](#5-configuration-resolution)
6. [Testing Strategy](#6-testing-strategy)
7. [Implementation Order](#7-implementation-order)
8. [Build & Package](#8-build--package)

---

## 1. Project Structure

```
openclaw-governance/
├── index.ts                          # Plugin entry point (register function)
├── openclaw.plugin.json              # Plugin manifest with JSON Schema
├── package.json                      # NPM package definition
├── tsconfig.json                     # TypeScript configuration
├── README.md                         # Public documentation
├── RFC.md                            # Normative specification
├── ARCHITECTURE.md                   # This file
├── src/
│   ├── types.ts                      # All type definitions (single source of truth)
│   ├── config.ts                     # Configuration resolution and defaults
│   ├── engine.ts                     # GovernanceEngine — orchestrator
│   ├── policy-loader.ts              # Policy parsing, validation, indexing
│   ├── policy-evaluator.ts           # Rule matching and condition evaluation
│   ├── conditions/
│   │   ├── index.ts                  # Condition evaluator registry
│   │   ├── tool.ts                   # ToolCondition evaluator
│   │   ├── time.ts                   # TimeCondition evaluator
│   │   ├── agent.ts                  # AgentCondition evaluator
│   │   ├── context.ts               # ContextCondition evaluator
│   │   ├── risk.ts                   # RiskCondition evaluator
│   │   ├── frequency.ts             # FrequencyCondition evaluator
│   │   ├── composite.ts             # CompositeCondition (any/not) evaluator
│   │   └── intent.ts                # IntentCondition evaluator (LLM)
│   ├── risk-assessor.ts             # Risk scoring engine
│   ├── trust-manager.ts             # Trust score computation and persistence
│   ├── audit-trail.ts               # Audit record generation, hash chain, storage
│   ├── audit-redactor.ts            # Sensitive data redaction
│   ├── approval-manager.ts          # Human-in-the-loop approval workflow
│   ├── llm-client.ts                # LLM escalation client (OpenAI-compatible)
│   ├── frequency-tracker.ts         # Ring buffer frequency counter
│   ├── builtin-policies.ts          # Built-in policy templates
│   ├── hooks.ts                     # OpenClaw hook registration and handlers
│   └── util.ts                      # Shared utilities (time, hashing, etc.)
├── test/
│   ├── config.test.ts
│   ├── engine.test.ts
│   ├── policy-loader.test.ts
│   ├── policy-evaluator.test.ts
│   ├── conditions/
│   │   ├── tool.test.ts
│   │   ├── time.test.ts
│   │   ├── agent.test.ts
│   │   ├── context.test.ts
│   │   ├── risk.test.ts
│   │   ├── frequency.test.ts
│   │   ├── composite.test.ts
│   │   └── intent.test.ts
│   ├── risk-assessor.test.ts
│   ├── trust-manager.test.ts
│   ├── audit-trail.test.ts
│   ├── audit-redactor.test.ts
│   ├── approval-manager.test.ts
│   ├── llm-client.test.ts
│   ├── frequency-tracker.test.ts
│   ├── builtin-policies.test.ts
│   ├── hooks.test.ts
│   ├── util.test.ts
│   └── integration.test.ts          # End-to-end governance pipeline tests
└── dist/                             # Compiled output (git-ignored)
```

**File size constraint:** Max 400 lines per file. Max 40 lines per function (data tables exempt).

---

## 2. Type Definitions

All types live in `src/types.ts`. This is the single source of truth. Other modules import from here.

### 2.1 Plugin API Types (from OpenClaw)

```typescript
// ── OpenClaw Plugin API (external contract, do not modify) ──

export type PluginLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug?: (msg: string) => void;
};

export type OpenClawPluginApi = {
  id: string;
  pluginConfig?: Record<string, unknown>;
  logger: PluginLogger;
  config: Record<string, unknown>;
  registerService: (service: PluginService) => void;
  registerCommand: (command: PluginCommand) => void;
  registerGatewayMethod: (method: string, handler: (...args: any[]) => any) => void;
  on: <K extends string>(
    hookName: K,
    handler: (...args: any[]) => any,
    opts?: { priority?: number },
  ) => void;
};

export type PluginService = {
  id: string;
  start: (ctx: any) => void | Promise<void>;
  stop?: (ctx: any) => void | Promise<void>;
};

export type PluginCommand = {
  name: string;
  description: string;
  requireAuth?: boolean;
  handler: (ctx?: any) => { text: string } | Promise<{ text: string }>;
};
```

### 2.2 Hook Event Types (from OpenClaw)

```typescript
export type HookBeforeToolCallEvent = {
  toolName: string;
  params: Record<string, unknown>;
};

export type HookBeforeToolCallResult = {
  params?: Record<string, unknown>;
  block?: boolean;
  blockReason?: string;
};

export type HookToolContext = {
  agentId?: string;
  sessionKey?: string;
  toolName: string;
};

export type HookMessageSendingEvent = {
  to: string;
  content: string;
  metadata?: Record<string, unknown>;
};

export type HookMessageSendingResult = {
  content?: string;
  cancel?: boolean;
};

export type HookMessageContext = {
  channelId: string;
  accountId?: string;
  conversationId?: string;
};

export type HookBeforeAgentStartEvent = {
  prompt: string;
  messages?: unknown[];
};

export type HookBeforeAgentStartResult = {
  systemPrompt?: string;
  prependContext?: string;
};

export type HookAgentContext = {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
};

export type HookAfterToolCallEvent = {
  toolName: string;
  params: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs?: number;
};

export type HookSessionStartEvent = {
  sessionId: string;
  resumedFrom?: string;
};

export type HookSessionContext = {
  agentId?: string;
  sessionId: string;
};

export type HookGatewayStartEvent = { port: number };
export type HookGatewayStopEvent = { reason?: string };
export type HookGatewayContext = { port?: number };
```

### 2.3 Governance Domain Types

```typescript
// ── Trust ──

export type TrustTier = "untrusted" | "restricted" | "standard" | "trusted" | "privileged";

export type TrustSignals = {
  successCount: number;
  violationCount: number;
  approvedEscalations: number;
  deniedEscalations: number;
  ageDays: number;
  cleanStreak: number;
  manualAdjustment: number;
};

export type TrustEvent = {
  timestamp: string;
  type: "success" | "violation" | "escalation_approved" | "escalation_denied" | "manual_adjustment";
  delta: number;
  reason?: string;
};

export type AgentTrust = {
  agentId: string;
  score: number;
  tier: TrustTier;
  signals: TrustSignals;
  history: TrustEvent[];
  lastEvaluation: string;
  created: string;
  locked?: TrustTier;
  floor?: number;
};

export type TrustStore = {
  version: 1;
  updated: string;
  agents: Record<string, AgentTrust>;
};

// ── Policy ──

export type PolicyHookName =
  | "before_tool_call"
  | "message_sending"
  | "before_agent_start"
  | "session_start";

export type PolicyScope = {
  agents?: string[];
  excludeAgents?: string[];
  channels?: string[];
  hooks?: PolicyHookName[];
};

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type AuditLevel = "minimal" | "standard" | "verbose";

export type RuleEffect =
  | { action: "allow" }
  | { action: "deny"; reason: string }
  | { action: "escalate"; to: EscalationTarget; timeout?: number; fallback?: "allow" | "deny" }
  | { action: "audit"; level?: AuditLevel };

export type EscalationTarget = "human";

export type ParamMatcher =
  | { equals: string | number | boolean }
  | { contains: string }
  | { matches: string }
  | { startsWith: string }
  | { in: (string | number)[] };

// ── Condition Types ──

export type ToolCondition = {
  type: "tool";
  name?: string | string[];
  params?: Record<string, ParamMatcher>;
};

export type TimeCondition = {
  type: "time";
  window?: string;
  after?: string;
  before?: string;
  days?: number[];
};

export type AgentCondition = {
  type: "agent";
  id?: string | string[];
  trustTier?: TrustTier | TrustTier[];
  minScore?: number;
  maxScore?: number;
};

export type ContextCondition = {
  type: "context";
  conversationContains?: string | string[];
  messageContains?: string | string[];
  hasMetadata?: string | string[];
  channel?: string | string[];
  sessionKey?: string;
};

export type RiskCondition = {
  type: "risk";
  minRisk?: RiskLevel;
  maxRisk?: RiskLevel;
};

export type FrequencyCondition = {
  type: "frequency";
  maxCount: number;
  windowSeconds: number;
  scope?: "agent" | "session" | "global";
};

export type IntentCondition = {
  type: "intent";
  description: string;
  confidence?: number;
};

export type CompositeCondition = {
  type: "any";
  conditions: Condition[];
};

export type NegationCondition = {
  type: "not";
  condition: Condition;
};

export type Condition =
  | ToolCondition
  | TimeCondition
  | AgentCondition
  | ContextCondition
  | RiskCondition
  | FrequencyCondition
  | IntentCondition
  | CompositeCondition
  | NegationCondition;

export type Rule = {
  id: string;
  description?: string;
  conditions: Condition[];
  effect: RuleEffect;
  minTrust?: TrustTier;
  maxTrust?: TrustTier;
};

export type Policy = {
  id: string;
  name: string;
  version: string;
  description?: string;
  scope: PolicyScope;
  rules: Rule[];
  enabled?: boolean;
  priority?: number;
};

// ── Evaluation ──

export type EvaluationContext = {
  hook: PolicyHookName;
  agentId: string;
  sessionKey: string;
  channel?: string;
  toolName?: string;
  toolParams?: Record<string, unknown>;
  messageContent?: string;
  messageTo?: string;
  timestamp: number;
  time: TimeContext;
  trust: { score: number; tier: TrustTier };
  conversationContext?: string[];
  metadata?: Record<string, unknown>;
};

export type TimeContext = {
  hour: number;
  minute: number;
  dayOfWeek: number;
  date: string;
  timezone: string;
};

export type RiskFactor = {
  name: string;
  weight: number;
  value: number;
  description: string;
};

export type RiskAssessment = {
  level: RiskLevel;
  score: number;
  factors: RiskFactor[];
};

export type MatchedPolicy = {
  policyId: string;
  ruleId: string;
  effect: RuleEffect;
};

export type Verdict = {
  action: "allow" | "deny" | "escalate";
  reason: string;
  risk: RiskAssessment;
  matchedPolicies: MatchedPolicy[];
  trust: { score: number; tier: TrustTier };
  evaluationUs: number;
  llmEscalated: boolean;
};

// ── Audit ──

export type AuditVerdict =
  | "allow"
  | "deny"
  | "escalate"
  | "escalate_approved"
  | "escalate_denied"
  | "escalate_timeout"
  | "error_fallback";

export type AuditContext = {
  hook: string;
  agentId: string;
  sessionKey: string;
  channel?: string;
  toolName?: string;
  toolParams?: Record<string, unknown>;
  messageContent?: string;
  messageTo?: string;
};

export type AuditRecord = {
  id: string;
  seq: number;
  prevHash: string;
  hash: string;
  timestamp: number;
  timestampIso: string;
  verdict: AuditVerdict;
  context: AuditContext;
  trust: { score: number; tier: TrustTier };
  risk: { level: RiskLevel; score: number };
  matchedPolicies: MatchedPolicy[];
  evaluationUs: number;
  llmEscalated: boolean;
  controls: string[];
};

export type AuditChainState = {
  seq: number;
  lastHash: string;
  lastTimestamp: number;
  recordCount: number;
};

// ── Approval ──

export type ApprovalStatus = "pending" | "approved" | "denied" | "timeout" | "expired";

export type PendingApproval = {
  id: string;
  agentId: string;
  sessionKey: string;
  verdict: Verdict;
  context: EvaluationContext;
  status: ApprovalStatus;
  createdAt: number;
  timeoutAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
  fallback: "allow" | "deny";
};

// ── Frequency ──

export type FrequencyEntry = {
  timestamp: number;
  agentId: string;
  sessionKey: string;
  toolName?: string;
};

// ── Config ──

export type TimeWindow = {
  name: string;
  start: string;
  end: string;
  days?: number[];
  timezone?: string;
};

export type TrustConfig = {
  enabled: boolean;
  defaults: Record<string, number>;
  persistIntervalSeconds: number;
  decay: { enabled: boolean; inactivityDays: number; rate: number };
  weights?: Partial<TrustWeights>;
  maxHistoryPerAgent: number;
};

export type TrustWeights = {
  agePerDay: number;
  ageMax: number;
  successPerAction: number;
  successMax: number;
  violationPenalty: number;
  approvedEscalationBonus: number;
  deniedEscalationPenalty: number;
  cleanStreakPerDay: number;
  cleanStreakMax: number;
};

export type AuditConfig = {
  enabled: boolean;
  backend: "local" | "nats" | "both";
  retentionDays: number;
  verifyOnStartup: boolean;
  redactPatterns: string[];
  level: AuditLevel;
};

export type ApprovalConfig = {
  enabled: boolean;
  timeoutSeconds: number;
  defaultFallback: "allow" | "deny";
  maxPendingPerAgent: number;
  channel: "system_event" | "direct_message";
  target?: string;
};

export type LlmConfig = {
  enabled: boolean;
  endpoint: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  escalationThreshold: number;
  minRiskForEscalation: number;
  maxConcurrent: number;
  cacheResults: boolean;
  cacheTtlSeconds: number;
};

export type PerformanceConfig = {
  maxEvalUs: number;
  maxContextMessages: number;
  frequencyBufferSize: number;
};

export type BuiltinPoliciesConfig = {
  nightMode?: boolean | { after?: string; before?: string };
  credentialGuard?: boolean;
  productionSafeguard?: boolean;
  rateLimiter?: boolean | { maxPerMinute?: number };
};

export type FailMode = "open" | "closed";

export type GovernanceConfig = {
  enabled: boolean;
  timezone: string;
  failMode: FailMode;
  policies: Policy[];
  timeWindows: Record<string, TimeWindow>;
  trust: TrustConfig;
  audit: AuditConfig;
  approval: ApprovalConfig;
  llm: LlmConfig;
  toolRiskOverrides: Record<string, number>;
  builtinPolicies: BuiltinPoliciesConfig;
  performance: PerformanceConfig;
};

// ── Policy Index (internal) ──

export type PolicyIndex = {
  /** Policies indexed by hook name */
  byHook: Map<PolicyHookName, Policy[]>;
  /** Policies indexed by agent ID (includes "*" for global) */
  byAgent: Map<string, Policy[]>;
  /** All compiled regex patterns, keyed by their source string */
  regexCache: Map<string, RegExp>;
};
```

---

## 3. Module Specifications

### 3.1 `index.ts` — Plugin Entry Point

**Responsibility:** Register the governance plugin with OpenClaw.

**Pattern:** Follows the exact same pattern as `nats-eventstore/index.ts` and `cortex/index.ts`.

```typescript
// Pseudocode structure
import { resolveConfig } from "./src/config.js";
import { GovernanceEngine } from "./src/engine.js";
import { registerGovernanceHooks } from "./src/hooks.js";

const plugin = {
  id: "openclaw-governance",
  name: "OpenClaw Governance",
  description: "Contextual, learning, cross-agent governance for AI agents",
  version: "0.1.0",

  register(api: OpenClawPluginApi) {
    const config = resolveConfig(api.pluginConfig);
    if (!config.enabled) {
      api.logger.info("[governance] Disabled via config");
      return;
    }

    const engine = new GovernanceEngine(config, api.logger);

    // Register lifecycle service
    api.registerService({
      id: "governance-engine",
      start: async () => engine.start(),
      stop: async () => engine.stop(),
    });

    // Register hooks
    registerGovernanceHooks(api, engine, config);

    // Register commands
    registerCommands(api, engine);

    // Register gateway methods
    api.registerGatewayMethod("governance.status", async () => engine.getStatus());
    api.registerGatewayMethod("governance.trust", async (params) => engine.getTrust(params?.agentId));
  },
};

export default plugin;
```

**Lines:** ~80

---

### 3.2 `src/config.ts` — Configuration Resolution

**Responsibility:** Resolve raw `pluginConfig` into a fully-typed `GovernanceConfig` with defaults.

**Exports:**
```typescript
export function resolveConfig(raw?: Record<string, unknown>): GovernanceConfig;
```

**Default values:**

| Field | Default |
|---|---|
| `enabled` | `true` |
| `timezone` | `"UTC"` |
| `failMode` | `"open"` |
| `policies` | `[]` |
| `timeWindows` | `{}` |
| `trust.enabled` | `true` |
| `trust.defaults` | `{ "main": 60, "*": 10 }` |
| `trust.persistIntervalSeconds` | `60` |
| `trust.decay.enabled` | `true` |
| `trust.decay.inactivityDays` | `30` |
| `trust.decay.rate` | `0.99` |
| `trust.maxHistoryPerAgent` | `100` |
| `audit.enabled` | `true` |
| `audit.backend` | `"local"` |
| `audit.retentionDays` | `90` |
| `audit.verifyOnStartup` | `true` |
| `audit.redactPatterns` | `[]` |
| `audit.level` | `"standard"` |
| `approval.enabled` | `true` |
| `approval.timeoutSeconds` | `300` |
| `approval.defaultFallback` | `"deny"` |
| `approval.maxPendingPerAgent` | `3` |
| `approval.channel` | `"system_event"` |
| `llm.enabled` | `false` |
| `llm.endpoint` | `"http://localhost:11434/v1"` |
| `llm.model` | `"mistral:7b"` |
| `llm.apiKey` | `""` |
| `llm.timeoutMs` | `5000` |
| `llm.escalationThreshold` | `50` |
| `llm.minRiskForEscalation` | `20` |
| `llm.maxConcurrent` | `2` |
| `llm.cacheResults` | `true` |
| `llm.cacheTtlSeconds` | `300` |
| `performance.maxEvalUs` | `5000` |
| `performance.maxContextMessages` | `10` |
| `performance.frequencyBufferSize` | `1000` |

**Pattern:** Same as `cortex/src/config.ts` — destructure with defaults, no validation library.

**Lines:** ~120

---

### 3.3 `src/engine.ts` — GovernanceEngine

**Responsibility:** Orchestrator that ties all subsystems together. This is the single entry point for hook handlers.

**Exports:**
```typescript
export class GovernanceEngine {
  constructor(config: GovernanceConfig, logger: PluginLogger);
  
  /** Initialize engine — load state, verify audit chain */
  start(): Promise<void>;
  
  /** Graceful shutdown — flush buffers, persist trust */
  stop(): Promise<void>;
  
  /** Primary evaluation entry point. Called by hook handlers. */
  evaluate(ctx: EvaluationContext): Promise<Verdict>;
  
  /** Record a completed action outcome (for trust updates) */
  recordOutcome(agentId: string, toolName: string, success: boolean): void;
  
  /** Get engine status summary */
  getStatus(): GovernanceStatus;
  
  /** Get trust state for an agent (or all) */
  getTrust(agentId?: string): AgentTrust | TrustStore;
  
  /** Set trust score manually */
  setTrust(agentId: string, score: number): void;
  
  /** Resolve a pending approval */
  resolveApproval(id: string, approved: boolean, resolvedBy?: string): void;
  
  /** Get pending approvals */
  getPendingApprovals(): PendingApproval[];
}
```

**Internal structure:**
```typescript
class GovernanceEngine {
  private config: GovernanceConfig;
  private logger: PluginLogger;
  private policyIndex: PolicyIndex;
  private evaluator: PolicyEvaluator;
  private riskAssessor: RiskAssessor;
  private trustManager: TrustManager;
  private auditTrail: AuditTrail;
  private approvalManager: ApprovalManager;
  private llmClient: LlmClient | null;
  private frequencyTracker: FrequencyTracker;
  private stats: EvaluationStats;
  
  // evaluate() orchestration:
  // 1. riskAssessor.assess(ctx)
  // 2. evaluator.evaluate(ctx, policyIndex, risk)
  // 3. trustManager.checkTrustGates(verdict, ctx)
  // 4. auditTrail.record(verdict, ctx, risk)
  // 5. return verdict
}
```

**Lines:** ~200

---

### 3.4 `src/policy-loader.ts` — Policy Loading and Indexing

**Responsibility:** Parse policy definitions from config, validate them, compile regex patterns, and build the policy index.

**Exports:**
```typescript
/** Parse and validate policies from config. Throws on invalid policy definitions. */
export function loadPolicies(
  policies: Policy[],
  builtinConfig: BuiltinPoliciesConfig,
  logger: PluginLogger,
): Policy[];

/** Build an indexed structure for fast policy lookup. */
export function buildPolicyIndex(policies: Policy[]): PolicyIndex;

/** Validate a single regex pattern for safety (reject catastrophic backtracking). */
export function validateRegex(pattern: string): { valid: boolean; error?: string };
```

**Regex safety validation:**
- Reject patterns with nested quantifiers: `(a+)+`, `(a*)*`, `(a+)*b`
- Reject patterns longer than 500 characters
- Use a simple heuristic: count nesting depth of quantifiers via regex on the pattern itself
- On invalid pattern: log warning, skip the condition (treat as non-matching)

**Policy index structure:**
- `byHook`: Group policies by their `scope.hooks`. Policies with no hook scope go into ALL hook groups.
- `byAgent`: Group policies by their `scope.agents`. Policies with no agent scope go into `"*"` (global).
- `regexCache`: Compile all `matches` patterns from all conditions into `RegExp` objects.

**Lines:** ~180

---

### 3.5 `src/policy-evaluator.ts` — Rule Matching

**Responsibility:** Evaluate an `EvaluationContext` against the policy index and return matched policies with their effects.

**Exports:**
```typescript
export class PolicyEvaluator {
  constructor(conditionEvaluators: ConditionEvaluatorMap);
  
  /** Evaluate context against indexed policies. Returns all matches + final verdict action. */
  evaluate(
    ctx: EvaluationContext,
    index: PolicyIndex,
    risk: RiskAssessment,
    llmClient: LlmClient | null,
  ): Promise<{ action: "allow" | "deny" | "escalate"; reason: string; matches: MatchedPolicy[] }>;
}
```

**Algorithm (per RFC §4.7 and §6.4):**

```
1. Collect applicable policies:
   - index.byHook.get(ctx.hook) + index.byAgent.get(ctx.agentId) + index.byAgent.get("*")
   - Deduplicate by policy ID
   - Filter by scope (excludeAgents, channels)
   - Filter by enabled flag
   
2. Sort by priority (desc), then specificity (desc)
   - Specificity: policies with specific agents > global policies

3. For each policy:
   a. For each rule in policy.rules:
      - Check minTrust/maxTrust against ctx.trust.tier
      - Evaluate all conditions (AND logic, short-circuit on first false)
      - If all conditions match → this rule is the policy's verdict; break
   b. If no rule matched → policy produces no verdict

4. Collect all policy verdicts

5. Apply deny-wins aggregation:
   - Any "deny" → final is "deny" (combine reasons)
   - Any "escalate" (no deny) → final is "escalate"
   - Any "audit" (no deny/escalate) → final is "allow" (audit is side-effect, not blocking)
   - All "allow" / no matches → final is "allow"

6. Return { action, reason, matches }
```

**Lines:** ~150

---

### 3.6 `src/conditions/` — Condition Evaluators

Each condition type has its own evaluator module. All follow this interface:

```typescript
export type ConditionEvaluatorFn = (
  condition: Condition,
  ctx: EvaluationContext,
  deps: ConditionDeps,
) => boolean | Promise<boolean>;

export type ConditionDeps = {
  regexCache: Map<string, RegExp>;
  timeWindows: Record<string, TimeWindow>;
  risk: RiskAssessment;
  frequencyTracker: FrequencyTracker;
  llmClient: LlmClient | null;
};

export type ConditionEvaluatorMap = Record<Condition["type"], ConditionEvaluatorFn>;
```

#### 3.6.1 `conditions/index.ts`

Registry that maps condition type strings to evaluator functions:

```typescript
export function createConditionEvaluators(): ConditionEvaluatorMap {
  return {
    tool: evaluateToolCondition,
    time: evaluateTimeCondition,
    agent: evaluateAgentCondition,
    context: evaluateContextCondition,
    risk: evaluateRiskCondition,
    frequency: evaluateFrequencyCondition,
    intent: evaluateIntentCondition,
    any: evaluateCompositeCondition,
    not: evaluateNegationCondition,
  };
}

export async function evaluateConditions(
  conditions: Condition[],
  ctx: EvaluationContext,
  deps: ConditionDeps,
  evaluators: ConditionEvaluatorMap,
): Promise<boolean>;
```

**Lines:** ~50

#### 3.6.2 `conditions/tool.ts`

```typescript
export function evaluateToolCondition(
  condition: ToolCondition,
  ctx: EvaluationContext,
  deps: ConditionDeps,
): boolean;
```

**Logic:**
1. If `condition.name` is specified:
   - If string: exact match or glob against `ctx.toolName`
   - If array: any match
   - Glob support: `*` matches any characters (convert to regex: `^name$` with `*` → `.*`)
2. If `condition.params` is specified:
   - For each param matcher, check against `ctx.toolParams[key]`
   - `equals`: strict equality
   - `contains`: `String(value).includes(target)`
   - `matches`: test against compiled regex from `deps.regexCache`
   - `startsWith`: `String(value).startsWith(target)`
   - `in`: `array.includes(value)`

**Lines:** ~80

#### 3.6.3 `conditions/time.ts`

```typescript
export function evaluateTimeCondition(
  condition: TimeCondition,
  ctx: EvaluationContext,
  deps: ConditionDeps,
): boolean;
```

**Logic:**
1. If `condition.window`: resolve from `deps.timeWindows`, then evaluate as if after/before/days were set.
2. If `condition.after` and/or `condition.before`:
   - Parse "HH:MM" to minutes-since-midnight
   - Handle midnight wrap: if after > before, it means "after 22:00 OR before 06:00"
   - Compare against `ctx.time.hour * 60 + ctx.time.minute`
3. If `condition.days`: check `ctx.time.dayOfWeek` against allowed days.

**Lines:** ~70

#### 3.6.4 `conditions/agent.ts`

```typescript
export function evaluateAgentCondition(
  condition: AgentCondition,
  ctx: EvaluationContext,
  deps: ConditionDeps,
): boolean;
```

**Logic:**
1. If `condition.id`: match against `ctx.agentId` (string or array, support glob)
2. If `condition.trustTier`: check `ctx.trust.tier` against allowed tiers
3. If `condition.minScore` / `condition.maxScore`: range check on `ctx.trust.score`

**Lines:** ~40

#### 3.6.5 `conditions/context.ts`

```typescript
export function evaluateContextCondition(
  condition: ContextCondition,
  ctx: EvaluationContext,
  deps: ConditionDeps,
): boolean;
```

**Logic:**
1. `conversationContains`: test each pattern (compiled regex) against `ctx.conversationContext` entries. ANY pattern matching ANY entry = true.
2. `messageContains`: test against `ctx.messageContent` or `ctx.toolParams?.command` (for exec tools).
3. `hasMetadata`: check key presence in `ctx.metadata`.
4. `channel`: match `ctx.channel`.
5. `sessionKey`: glob match against `ctx.sessionKey`.

**Lines:** ~70

#### 3.6.6 `conditions/risk.ts`

```typescript
export function evaluateRiskCondition(
  condition: RiskCondition,
  ctx: EvaluationContext,
  deps: ConditionDeps,
): boolean;
```

**Logic:** Map risk levels to numeric ranges and compare against `deps.risk.level`.

Risk level ordering: `low=0, medium=1, high=2, critical=3`.

**Lines:** ~30

#### 3.6.7 `conditions/frequency.ts`

```typescript
export function evaluateFrequencyCondition(
  condition: FrequencyCondition,
  ctx: EvaluationContext,
  deps: ConditionDeps,
): boolean;
```

**Logic:** Query `deps.frequencyTracker` for count of matching events in the time window. Returns `true` if count >= maxCount (meaning: "the frequency limit IS exceeded" = condition matches for a deny rule).

**Lines:** ~30

#### 3.6.8 `conditions/composite.ts`

```typescript
export function evaluateCompositeCondition(
  condition: CompositeCondition,
  ctx: EvaluationContext,
  deps: ConditionDeps,
): Promise<boolean>;

export function evaluateNegationCondition(
  condition: NegationCondition,
  ctx: EvaluationContext,
  deps: ConditionDeps,
): Promise<boolean>;
```

**Logic:**
- `any`: OR logic — return true if ANY sub-condition matches
- `not`: negate the inner condition's result

Both recursively call `evaluateConditions` for sub-conditions.

**Lines:** ~40

#### 3.6.9 `conditions/intent.ts`

```typescript
export async function evaluateIntentCondition(
  condition: IntentCondition,
  ctx: EvaluationContext,
  deps: ConditionDeps,
): Promise<boolean>;
```

**Logic:**
1. If `deps.llmClient` is null → return false (intent conditions require LLM)
2. Build LLM prompt per RFC §9.4
3. Call `deps.llmClient.evaluateIntent(prompt)`
4. Parse JSON response
5. Return `response.matches && response.confidence >= (condition.confidence ?? 0.7)`

**Lines:** ~50

---

### 3.7 `src/risk-assessor.ts` — Risk Scoring

**Responsibility:** Compute risk score for an action based on tool sensitivity, time, trust, frequency, and target scope.

**Exports:**
```typescript
export class RiskAssessor {
  constructor(toolRiskOverrides: Record<string, number>);
  
  /** Assess risk for an evaluation context */
  assess(ctx: EvaluationContext, frequencyTracker: FrequencyTracker): RiskAssessment;
}
```

**Built-in tool risk scores (overridable via config):**

```typescript
const DEFAULT_TOOL_RISK: Record<string, number> = {
  // Critical
  gateway: 95,
  cron: 90,
  elevated: 95,
  // High
  exec: 70,
  write: 65,
  edit: 60,
  // Medium
  sessions_spawn: 45,
  sessions_send: 50,
  browser: 40,
  message: 40,
  // Low
  read: 10,
  memory_search: 5,
  memory_get: 5,
  web_search: 15,
  web_fetch: 20,
  image: 10,
  canvas: 15,
};
```

**Risk computation (per RFC §6.3):**

```
toolSensitivity = lookupToolRisk(ctx.toolName) * 0.30
timeRisk = isOffHours(ctx.time) ? 15 : 0
trustDeficit = ((100 - ctx.trust.score) / 100) * 20
frequencyRisk = min(recentActionCount / 20, 1) * 15
targetScope = isExternalTarget(ctx) ? 20 : 0

total = clamp(toolSensitivity + timeRisk + trustDeficit + frequencyRisk + targetScope, 0, 100)
level = total <= 25 ? "low" : total <= 50 ? "medium" : total <= 75 ? "high" : "critical"
```

**Lines:** ~120

---

### 3.8 `src/trust-manager.ts` — Trust System

**Responsibility:** Manage agent trust scores, compute scores from signals, persist to disk.

**Exports:**
```typescript
export class TrustManager {
  constructor(config: TrustConfig, workspace: string, logger: PluginLogger);
  
  /** Load trust store from disk */
  load(): void;
  
  /** Get trust state for an agent (creates default if not exists) */
  getAgentTrust(agentId: string): AgentTrust;
  
  /** Get the full trust store */
  getStore(): TrustStore;
  
  /** Record a successful action */
  recordSuccess(agentId: string, reason?: string): void;
  
  /** Record a policy violation */
  recordViolation(agentId: string, reason?: string): void;
  
  /** Record an escalation outcome */
  recordEscalation(agentId: string, approved: boolean, reason?: string): void;
  
  /** Manual trust score adjustment */
  setScore(agentId: string, score: number): void;
  
  /** Lock agent to a trust tier */
  lockTier(agentId: string, tier: TrustTier): void;
  
  /** Unlock agent trust tier */
  unlockTier(agentId: string): void;
  
  /** Set trust floor */
  setFloor(agentId: string, floor: number): void;
  
  /** Reset trust history for an agent */
  resetHistory(agentId: string): void;
  
  /** Flush trust store to disk (called by engine on shutdown and timer) */
  flush(): void;
  
  /** Start periodic persistence timer */
  startPersistence(): void;
  
  /** Stop persistence timer */
  stopPersistence(): void;
}
```

**Score computation (per RFC §5.2):**
```typescript
function computeScore(signals: TrustSignals, weights: TrustWeights): number {
  const base = Math.min(signals.ageDays * weights.agePerDay, weights.ageMax);
  const success = Math.min(signals.successCount * weights.successPerAction, weights.successMax);
  const violations = signals.violationCount * weights.violationPenalty;
  const escApproved = signals.approvedEscalations * weights.approvedEscalationBonus;
  const escDenied = signals.deniedEscalations * weights.deniedEscalationPenalty;
  const streak = Math.min(signals.cleanStreak * weights.cleanStreakPerDay, weights.cleanStreakMax);
  const raw = base + success + violations + escApproved + escDenied + streak + signals.manualAdjustment;
  return Math.max(0, Math.min(100, raw));
}
```

**Default weights:**

| Weight | Value |
|---|---|
| `agePerDay` | 0.5 |
| `ageMax` | 20 |
| `successPerAction` | 0.1 |
| `successMax` | 30 |
| `violationPenalty` | -2 |
| `approvedEscalationBonus` | 0.5 |
| `deniedEscalationPenalty` | -3 |
| `cleanStreakPerDay` | 0.3 |
| `cleanStreakMax` | 20 |

**Storage:** `{workspace}/governance/trust.json`

**Tier mapping:**
```typescript
function scoreToTier(score: number): TrustTier {
  if (score >= 80) return "privileged";
  if (score >= 60) return "trusted";
  if (score >= 40) return "standard";
  if (score >= 20) return "restricted";
  return "untrusted";
}
```

**Lines:** ~250

---

### 3.9 `src/audit-trail.ts` — Audit System

**Responsibility:** Generate, hash-chain, and persist audit records.

**Exports:**
```typescript
export class AuditTrail {
  constructor(config: AuditConfig, workspace: string, logger: PluginLogger);
  
  /** Load chain state from disk, optionally verify */
  load(verify: boolean): void;
  
  /** Create and buffer an audit record */
  record(
    verdict: AuditVerdict,
    context: AuditContext,
    trust: { score: number; tier: TrustTier },
    risk: { level: RiskLevel; score: number },
    matchedPolicies: MatchedPolicy[],
    evaluationUs: number,
    llmEscalated: boolean,
  ): AuditRecord;
  
  /** Query audit records from disk */
  query(filter: AuditFilter): AuditRecord[];
  
  /** Flush buffered records to disk */
  flush(): void;
  
  /** Start auto-flush timer */
  startAutoFlush(): void;
  
  /** Stop auto-flush timer */
  stopAutoFlush(): void;
  
  /** Get chain state */
  getChainState(): AuditChainState;
  
  /** Verify chain integrity for a given date range */
  verifyChain(from?: string, to?: string): { valid: boolean; breakAt?: number; error?: string };
  
  /** Get statistics */
  getStats(): AuditStats;
}

type AuditFilter = {
  agentId?: string;
  verdict?: AuditVerdict;
  from?: number;
  to?: number;
  limit?: number;
};

type AuditStats = {
  totalRecords: number;
  recordsByVerdict: Record<AuditVerdict, number>;
  chainValid: boolean;
  oldestRecord?: string;
  newestRecord?: string;
};
```

**Hash chain implementation:**
```typescript
import { createHash } from "node:crypto";

function computeHash(record: Omit<AuditRecord, "hash">): string {
  const data = `${record.seq}|${record.timestamp}|${record.verdict}|${record.context.agentId}|${record.context.hook}|${record.context.toolName ?? ""}|${record.prevHash}`;
  return createHash("sha256").update(data).digest("hex");
}
```

**File format:** JSONL (one JSON object per line) in `{workspace}/governance/audit/YYYY-MM-DD.jsonl`

**Chain state file:** `{workspace}/governance/audit/chain-state.json`

**Buffer:** In-memory array, flushed every 1s or 100 records (whichever first).

**Lines:** ~250

---

### 3.10 `src/audit-redactor.ts` — Sensitive Data Redaction

**Responsibility:** Redact sensitive fields from audit contexts before persistence.

**Exports:**
```typescript
export function createRedactor(customPatterns: string[]): (ctx: AuditContext) => AuditContext;
```

**Built-in redaction patterns:**
```typescript
const SENSITIVE_PARAM_KEYS = /^(password|secret|token|apiKey|api_key|credential|auth|authorization)$/i;
const SENSITIVE_PATH_PATTERNS = /\.(env|pem|key|crt|p12|pfx)$|credentials|secrets/i;
const MAX_MESSAGE_LENGTH = 500;
```

**Logic:**
1. Deep-clone the context (structuredClone or manual)
2. Walk `toolParams` — if key matches `SENSITIVE_PARAM_KEYS`, replace value with `"[REDACTED]"`
3. If `messageContent` exceeds `MAX_MESSAGE_LENGTH`, truncate with `"[TRUNCATED at 500 chars]"`
4. Apply custom patterns (regex match on all string values)

**Lines:** ~60

---

### 3.11 `src/approval-manager.ts` — Human-in-the-Loop

**Responsibility:** Manage pending approval requests, timeouts, and resolution.

**Exports:**
```typescript
export class ApprovalManager {
  constructor(config: ApprovalConfig, workspace: string, logger: PluginLogger);
  
  /** Load pending approvals from disk (survive gateway restart) */
  load(): void;
  
  /** Create a pending approval. Returns the approval ID. */
  create(verdict: Verdict, ctx: EvaluationContext): PendingApproval;
  
  /** Resolve an approval (approve or deny) */
  resolve(id: string, approved: boolean, resolvedBy?: string): PendingApproval | null;
  
  /** Check and expire timed-out approvals. Called periodically. */
  checkTimeouts(): PendingApproval[];
  
  /** Get all pending approvals */
  getPending(): PendingApproval[];
  
  /** Get pending approvals for a specific agent */
  getPendingForAgent(agentId: string): PendingApproval[];
  
  /** Check if agent has room for more pending approvals */
  canEscalate(agentId: string): boolean;
  
  /** Format an approval notification message */
  formatNotification(approval: PendingApproval): string;
  
  /** Persist pending approvals to disk */
  flush(): void;
  
  /** Start timeout checker interval */
  startTimeoutChecker(): void;
  
  /** Stop timeout checker */
  stopTimeoutChecker(): void;
}
```

**Storage:** `{workspace}/governance/pending-approvals.json`

**Timeout checker:** Runs every 10 seconds, calls `checkTimeouts()`.

**Lines:** ~200

---

### 3.12 `src/llm-client.ts` — LLM Escalation Client

**Responsibility:** Call an OpenAI-compatible API for intent evaluation. Includes caching and concurrency control.

**Exports:**
```typescript
export class LlmClient {
  constructor(config: LlmConfig, logger: PluginLogger);
  
  /** Evaluate an intent condition against the given context */
  evaluateIntent(
    intent: IntentCondition,
    ctx: EvaluationContext,
  ): Promise<{ matches: boolean; confidence: number; reasoning: string } | null>;
  
  /** Clear intent cache */
  clearCache(): void;
  
  /** Clear timers */
  destroy(): void;
}
```

**Implementation details:**
- HTTP client: `fetch` (built into Node 22)
- Concurrency: semaphore (simple counter) limiting to `config.maxConcurrent` parallel calls
- Cache: `Map<string, { result, expiresAt }>` — cache key is SHA-256 of intent description + tool context
- Timeout: `AbortController` with `config.timeoutMs`
- On timeout/error: return `null` (caller falls back to regex-only verdict)

**Lines:** ~150

---

### 3.13 `src/frequency-tracker.ts` — Ring Buffer Frequency Counter

**Responsibility:** Track action frequency using a fixed-size ring buffer. No growing arrays.

**Exports:**
```typescript
export class FrequencyTracker {
  constructor(bufferSize: number);
  
  /** Record an action */
  record(entry: FrequencyEntry): void;
  
  /** Count matching entries within a time window */
  count(
    windowSeconds: number,
    scope: "agent" | "session" | "global",
    agentId: string,
    sessionKey: string,
  ): number;
  
  /** Clear all entries */
  clear(): void;
}
```

**Ring buffer implementation:**
```typescript
class FrequencyTracker {
  private buffer: (FrequencyEntry | null)[];
  private head: number = 0;
  private size: number;
  
  // record: write at head, advance head (modulo size)
  // count: scan buffer, skip nulls and expired entries, count matches
}
```

**Lines:** ~70

---

### 3.14 `src/builtin-policies.ts` — Built-in Policy Templates

**Responsibility:** Generate Policy objects for built-in templates (night mode, credential guard, etc.)

**Exports:**
```typescript
export function getBuiltinPolicies(config: BuiltinPoliciesConfig): Policy[];
```

**Templates:**

1. **Night Mode** (`builtin-night-mode`): Deny non-critical tools 23:00–08:00. Allow: `read`, `memory_search`, `memory_get`.
2. **Credential Guard** (`builtin-credential-guard`): Deny exec commands containing `cat .env`, `cat credentials`, `git remote -v`, `printenv`, `echo $`. Deny read/write on paths matching `.env`, `credentials`, `secrets`.
3. **Production Safeguard** (`builtin-production-safeguard`): Escalate on `gateway`, `cron`, `systemctl`, `docker push`, `dns` commands.
4. **Rate Limiter** (`builtin-rate-limiter`): Deny when exec calls exceed N/minute.

**Lines:** ~150

---

### 3.15 `src/hooks.ts` — Hook Registration

**Responsibility:** Register all OpenClaw hook handlers that wire into the governance engine.

**Exports:**
```typescript
export function registerGovernanceHooks(
  api: OpenClawPluginApi,
  engine: GovernanceEngine,
  config: GovernanceConfig,
): void;
```

**Hook registrations:**

```typescript
function registerGovernanceHooks(api, engine, config) {
  // Primary enforcement — highest priority
  api.on("before_tool_call", handleBeforeToolCall(engine, config), { priority: 1000 });
  api.on("message_sending", handleMessageSending(engine, config), { priority: 1000 });
  
  // Informational hooks
  api.on("after_tool_call", handleAfterToolCall(engine), { priority: 900 });
  api.on("message_sent", handleMessageSent(engine), { priority: 900 });
  
  // Context injection
  api.on("before_agent_start", handleBeforeAgentStart(engine, config), { priority: 5 });
  
  // Lifecycle
  api.on("session_start", handleSessionStart(engine), { priority: 1 });
  api.on("gateway_start", handleGatewayStart(engine), { priority: 1 });
  api.on("gateway_stop", handleGatewayStop(engine), { priority: 999 });
}
```

**Handler factories:** Each handler is a factory function that returns the hook handler closure, capturing the engine reference.

**Error handling:** Every handler MUST be wrapped in try/catch. On error:
- Log at error level
- If `config.failMode === "open"`: return undefined (allow)
- If `config.failMode === "closed"`: return block/cancel

**Lines:** ~200

---

### 3.16 `src/util.ts` — Shared Utilities

**Responsibility:** Time utilities, hashing, glob-to-regex conversion.

**Exports:**
```typescript
/** Parse "HH:MM" string to minutes since midnight */
export function parseTimeToMinutes(time: string): number;

/** Check if current time is within a time window (handles midnight wrap) */
export function isInTimeRange(currentMinutes: number, afterMinutes: number, beforeMinutes: number): boolean;

/** Get current time components in a specific timezone */
export function getCurrentTime(timezone: string): TimeContext;

/** Convert a glob pattern to a RegExp (only * is supported) */
export function globToRegex(pattern: string): RegExp;

/** SHA-256 hash a string, return hex */
export function sha256(data: string): string;

/** Clamp a number to [min, max] */
export function clamp(value: number, min: number, max: number): number;

/** High-resolution timer (microseconds) */
export function nowUs(): number;

/** Extract agent ID from session key (e.g., "agent:forge:subagent:abc" → "forge") */
export function extractAgentId(sessionKey?: string, agentId?: string): string;

/** Check if a session key belongs to a sub-agent */
export function isSubAgent(sessionKey?: string): boolean;
```

**Lines:** ~100

---

## 4. Data Flow

### 4.1 Tool Call Governance (before_tool_call)

```
Agent calls exec("docker rm container-x")
         │
         ▼
┌─────────────────────────────────┐
│ OpenClaw: before_tool_call hook │
│ (priority 1000 = governance)    │
└─────────────┬───────────────────┘
              │
              ▼
┌─────────────────────────────────┐
│ hooks.ts: handleBeforeToolCall  │
│ 1. Build EvaluationContext      │
│    - agentId: "main"            │
│    - toolName: "exec"           │
│    - toolParams: {command:...}  │
│    - time: {hour:3, ...}       │
│    - trust: {score:60, ...}    │
└─────────────┬───────────────────┘
              │
              ▼
┌─────────────────────────────────┐
│ engine.ts: evaluate(ctx)        │
│                                 │
│ 1. riskAssessor.assess(ctx)     │
│    → { level:"high", score:72 } │
│                                 │
│ 2. evaluator.evaluate(ctx,idx)  │
│    → scans indexed policies     │
│    → builtin-night-mode matches │
│    → { action:"deny" }         │
│                                 │
│ 3. trustManager.recordViolation │
│                                 │
│ 4. auditTrail.record(...)       │
│    → hash chain, buffer         │
│                                 │
│ 5. return Verdict               │
└─────────────┬───────────────────┘
              │
              ▼
┌─────────────────────────────────┐
│ hooks.ts → OpenClaw             │
│ return {                        │
│   block: true,                  │
│   blockReason: "Night mode..."  │
│ }                               │
└─────────────────────────────────┘
              │
              ▼
        Tool call blocked.
        Agent receives error.
```

### 4.2 Escalation Flow

```
Agent calls gateway("restart")
         │
         ▼
┌─────────────────────────────┐
│ evaluate(ctx)               │
│ → production-safeguard      │
│ → effect: "escalate"        │
│ → to: "human"               │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ approvalManager.create(...)  │
│ → PendingApproval created    │
│ → notification formatted     │
│ → system event enqueued      │
└──────────┬──────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ return { block: true,         │
│   blockReason: "🔒 Awaiting  │
│   governance approval..."     │
│ }                             │
└──────────┬───────────────────┘
           │
      ┌────┴────┐
      ▼         ▼
  Human sees   Timeout
  notification  (300s)
      │         │
      ▼         ▼
  /approve    fallback
  or /deny    applied
      │         │
      ▼         ▼
  auditTrail   auditTrail
  .record()    .record()
```

**Important:** Since `before_tool_call` blocks synchronously, the escalation flow blocks the tool call. The agent receives an error message explaining the block. The human can then use `/approve <id>` and the agent can retry the tool call (which will now find the approval in the approval manager).

### 4.3 Trust Update Flow

```
after_tool_call event
    │
    ▼
┌────────────────────────────────┐
│ hooks.ts: handleAfterToolCall  │
│ → success = !event.error       │
│ → engine.recordOutcome(...)    │
└────────────┬───────────────────┘
             │
             ▼
┌────────────────────────────────┐
│ trustManager.recordSuccess()   │
│ or recordViolation()           │
│                                │
│ 1. signals.successCount++      │
│    (or violationCount++)       │
│ 2. history.push(event)         │
│ 3. computeScore(signals)       │
│ 4. update tier                 │
│ 5. debounced persist to disk   │
└────────────────────────────────┘
```

### 4.4 Startup Flow

```
gateway_start event
    │
    ▼
┌────────────────────────────────┐
│ engine.start()                 │
│                                │
│ 1. policyLoader.loadPolicies() │
│    + builtinPolicies           │
│    → compile regex             │
│    → build policy index        │
│                                │
│ 2. trustManager.load()         │
│    → read trust.json           │
│    → apply decay if needed     │
│                                │
│ 3. auditTrail.load(verify)     │
│    → read chain-state.json     │
│    → verify hash chain         │
│                                │
│ 4. approvalManager.load()      │
│    → read pending-approvals    │
│    → expire stale approvals    │
│                                │
│ 5. frequencyTracker.clear()    │
│                                │
│ 6. Start timers:               │
│    - trust persistence (60s)   │
│    - audit flush (1s)          │
│    - approval timeout (10s)    │
└────────────────────────────────┘
```

---

## 5. Configuration Resolution

### 5.1 Config in openclaw.json

```json
{
  "plugins": {
    "openclaw-governance": {
      "enabled": true,
      "timezone": "Europe/Berlin",
      "policies": [
        {
          "id": "forge-no-deploy",
          "name": "Forge Cannot Deploy",
          "version": "1.0.0",
          "scope": { "agents": ["forge"] },
          "rules": [
            {
              "id": "block-push",
              "conditions": [
                { "type": "tool", "name": "exec", "params": { "command": { "matches": "git push.*(main|master)" } } }
              ],
              "effect": { "action": "deny", "reason": "Forge cannot push to main" }
            }
          ]
        }
      ],
      "timeWindows": {
        "weekly-maintenance": {
          "name": "Weekly Maintenance",
          "start": "02:00",
          "end": "06:00",
          "days": [0],
          "timezone": "Europe/Berlin"
        }
      },
      "trust": {
        "defaults": {
          "main": 60,
          "forge": 45,
          "cerberus": 50,
          "harbor": 45,
          "leuko": 40,
          "stella": 35,
          "vera": 50,
          "viola": 45,
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
        "backend": "both",
        "retentionDays": 90,
        "level": "standard"
      },
      "llm": {
        "enabled": false
      }
    }
  }
}
```

### 5.2 Workspace Directory Resolution

The governance engine stores state in `{workspace}/governance/`:

```
{workspace}/governance/
├── trust.json                # Trust store
├── pending-approvals.json    # Pending escalations
└── audit/
    ├── chain-state.json      # Current chain head
    ├── 2026-02-17.jsonl      # Today's audit records
    ├── 2026-02-16.jsonl      # Yesterday's
    └── ...
```

Workspace resolution (same pattern as cortex):
1. If `config.workspace` is set, use it.
2. If OpenClaw context provides `workspaceDir`, use it.
3. Fall back to `~/.openclaw/plugins/openclaw-governance/`.

---

## 6. Testing Strategy

### 6.1 Unit Tests

Every module gets dedicated unit tests. Minimum coverage: 90% lines.

**Test framework:** vitest (consistent with other OpenClaw plugins)

**Test patterns:**

```typescript
// Example: conditions/time.test.ts
describe("evaluateTimeCondition", () => {
  it("should match when current time is within range", () => { ... });
  it("should match midnight-wrapping range (22:00-06:00)", () => { ... });
  it("should not match when outside range", () => { ... });
  it("should respect day-of-week filter", () => { ... });
  it("should resolve named time windows", () => { ... });
  it("should handle edge case: range start equals end", () => { ... });
});
```

### 6.2 Key Test Scenarios

| Module | Critical Test Cases |
|---|---|
| `config` | Defaults applied, partial overrides work, invalid values rejected |
| `policy-loader` | Valid policy loads, invalid regex rejected, builtin templates generated, policy index built correctly |
| `policy-evaluator` | AND logic, deny-wins, priority ordering, scope filtering, empty policy passthrough |
| `conditions/tool` | Exact match, glob match, array match, param matchers (equals/contains/matches/startsWith/in), missing tool name |
| `conditions/time` | Normal range, midnight wrap, day filter, named window resolution, edge: start==end |
| `conditions/agent` | ID match, trust tier match, score range, glob ID |
| `conditions/context` | Conversation search, message search, metadata check, channel filter, session key glob |
| `conditions/risk` | Level ordering, boundary values |
| `conditions/frequency` | Under limit, at limit, over limit, different scopes |
| `conditions/composite` | OR logic with any, NOT logic, nested composites |
| `conditions/intent` | LLM available, LLM unavailable (returns false), LLM timeout, confidence threshold |
| `risk-assessor` | Known tools, unknown tools (default), off-hours bonus, trust deficit, overrides |
| `trust-manager` | Score computation, tier mapping, decay, manual adjustment, lock, floor, persistence round-trip |
| `audit-trail` | Record creation, hash chain integrity, chain verification, buffer flush, redaction applied, JSONL format |
| `audit-redactor` | Sensitive keys redacted, message truncation, custom patterns, nested objects |
| `approval-manager` | Create, resolve (approve/deny), timeout, max pending limit, persistence round-trip |
| `llm-client` | Successful call, timeout, cache hit, cache miss, concurrent limit |
| `frequency-tracker` | Ring buffer wrap, time window expiry, scope filtering |
| `hooks` | before_tool_call deny returns block, allow returns undefined, error returns undefined (fail-open), priority set correctly |
| `integration` | Full pipeline: tool call → risk → policy → trust update → audit record |

### 6.3 Integration Tests

`test/integration.test.ts` tests the full governance pipeline end-to-end:

```typescript
describe("Governance Integration", () => {
  it("should deny tool call matching a deny policy", async () => {
    // Setup: engine with policy denying exec "rm -rf"
    // Action: evaluate exec with command "rm -rf /"
    // Assert: verdict.action === "deny"
    // Assert: audit record created with verdict "deny"
    // Assert: trust violation recorded
  });

  it("should allow tool call when no policies match", async () => {
    // Setup: engine with policy only targeting "forge"
    // Action: evaluate as "main" agent
    // Assert: verdict.action === "allow"
  });

  it("should escalate when policy requests it", async () => {
    // Setup: engine with escalation policy
    // Action: evaluate matching tool call
    // Assert: verdict.action === "escalate"
    // Assert: pending approval created
  });

  it("should deny-wins across multiple policies", async () => {
    // Setup: policy A allows, policy B denies
    // Action: evaluate tool call matching both
    // Assert: verdict.action === "deny"
  });

  it("should respect trust tier gates on rules", async () => {
    // Setup: rule with minTrust="trusted"
    // Action: evaluate as agent with score=30 (restricted)
    // Assert: rule does not match (trust gate fails)
  });

  it("should apply night mode builtin policy", async () => {
    // Setup: nightMode enabled, inject time = 3 AM
    // Action: evaluate exec call
    // Assert: verdict.action === "deny"
  });

  it("should handle engine errors with fail-open", async () => {
    // Setup: engine with broken policy (to force error)
    // Action: evaluate any tool call
    // Assert: verdict.action === "allow" (fail-open)
    // Assert: error logged
  });

  it("should maintain hash chain integrity", async () => {
    // Setup: engine, create 10 audit records
    // Action: verify chain
    // Assert: all hashes match
  });
});
```

### 6.4 Performance Tests

`test/performance.test.ts` (separate from unit tests, run with `--benchmark`):

```typescript
describe("Performance", () => {
  it("should evaluate 10 regex policies in <5ms", () => {
    // Setup: 10 policies with regex conditions
    // Action: run 100 evaluations
    // Assert: p99 < 5000μs
  });

  it("should handle 1000 frequency entries without degradation", () => {
    // Setup: fill ring buffer to capacity
    // Action: count in various windows
    // Assert: each count < 100μs
  });
});
```

### 6.5 Test Configuration

```json
// vitest.config.ts
{
  "test": {
    "include": ["test/**/*.test.ts"],
    "coverage": {
      "provider": "v8",
      "include": ["src/**/*.ts"],
      "exclude": ["src/types.ts"],
      "thresholds": {
        "lines": 90,
        "functions": 90,
        "branches": 85
      }
    }
  }
}
```

---

## 7. Implementation Order

Forge MUST implement modules in this order. Each phase builds on the previous and can be tested independently.

### Phase 1: Foundation (types, config, utils)
1. `src/types.ts` — All type definitions
2. `src/util.ts` — Shared utilities (time, hashing, clamp)
3. `src/config.ts` — Configuration resolution
4. `test/config.test.ts`
5. `test/util.test.ts`

### Phase 2: Core Engine (conditions, evaluation)
6. `src/conditions/tool.ts` + `test/conditions/tool.test.ts`
7. `src/conditions/time.ts` + `test/conditions/time.test.ts`
8. `src/conditions/agent.ts` + `test/conditions/agent.test.ts`
9. `src/conditions/context.ts` + `test/conditions/context.test.ts`
10. `src/conditions/risk.ts` + `test/conditions/risk.test.ts`
11. `src/conditions/frequency.ts` + `test/conditions/frequency.test.ts`
12. `src/conditions/composite.ts` + `test/conditions/composite.test.ts`
13. `src/conditions/index.ts`
14. `src/frequency-tracker.ts` + `test/frequency-tracker.test.ts`
15. `src/risk-assessor.ts` + `test/risk-assessor.test.ts`
16. `src/policy-loader.ts` + `test/policy-loader.test.ts`
17. `src/policy-evaluator.ts` + `test/policy-evaluator.test.ts`

### Phase 3: Trust & Audit
18. `src/trust-manager.ts` + `test/trust-manager.test.ts`
19. `src/audit-redactor.ts` + `test/audit-redactor.test.ts`
20. `src/audit-trail.ts` + `test/audit-trail.test.ts`

### Phase 4: Approval & LLM
21. `src/approval-manager.ts` + `test/approval-manager.test.ts`
22. `src/conditions/intent.ts` + `test/conditions/intent.test.ts`
23. `src/llm-client.ts` + `test/llm-client.test.ts`

### Phase 5: Integration
24. `src/builtin-policies.ts` + `test/builtin-policies.test.ts`
25. `src/engine.ts` + `test/engine.test.ts`
26. `src/hooks.ts` + `test/hooks.test.ts`
27. `index.ts`
28. `test/integration.test.ts`

### Phase 6: Package
29. `openclaw.plugin.json`
30. `package.json`
31. `tsconfig.json`
32. `README.md`

---

## 8. Build & Package

### 8.1 package.json

```json
{
  "name": "@vainplex/openclaw-governance",
  "version": "0.1.0",
  "description": "Contextual, learning, cross-agent governance for AI agents",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist/", "openclaw.plugin.json", "README.md"],
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "oxlint src/ test/",
    "clean": "rm -rf dist/"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "@vitest/coverage-v8": "^3.0.0",
    "oxlint": "^0.15.0"
  },
  "engines": {
    "node": ">=22.0.0"
  },
  "license": "MIT",
  "author": "Albert Hild <albert@vainplex.dev>",
  "repository": {
    "type": "git",
    "url": "https://github.com/alberthild/openclaw-governance.git"
  },
  "keywords": ["openclaw", "governance", "ai-agents", "policy-engine", "trust", "audit"]
}
```

**Zero runtime dependencies.** Only `node:crypto`, `node:fs`, `node:path`, `node:url` from Node.js builtins.

### 8.2 tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": ".",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["index.ts", "src/**/*.ts"],
  "exclude": ["node_modules", "dist", "test"]
}
```

### 8.3 openclaw.plugin.json

The full JSON Schema for plugin configuration. See RFC §10.3 for the schema specification. The actual file should define all properties with types, defaults, and descriptions matching the `GovernanceConfig` type.

### 8.4 Dependencies Note

This plugin has **zero runtime dependencies**. All functionality uses Node.js builtins:

| Need | Solution |
|---|---|
| Hashing (SHA-256) | `node:crypto` → `createHash("sha256")` |
| UUIDs | `node:crypto` → `randomUUID()` |
| File I/O | `node:fs` |
| Path handling | `node:path` |
| HTTP (LLM client) | Global `fetch` (Node 22 built-in) |
| High-res timing | `performance.now()` (global) |
| JSON parsing | Built-in `JSON.parse`/`JSON.stringify` |
| Regex | Built-in `RegExp` |
| Timezone handling | `Intl.DateTimeFormat` with `timeZone` option |

---

*End of Architecture Document.*