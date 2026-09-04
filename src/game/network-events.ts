import type { GameData } from "./types";

// Keep UI delivery independent of the simulation and of snapshot array identity.
export function createNetworkEventFeed() {
  let scope = "", lastHour = -1;
  const seen = new Set<string>();
  return (campaign: GameData["campaign"], room: string) => {
    const reset = scope !== room || campaign.elapsedHours < lastHour;
    if (reset) { seen.clear(); scope = room; lastHour = -1; }
    const first = lastHour < 0;
    lastHour = campaign.elapsedHours;
    return (campaign.eventHistory ?? []).filter(event => {
      const key = `${event.id}:${event.atHour}`;
      if (seen.has(key)) return false;
      seen.add(key);
      // A reconnect must not open the entire historical log. Recent opening
      // events still appear; all subsequent received events are delivered.
      return !first || event.atHour >= campaign.elapsedHours - 1;
    });
  };
}
