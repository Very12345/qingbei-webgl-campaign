import type { CampaignState, Team } from "./types";

export type ResearchId =
  | "pku_bike"
  | "pku_slogan_bike"
  | "pku_phone_bike"
  | "thu_bike"
  | "thu_purple_bike"
  | "bus"
  | "large_bus";

type ResearchDefinition = {
  id: ResearchId;
  team: Team | "both";
  category: "bike" | "bus";
  title: string;
  description: string;
  cost: number;
  hours: number;
  deploymentCost: number;
  cooldownHours: number;
  productionHours: number;
  productionQuantity: number;
  requires: ResearchId[];
  passengers: number;
  movementMultiplier: number;
  attackMultiplier: number;
  moraleMultiplier: number;
  damageTakenMultiplier: number;
  outsideCampusMovement?: number;
  outsideCampusMorale?: number;
};

export const RESEARCH_DEFINITIONS: Record<ResearchId, ResearchDefinition> = {
  pku_bike: {
    id: "pku_bike", team: "pku", category: "bike", title: "北大普通小黄车",
    description: "基础共享单车：移速+400%、攻击+10%，首次交战丢车。",
    cost: 10, hours: 24, deploymentCost: 1, cooldownHours: 1,
    productionHours: 6, productionQuantity: 10, requires: [], passengers: 10,
    movementMultiplier: 5, attackMultiplier: 1.1, moraleMultiplier: 1,
    damageTakenMultiplier: 1,
  },
  pku_slogan_bike: {
    id: "pku_slogan_bike", team: "pku", category: "bike", title: "神秘标语小黄车",
    description: "冷却减半、单批产量翻倍；意志-20%、攻击-10%。",
    cost: 25, hours: 36, deploymentCost: 1, cooldownHours: 0.5,
    productionHours: 6, productionQuantity: 20, requires: ["pku_bike"], passengers: 10,
    movementMultiplier: 5, attackMultiplier: 0.9, moraleMultiplier: 0.8,
    damageTakenMultiplier: 1,
  },
  pku_phone_bike: {
    id: "pku_phone_bike", team: "pku", category: "bike", title: "手机支架小黄车",
    description: "冷却+20%、单批产量-20%；总攻击+20%、移速额外+20%、意志+10%。",
    cost: 30, hours: 48, deploymentCost: 2, cooldownHours: 1.2,
    productionHours: 7, productionQuantity: 8, requires: ["pku_bike"], passengers: 8,
    movementMultiplier: 6, attackMultiplier: 1.2, moraleMultiplier: 1.1,
    damageTakenMultiplier: 1,
  },
  thu_bike: {
    id: "thu_bike", team: "thu", category: "bike", title: "清华普通小黄车",
    description: "基础共享单车：移速+400%、攻击+10%，首次交战丢车。",
    cost: 10, hours: 24, deploymentCost: 1, cooldownHours: 1,
    productionHours: 6, productionQuantity: 10, requires: [], passengers: 10,
    movementMultiplier: 5, attackMultiplier: 1.1, moraleMultiplier: 1,
    damageTakenMultiplier: 1,
  },
  thu_purple_bike: {
    id: "thu_purple_bike", team: "thu", category: "bike", title: "小紫车",
    description: "冷却减半、单批产量+50%；校内无负面，离开清华校园后意志-50%、移速-20%。",
    cost: 30, hours: 48, deploymentCost: 2, cooldownHours: 0.5,
    productionHours: 7, productionQuantity: 15, requires: ["thu_bike"], passengers: 10,
    movementMultiplier: 5, attackMultiplier: 1.1, moraleMultiplier: 1,
    damageTakenMultiplier: 1, outsideCampusMovement: 0.8,
    outsideCampusMorale: 0.5,
  },
  bus: {
    id: "bus", team: "both", category: "bus", title: "普通校园大巴",
    description: "装载30人：移速+900%、防御+100%、攻击+50%；严格沿大路行驶。",
    cost: 60, hours: 72, deploymentCost: 60, cooldownHours: 5,
    productionHours: 24, productionQuantity: 1, requires: [], passengers: 30,
    movementMultiplier: 10, attackMultiplier: 1.5, moraleMultiplier: 1,
    damageTakenMultiplier: 0.5,
  },
  large_bus: {
    id: "large_bus", team: "both", category: "bus", title: "大型校园大巴",
    description: "装载50人：防御+200%、攻击+80%，生产成本和冷却更高。",
    cost: 90, hours: 96, deploymentCost: 100, cooldownHours: 6,
    productionHours: 36, productionQuantity: 1, requires: ["bus"], passengers: 50,
    movementMultiplier: 8, attackMultiplier: 1.8, moraleMultiplier: 1.1,
    damageTakenMultiplier: 1 / 3,
  },
};

export const researchIdsForTeam = (team: Team) =>
  (Object.keys(RESEARCH_DEFINITIONS) as ResearchId[]).filter((id) => {
    const owner = RESEARCH_DEFINITIONS[id].team;
    return owner === "both" || owner === team;
  });

const emptyStockpile = (): Record<ResearchId, number> => ({
  pku_bike: 0, pku_slogan_bike: 0, pku_phone_bike: 0,
  thu_bike: 0, thu_purple_bike: 0, bus: 0, large_bus: 0,
});

export const defaultResearchState = (): CampaignState["research"] => ({
  active: { pku: null, thu: null },
  completed: { pku: [], thu: [] },
  production: { pku: {}, thu: {} },
  stockpile: { pku: emptyStockpile(), thu: emptyStockpile() },
  lastBusAllocation: { pku: -999, thu: -999 },
  lastBikeAllocation: { pku: -999, thu: -999 },
});

export const hasResearch = (
  campaign: CampaignState,
  team: Team,
  id: ResearchId,
) => campaign.research.completed[team].includes(id);
