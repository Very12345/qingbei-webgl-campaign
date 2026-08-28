import type { Team } from "./types";

export const TEAM_COLOR: Record<Team, number> = {
  pku: 0xa20d27,
  thu: 0x6f3291,
};

export const INITIAL_PRODUCTION_POPULATION_BUDGET = 720;
export const BASE_TEAM_UNIT_CAP = 1500;

export const productionSlots = (siteCount: number, ratio: number) =>
  siteCount > 0 ? Math.max(1, Math.ceil(siteCount * ratio)) : 0;
