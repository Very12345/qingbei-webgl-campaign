import type { CampaignState } from "./types";

// Visual-only stream. It must never feed battleAlerts/fightingUnitIds or events.
export function createFieldContactFeed() {
  let lastId = 0, lastHour = -1;
  return (campaign: CampaignState) => {
    const alerts = campaign.fieldEncounters?.alerts ?? [];
    const latest = alerts.at(-1)?.id ?? 0, hour = campaign.elapsedHours;
    const reset = hour < lastHour || latest < lastId;
    if (reset) lastId = 0;
    else if (latest <= lastId) { lastHour = hour; return []; }
    lastHour = hour;
    const fresh = alerts.filter(a => a.id > lastId && a.atHour <= hour && a.atHour >= hour - 0.5);
    lastId = latest;
    return fresh.slice(-3);
  };
}
