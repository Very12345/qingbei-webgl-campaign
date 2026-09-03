import {
  ACADEMIC_YEAR_END_ISO,
  CALENDAR_EVENTS,
  type CalendarEventDefinition,
  type CalendarEffect,
} from "../../campaign-content";
import { TACTICAL_EVENTS, type TacticalEventDefinition } from "../../tactical-events";
import { EVENT_CARDS } from "../events/event-cards";
import type { EventCard, GameData, SiteState, Team } from "../types";
import { addTimedStatus } from "./modifiers";
import { spawnKernelUnits } from "./production";

export type KernelEventContext = {
  fightingUnitIds?: ReadonlySet<number>;
  issueOrder?: (team: Team, sourceId: number, targetId: number, count: number) => number | void;
};

export function recordKernelEvent(
  game: GameData,
  id: string,
  card: Omit<EventCard, "id">,
) {
  if (game.campaign.firedEvents.includes(id)) return false;
  game.campaign.firedEvents.push(id);
  game.campaign.eventHistory.push({
    id,
    ...card,
    atHour: game.campaign.elapsedHours,
  });
  return true;
}

const applyEffects = (
  game: GameData,
  id: string,
  title: string,
  team: Team,
  effects: CalendarEffect,
  prefix: string,
) => {
  if (effects.resources) game.resources[team] += effects.resources;
  if (effects.spawn) {
    const sites = game.sites.filter(
      (site) =>
        site.team === team &&
        !site.destroyed &&
        (site.type === "dorm" || site.type === "gate"),
    );
    for (let index = 0; index < Math.ceil(effects.spawn / 5) && sites.length; index++)
      spawnKernelUnits(game, sites[index % sites.length], team, 1);
  }
  addTimedStatus(game, {
    id: `${prefix}_${id}_${team}`,
    title,
    team,
    durationHours: effects.durationHours ?? 168,
    attack: effects.attack ?? 1,
    movement: effects.movement ?? 1,
    morale: effects.morale ?? 1,
    production: effects.production,
    defense: effects.defense,
    supplyUse: effects.supplyUse,
    healing: effects.healing,
    riverMovement: effects.riverMovement,
  });
  if ((effects.healing ?? 1) > 1)
    for (const unit of game.units)
      if (unit.team === team)
        unit.hp = Math.min(100, unit.hp + 25 * ((effects.healing ?? 1) - 1));
};

const calendarCard = (definition: CalendarEventDefinition): Omit<EventCard, "id"> => ({
  title: definition.title,
  body: definition.body,
  effect: definition.effect,
  quadrant:
    definition.team === "pku"
      ? "lake"
      : definition.team === "thu"
        ? "march"
        : "arrival",
  date: definition.startISO.slice(0, 10),
  image: definition.image,
  sourceType: definition.sourceType,
  sourceUrl: definition.sourceUrl,
});

const tacticalCard = (definition: TacticalEventDefinition): Omit<EventCard, "id"> => ({
  title: definition.title,
  body: definition.body,
  effect: definition.effect,
  quadrant:
    definition.team === "pku"
      ? "lake"
      : definition.team === "thu"
        ? "march"
        : "classroom",
  date: "战况触发",
  image: definition.image,
  sourceType: definition.sourceType,
  sourceUrl: definition.sourceUrl,
});

const engagedBy = (
  game: GameData,
  site: SiteState | undefined,
  attackingTeam: Team,
  fightingUnitIds: ReadonlySet<number>,
  radius = 12,
) => {
  if (!site) return false;
  const x = site.navX ?? site.x,
    z = site.navZ ?? site.z;
  return game.units.some(
    (unit) =>
      unit.team === attackingTeam &&
      (unit.targetSiteId === site.id || fightingUnitIds.has(unit.id)) &&
      Math.hypot(unit.x - x, unit.z - z) < radius,
  );
};

const siteByName = (game: GameData, name: string) =>
  game.sites.find((site) => site.name === name && !site.destroyed);

const teamPopulation = (game: GameData, team: Team) =>
  game.units
    .filter((unit) => unit.team === team)
    .reduce((sum, unit) => sum + unit.strength, 0);

const deployExternalTeam = (
  game: GameData,
  context: KernelEventContext,
  skin: NonNullable<GameData["units"][number]["skin"]>,
  label: string,
  people: number,
  attack: number,
  morale: number,
  useBus = false,
) => {
  const pkuPeople = teamPopulation(game, "pku"),
    thuPeople = teamPopulation(game, "thu"),
    ally: Team = pkuPeople <= thuPeople ? "pku" : "thu",
    enemy: Team = ally === "pku" ? "thu" : "pku",
    border = game.sites
      .filter((site) => site.team === ally && !site.destroyed)
      .sort((a, b) => b.x - a.x)[0];
  if (!border) return;
  const firstId = game.units.reduce((maximum, unit) => Math.max(maximum, unit.id), -1) + 1;
  border.displayName = `${label}·${border.name}`;
  spawnKernelUnits(game, border, ally, Math.ceil(people / 5), attack, 130, skin);
  const guests = game.units.filter((unit) => unit.id >= firstId);
  for (const unit of guests) unit.morale = morale;
  if (useBus) {
    const groupId = `${skin}-bus-${Math.floor(game.campaign.elapsedHours)}`;
    for (const unit of guests.slice(0, people)) {
      unit.transport = "bus";
      unit.transportGroupId = groupId;
      unit.transportModel = "bus";
    }
  }
  const target = game.sites
    .filter((site) => site.team === enemy && !site.destroyed)
    .sort(
      (a, b) =>
        Math.hypot(a.x - border.x, a.z - border.z) -
        Math.hypot(b.x - border.x, b.z - border.z),
    )[0];
  if (target && context.issueOrder && border.orderOwner !== "player") {
    context.issueOrder(ally, border.id, target.id, people);
    border.orderTarget = undefined;
    border.orderPath = undefined;
    border.orderPurpose = undefined;
    border.orderIssuedAt = undefined;
  }
};

const processCalendarEvents = (game: GameData) => {
  const campaignNow =
      Date.parse(game.campaign.startDateISO) + game.campaign.elapsedHours * 3_600_000,
    academicYearEnd = Date.parse(ACADEMIC_YEAR_END_ISO);
  if (campaignNow > academicYearEnd) return;
  for (const definition of CALENDAR_EVENTS) {
    if (campaignNow < Date.parse(definition.startISO)) continue;
    if (!recordKernelEvent(game, definition.id, calendarCard(definition))) continue;
    const targets: Team[] =
      definition.team === "both"
        ? ["pku", "thu"]
        : [definition.team as Team];
    for (const team of targets) {
      applyEffects(game, definition.id, definition.title, team, definition.effects, "calendar");
      if (
        definition.id.includes("opening_ceremony") ||
        definition.id === "pku_degree_committee"
      ) {
        const active = game.campaign.decisions.active[team];
        if (active)
          active.completesAt = Math.max(
            game.campaign.elapsedHours,
            active.completesAt - 24,
          );
      }
    }
    if (definition.id === "pku_undergrad_registration") {
      const target = game.units.filter((unit) => unit.team === "thu").length + 20,
        current = game.units.filter((unit) => unit.team === "pku").length,
        dorms = game.sites.filter(
          (site) => site.team === "pku" && site.type === "dorm" && !site.destroyed,
        );
      for (let index = 0; index < Math.ceil(Math.max(0, target - current) / 5); index++)
        if (dorms.length) spawnKernelUnits(game, dorms[index % dorms.length], "pku", 1);
    }
  }
};

const tacticalMatches = (
  game: GameData,
  definition: TacticalEventDefinition,
  fightingUnitIds: ReadonlySet<number>,
) => {
  const trigger = definition.trigger,
    eventTeam = definition.team === "both" ? null : (definition.team as Team),
    siteOwned = (name: string, team: Team) =>
      game.sites.some(
        (site) => site.name === name && site.team === team && !site.destroyed,
      );
  if (trigger.type === "site_threat" && eventTeam)
    return game.sites
      .filter(
        (site) =>
          trigger.sites.includes(site.name) &&
          site.team === eventTeam &&
          !site.destroyed,
      )
      .some((site) => {
        const enemy: Team = eventTeam === "pku" ? "thu" : "pku";
        return game.units.filter(
          (unit) =>
            unit.team === enemy &&
            (unit.targetSiteId === site.id || fightingUnitIds.has(unit.id)) &&
            Math.hypot(
              unit.x - (site.navX ?? site.x),
              unit.z - (site.navZ ?? site.z),
            ) < 12,
        ).length >= trigger.enemyCount;
      });
  if (trigger.type === "control_all" && eventTeam) {
    const stagger =
      96 +
      ([...definition.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 240);
    return (
      game.campaign.elapsedHours >= stagger &&
      trigger.sites.every((name) => siteOwned(name, eventTeam))
    );
  }
  if (trigger.type === "resource_low" && eventTeam)
    return game.resources[eventTeam] < trigger.below && siteOwned(trigger.site, eventTeam);
  if (trigger.type === "disadvantage") {
    const pku = game.sites.filter((site) => site.team === "pku" && !site.destroyed).length,
      thu = game.sites.filter((site) => site.team === "thu" && !site.destroyed).length;
    return eventTeam
      ? (eventTeam === "pku" ? thu - pku : pku - thu) >= trigger.siteDelta
      : Math.abs(pku - thu) >= trigger.siteDelta;
  }
  if (trigger.type === "casualties")
    return game.deaths.pku + game.deaths.thu >= trigger.total;
  if (trigger.type === "elapsed") return game.campaign.elapsedHours >= trigger.hours;
  if (trigger.type === "core_recaptured" && eventTeam)
    return (
      game.campaign.elapsedHours > 96 &&
      siteOwned(trigger.site, eventTeam) &&
      game.campaign.eventHistory.some((entry) => entry.id.includes("captured"))
    );
  return false;
};

const processTacticalEvents = (
  game: GameData,
  fightingUnitIds: ReadonlySet<number>,
) => {
  if (!game.campaign.warUnlocked) return;
  for (const definition of TACTICAL_EVENTS) {
    if (game.campaign.firedEvents.includes(definition.id)) continue;
    if (!tacticalMatches(game, definition, fightingUnitIds)) continue;
    if (!recordKernelEvent(game, definition.id, tacticalCard(definition))) continue;
    let targets: Team[] =
      definition.team === "both"
        ? ["pku", "thu"]
        : [definition.team as Team];
    if (definition.id === "catchup_alumni_return") {
      const pku = game.sites.filter((site) => site.team === "pku" && !site.destroyed).length,
        thu = game.sites.filter((site) => site.team === "thu" && !site.destroyed).length;
      targets = [pku <= thu ? "pku" : "thu"];
    }
    for (const team of targets)
      applyEffects(game, definition.id, definition.title, team, definition.effects, "tactical");
  }
};

const processScenarioEvents = (
  game: GameData,
  context: KernelEventContext,
) => {
  const fighting = context.fightingUnitIds ?? new Set<number>(),
    fireCard = (id: keyof typeof EVENT_CARDS, apply?: () => void) => {
      if (!recordKernelEvent(game, id, EVENT_CARDS[id])) return false;
      apply?.();
      return true;
    };
  if (game.campaign.elapsedHours >= 0) fireCard("thu_arrival");
  if (game.campaign.elapsedHours >= 24)
    fireCard("night_mobilization", () => {
      game.resources.pku += 20;
      game.resources.thu += 20;
    });
  if (game.campaign.elapsedHours >= 35)
    fireCard("pku_jianghuai_welcome", () => {
      game.resources.pku += 20;
      addTimedStatus(game, {
        id: "jianghuai_welcome",
        title: "江淮迎新",
        team: "pku",
        durationHours: 48,
        attack: 1,
        movement: 1,
        morale: 1.1,
      });
    });
  if (game.campaign.elapsedHours >= 84)
    fireCard("war_begins", () => {
      game.campaign.warUnlocked = true;
    });
  if (game.campaign.elapsedHours >= 328)
    fireCard("thu_morning_run", () => {
      addTimedStatus(game, {
        id: "thu_run_thu",
        title: "清华夜跑",
        team: "thu",
        durationHours: 4,
        attack: 0.9,
        movement: 1.5,
        morale: 1.2,
      });
      addTimedStatus(game, {
        id: "thu_run_pku",
        title: "夜跑对峙",
        team: "pku",
        durationHours: 4,
        attack: 1.2,
        movement: 1,
        morale: 1.05,
      });
      const edgeSites = game.sites
        .filter(
          (site) =>
            site.team === "thu" &&
            !site.destroyed &&
            (site.type === "gate" || Math.abs(site.x) > 18 || Math.abs(site.z) > 25),
        )
        .slice(0, 12);
      if (context.issueOrder && edgeSites.length)
        edgeSites.forEach((source, index) =>
          context.issueOrder!(
            "thu",
            source.id,
            edgeSites[(index + 1) % edgeSites.length].id,
            Number.POSITIVE_INFINITY,
          ),
        );
    });
  const morningDay = Math.floor(game.campaign.elapsedHours / 24);
  if (morningDay > game.campaign.lastMorningEventDay) {
    game.campaign.lastMorningEventDay = morningDay;
    const morningDate = new Date(
        Date.parse(game.campaign.startDateISO) + morningDay * 86_400_000,
      ),
      weekday = morningDate.getUTCDay(),
      teamsStarted = ([
        ["pku", "2026-09-07T08:00:00+08:00"],
        ["thu", "2026-09-14T08:00:00+08:00"],
      ] as const).filter(([, start]) => morningDate.getTime() >= Date.parse(start));
    if (weekday >= 1 && weekday <= 5 && teamsStarted.length) {
      const id = `morning_class_${morningDay}`;
      for (const [team] of teamsStarted) {
        const teamId = `${id}_${team}`;
        if (game.campaign.firedEvents.includes(teamId)) continue;
        game.campaign.firedEvents.push(teamId);
        addTimedStatus(game, {
          id: teamId,
          title: "上早八",
          team,
          durationHours: 1,
          attack: 0.72,
          movement: 0.68,
          morale: 0.9,
        });
      }
      recordKernelEvent(game, id, {
        ...EVENT_CARDS.morning_class,
        date: `${morningDate.toISOString().slice(0, 10)} · 08:00`,
      });
    }
  }
  const library = siteByName(game, "北京大学图书馆"),
    physics =
      siteByName(game, "北京大学物理学院") ?? siteByName(game, "物理学院"),
    chemistry = game.sites.find(
      (site) => site.name.includes("化学学院") && !site.destroyed,
    ),
    qz = siteByName(game, "求真书院"),
    yuanpei = siteByName(game, "元培学院（俄文楼）"),
    math = siteByName(game, "北京大学数学科学学院（理科一号楼）");
  if (game.campaign.warUnlocked && engagedBy(game, library, "thu", fighting))
    fireCard("pku_librarian", () =>
      addTimedStatus(game, {
        id: "librarian", title: "图书管理员", team: "pku", durationHours: 24,
        attack: 1.1, movement: 1, morale: 1.5,
      }),
    );
  if (game.campaign.warUnlocked && engagedBy(game, physics, "thu", fighting))
    fireCard("two_bombs_one_satellite", () => {
      for (const unit of game.units)
        if (unit.team === "thu" && physics && Math.hypot(unit.x - physics.x, unit.z - physics.z) < 6) {
          unit.hp = Math.max(5, unit.hp - 68);
          unit.morale = Math.max(0, (unit.morale ?? 100) - 45);
        }
      addTimedStatus(game, {
        id: "two_bombs", title: "两弹一星", team: "pku", durationHours: 24,
        attack: 1, movement: 1, morale: 1.5,
      });
    });
  if (game.campaign.warUnlocked && engagedBy(game, chemistry, "thu", fighting))
    fireCard("chemistry_century", () => {
      for (const unit of game.units)
        if (unit.team === "thu" && chemistry && Math.hypot(unit.x - chemistry.x, unit.z - chemistry.z) < 5)
          unit.supply = Math.max(0, unit.supply - 65);
      addTimedStatus(game, {
        id: "chemistry", title: "百年化学", team: "pku", durationHours: 18,
        attack: 1, movement: 1, morale: 1.2,
      });
    });
  if (game.campaign.warUnlocked && engagedBy(game, qz, "pku", fighting))
    fireCard("qz_approach", () => {
      if (!qz) return;
      addTimedStatus(game, {
        id: "qz_defense", title: "水向下流", team: "thu", durationHours: 24,
        attack: 1, movement: 1, morale: 1.25,
      });
      addTimedStatus(game, {
        id: "qz_stall", title: "前锋受阻", team: "pku", durationHours: 24,
        attack: 1, movement: 1, morale: 0.8,
      });
      spawnKernelUnits(game, qz, "thu", 10, 1.15);
      game.campaign.freezeUntil.pku = game.campaign.elapsedHours + 24;
    });
  if (game.campaign.warUnlocked && engagedBy(game, yuanpei, "thu", fighting))
    fireCard("yuanpei_attack", () => {
      if (!yuanpei) return;
      addTimedStatus(game, {
        id: "freedom", title: "为了自由", team: "pku", durationHours: 24,
        attack: 1.25, movement: 1, morale: 1.35,
      });
      spawnKernelUnits(game, yuanpei, "pku", 10, 1.25);
    });
  if (game.campaign.warUnlocked && engagedBy(game, math, "thu", fighting))
    fireCard("double_fei", () =>
      addTimedStatus(game, {
        id: "double_fei_status", title: "双菲学校", team: "thu", durationHours: 18,
        attack: 0.5, movement: 0.5, morale: 0.75,
      }),
    );
  const pkuSites = game.sites.filter(
      (site) => site.team === "pku" && !site.destroyed,
    ).length,
    thuSites = game.sites.filter(
      (site) => site.team === "thu" && !site.destroyed,
    ).length;
  if (game.campaign.warUnlocked && pkuSites > thuSites + 3)
    fireCard("pku_advantage", () => {
      if (!qz) return;
      for (const unit of game.units)
        if (unit.team === "pku" && Math.hypot(unit.x - qz.x, unit.z - qz.z) < 18)
          unit.attackModifier = (unit.attackModifier ?? 1) * 0.9;
    });
  if (
    game.campaign.warUnlocked &&
    game.units.some(
      (unit) => unit.team === "thu" && Math.hypot(unit.x + 29.413, unit.z - 18.145) < 6,
    )
  )
    fireCard("lake_awakened", () => {
      game.campaign.attackBonus.pku *= 1.15;
      addTimedStatus(game, {
        id: "lake_morale", title: "胸中未名水", team: "pku", durationHours: 24,
        attack: 1, movement: 1, morale: 1.25,
      });
    });
  if (game.deaths.pku + game.deaths.thu > 0)
    fireCard("first_blood", () => {
      game.campaign.cautionUntil = game.campaign.elapsedHours + 12;
      for (const team of ["pku", "thu"] as Team[])
        addTimedStatus(game, {
          id: `first_blood_${team}`, title: "伤亡震动", team, durationHours: 12,
          attack: 0.9, movement: 1, morale: 0.9,
        });
    });
  if (thuSites * 2 < Math.max(1, game.campaign.initialThuSites))
    fireCard("thu_ustc", () => {
      game.campaign.thuFactionName = "中科大";
      game.campaign.attackBonus.thu *= 1.12;
      addTimedStatus(game, {
        id: "ustc_transition_bonus",
        title: "科大化整编",
        team: "thu",
        durationHours: 24 * 365,
        attack: 1.12,
        movement: 1.1,
        morale: 1.25,
        production: 1.15,
        defense: 1.1,
      });
      for (const unit of game.units)
        if (unit.team === "thu" && !unit.skin) unit.skin = "ustc";
      for (const site of game.sites)
        if (site.team === "thu" && !site.destroyed)
          site.displayName = `中科大清华园校区·${site.name}`;
    });
  if (game.campaign.elapsedHours >= 120)
    fireCard("zju_invasion", () => {
      const pkuPeople = teamPopulation(game, "pku"),
        thuPeople = teamPopulation(game, "thu"),
        ally: Team = pkuPeople <= thuPeople ? "pku" : "thu",
        enemy: Team = ally === "pku" ? "thu" : "pku",
        border = game.sites
          .filter((site) => site.team === ally && !site.destroyed)
          .sort((a, b) => b.x - a.x)[0];
      if (!border) return;
      border.displayName = `浙大先遣驻地·${border.name}`;
      spawnKernelUnits(game, border, ally, 14, 1.12, 135, "zju");
      const target = game.sites
        .filter((site) => site.team === enemy && !site.destroyed)
        .sort(
          (a, b) =>
            Math.hypot(a.x - border.x, a.z - border.z) -
            Math.hypot(b.x - border.x, b.z - border.z),
        )[0];
      if (target && context.issueOrder && border.orderOwner !== "player") {
        context.issueOrder(ally, border.id, target.id, 14);
        border.orderTarget = undefined;
        border.orderPath = undefined;
        border.orderPurpose = undefined;
        border.orderIssuedAt = undefined;
      }
    });
  if (game.campaign.elapsedHours >= 240)
    fireCard("nju_invasion", () =>
      deployExternalTeam(game, context, "nju", "南雍气象站", 20, 1.05, 135),
    );
  if (game.deaths.pku + game.deaths.thu >= 160)
    fireCard("fdu_invasion", () =>
      deployExternalTeam(game, context, "fdu", "相辉交换驻地", 20, 1.08, 145),
    );
  if (game.campaign.elapsedHours >= 360)
    fireCard("sjtu_invasion", () =>
      deployExternalTeam(game, context, "sjtu", "闵行导航终点", 30, 1.12, 140, true),
    );
  if (game.campaign.warUnlocked && qz && thuSites < 48)
    fireCard("thu_alarm", () => {
      qz.supply = 100;
      spawnKernelUnits(game, qz, "thu", 8, 1.1);
    });
};

export function processKernelEvents(game: GameData, context: KernelEventContext = {}) {
  game.campaign.statuses = (game.campaign.statuses ?? []).filter(
    (status) => status.until > game.campaign.elapsedHours,
  );
  processCalendarEvents(game);
  processScenarioEvents(game, context);
  processTacticalEvents(game, context.fightingUnitIds ?? new Set<number>());
  const academicYearEnd = Date.parse(ACADEMIC_YEAR_END_ISO),
    campaignNow =
      Date.parse(game.campaign.startDateISO) +
      game.campaign.elapsedHours * 3_600_000;
  if (campaignNow >= academicYearEnd && !game.campaign.academicYearOutcome) {
    const ratioPoints = (a: number, b: number, weight: number) =>
        a + b > 0 ? (a / (a + b)) * weight : weight / 2,
      pkuSites = game.sites.filter((site) => site.team === "pku" && !site.destroyed),
      thuSites = game.sites.filter((site) => site.team === "thu" && !site.destroyed),
      siteInfluence = (sites: SiteState[]) =>
        sites.reduce(
          (sum, site) =>
            sum +
            (site.type === "capital" || site.type === "target"
              ? 2.2
              : site.type === "gate"
                ? 1.35
                : site.type === "camp"
                  ? 0.55
                  : 1),
          0,
        ),
      pkuUnits = game.units.filter((unit) => unit.team === "pku"),
      thuUnits = game.units.filter((unit) => unit.team === "thu"),
      readiness = (units: GameData["units"]) =>
        units.length
          ? units.reduce(
              (sum, unit) =>
                sum +
                (unit.hp / 100 + unit.supply / 100 + (unit.morale ?? 100) / 100) /
                  3,
              0,
            ) / units.length
          : 0,
      pkuScore =
        ratioPoints(pkuSites.length, thuSites.length, 30) +
        ratioPoints(siteInfluence(pkuSites), siteInfluence(thuSites), 20) +
        ratioPoints(pkuUnits.length, thuUnits.length, 15) +
        ratioPoints(game.deaths.thu, game.deaths.pku, 15) +
        ratioPoints(readiness(pkuUnits), readiness(thuUnits), 10) +
        ratioPoints(game.resources.pku, game.resources.thu, 10),
      thuScore = 100 - pkuScore,
      result =
        Math.abs(pkuScore - thuScore) < 5
          ? "draw"
          : pkuScore > thuScore
            ? "pku"
            : "thu";
    game.campaign.academicYearOutcome = {
      atHour: game.campaign.elapsedHours,
      pkuScore,
      thuScore,
      result,
      summary:
        result === "draw"
          ? "一个学年过去，双方仍处于长期僵持。"
          : `${result === "pku" ? "北大" : game.campaign.thuFactionName}取得学年阶段优势。`,
    };
    game.campaign.eventHistory.push({
      id: "academic_year_epilogue",
      title: "学年结语：战线仍在延伸",
      body: game.campaign.academicYearOutcome.summary,
      effect: `北大 ${pkuScore.toFixed(1)} 分；${game.campaign.thuFactionName} ${thuScore.toFixed(1)} 分。正式胜负规则保持不变，战局可以继续。`,
      quadrant: "classroom",
      date: "2027年8月15日",
      image: "events/calendar/shared_midsummer.webp",
      sourceType: "calendar",
      atHour: game.campaign.elapsedHours,
    });
  }
}
