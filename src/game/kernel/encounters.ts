import type { GameData, UnitState } from "../types";
import type { SiteState } from "../types";
import { navIndex, navPoint, type KernelNavGrid } from "./navigation";
import { unitModifiers } from "./modifiers";

export const FIELD_ENCOUNTER_VERSION = 1;
export const FIELD_REACTION_HOURS = 0.1;
export const FIELD_COOLDOWN_HOURS = 6;
export const FIELD_SLOW_HOURS = 0.5;
export const FIELD_SLOW_FACTOR = 0.85;

type RuntimeStates = { values: Array<number | null>; offsets: Map<number, number>; slowUntil: number[] };
const runtimeStates = new WeakMap<GameData, RuntimeStates>();
const statesFor = (game: GameData) => {
  let states = runtimeStates.get(game);
  if (!states) {
    game.campaign.fieldEncounters!.unitStates ??= [];
    const values = game.campaign.fieldEncounters!.unitStates, offsets = new Map<number, number>(), slowUntil: number[] = [];
    for (let offset = 0; offset + 3 < values.length; offset += 4)
      if (typeof values[offset] === "number") {
        offsets.set(values[offset]!, offset);
        slowUntil[values[offset]!] = values[offset + 3] ?? 0;
      }
    states = {values, offsets, slowUntil};
    runtimeStates.set(game, states);
  }
  return states;
};
export const fieldMovementFactor = (game: GameData, unitId: number) => {
  return (statesFor(game).slowUntil[unitId] ?? 0) > game.campaign.elapsedHours ? FIELD_SLOW_FACTOR : 1;
};
export const fieldSlowUntilById = (game: GameData) => statesFor(game).slowUntil;

// One linked list per navigation cell/team. Both the buffers and the local
// adjacency graph are reused; no soldier-to-soldier distance search is made.
export class FieldEncounters {
  private readonly heads: Int32Array;
  private readonly ready: Int32Array;
  private readonly claimed: Uint8Array;
  private readonly passable: Uint8Array;
  private readonly neighbors: Int32Array;
  private readonly groupStrength: Float64Array;
  private readonly groupAttack: Float64Array;
  private readonly groupDefense: Float64Array;
  private readonly groupCount: Int32Array;
  private readonly sharedModifiers = [new Map<string, {attack:number;defense:number}>(), new Map<string, {attack:number;defense:number}>()];
  private readonly shareModifiersByTeam = [true, true];
  private readonly active: number[] = [];
  private next = new Int32Array(0);
  private readyNext = new Int32Array(0);
  private readonly liveTeams = [0, 0];
  private readonly cachedUnits: UnitState[] = [];
  private cachedValues = new Float64Array(0);
  private nextWake = -Infinity;
  private lastHour = -Infinity;
  private skipReady = false;
  private cachedGameUnits = 0;
  private readonly cachedSites: SiteState[] = [];
  private cachedSiteValues = new Float64Array(0);
  private readonly buses = [new Map<string, {cell:number; blocked:boolean; cooldown:number; slow:number; near:number}>(),
    new Map<string, {cell:number; blocked:boolean; cooldown:number; slow:number; near:number}>()];
  readonly stats = { scans: 0, cachedScans: 0, units: 0, groups: 0, candidateChecks: 0, pairs: 0 };

  constructor(private readonly grid: KernelNavGrid) {
    const size = grid.cols * grid.rows;
    this.heads = new Int32Array(size * 2).fill(-1);
    this.ready = new Int32Array(size * 2).fill(-1);
    this.claimed = new Uint8Array(size * 2);
    this.passable = new Uint8Array(size);
    this.neighbors = new Int32Array(size * 4).fill(-1);
    this.groupStrength = new Float64Array(size * 2);
    this.groupAttack = new Float64Array(size * 2);
    this.groupDefense = new Float64Array(size * 2);
    this.groupCount = new Int32Array(size * 2);
    for (let cell = 0; cell < size; cell++)
      this.passable[cell] = !grid.building[cell] && (!grid.water[cell] || !!grid.road[cell]) ? 1 : 0;
    for (let cell = 0; cell < size; cell++) {
      if (!this.passable[cell]) continue;
      const x = cell % grid.cols;
      const adjacent = [x > 0 ? cell - 1 : -1, x + 1 < grid.cols ? cell + 1 : -1,
        cell >= grid.cols ? cell - grid.cols : -1, cell + grid.cols < size ? cell + grid.cols : -1];
      for (let i = 0; i < 4; i++)
        if (adjacent[i] >= 0 && this.passable[adjacent[i]]) this.neighbors[cell * 4 + i] = adjacent[i];
    }
  }

  due(game: GameData) {
    return game.campaign.elapsedHours + 1e-9 >= (game.campaign.fieldEncounters?.nextScanAt ?? -Infinity);
  }

  invalidate() { this.skipReady = false; }

  remove(game: GameData, dead: ReadonlySet<number>) {
    if (!dead.size) return;
    const states = statesFor(game), values = states.values;
    let write = 0, activeSlowUntil = 0;
    states.offsets.clear(); states.slowUntil.length = 0;
    for (let read = 0; read + 3 < values.length; read += 4) {
      const id = values[read];
      if (typeof id !== "number" || dead.has(id)) continue;
      if (write !== read) for (let field = 0; field < 4; field++) values[write + field] = values[read + field];
      states.offsets.set(id, write);
      states.slowUntil[id] = values[write + 3] ?? 0;
      activeSlowUntil = Math.max(activeSlowUntil, values[write + 3] ?? 0);
      write += 4;
    }
    values.length = write;
    game.campaign.fieldEncounters!.activeSlowUntil = activeSlowUntil;
    this.invalidate();
  }

  canSkip(game: GameData) {
    if (!this.skipReady || game.units.length !== this.cachedGameUnits || game.campaign.elapsedHours >= this.nextWake ||
        !this.sitesMatch(game)) return false;
    return true;
  }

  // If every unit was stationary and eligible at the last full scan, the
  // linked spatial groups are still exact. At a timer deadline only rebuild
  // the ready lists; there is no reason to classify and hash every unit again.
  canResume(game: GameData) {
    const hour = game.campaign.elapsedHours;
    return this.skipReady && Number.isFinite(this.nextWake) && hour >= this.nextWake &&
      this.cachedUnits.length === game.units.length && game.units.length === this.cachedGameUnits &&
      game.campaign.freezeUntil.pku <= hour && game.campaign.freezeUntil.thu <= hour && this.sitesMatch(game);
  }

  resume(game: GameData, dead: Set<number>) {
    const state = game.campaign.fieldEncounters!, hour = game.campaign.elapsedHours, runtime = statesFor(game);
    state.nextScanAt = hour + FIELD_REACTION_HOURS;
    state.tick++; this.lastHour = hour;
    this.stats.scans++; this.stats.units += this.cachedUnits.length;
    this.preparePower(game, hour);
    this.nextWake = Infinity;
    for (const group of this.active) {
      this.ready[group] = -1;
      this.claimed[group] = 0;
      this.groupStrength[group] = this.groupAttack[group] = this.groupDefense[group] = this.groupCount[group] = 0;
      for (let index = this.heads[group]; index >= 0; index = this.next[index]) {
        const unit = game.units[index], contact = runtime.offsets.get(unit.id);
        if (contact == null) continue;
        const warning = (runtime.values[contact + 1] ?? hour) + FIELD_REACTION_HOURS;
        const cooldown = runtime.values[contact + 2] ?? -Infinity;
        if (warning > hour) this.nextWake = Math.min(this.nextWake, warning);
        if (cooldown > hour) this.nextWake = Math.min(this.nextWake, cooldown);
        if (warning > hour || cooldown > hour) continue;
        this.addReady(game, group, index);
      }
    }
    this.match(game, state.tick, dead);
    if (this.active.some(group => this.ready[group] >= 0 && !this.claimed[group]))
      this.nextWake = Math.min(this.nextWake, hour + FIELD_REACTION_HOURS);
  }

  private sitesMatch(game: GameData) {
    if (game.sites.length !== this.cachedSites.length) return false;
    for (let i = 0; i < game.sites.length; i++) {
      const site = game.sites[i], offset = i * 5;
      if (site !== this.cachedSites[i] || site.x !== this.cachedSiteValues[offset] || site.z !== this.cachedSiteValues[offset + 1] ||
          (site.navX ?? site.x) !== this.cachedSiteValues[offset + 2] || (site.navZ ?? site.z) !== this.cachedSiteValues[offset + 3] ||
          ((site.team === "pku" ? 0 : 1) | (site.destroyed ? 2 : 0)) !== this.cachedSiteValues[offset + 4]) return false;
    }
    return true;
  }

  skip(game: GameData) {
    const state = game.campaign.fieldEncounters!;
    state.nextScanAt = game.campaign.elapsedHours + FIELD_REACTION_HOURS;
    state.tick++; this.lastHour = game.campaign.elapsedHours;
    this.stats.scans++; this.stats.cachedScans++;
  }

  matchesCandidate(game: GameData, unit: UnitState, position: number) {
    const states = statesFor(game), contact = states.offsets.get(unit.id);
    const offset = position * 6;
    return this.cachedUnits[position] === unit && unit.x === this.cachedValues[offset] &&
      unit.z === this.cachedValues[offset + 1] && (unit.team === "pku" ? 0 : 1) === this.cachedValues[offset + 2] &&
      (contact == null ? -Infinity : states.values[contact + 1] ?? -Infinity) === this.cachedValues[offset + 3] &&
      (contact == null ? -Infinity : states.values[contact + 2] ?? -Infinity) === this.cachedValues[offset + 4] &&
      (contact == null ? -Infinity : states.values[contact + 3] ?? -Infinity) === this.cachedValues[offset + 5];
  }

  candidateCountMatches(count: number) { return count === this.cachedUnits.length; }

  step(game: GameData, excluded: ReadonlySet<number>, dead: Set<number>, candidates?: readonly number[], hasBuses = true, unchangedHint?: boolean) {
    const state = game.campaign.fieldEncounters;
    if (state?.version !== 1 || !game.campaign.warUnlocked) return;
    const hour = game.campaign.elapsedHours, runtime = statesFor(game);
    state.nextScanAt = hour + FIELD_REACTION_HOURS;
    state.tick++;
    this.stats.scans++;
    this.stats.units += candidates?.length ?? game.units.length;
    const cacheable = !!candidates?.length && !hasBuses && excluded.size === 0;
    const unchanged = unchangedHint ?? (cacheable && this.unchanged(game, candidates!));
    if (cacheable && unchanged && hour >= this.lastHour && hour < this.nextWake) {
      this.lastHour = hour; this.stats.cachedScans++; return;
    }
    this.lastHour = hour;
    this.preparePower(game, hour);
    this.cachedUnits.length = 0;
    this.skipReady = false;
    for (const group of this.active) {
      this.heads[group] = this.ready[group] = -1;
      this.claimed[group] = 0;
      this.groupStrength[group] = this.groupAttack[group] = this.groupDefense[group] = this.groupCount[group] = 0;
    }
    this.active.length = 0;
    this.liveTeams[0] = this.liveTeams[1] = 0;
    if (candidates?.length === 0) { this.remember(game, candidates, hour); return; }
    if (this.next.length < game.units.length) {
      this.next = new Int32Array(Math.max(256, game.units.length * 2));
      this.readyNext = new Int32Array(this.next.length);
    }
    this.buses[0].clear(); this.buses[1].clear();
    // A vehicle occupies one encounter cell. Passengers cannot be pulled into
    // different pairings merely because their rendered seats straddle a grid edge.
    if (hasBuses) for (const unit of game.units) {
      if (unit.transport !== "bus" || !unit.transportGroupId || unit.hp <= 0) continue;
      const map = this.buses[unit.team === "pku" ? 0 : 1];
      let bus = map.get(unit.transportGroupId);
      if (!bus) { bus = {cell:navIndex(this.grid, unit.x, unit.z),blocked:false,cooldown:0,slow:0,near:0}; map.set(unit.transportGroupId,bus); }
      bus.blocked ||= excluded.has(unit.id) || !!unit.retreating || game.campaign.freezeUntil[unit.team] > hour;
      const contact = runtime.offsets.get(unit.id);
      bus.cooldown = Math.max(bus.cooldown, contact == null ? 0 : runtime.values[contact + 2] ?? 0);
      bus.slow = Math.max(bus.slow, contact == null ? 0 : runtime.values[contact + 3] ?? 0);
      bus.near = Math.max(bus.near, contact == null ? hour : runtime.values[contact + 1] ?? hour);
    }
    const count = candidates?.length ?? game.units.length;
    for (let position = 0; position < count; position++) {
      const i = candidates ? candidates[position] : position;
      const unit = game.units[i];
      const bus = unit.transport === "bus" && unit.transportGroupId ? this.buses[unit.team === "pku" ? 0 : 1].get(unit.transportGroupId) : undefined;
      if (unit.hp <= 0 || unit.strength <= 0 || unit.retreating || excluded.has(unit.id) ||
          bus?.blocked || game.campaign.freezeUntil[unit.team] > hour) { this.clearNear(game, unit, hour); continue; }
      if (bus && (bus.cooldown > hour || bus.slow > hour)) {
        const contact = this.contact(game, unit, true, runtime)!;
        runtime.values[contact + 2] = bus.cooldown; runtime.values[contact + 3] = bus.slow;
        runtime.slowUntil[unit.id] = bus.slow;
      }
      const cell = bus?.cell ?? navIndex(this.grid, unit.x, unit.z);
      if (cell < 0 || !this.passable[cell]) { this.clearNear(game, unit, hour); continue; }
      const team = unit.team === "pku" ? 0 : 1, group = cell * 2 + team;
      if (this.heads[group] < 0) this.active.push(group);
      this.next[i] = this.heads[group];
      this.heads[group] = i;
      this.liveTeams[team]++;
    }
    this.stats.groups += this.active.length;
    // Presence includes cooling-down troops, so timers don't flicker simply
    // because an enemy has already exchanged fire this hour.
    for (const group of this.active) {
      const cell = group >> 1, enemy = 1 - (group & 1);
      let nearby = this.liveTeams[enemy] > 0 && this.heads[cell * 2 + enemy] >= 0;
      if (!nearby && this.liveTeams[enemy] > 0) for (let d = 0; d < 4; d++) {
        const other = this.neighbors[cell * 4 + d];
        if (other >= 0 && this.heads[other * 2 + enemy] >= 0) { nearby = true; break; }
      }
      for (let index = this.heads[group]; index >= 0; index = this.next[index]) {
        const unit = game.units[index];
        if (!nearby) { this.clearNear(game, unit, hour); continue; }
        const contact = this.contact(game, unit, true, runtime)!;
        if (runtime.values[contact + 1] == null || runtime.values[contact + 1]! > hour) runtime.values[contact + 1] = hour;
        if (unit.transport === "bus" && unit.transportGroupId)
          runtime.values[contact + 1] = Math.max(runtime.values[contact + 1]!, this.buses[unit.team === "pku" ? 0 : 1].get(unit.transportGroupId)!.near);
        if (hour - runtime.values[contact + 1]! + 1e-9 < FIELD_REACTION_HOURS || (runtime.values[contact + 2] ?? -Infinity) > hour) continue;
        this.addReady(game, group, index);
      }
    }
    this.match(game, state.tick, dead);
    if (cacheable) this.remember(game, candidates!, hour);
  }

  private unchanged(game: GameData, candidates: readonly number[]) {
    if (candidates.length !== this.cachedUnits.length) return false;
    const runtime = statesFor(game);
    for (let n = 0; n < candidates.length; n++) {
      const u = game.units[candidates[n]], offset = n * 6;
      const contact = runtime.offsets.get(u.id);
      if (u !== this.cachedUnits[n] || u.hp <= 0 || !(u.strength > 0) || u.retreating ||
          game.campaign.freezeUntil[u.team] > game.campaign.elapsedHours ||
          u.x !== this.cachedValues[offset] || u.z !== this.cachedValues[offset + 1] ||
          (u.team === "pku" ? 0 : 1) !== this.cachedValues[offset + 2] ||
          (contact == null ? -Infinity : runtime.values[contact + 1] ?? -Infinity) !== this.cachedValues[offset + 3] ||
          (contact == null ? -Infinity : runtime.values[contact + 2] ?? -Infinity) !== this.cachedValues[offset + 4] ||
          (contact == null ? -Infinity : runtime.values[contact + 3] ?? -Infinity) !== this.cachedValues[offset + 5]) return false;
    }
    return true;
  }

  private remember(game: GameData, candidates: readonly number[], hour: number) {
    if (this.cachedValues.length < candidates.length * 6) this.cachedValues = new Float64Array(candidates.length * 12);
    this.nextWake = Infinity;
    const runtime = statesFor(game);
    for (let n = 0; n < candidates.length; n++) {
      const u = game.units[candidates[n]], offset = n * 6, contact = runtime.offsets.get(u.id);
      this.cachedUnits.push(u);
      this.cachedValues[offset] = u.x; this.cachedValues[offset + 1] = u.z;
      this.cachedValues[offset + 2] = u.team === "pku" ? 0 : 1;
      this.cachedValues[offset + 3] = contact == null ? -Infinity : runtime.values[contact + 1] ?? -Infinity;
      this.cachedValues[offset + 4] = contact == null ? -Infinity : runtime.values[contact + 2] ?? -Infinity;
      this.cachedValues[offset + 5] = contact == null ? -Infinity : runtime.values[contact + 3] ?? -Infinity;
      const warning = this.cachedValues[offset + 3] + FIELD_REACTION_HOURS;
      // Expired slow timers do not affect eligibility; the aggregate high-water
      // mark disables movement lookup without forcing a full spatial rebuild.
      for (const deadline of [warning, this.cachedValues[offset + 4]])
        if (deadline > hour) this.nextWake = Math.min(this.nextWake, deadline);
    }
    this.skipReady = candidates.every(index => {
      const unit = game.units[index];
      return unit.targetSiteId == null && !unit.movementOrder && !unit.retreating;
    });
    this.cachedGameUnits = game.units.length;
    this.cachedSites.length = 0;
    if (this.cachedSiteValues.length < game.sites.length * 5) this.cachedSiteValues = new Float64Array(game.sites.length * 10);
    for (let i = 0; i < game.sites.length; i++) {
      const site = game.sites[i], offset = i * 5;
      this.cachedSites.push(site);
      this.cachedSiteValues[offset] = site.x; this.cachedSiteValues[offset + 1] = site.z;
      this.cachedSiteValues[offset + 2] = site.navX ?? site.x; this.cachedSiteValues[offset + 3] = site.navZ ?? site.z;
      this.cachedSiteValues[offset + 4] = (site.team === "pku" ? 0 : 1) | (site.destroyed ? 2 : 0);
    }
    const deadlines = [game.campaign.decisions.active.pku?.completesAt, game.campaign.decisions.active.thu?.completesAt,
      game.campaign.research.active.pku?.completesAt, game.campaign.research.active.thu?.completesAt,
      game.campaign.freezeUntil.pku, game.campaign.freezeUntil.thu];
    for (const team of ["pku", "thu"] as const)
      for (const production of Object.values(game.campaign.research.production[team])) deadlines.push(production?.completesAt);
    for (const deadline of deadlines) if (deadline != null && deadline > hour) this.nextWake = Math.min(this.nextWake, deadline);
  }

  clearNear(game: GameData, unit: UnitState, hour: number) {
    const states = statesFor(game), contact = states.offsets.get(unit.id);
    if (contact == null) return;
    states.values[contact + 1] = null;
    if ((states.values[contact + 2] ?? 0) <= hour) states.values[contact + 2] = null;
    if ((states.values[contact + 3] ?? 0) <= hour) {
      states.values[contact + 3] = null;
      states.slowUntil[unit.id] = 0;
    }
  }

  private contact(game: GameData, unit: UnitState, create = false, states = statesFor(game)) {
    let contact = states.offsets.get(unit.id);
    if (contact == null && create) {
      contact = states.values.length;
      states.values.push(unit.id, null, null, null);
      states.offsets.set(unit.id, contact);
    }
    return contact;
  }

  private match(game: GameData, tick: number, dead: Set<number>) {
    const pivot = tick & 1;
    const start = tick % Math.max(1, this.active.length);
    for (let n = 0; n < this.active.length; n++) {
      const group = this.active[(start + n) % this.active.length];
      if ((group & 1) !== pivot || this.claimed[group] || this.ready[group] < 0) continue;
      const cell = group >> 1, enemy = 1 - pivot;
      for (let candidate = 0; candidate < 5; candidate++) {
        this.stats.candidateChecks++;
        const other = candidate === 0 ? cell : this.neighbors[cell * 4 + ((tick + cell + candidate - 1) % 4)];
        if (other < 0) continue;
        const target = other * 2 + enemy;
        if (this.claimed[target] || this.ready[target] < 0) continue;
        this.claimed[group] = this.claimed[target] = 1;
        this.exchange(game, group, target, dead);
        break;
      }
    }
  }

  private addReady(game: GameData, group: number, index: number) {
    const unit = game.units[index];
    this.readyNext[index] = this.ready[group];
    this.ready[group] = index;
    const outside = !(unit.x > -18 && unit.x < 38 && unit.z > -48 && unit.z < 17), team = unit.team === "pku" ? 0 : 1;
    let modifiers: {attack:number;defense:number};
    if (this.shareModifiersByTeam[team]) {
      const key = `${unit.transportModel ?? ""}/${outside ? 1 : 0}`;
      modifiers = this.sharedModifiers[team].get(key)!;
      if (!modifiers) {
        const computed = unitModifiers(game, unit, outside);
        modifiers = {attack:computed.attack, defense:computed.defense};
        this.sharedModifiers[team].set(key, modifiers);
      }
    } else modifiers = unitModifiers(game, unit, outside);
    const strength = unit.strength;
    this.groupStrength[group] += strength;
    this.groupAttack[group] += strength * modifiers.attack * (unit.attackModifier ?? 1) * game.campaign.attackBonus[unit.team];
    this.groupDefense[group] += strength * modifiers.defense;
    this.groupCount[group]++;
  }

  private preparePower(game: GameData, hour: number) {
    this.sharedModifiers[0].clear(); this.sharedModifiers[1].clear();
    this.shareModifiersByTeam[0] = this.shareModifiersByTeam[1] = true;
    for (const status of game.campaign.statuses)
      if (status.until > hour && status.unitIds.length)
        this.shareModifiersByTeam[status.team === "pku" ? 0 : 1] = false;
  }

  private power(group: number) {
    const strength = this.groupStrength[group];
    return { strength, attack: this.groupAttack[group] / strength, defense: this.groupDefense[group] / strength, count: this.groupCount[group] };
  }

  private exchange(game: GameData, a: number, b: number, dead: Set<number>) {
    const state = game.campaign.fieldEncounters!, hour = game.campaign.elapsedHours, id = state.nextId++;
    const runtime = statesFor(game);
    const left = this.power(a), right = this.power(b);
    const frontage = Math.min(left.strength, right.strength, 20);
    const damage = (own: typeof left, enemy: typeof left) =>
      Math.min(3, 2 * frontage / own.strength * Math.max(0, Math.min(1.5, enemy.attack / Math.max(0.35, own.defense))));
    const damageA = damage(left, right), damageB = damage(right, left);
    const apply = (group: number, count: number, loss: number) => {
      let index = this.ready[group], remainingDeaths = 1;
      for (let skip = (id + group) % count; skip > 0; skip--) {
        index = this.readyNext[index];
        if (index < 0) index = this.ready[group];
      }
      for (let visited = 0; visited < count; visited++) {
        const unit = game.units[index], contact = this.contact(game, unit, true, runtime)!;
        runtime.values[contact + 2] = hour + FIELD_COOLDOWN_HOURS;
        runtime.values[contact + 3] = hour + FIELD_SLOW_HOURS;
        runtime.slowUntil[unit.id] = runtime.values[contact + 3]!;
        const before = unit.hp, after = before - loss;
        if (after <= 0 && unit.strength <= remainingDeaths) {
          unit.hp = after; remainingDeaths -= unit.strength; dead.add(unit.id);
        } else unit.hp = after <= 0 ? Math.max(Math.min(before, 1), after) : after;
        index = this.readyNext[index];
        if (index < 0) index = this.ready[group];
      }
    };
    apply(a, left.count, damageA); apply(b, right.count, damageB);
    state.activeSlowUntil = Math.max(state.activeSlowUntil ?? 0, hour + FIELD_SLOW_HOURS);
    const [ax, az] = navPoint(this.grid, a >> 1), [bx, bz] = navPoint(this.grid, b >> 1);
    state.alerts.push({ id, x: (ax + bx) / 2, z: (az + bz) / 2, atHour: hour });
    if (state.alerts.length > 24) state.alerts.splice(0, state.alerts.length - 24);
    this.nextWake = Math.min(this.nextWake, hour + FIELD_COOLDOWN_HOURS);
    this.stats.pairs++;
  }
}
