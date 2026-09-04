import type { GameData } from "../types";
import { navPoint, nearestOpenIndex, type KernelNavGrid } from "./navigation";
import { CALENDAR_EVENTS } from "../../campaign-content";
import { TACTICAL_EVENTS } from "../../tactical-events";

// Opt-in server scenarios use the same initialization before the first snapshot.
export function prepareServerDeployment(game: GameData, grid: KernelNavGrid | undefined, opening: "standard" | "blitz") {
  game.campaign.serverOpening = opening;
  for (const unit of game.units) {
    if (unit.targetSiteId != null || unit.movementOrder) continue;
    if (grid) {
      const open = nearestOpenIndex(grid, unit.x, unit.z);
      if (open >= 0) [unit.x, unit.z] = navPoint(grid, open);
    }
    unit.tx = unit.x;
    unit.tz = unit.z;
    unit.path = undefined;
    unit.pathIndex = undefined;
  }
  game.campaign.battleStats ??= { kills: { pku: 0, thu: 0 }, captures: { pku: 0, thu: 0 } };
  if (opening !== "blitz") return;
  // August 19, 20:00: skip the preparation phase, without simulating free
  // production, AI orders or score before either player has joined.
  game.campaign.elapsedHours = 84;
  game.timeOfDay = 20;
  game.campaign.warUnlocked = true;
  game.campaign.lastProductionCycle = 14;
  game.campaign.lastDiningCycle = 7;
  game.campaign.lastMorningEventDay = 3;
  game.campaign.firedEvents = [...new Set([...game.campaign.firedEvents,
    "thu_arrival", "night_mobilization", "pku_jianghuai_welcome",
    ...CALENDAR_EVENTS.filter(event => Date.parse(event.startISO) < Date.parse(game.campaign.startDateISO) + 84*3_600_000).map(event=>event.id),
    ...TACTICAL_EVENTS.filter(event=>event.trigger.type === "elapsed" && event.trigger.hours < 84).map(event=>event.id),
  ])];
}
