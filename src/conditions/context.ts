import type {
  Condition,
  ConditionDeps,
  ContextCondition,
  EvaluationContext,
} from "../types.js";
import { globToRegex } from "../util.js";

function matchesAny(
  patterns: string | string[],
  texts: string[],
  regexCache: Map<string, RegExp>,
): boolean {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  return list.some((pattern) => {
    const re = regexCache.get(pattern);
    if (re) return texts.some((t) => re.test(t));
    // Try as regex, fall back to substring search
    try {
      const compiled = new RegExp(pattern);
      return texts.some((t) => compiled.test(t));
    } catch {
      return texts.some((t) => t.includes(pattern));
    }
  });
}

export function evaluateContextCondition(
  condition: Condition,
  ctx: EvaluationContext,
  _deps: ConditionDeps,
): boolean {
  const c = condition as ContextCondition;

  if (c.conversationContains !== undefined) {
    const convo = ctx.conversationContext ?? [];
    if (convo.length === 0) return false;
    if (!matchesAny(c.conversationContains, convo, _deps.regexCache)) {
      return false;
    }
  }

  if (c.messageContains !== undefined) {
    const content = ctx.messageContent ?? "";
    if (!content) return false;
    if (!matchesAny(c.messageContains, [content], _deps.regexCache)) {
      return false;
    }
  }

  if (c.hasMetadata !== undefined) {
    const meta = ctx.metadata ?? {};
    const keys = Array.isArray(c.hasMetadata)
      ? c.hasMetadata
      : [c.hasMetadata];
    if (!keys.every((k) => k in meta)) return false;
  }

  if (c.channel !== undefined) {
    const channels = Array.isArray(c.channel) ? c.channel : [c.channel];
    if (!ctx.channel || !channels.includes(ctx.channel)) return false;
  }

  if (c.sessionKey !== undefined) {
    if (!ctx.sessionKey) return false;
    const re = globToRegex(c.sessionKey);
    if (!re.test(ctx.sessionKey)) return false;
  }

  return true;
}
