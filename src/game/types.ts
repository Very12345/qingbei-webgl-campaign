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
  dispatchRatio?: number;
  osmKey?: string;
  temporary?: boolean;
  destroyed?: boolean;
  generated?: boolean;
  busCooldownUntil?: number;
  bikeCooldownUntil?: number;
};

export type TransportKind = "bus" | "bike";

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
  path?: [number, number][];
  pathIndex?: number;
  attackModifier?: number;
  moveModifier?: number;
  morale?: number;
  retreating?: boolean;
  skin?: "ustc" | "zju";
  transport?: TransportKind;
  transportGroupId?: string;
  transportModel?: import("./research").ResearchId;
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
  team: Team;
  startedAt: number;
  completesAt: number;
};
export type DecisionState = {
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
    | {
        id: string;
        researchId: import("./research").ResearchId;
        startedAt: number;
        completesAt: number;
      }
    | null
  >;
  stockpile: Record<
    Team,
    Record<import("./research").ResearchId, number>
  >;
  lastBusAllocation: Record<Team, number>;
  lastBikeAllocation: Record<Team, number>;
};
export type AiState = {
  difficulty: AiDifficulty;
  seed: number;
  personality: Record<Team, string>;
  nextStrategicAt: Record<Team, number>;
  failedGoals: Record<string, number>;
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
  rulesVersion: number;
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
  icon?: "map" | "tower" | "book" | "shield";
};

export type ServerPlayer = {
  id: string;
  nickname: string;
  team: Team;
  host: boolean;
};

export type ServerRecord = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  hostTeam: Team;
  maxPlayers: number;
  allowSameTeam: boolean;
  map: Snapshot;
  players: ServerPlayer[];
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
export type MultiplayerEnvelope =
  | { type: "state"; game: GameData; role: "host" | "guest" }
  | {
      type: "state_delta";
      revision: number;
      role: "host" | "guest";
      units: UnitNetworkState[];
      removedUnitIds: number[];
      timeOfDay: number;
      timeScale: number;
      elapsedHours: number;
      resources: Record<Team, number>;
      deaths: Record<Team, number>;
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
