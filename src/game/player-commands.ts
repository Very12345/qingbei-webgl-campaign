import type { ClientSiteCommand, ClientUnitCommand, GameData, Team } from "./types";

export type PlayerCommandSelection = { siteIds?: number[]; unitIds?: number[] };

// Invoked only by player controls, never by a state-diff/render/network timer.
export function collectPlayerCommands(game: GameData, team: Team, selection: PlayerCommandSelection) {
  const siteIds = new Set(selection.siteIds ?? []), unitIds = new Set(selection.unitIds ?? []);
  const sites: ClientSiteCommand[] = game.sites.filter(s => siteIds.has(s.id) && !s.destroyed).map(s => ({
    id: s.id, stance: s.stance, dispatchRatio: s.dispatchRatio ?? .6,
    orderTarget: s.team === team ? s.orderTarget ?? null : null,
    plannedOrderTarget: s.plannedOrderTargets?.[team] ?? null,
    displayName: s.team === team ? s.displayName : undefined,
  }));
  const units: ClientUnitCommand[] = game.units.filter(u => unitIds.has(u.id) && u.team === team).map(u => ({
    id: u.id, team: u.team, tx: u.tx, tz: u.tz, targetSiteId: u.targetSiteId ?? null,
  }));
  return { sites, units };
}
