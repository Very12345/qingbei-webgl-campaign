import {
  DECISIONS,
  type DecisionDefinition,
  type DecisionEffect,
} from "../campaign-content";
import type { CampaignState, Team, TimedStatus } from "./types";

export function nextDecisionInstance(campaign: CampaignState) {
  campaign.decisions.nextInstance = (campaign.decisions.nextInstance ?? 0) + 1;
  return `decision-${campaign.decisions.nextInstance}`;
}

const decisionRequirementMet = (requirement: string, completed: string[]) =>
  requirement.split("|").some((id) => completed.includes(id));

export const decisionAvailable = (
  decision: DecisionDefinition,
  campaign: CampaignState,
) =>
  !campaign.decisions.completed.includes(decision.id) &&
  !campaign.decisions.locked.includes(decision.id) &&
  decision.requires.every((requirement) =>
    decisionRequirementMet(requirement, campaign.decisions.completed),
  );

const decisionEffectCache = new WeakMap<
  CampaignState,
  { key: string; completed: string[]; values: Record<Team, DecisionEffect> }
>();

export const decisionEffectsFor = (campaign: CampaignState, team: Team) => {
  const completed = campaign.decisions.completed;
  let cached = decisionEffectCache.get(campaign);
  if (cached && cached.completed.length === completed.length) {
    let unchanged = true;
    for (let index = 0; index < completed.length; index++)
      if (cached.completed[index] !== completed[index]) { unchanged = false; break; }
    if (unchanged) return cached.values[team];
  }
  const key = completed.join("|");
  if (!cached || cached.key !== key) {
    const values: Record<Team, DecisionEffect> = { pku: {}, thu: {} };
    for (const decision of DECISIONS) {
      if (!campaign.decisions.completed.includes(decision.id)) continue;
      const result = values[decision.team];
      for (const [effectKey, value] of Object.entries(decision.effects) as [
        keyof DecisionEffect,
        number,
      ][]) {
        if (value == null) continue;
        result[effectKey] = (result[effectKey] ?? 1) * value;
      }
    }
    cached = { key, completed: completed.slice(), values };
    decisionEffectCache.set(campaign, cached);
  } else cached.completed = completed.slice();
  return cached.values[team];
};

export const statusMembershipCache = new WeakMap<TimedStatus, Set<number>>();
