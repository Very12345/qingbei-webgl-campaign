import type { CampaignState, Team } from "./types";

export type ResearchId = "bike" | "ebike" | "bus" | "armored_bus";

export const RESEARCH_DEFINITIONS = {
  bus: {
    id: "bus" as const,
    title: "校园大巴动员",
    description:
      "每辆装载40人：移速+900%、防御+100%、攻击+50%。仅走大路，遇楼或河自动下车。",
    cost: 60,
    hours: 72,
    deploymentCost: 60,
    cooldownHours: 5,
    productionHours: 24,
    productionQuantity: 1,
    requires: [] as ResearchId[],
  },
  bike: {
    id: "bike" as const,
    title: "共享单车征用",
    description:
      "每1资源配置10辆：10人移速+400%、攻击+10%；首次交战丢车并冷却1小时。",
    cost: 1,
    hours: 24,
    deploymentCost: 1,
    cooldownHours: 1,
    productionHours: 6,
    productionQuantity: 10,
    requires: [] as ResearchId[],
  },
  ebike: {
    id: "ebike" as const,
    title: "电助力共享单车",
    description:
      "共享单车升级型：移速+600%、攻击+20%，首次交战后仍会丢弃。",
    cost: 30,
    hours: 48,
    deploymentCost: 3,
    cooldownHours: 1,
    productionHours: 8,
    productionQuantity: 10,
    requires: ["bike"] as ResearchId[],
  },
  armored_bus: {
    id: "armored_bus" as const,
    title: "装甲校园大巴",
    description:
      "可装载50人：移速+700%、防御+200%、攻击+80%；仍须严格沿大路行驶。",
    cost: 90,
    hours: 96,
    deploymentCost: 90,
    cooldownHours: 6,
    productionHours: 36,
    productionQuantity: 1,
    requires: ["bus"] as ResearchId[],
  },
};

export const defaultResearchState = (): CampaignState["research"] => ({
  active: { pku: null, thu: null },
  completed: { pku: [], thu: [] },
  production: { pku: null, thu: null },
  stockpile: {
    pku: { bike: 0, ebike: 0, bus: 0, armored_bus: 0 },
    thu: { bike: 0, ebike: 0, bus: 0, armored_bus: 0 },
  },
  lastBusAllocation: { pku: -999, thu: -999 },
  lastBikeAllocation: { pku: -999, thu: -999 },
});

export const hasResearch = (
  campaign: CampaignState,
  team: Team,
  id: ResearchId,
) => campaign.research.completed[team].includes(id);
