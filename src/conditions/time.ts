import type {
  Condition,
  ConditionDeps,
  EvaluationContext,
  TimeCondition,
} from "../types.js";
import { isInTimeRange, parseTimeToMinutes } from "../util.js";

export function evaluateTimeCondition(
  condition: Condition,
  ctx: EvaluationContext,
  deps: ConditionDeps,
): boolean {
  const c = condition as TimeCondition;

  // Named window resolution
  if (c.window) {
    const win = deps.timeWindows[c.window];
    if (!win) return false;

    const currentMinutes = ctx.time.hour * 60 + ctx.time.minute;
    const start = parseTimeToMinutes(win.start);
    const end = parseTimeToMinutes(win.end);
    if (start < 0 || end < 0) return false;

    if (!isInTimeRange(currentMinutes, start, end)) return false;

    if (win.days && win.days.length > 0) {
      if (!win.days.includes(ctx.time.dayOfWeek)) return false;
    }

    return true;
  }

  // Inline time range
  if (c.after !== undefined && c.before !== undefined) {
    const currentMinutes = ctx.time.hour * 60 + ctx.time.minute;
    const afterMin = parseTimeToMinutes(c.after);
    const beforeMin = parseTimeToMinutes(c.before);
    if (afterMin < 0 || beforeMin < 0) return false;

    if (!isInTimeRange(currentMinutes, afterMin, beforeMin)) return false;
  } else if (c.after !== undefined) {
    const currentMinutes = ctx.time.hour * 60 + ctx.time.minute;
    const afterMin = parseTimeToMinutes(c.after);
    if (afterMin < 0) return false;
    if (currentMinutes < afterMin) return false;
  } else if (c.before !== undefined) {
    const currentMinutes = ctx.time.hour * 60 + ctx.time.minute;
    const beforeMin = parseTimeToMinutes(c.before);
    if (beforeMin < 0) return false;
    if (currentMinutes >= beforeMin) return false;
  }

  // Day-of-week filter
  if (c.days && c.days.length > 0) {
    if (!c.days.includes(ctx.time.dayOfWeek)) return false;
  }

  return true;
}
