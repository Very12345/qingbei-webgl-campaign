import type { RegionId, Team } from "../types";

export type GameScreen = "home" | "game";

export type BattlefieldSceneApi = {
  sync: () => void;
  focus: (region: RegionId) => void;
  applyMaterials: (unitUrl: string | null, siteUrl: string | null) => void;
  clearUnitSelection: () => void;
  setLayers: (sites: boolean, control: boolean) => void;
  setPerspective: (team: Team) => void;
  buildCampAt: (x: number, z: number) => boolean;
  enterDirectControl: () => boolean;
  exitDirectControl: () => void;
  refreshSiteStance: (siteId: number) => void;
};

export type CampContext = {
  x: number;
  y: number;
  worldX: number;
  worldZ: number;
};

export type BattleStats = {
  pku: number;
  thu: number;
  pkuSites: number;
  thuSites: number;
  pkuGrowth: number;
  thuGrowth: number;
};
