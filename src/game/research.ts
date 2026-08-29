import type { CampaignState, Team } from "./types";

export type ResearchId = "bus" | "bike";

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
  },
};

export const defaultResearchState = (): CampaignState["research"] => ({
  active: { pku: null, thu: null },
  completed: { pku: [], thu: [] },
  lastBusAllocation: { pku: -999, thu: -999 },
  lastBikeAllocation: { pku: -999, thu: -999 },
});

export const hasResearch = (
  campaign: CampaignState,
  team: Team,
  id: ResearchId,
) => campaign.research.completed[team].includes(id);
