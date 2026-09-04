import { decisionEffectsFor } from "../decisions";
import type { GameData, SiteState, UnitState } from "../types";

export const PLAYER_DISPATCH_VERSION = 1;

export function playerDispatchPolicy(game: GameData, site: SiteState) {
  const stanceRatio = site.stance === "defend" ? .45 : site.stance === "guard" ? .72 : 1;
  const requested = (site.dispatchRatio ?? stanceRatio) * (decisionEffectsFor(game.campaign, site.team).dispatch ?? 1);
  return {
    ratio: Math.max(0, Math.min(stanceRatio, Number.isFinite(requested) ? requested : stanceRatio)),
    minimum: site.stance === "defend" ? 4 : site.stance === "guard" ? 2 : 0,
  };
}

const people = (unit: UnitState) => Math.max(0, unit.strength);
const isIdle = (unit: UnitState) => unit.targetSiteId == null && !unit.movementOrder && !unit.retreating;
type DispatchLedger = NonNullable<SiteState["playerDispatch"]>;
type SettledLedger = {
  ledger: Pick<DispatchLedger, "team" | "targetId" | "ratio" | "minimum" | "credit" | "retryAt">;
  units: Float64Array;
  observed: Float64Array;
  committed: number[];
};
const settledLedgers = new WeakMap<DispatchLedger, SettledLedger>();

function settledUnchanged(ledger: DispatchLedger, units: UnitState[]) {
  const previous = settledLedgers.get(ledger);
  if (!previous || !ledger.observedUnits || !ledger.committedUnitIds || previous.units.length !== units.length * 3) return false;
  const saved = previous.ledger;
  if (saved.team !== ledger.team || saved.targetId !== ledger.targetId ||
      !Object.is(saved.ratio, ledger.ratio) || saved.minimum !== ledger.minimum ||
      !Object.is(saved.credit, ledger.credit) || !Object.is(saved.retryAt, ledger.retryAt) ||
      previous.observed.length !== ledger.observedUnits.length * 2 ||
      previous.committed.length !== ledger.committedUnitIds.length) return false;
  // Compare values, not just identity/length: external commands and restored
  // state may edit arrays in place, including replacements of the same length.
  for (let i = 0; i < units.length; i++) {
    const offset = i * 3, unit = units[i];
    if (previous.units[offset] !== unit.id || !Object.is(previous.units[offset + 1], people(unit)) || previous.units[offset + 2] !== (isIdle(unit) ? 1 : 0)) return false;
  }
  for (let i = 0; i < ledger.observedUnits.length; i++) {
    const b = ledger.observedUnits[i];
    if (previous.observed[i * 2] !== b[0] || !Object.is(previous.observed[i * 2 + 1], b[1])) return false;
  }
  for (let i = 0; i < ledger.committedUnitIds.length; i++)
    if (previous.committed[i] !== ledger.committedUnitIds[i]) return false;
  return true;
}

function rememberSettled(ledger: DispatchLedger, units: UnitState[]) {
  const unitValues = new Float64Array(units.length * 3);
  for (let i = 0; i < units.length; i++) {
    unitValues[i * 3] = units[i].id;
    unitValues[i * 3 + 1] = people(units[i]);
    unitValues[i * 3 + 2] = isIdle(units[i]) ? 1 : 0;
  }
  const observed = new Float64Array(ledger.observedUnits.length * 2);
  for (let i = 0; i < ledger.observedUnits.length; i++) {
    observed[i * 2] = ledger.observedUnits[i][0];
    observed[i * 2 + 1] = ledger.observedUnits[i][1];
  }
  const {team, targetId, ratio, minimum, credit, retryAt} = ledger;
  settledLedgers.set(ledger, {
    ledger: {team, targetId, ratio, minimum, credit, retryAt},
    units: unitValues, observed, committed: ledger.committedUnitIds.slice(),
  });
}

// Persist the arrival budget with the site. Rendering, elapsed time, retries
// and save/load do not create fresh authorization to empty its garrison.
export function dispatchPlayerRoutes(
  game: GameData,
  dispatch: (source: SiteState, units: UnitState[]) => number,
  initialLimits: ReadonlyMap<number, number> = new Map(),
) {
  const present = new Map<number, UnitState[]>();
  const buses = new Map<string, UnitState[]>();
  for (const unit of game.units) {
    if (unit.hp > 0 && unit.transport === "bus" && unit.transportGroupId) {
      const group = buses.get(unit.transportGroupId);
      if (group) group.push(unit); else buses.set(unit.transportGroupId, [unit]);
    }
    const source = game.sites[unit.siteId];
    if (!source || source.destroyed || source.orderOwner !== "player" || source.orderTarget == null ||
        unit.hp <= 0 || unit.team !== source.team ||
        Math.hypot(unit.x - (source.navX ?? source.x), unit.z - (source.navZ ?? source.z)) >= 3.4) continue;
    const group = present.get(source.id);
    if (group) group.push(unit); else present.set(source.id, [unit]);
  }
  for (const source of game.sites) {
    if (source.destroyed || source.orderOwner !== "player" || source.orderTarget == null) {
      source.playerDispatch = undefined;
      continue;
    }
    const target = game.sites[source.orderTarget];
    if (!target || target.destroyed) {
      source.orderTarget = source.orderPath = source.orderPurpose = source.orderIssuedAt = source.orderOwner = undefined;
      source.playerDispatch = undefined;
      continue;
    }
    const policy = playerDispatchPolicy(game, source);
    let ledger = source.playerDispatch;
    const units = present.get(source.id) ?? [];
    if (ledger && ledger.team === source.team && ledger.targetId === target.id &&
        ledger.ratio === policy.ratio && ledger.minimum === policy.minimum && settledUnchanged(ledger, units)) continue;
    if (ledger) settledLedgers.delete(ledger);
    const idle = units.filter(isIdle);
    if (!ledger || ledger.team !== source.team) {
      ledger = source.playerDispatch = { ...policy, team: source.team, observedUnits: [], committedUnitIds: [], credit: 0, targetId: target.id };
    } else if (ledger.ratio !== policy.ratio || ledger.minimum !== policy.minimum) {
      // A looser stance may release existing reserves once. Tightening retains
      // the current reserves, cancels unused credit and applies to new arrivals.
      if (policy.ratio > ledger.ratio || policy.minimum < ledger.minimum) ledger.observedUnits = [];
      else ledger.observedUnits = idle.map(unit => [unit.id, people(unit)]);
      ledger.committedUnitIds = [];
      ledger.credit = 0;
      ledger.retryAt = undefined;
      Object.assign(ledger, policy);
    }
    if (ledger.targetId !== target.id) { ledger.targetId = target.id; ledger.retryAt = undefined; }
    const currentIds = new Set(units.map(unit => unit.id));
    const observed = new Map(ledger.observedUnits);
    const committed = new Set(ledger.committedUnitIds);
    for (const [id,strength] of observed) if (!currentIds.has(id)) {
      if (!committed.has(id)) ledger.credit = Math.max(0, ledger.credit - strength * policy.ratio);
      observed.delete(id); committed.delete(id);
    }
    for (const unit of idle) if (!observed.has(unit.id)) {
      observed.set(unit.id, people(unit));
      ledger.credit += people(unit) * policy.ratio;
    }
    ledger.observedUnits = [...observed].sort((a,b) => a[0]-b[0]);
    ledger.committedUnitIds = [...committed].sort((a,b) => a-b);
    const idlePeople = idle.reduce((sum, unit) => sum + people(unit), 0);
    // Losses or separate unit orders cannot leave a budget larger than the
    // forces still available. Keep fractions so one-at-a-time arrivals work.
    ledger.credit = Math.max(0, Math.min(ledger.credit, idlePeople));
    let budget = Math.min(Math.floor(ledger.credit + 1e-8), Math.max(0, idlePeople - policy.minimum));
    if (budget <= 0) { rememberSettled(ledger, units); continue; }
    if ((ledger.retryAt ?? 0) > game.campaign.elapsedHours) continue;
    const selected: UnitState[] = [], handled = new Set<number>();
    const idleIds = new Set(idle.map(unit => unit.id));
    for (const unit of idle) {
      if (handled.has(unit.id)) continue;
      const group = unit.transport === "bus" && unit.transportGroupId
        ? buses.get(unit.transportGroupId) ?? [unit]
        : [unit];
      for (const member of group) handled.add(member.id);
      if (group.some(member => !idleIds.has(member.id))) continue;
      const strength = group.reduce((sum, member) => sum + people(member), 0);
      if (strength <= 0 || strength > budget || selected.length + group.length > (initialLimits.get(source.id) ?? Infinity)) continue;
      selected.push(...group); budget -= strength;
    }
    if (!selected.length) continue;
    if (dispatch(source, selected) > 0) {
      ledger.credit = Math.max(0, ledger.credit - selected.reduce((sum, unit) => sum + people(unit), 0));
      for (const unit of selected) committed.add(unit.id);
      ledger.committedUnitIds = [...committed].sort((a,b) => a-b);
      ledger.retryAt = undefined;
    } else ledger.retryAt = game.campaign.elapsedHours + .05;
  }
}
