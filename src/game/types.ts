import type { CampaignEventCardSpec } from "../event-api";

export type Team = "pku" | "thu";
export type Stance = "defend" | "guard" | "standby";
export type RegionId = "main";
export type MapViewMode = "sites" | "control";
export type SiteKind =
  | "dorm"
  | "dining"
  | "teaching"
  | "gate"
  | "target"
  | "capital"
  | "camp";

export type SiteState = {
  id: number;
  name: string;
  displayName?: string;
  team: Team;
  x: number;
  z: number;
  navX?: number;
  navZ?: number;
  hasPortal?: boolean;
  type: SiteKind;
  stance: Stance;
  supply: number;
  orderTarget?: number;
  orderPath?: [number, number][];
  orderPurpose?: "combat" | "logistics" | "probe";
  orderIssuedAt?: number;
  orderOwner?: "player" | "ai";
  playerDispatch?: {
    team: Team;
    ratio: number;
    minimum: number;
    observedUnits: [number, number][];
    committedUnitIds: number[];
    credit: number;
    retryAt?: number;
    targetId: number;
  };
  plannedOrderTargets?: Partial<Record<Team, number>>;
  plannedOrderPaths?: Partial<Record<Team, [number, number][]>>;
  plannedOrderOwners?: Partial<Record<Team, "player" | "ai">>;
  dispatchRatio?: number;
  osmKey?: string;
  temporary?: boolean;
  destroyed?: boolean;
  generated?: boolean;
  busCooldownUntil?: number;
  bikeCooldownUntil?: number;
};

export type TransportKind = "bus" | "bike";

// Logical movement intent is separate from the current intercepted waypoint.
// Only the authoritative kernel assigns this; clients send actions, not orders.
export type UnitMovementOrder = {
  team: Team;
  goalSiteId?: number;
  goalX: number;
  goalZ: number;
  sourceSiteId?: number;
  purpose: "combat" | "logistics" | "probe";
  effectiveSiteId?: number;
  retryAt?: number;
  awaitingContinuation?: boolean;
  /** Original route after an interception; auxiliary approaches never replace it. */
  continuationPath?: [number, number][];
};

export type UnitState = {
  id: number;
  team: Team;
  x: number;
  z: number;
  tx: number;
  tz: number;
  hp: number;
  supply: number;
  strength: number;
  siteId: number;
  targetSiteId?: number;
  movementOrder?: UnitMovementOrder;
  path?: [number, number][];
  pathIndex?: number;
  attackModifier?: number;
  moveModifier?: number;
  morale?: number;
  retreating?: boolean;
  skin?: "ustc" | "zju" | "nju" | "fdu" | "sjtu";
  transport?: TransportKind;
  transportGroupId?: string;
  transportModel?: import("./research").ResearchId;
  transportOutsidePenalty?: boolean;
};

export type TimedStatus = {
  id: string;
  title: string;
  team: Team;
  until: number;
  attack: number;
  movement: number;
  morale: number;
  production?: number;
  defense?: number;
  supplyUse?: number;
  healing?: number;
  riverMovement?: number;
  unitIds: number[];
};

export type EventCard = CampaignEventCardSpec & { id: string };
export type EventHistoryEntry = EventCard & { atHour: number };
export type FieldContactAlert = { id: number; x: number; z: number; atHour: number };
export type BattleAlert = {
  id: number;
  x: number;
  z: number;
  atHour: number;
  seen: boolean;
};
export type CampaignOutcome = {
  winner: Team;
  reason: string;
  atHour: number;
};
export type AiDifficulty = "casual" | "standard" | "hard";
export type DecisionProgress = {
  id: string;
  instanceId?: string;
  team: Team;
  startedAt: number;
  completesAt: number;
};
export type DecisionState = {
  nextInstance?: number;
  active: Record<Team, DecisionProgress | null>;
  completed: string[];
  locked: string[];
};
export type ResearchProgress = {
  id: import("./research").ResearchId;
  team: Team;
  startedAt: number;
  completesAt: number;
};
export type ResearchState = {
  active: Record<Team, ResearchProgress | null>;
  completed: Record<Team, import("./research").ResearchId[]>;
  production: Record<
    Team,
    Partial<
      Record<
        import("./research").ResearchId,
        {
          id: string;
          researchId: import("./research").ResearchId;
          startedAt: number;
          completesAt: number;
        }
      >
    >
  >;
  stockpile: Record<
    Team,
    Record<import("./research").ResearchId, number>
  >;
  lastBusAllocation: Record<Team, number>;
  lastBikeAllocation: Record<Team, number>;
};
export type AiState = {
  campResourceReserve?: Partial<Record<Team, number>>;
  difficulty: AiDifficulty;
  difficultyByTeam?: Record<Team, AiDifficulty>;
  seed: number;
  seedByTeam?: Record<Team, number>;
  personality: Record<Team, string>;
  nextStrategicAt: Record<Team, number>;
  failedGoals: Record<string, number>;
  intent?: Record<
    Team,
    "passive" | "single_breakthrough" | "positional" | "probing"
  >;
  intentUpdatedAt?: Record<Team, number>;
};
export type AcademicYearOutcome = {
  atHour: number;
  pkuScore: number;
  thuScore: number;
  result: "pku" | "thu" | "draw";
  summary: string;
};

export type ChatChannel = "team" | "all";
export type PlayerIdentity = {
  id: string;
  nickname: string;
  team: Team;
  host: boolean;
};
export type ChatMessage = {
  id: string;
  senderId: string;
  senderName: string;
  senderTeam: Team;
  channel: ChatChannel | "system";
  text: string;
  sentAt: number;
};
export type DecisionVote = {
  id: string;
  decisionId: string;
  team: Team;
  deadline: number;
  votes: Record<string, boolean>;
};

export type CampaignState = {
  fieldEncounters?: {
    version: 1;
    tick: number;
    nextId: number;
    nextScanAt?: number;
    activeSlowUntil?: number;
    /** Flat [unitId, nearSince, cooldownUntil, slowUntil, ...]; null represents an inactive timer in JSON saves. */
    unitStates: Array<number | null>;
    alerts: FieldContactAlert[];
  };
  battleStats?: { kills: Record<Team, number>; captures: Record<Team, number> };
  rulesVersion: number;
  orderRulesVersion?: number;
  serverOpening?: "standard" | "blitz";
  startDateISO: string;
  elapsedHours: number;
  firedEvents: string[];
  warUnlocked: boolean;
  attackBonus: Record<Team, number>;
  freezeUntil: Record<Team, number>;
  cautionUntil?: number;
  outcome?: CampaignOutcome;
  nextSiteId: number;
  lastProductionCycle: number;
  lastDiningCycle: number;
  lastMorningEventDay: number;
  morningPenaltyUntil?: number;
  thuFactionName: string;
  statuses: TimedStatus[];
  eventHistory: EventHistoryEntry[];
  battleAlerts: BattleAlert[];
  initialThuSites: number;
  initialPkuSites: number;
  initialProductionSites: Record<Team, number>;
  decisions: DecisionState;
  research: ResearchState;
  ai: AiState;
  academicYearOutcome?: AcademicYearOutcome;
};

export type GameData = {
  timeOfDay: number;
  resources: Record<Team, number>;
  deaths: Record<Team, number>;
  sites: SiteState[];
  units: UnitState[];
  campaign: CampaignState;
};

export type Snapshot = GameData & {
  version: 1 | 2 | 3 | 4;
  name: string;
  savedAt: number;
  sourceSavedAt?: number;
  icon?: "map" | "tower" | "book" | "shield";
};

export type ServerPlayer = {
  id: string;
  nickname: string;
  team: Team;
  host: boolean;
  local?: boolean;
};
export type ServerLogEntry = {
  id: string;
  at: number;
  category: "system" | "player" | "chat" | "battle" | "command";
  text: string;
};

export type ServerRecord = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  hostTeam: Team;
  maxPlayers: number;
  allowSameTeam: boolean;
  turnServer?: {
    urls: string[];
    username: string;
    credential: string;
  };
  map: Snapshot;
  players: ServerPlayer[];
  logs?: ServerLogEntry[];
};

export type ServerConfigurationDraft = {
  id?: string;
  name: string;
  hostTeam: Team;
  maxPlayers: number;
  allowSameTeam: boolean;
  mapSavedAt?: number;
};

export type UnitNetworkState = Omit<UnitState, "path" | "pathIndex">;
export type CompactUnitNetworkState = [
  id: number,
  team: 0 | 1,
  x100: number,
  z100: number,
  tx100: number,
  tz100: number,
  hp10: number,
  supply10: number,
  strength: number,
  siteId: number,
  targetSiteId: number,
  attackModifier100: number | null,
  moveModifier100: number | null,
  morale10: number,
  flags: number,
  skin: number,
  transport: number,
  transportGroupId: string,
  transportModel: string,
  goalSiteId?: number,
  goalX100?: number | null,
  goalZ100?: number | null,
];
export type ClientUnitCommand = {
  id: number;
  team: Team;
  tx: number;
  tz: number;
  targetSiteId: number | null;
};
export type ClientSiteCommand = {
  id: number;
  stance: Stance;
  dispatchRatio: number;
  orderTarget: number | null;
  plannedOrderTarget: number | null;
  displayName?: string;
};
export type MultiplayerEnvelope =
  | { type: "ping"; id: string; sentAt: number }
  | { type: "pong"; id: string; sentAt: number }
  | {
      type: "network_chunk";
      transferId: string;
      index: number;
      total: number;
      data: string;
    }
  | { type: "state"; game: GameData; role: "host" | "guest"; pausedForPlayers?: boolean; revision?: number; networkEpoch?: number }
  | {
      type: "state_delta";
      networkEpoch?: number;
      pausedForPlayers?: boolean;
      revision: number;
      role: "host" | "guest";
      units: Array<CompactUnitNetworkState | UnitNetworkState>;
      unitHp?: Array<[startId: number, count: number, hp10: number]>;
      newUnits?: UnitNetworkState[];
      removedUnitIds: number[];
      sites: SiteState[];
      campaign?: CampaignState;
      fieldContacts?: FieldContactAlert[];
      timeOfDay: number;
      timeScale: number;
      elapsedHours: number;
      resources: Record<Team, number>;
      deaths: Record<Team, number>;
    }
  | {
      type: "client_commands";
      intent?: "player";
      revision: number;
      units: ClientUnitCommand[];
      sites: ClientSiteCommand[];
    }
  | {
      type: "client_action";
      action:
        | { kind: "decision_cancel"; id: string; startedAt: number; instanceId?: string }
        | { kind: "research"; id: import("./research").ResearchId }
        | { kind: "production_start"; id: import("./research").ResearchId }
        | { kind: "production_stop"; id: import("./research").ResearchId }
        | { kind: "mobilize"; stance: Stance }
        | { kind: "build_camp"; x: number; z: number };
    }
  | { type: "hello"; identity: PlayerIdentity }
  | { type: "chat_send"; channel: ChatChannel; text: string }
  | { type: "chat_message"; message: ChatMessage }
  | { type: "chat_history"; messages: ChatMessage[] }
  | {
      type: "decision_vote_request";
      decisionId: string;
      team: Team;
      voterId: string;
    }
  | {
      type: "decision_vote_cast";
      voteId: string;
      voterId: string;
      approve: boolean;
    }
  | { type: "decision_vote_state"; vote: DecisionVote | null };
