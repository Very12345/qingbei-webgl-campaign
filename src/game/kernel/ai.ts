import type { AiDifficulty, SiteState } from "../types";

export type AiIntent =
  | "passive"
  | "single_breakthrough"
  | "positional"
  | "probing";

export type HostileGroupSummary = {
  target: SiteState;
  strength: number;
};

export function classifyIntent(
  groups: HostileGroupSummary[],
  difficulty: AiDifficulty,
): AiIntent {
  const ordered = [...groups].sort((a, b) => b.strength - a.strength),
    total = ordered.reduce((sum, group) => sum + group.strength, 0),
    primary = ordered[0];
  if (total < (difficulty === "hard" ? 10 : 16)) return "passive";
  if (
    primary &&
    (primary.target.type === "dorm" || primary.target.type === "dining") &&
    primary.strength >= Math.max(12, total * 0.48)
  )
    return "single_breakthrough";
  if (ordered.length >= 3 && total >= 24) return "positional";
  return "probing";
}

export function offensiveMomentum(
  difficulty: AiDifficulty,
  friendlySiteCount: number,
  enemySiteCount: number,
  forceRatio: number,
) {
  if (difficulty === "casual") return 0;
  const siteAdvantage = friendlySiteCount / Math.max(1, enemySiteCount),
    start = difficulty === "hard" ? 0.95 : 1.05,
    range = difficulty === "hard" ? 0.55 : 1.15,
    siteMomentum = Math.max(0, Math.min(1, (siteAdvantage - start) / range)),
    forceMomentum = Math.max(0.28, Math.min(1, forceRatio / 0.9));
  return siteMomentum * forceMomentum;
}

export function isHighRiskEventTarget(site: SiteState) {
  return (
    site.type === "capital" ||
    site.type === "target" ||
    (site.type === "teaching" &&
      /物理|数学|化学|工学院|图书馆|技物|百周年|纪念讲堂/.test(site.name))
  );
}
