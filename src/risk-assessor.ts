import type {
  EvaluationContext,
  FrequencyTracker,
  RiskAssessment,
  RiskFactor,
  RiskLevel,
} from "./types.js";
import { clamp } from "./util.js";

const DEFAULT_TOOL_RISK: Record<string, number> = {
  gateway: 95, cron: 90, elevated: 95,
  exec: 70, write: 65, edit: 60,
  sessions_spawn: 45, sessions_send: 50,
  browser: 40, message: 40,
  read: 10, memory_search: 5, memory_get: 5,
  web_search: 15, web_fetch: 20, image: 10, canvas: 15,
};

function lookupToolRisk(
  toolName: string | undefined,
  overrides: Record<string, number>,
): number {
  if (!toolName) return 30;
  const override = overrides[toolName];
  if (override !== undefined) return override;
  const builtin = DEFAULT_TOOL_RISK[toolName];
  if (builtin !== undefined) return builtin;
  return 30;
}

function isOffHours(hour: number): boolean {
  return hour < 8 || hour >= 23;
}

function isExternalTarget(ctx: EvaluationContext): boolean {
  if (ctx.messageTo) return true;
  if (ctx.toolParams) {
    const host = ctx.toolParams["host"];
    if (typeof host === "string" && host !== "sandbox") return true;
    const elevated = ctx.toolParams["elevated"];
    if (elevated === true) return true;
  }
  return false;
}

export class RiskAssessor {
  private readonly overrides: Record<string, number>;

  constructor(toolRiskOverrides: Record<string, number>) {
    this.overrides = toolRiskOverrides;
  }

  assess(
    ctx: EvaluationContext,
    frequencyTracker: FrequencyTracker,
  ): RiskAssessment {
    const factors: RiskFactor[] = [];

    // Factor 1: Tool sensitivity (30%)
    const toolRaw = lookupToolRisk(ctx.toolName, this.overrides);
    const toolValue = (toolRaw / 100) * 30;
    factors.push({
      name: "tool_sensitivity",
      weight: 30,
      value: toolValue,
      description: `Tool ${ctx.toolName ?? "unknown"} risk=${toolRaw}`,
    });

    // Factor 2: Time of day (15%)
    const timeValue = isOffHours(ctx.time.hour) ? 15 : 0;
    factors.push({
      name: "time_of_day",
      weight: 15,
      value: timeValue,
      description: timeValue > 0 ? "Off-hours operation" : "Business hours",
    });

    // Factor 3: Trust deficit (20%)
    const trustValue = ((100 - ctx.trust.score) / 100) * 20;
    factors.push({
      name: "trust_deficit",
      weight: 20,
      value: trustValue,
      description: `Trust score ${ctx.trust.score}/100`,
    });

    // Factor 4: Frequency (15%)
    const recentCount = frequencyTracker.count(
      60, "agent", ctx.agentId, ctx.sessionKey,
    );
    const freqValue = Math.min(recentCount / 20, 1) * 15;
    factors.push({
      name: "frequency",
      weight: 15,
      value: freqValue,
      description: `${recentCount} actions in last 60s`,
    });

    // Factor 5: Target scope (20%)
    const targetValue = isExternalTarget(ctx) ? 20 : 0;
    factors.push({
      name: "target_scope",
      weight: 20,
      value: targetValue,
      description: targetValue > 0 ? "External target" : "Internal target",
    });

    const total = clamp(
      factors.reduce((sum, f) => sum + f.value, 0),
      0,
      100,
    );

    const level = scoreToRiskLevel(total);

    return { level, score: Math.round(total), factors };
  }
}

function scoreToRiskLevel(score: number): RiskLevel {
  if (score <= 25) return "low";
  if (score <= 50) return "medium";
  if (score <= 75) return "high";
  return "critical";
}
