import type {
  ConditionEvaluatorMap,
  ConditionDeps,
  EvaluationContext,
  MatchedPolicy,
  Policy,
  RiskAssessment,
} from "./types.js";
import { evaluateConditions } from "./conditions/index.js";
import { isTierAtLeast, isTierAtMost } from "./conditions/simple.js";

type EvalResult = {
  action: "allow" | "deny";
  reason: string;
  matches: MatchedPolicy[];
};

function matchesScope(policy: Policy, ctx: EvaluationContext): boolean {
  // Check excludeAgents
  if (policy.scope.excludeAgents?.includes(ctx.agentId)) {
    return false;
  }

  // Check channels
  if (policy.scope.channels && policy.scope.channels.length > 0) {
    if (!ctx.channel || !policy.scope.channels.includes(ctx.channel)) {
      return false;
    }
  }

  return true;
}

function policySpecificity(policy: Policy): number {
  let score = 0;
  if (policy.scope.agents && policy.scope.agents.length > 0) score += 10;
  if (policy.scope.channels && policy.scope.channels.length > 0) score += 5;
  if (policy.scope.hooks && policy.scope.hooks.length > 0) score += 3;
  return score;
}

export class PolicyEvaluator {
  private readonly evaluators: ConditionEvaluatorMap;

  constructor(evaluators: ConditionEvaluatorMap) {
    this.evaluators = evaluators;
  }

  evaluate(
    ctx: EvaluationContext,
    policies: Policy[],
    risk: RiskAssessment,
  ): EvalResult {
    // Filter by scope
    const applicable = policies.filter((p) => matchesScope(p, ctx));

    // Sort by priority (desc), then specificity (desc)
    applicable.sort((a, b) => {
      const priDiff = (b.priority ?? 0) - (a.priority ?? 0);
      if (priDiff !== 0) return priDiff;
      return policySpecificity(b) - policySpecificity(a);
    });

    const matches: MatchedPolicy[] = [];
    let hasDeny = false;
    let denyReason = "";
    let hasAudit = false;

    for (const policy of applicable) {
      const match = this.evaluatePolicy(policy, ctx, risk);
      if (match) {
        matches.push(match);
        if (match.effect.action === "deny") {
          hasDeny = true;
          if (!denyReason) {
            denyReason = "reason" in match.effect ? match.effect.reason : "";
          }
        } else if (match.effect.action === "audit") {
          hasAudit = true;
        }
      }
    }

    // Deny-wins aggregation
    if (hasDeny) {
      return {
        action: "deny",
        reason: denyReason || "Denied by governance policy",
        matches,
      };
    }

    if (hasAudit) {
      return {
        action: "allow",
        reason: "Allowed with audit logging",
        matches,
      };
    }

    return {
      action: "allow",
      reason: matches.length > 0
        ? "Allowed by governance policy"
        : "No matching policies",
      matches,
    };
  }

  private evaluatePolicy(
    policy: Policy,
    ctx: EvaluationContext,
    risk: RiskAssessment,
  ): MatchedPolicy | null {
    const deps: ConditionDeps = {
      regexCache: new Map(), // Will be replaced by engine with the real cache
      timeWindows: {},
      risk,
      frequencyTracker: { record: () => {}, count: () => 0, clear: () => {} },
    };

    for (const rule of policy.rules) {
      // Check trust gates
      if (rule.minTrust && !isTierAtLeast(ctx.trust.tier, rule.minTrust)) {
        continue;
      }
      if (rule.maxTrust && !isTierAtMost(ctx.trust.tier, rule.maxTrust)) {
        continue;
      }

      // Evaluate conditions (AND logic)
      if (evaluateConditions(rule.conditions, ctx, deps, this.evaluators)) {
        return {
          policyId: policy.id,
          ruleId: rule.id,
          effect: rule.effect,
        };
      }
    }

    return null;
  }

  /** Evaluate with externally provided deps (used by engine) */
  evaluateWithDeps(
    ctx: EvaluationContext,
    policies: Policy[],
    risk: RiskAssessment,
    deps: ConditionDeps,
  ): EvalResult {
    const applicable = policies.filter((p) => matchesScope(p, ctx));

    applicable.sort((a, b) => {
      const priDiff = (b.priority ?? 0) - (a.priority ?? 0);
      if (priDiff !== 0) return priDiff;
      return policySpecificity(b) - policySpecificity(a);
    });

    const matches: MatchedPolicy[] = [];
    let hasDeny = false;
    let denyReason = "";
    let hasAudit = false;

    for (const policy of applicable) {
      const match = this.evaluatePolicyWithDeps(policy, ctx, risk, deps);
      if (match) {
        matches.push(match);
        if (match.effect.action === "deny") {
          hasDeny = true;
          if (!denyReason) {
            denyReason = "reason" in match.effect ? match.effect.reason : "";
          }
        } else if (match.effect.action === "audit") {
          hasAudit = true;
        }
      }
    }

    if (hasDeny) {
      return {
        action: "deny",
        reason: denyReason || "Denied by governance policy",
        matches,
      };
    }

    if (hasAudit) {
      return { action: "allow", reason: "Allowed with audit logging", matches };
    }

    return {
      action: "allow",
      reason: matches.length > 0
        ? "Allowed by governance policy"
        : "No matching policies",
      matches,
    };
  }

  private evaluatePolicyWithDeps(
    policy: Policy,
    ctx: EvaluationContext,
    risk: RiskAssessment,
    deps: ConditionDeps,
  ): MatchedPolicy | null {
    const policyDeps: ConditionDeps = { ...deps, risk };

    for (const rule of policy.rules) {
      if (rule.minTrust && !isTierAtLeast(ctx.trust.tier, rule.minTrust)) {
        continue;
      }
      if (rule.maxTrust && !isTierAtMost(ctx.trust.tier, rule.maxTrust)) {
        continue;
      }

      if (evaluateConditions(rule.conditions, ctx, policyDeps, this.evaluators)) {
        return {
          policyId: policy.id,
          ruleId: rule.id,
          effect: rule.effect,
        };
      }
    }

    return null;
  }
}
