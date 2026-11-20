import rules from "./rules.json";

export const STORE_KEY: string = rules.storageKey;
export const DEFAULT_GOAL: number = rules.defaultGoalKg;
export const DEFAULT_SEGS: { until: number; per: number }[] = rules.defaultPlanSegs;
export const SYNC_TARGET: { owner: string; repo: string; branch: string; path: string } = rules.sync;
export const DAY_START_HOUR: number = rules.morningHours[0];

export const roundKg = (w: number): number => Math.round(w * 10) / 10;
export const isValidKg = (w: unknown): w is number => typeof w === "number" && w >= rules.kgRange[0] && w <= rules.kgRange[1];
export const isValidPer = (n: unknown): n is number => typeof n === "number" && n >= rules.perRange[0] && n <= rules.perRange[1];
export const isMorningHour = (h: number): boolean => h >= rules.morningHours[0] && h < rules.morningHours[1];
