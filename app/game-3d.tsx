"use client";
import { createNetworkEventFeed } from "../src/game/network-events";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import * as THREE from "three";
import {
  DECISIONS,
  type DecisionDefinition,
} from "../src/campaign-content";
import {
  PerformanceController,
  type PerformanceMetrics,
  type QualityMode,
} from "../src/performance-controller";
import type {
  AcademicYearOutcome,
  AiDifficulty,
  CampaignState,
  ChatChannel,
  ChatMessage,
  ClientSiteCommand,
  ClientUnitCommand,
  CompactUnitNetworkState,
  DecisionVote,
  EventCard,
  GameData,
  MultiplayerEnvelope,
  PlayerIdentity,
  RegionId,
  Snapshot,
  Stance,
  ServerRecord,
  ServerLogEntry,
  Team,
  UnitNetworkState,
  UnitState,
} from "../src/game/types";
import {
  deleteServerSave,
  readServerSaves,
  upsertServerSave,
} from "../src/game/server-storage";
import {
  AUTOSAVE_KEY,
  SAVE_KEY,
  deleteIndexedSnapshot,
  readAutosave,
  readIndexedSnapshot,
  readSaves,
} from "../src/game/storage";
import { decisionAvailable, nextDecisionInstance } from "../src/game/decisions";
import { applyProgressionAction } from "../src/game/kernel/progression";
import { createId } from "../src/game/id";
import { EVENT_CARDS } from "../src/game/events/event-cards";
import { makeFreshGame } from "../src/game/create-game";
import {
  RESEARCH_DEFINITIONS,
  type ResearchId,
} from "../src/game/research";
import {
  SERVER_ADMIN_CHANNEL,
  type ServerAdminMessage,
  type ServerBattleSummary,
} from "../src/game/server-admin-protocol";
import {
  createRoomCode,
  normalizeRoomCode,
  publishAutomaticSignal,
  subscribeAutomaticSignals,
  type AutomaticSignalMessage,
} from "../src/game/auto-signaling";
import {
  LocalRelayHub,
  localRoomStatus,
  localServerInfo,
  type NetworkChannel,
} from "../src/game/local-relay";
import {
  AcademicYearOverlay,
  EventBatchOverlay,
  EventLogOverlay,
  PerformanceHud,
  VictoryOverlay,
} from "../src/game/ui/overlays";
import { HomeScreen, type HomePage } from "../src/game/ui/home-screen";
import { FocusTree } from "../src/game/ui/focus-tree";
import { ResearchTree } from "../src/game/ui/research-tree";
import { ToolsPanel } from "../src/game/ui/tools-panel";
import { TeamLobby } from "../src/game/ui/team-lobby";
import type { BattlefieldToolMode } from "../src/game/engine/contracts";

type ServerInvitePayload = {
  kind: "qingbei-server-invite";
  sdp: RTCSessionDescriptionInit;
  playerCount: number;
  hostTeam: Team;
  operatorCounts?: Record<Team, number>;
  serverId?: string | null;
  iceServers?: RTCIceServer[];
  transport?: "webrtc" | "websocket";
  roomCode?: string;
};

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.cloudflare.com:3478" },
];

const EVENT_POPUP_SETTING_KEY = "qingbei-event-popup-enabled";
const MAX_TIME_SCALE = 64;

const NETWORK_SKINS: Array<UnitState["skin"]> = [
  undefined,
  "ustc",
  "zju",
  "nju",
  "fdu",
  "sjtu",
];

const encodeCompactUnit = (unit: UnitState): CompactUnitNetworkState => [
  unit.id,
  unit.team === "pku" ? 0 : 1,
  Math.round(unit.x * 100),
  Math.round(unit.z * 100),
  Math.round(unit.tx * 100),
  Math.round(unit.tz * 100),
  Math.round(unit.hp * 10),
  Math.round(unit.supply * 10),
  unit.strength,
  unit.siteId,
  unit.targetSiteId ?? -1,
  unit.attackModifier == null ? null : Math.round(unit.attackModifier * 100),
  unit.moveModifier == null ? null : Math.round(unit.moveModifier * 100),
  unit.morale == null ? -1 : Math.round(unit.morale * 10),
  (unit.retreating ? 1 : 0) | (unit.transportOutsidePenalty ? 2 : 0),
  Math.max(0, NETWORK_SKINS.indexOf(unit.skin)),
  unit.transport === "bus" ? 1 : unit.transport === "bike" ? 2 : 0,
  unit.transportGroupId ?? "",
  unit.transportModel ?? "",
];

const applyCompactUnit = (
  unit: UnitState,
  compact: CompactUnitNetworkState,
) => {
  unit.team = compact[1] === 0 ? "pku" : "thu";
  unit.x = compact[2] / 100;
  unit.z = compact[3] / 100;
  unit.tx = compact[4] / 100;
  unit.tz = compact[5] / 100;
  unit.hp = compact[6] / 10;
  unit.supply = compact[7] / 10;
  unit.strength = compact[8];
  unit.siteId = compact[9];
  unit.targetSiteId = compact[10] < 0 ? undefined : compact[10];
  unit.attackModifier = compact[11] == null ? undefined : compact[11] / 100;
  unit.moveModifier = compact[12] == null ? undefined : compact[12] / 100;
  unit.morale = compact[13] < 0 ? undefined : compact[13] / 10;
  unit.retreating = Boolean(compact[14] & 1);
  unit.transportOutsidePenalty = Boolean(compact[14] & 2);
  unit.skin = NETWORK_SKINS[compact[15]];
  unit.transport = compact[16] === 1 ? "bus" : compact[16] === 2 ? "bike" : undefined;
  unit.transportGroupId = compact[17] || undefined;
  unit.transportModel =
    (compact[18] as UnitState["transportModel"]) || undefined;
};

type TeamSelectionState =
  | {
      mode: "host";
      server: ServerRecord;
      counts: Record<Team, number>;
      forcedTeam: null;
    }
  | {
      mode: "guest";
      invite: ServerInvitePayload;
      counts: Record<Team, number>;
      forcedTeam: Team | null;
    };
type ClientAction = Extract<
  MultiplayerEnvelope,
  { type: "client_action" }
>["action"];
import {
  ChatPanel,
  DecisionVoteToast,
  MoreDrawer,
  SettingsDrawer,
} from "../src/game/ui/battle-panels";
import {
  DayScaleControl,
  SiteCommandMenu,
  WarOverview,
} from "../src/game/ui/battle-hud";
import type {
  BattlefieldSceneApi,
  BattleStats,
  CampContext,
  GameScreen,
} from "../src/game/engine/contracts";
import { useBattlefieldEngine } from "../src/game/engine/use-battlefield";
import { collectPlayerCommands, type PlayerCommandSelection } from "../src/game/player-commands";
import { NetworkHealth } from "../src/game/network-health";
import SaveWorker from "../src/save-worker.ts?worker&inline";
import ServerClockWorker from "../src/game/server-clock-worker.ts?worker&inline";

export default function Game3D() {
  const hostRef = useRef<HTMLDivElement>(null);
  const performanceControllerRef = useRef(new PerformanceController());
  const autosaveTaskRef = useRef<number | null>(null);
  const saveWorkerRef = useRef<Worker | null>(null);
  const saveWorkerRequestRef = useRef(0);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const siteMenuRef = useRef<HTMLElement>(null);
  const gameRef = useRef<GameData>(makeFreshGame());
  const activePlayerSaveRef = useRef<number | null>(null);
  const sceneApi = useRef<BattlefieldSceneApi | null>(null);
  const [saves, setSaves] = useState<Snapshot[]>([]);
  const [autosave, setAutosave] = useState<Snapshot | null>(null);
  const [serverSaves, setServerSaves] = useState<ServerRecord[]>([]);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const activeServerIdRef = useRef<string | null>(null);
  const autoDedicatedStartedRef = useRef(false);
  const autoLocalJoinStartedRef = useRef(false);
  const aiBenchmarkAutostartedRef = useRef(false);
  const [dedicatedServerHost, setDedicatedServerHost] = useState(false);
  const dedicatedServerHostRef = useRef(false);
  const pendingServerIdRef = useRef<string | null>(null);
  const adminChannelRef = useRef<BroadcastChannel | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [screen, setScreen] = useState<GameScreen>("home");
  const screenRef = useRef<GameScreen>("home");
  const [playerTeam, setPlayerTeam] = useState<Team>("pku");
  const playerTeamRef = useRef<Team>("pku");
  const [moreOpen, setMoreOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const pauseOpenRef = useRef(false);
  const [pauseSettingsOpen, setPauseSettingsOpen] = useState(false);
  const [homePage, setHomePage] = useState<HomePage>(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("join")) return "join-server";
    if (params.get("local") === "1")
      return params.get("manage") === "1" ? "servers" : "join-server";
    return "menu";
  });
  const [newGameTeam, setNewGameTeam] = useState<Team>("pku");
  const [aiObserverMode, setAiObserverMode] = useState(false);
  const aiObserverModeRef = useRef(false);
  const [openToLan, setOpenToLan] = useState(false);
  const [lanInput, setLanInput] = useState(
    () => new URLSearchParams(location.search).get("join") ?? "",
  );
  const [lanOutput, setLanOutput] = useState("");
  const [lanStatus, setLanStatus] = useState("未连接");
  const [lanMode, setLanMode] = useState<"host" | "join">("host");
  const [lanTeam, setLanTeam] = useState<Team>("pku");
  const [teamSelection, setTeamSelection] =
    useState<TeamSelectionState | null>(null);
  const lanTeamRef = useRef<Team>("pku");
  const [connectedPlayers, setConnectedPlayers] = useState(0);
  const [lanConnectionStage, setLanConnectionStage] = useState<
    "connecting" | "failed" | null
  >(null);
  const lanConnectionStageRef = useRef<"connecting" | "failed" | null>(null);
  const lanPeerRef = useRef<RTCPeerConnection | null>(null);
  const lanPeersRef = useRef(new Set<RTCPeerConnection>());
  const lanChannelsRef = useRef(new Set<NetworkChannel>());
  const lanChannelIdentityRef = useRef(new Map<NetworkChannel, PlayerIdentity>());
  const lanHostRef = useRef(false);
  const automaticSignalSourceRef = useRef<EventSource | null>(null);
  const automaticHostCodeRef = useRef<string | null>(null);
  const automaticHostPeersRef = useRef(new Map<string, RTCPeerConnection>());
  const automaticHostChannelsRef = useRef(
    new Map<string, RTCDataChannel>(),
  );
  const expectedTeamByChannelRef = useRef(
    new WeakMap<NetworkChannel, Team>(),
  );
  const automaticJoinRef = useRef<{
    roomCode: string;
    clientId: string;
  } | null>(null);
  const automaticPreferredTeamRef = useRef<Team | null>(null);
  const lastAutomaticRoomCodeRef = useRef<string | null>(null);
  const lanConnectionTimeoutRef = useRef<number | null>(null);
  const signalingSenderIdRef = useRef(createId());
  const localRelayHubRef = useRef<LocalRelayHub | null>(null);
  const localRelayModeRef = useRef(
    new URLSearchParams(location.search).get("local") === "1",
  );
  const localServerManagerRef = useRef(
    new URLSearchParams(location.search).get("manage") === "1",
  );
  const serverIceServersRef = useRef<RTCIceServer[]>(DEFAULT_ICE_SERVERS);
  const iceCandidateTypesRef = useRef(
    new WeakMap<RTCPeerConnection, Set<string>>(),
  );
  const clientActionSenderRef = useRef<(action: ClientAction) => boolean>(
    () => false,
  );
  const networkRevisionRef = useRef(0);
  const playerCommandSenderRef = useRef<(selection: PlayerCommandSelection) => void>(() => {});
  const networkHealthRef = useRef(new NetworkHealth());
  const canIssuePlayerCommandRef = useRef<() => boolean>(() => true);
  const [networkWarning, setNetworkWarning] = useState<string | null>(null);
  const networkLastFullAtRef = useRef(0);
  const networkLastDeltaAtRef = useRef(0);
  const networkUnitCursorRef = useRef(0);
  const networkUnitSignaturesRef = useRef(new Map<number, string>());
  const networkSiteSignaturesRef = useRef(new Map<number, string>());
  const networkCampaignSignatureRef = useRef("");
  const guestHasAuthoritativeStateRef = useRef(false);
  const clientActionRateRef = useRef(
    new WeakMap<NetworkChannel, number[]>(),
  );
  const networkPendingPingsRef = useRef(new Map<string, number>());
  const networkLatencySamplesRef = useRef<number[]>([]);
  const networkLastPingAtRef = useRef(0);
  const lastConnectionFailureRef = useRef<string | null>(null);
  const hostOperationQueueRef = useRef<Array<() => void>>([]);
  const hostOperationFlushTimerRef = useRef<number | null>(null);
  const networkReceivedEpochRef = useRef(new WeakMap<NetworkChannel,number>());
  const networkReceivedRevisionRef = useRef(
    new WeakMap<NetworkChannel, number>(),
  );
  const networkChunkBuffersRef = useRef(
    new WeakMap<
      NetworkChannel,
      Map<
        string,
        { parts: string[]; received: number; total: number; createdAt: number }
      >
    >(),
  );
  const [playerNickname, setPlayerNickname] = useState(() =>
    sessionStorage.getItem("qingbei-player-name") ||
    `玩家${Math.floor(100 + Math.random() * 900)}`,
  );
  const playerIdRef = useRef(
    sessionStorage.getItem("qingbei-player-id") || createId(),
  );
  const [chatOpen, setChatOpen] = useState(false);
  const [chatChannel, setChatChannel] = useState<ChatChannel>("team");
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  const [chatUnread, setChatUnread] = useState({ team: 0, all: 0 });
  const chatRateRef = useRef<number[]>([]);
  const chatOpenRef = useRef(false);
  const chatChannelRef = useRef<ChatChannel>("team");
  const [decisionVote, setDecisionVote] = useState<DecisionVote | null>(null);
  const decisionVoteRef = useRef<DecisionVote | null>(null);
  const [saveName, setSaveName] = useState("解放清华园");
  const [autoDay, setAutoDay] = useState(true);
  const autoDayRef = useRef(true);
  const initialBenchmarkScale = new URLSearchParams(location.search).has(
    "ai-benchmark",
  )
    ? 16
    : 1;
  const [timeScale, setTimeScale] = useState(initialBenchmarkScale);
  const timeScaleRef = useRef(initialBenchmarkScale);
  const [clock, setClock] = useState("8月16日 08:00");
  const [selected, setSelected] = useState<number | null>(null);
  const selectedRef = useRef<number | null>(null);
  const [selectedUnitCount, setSelectedUnitCount] = useState(0);
  const [region, setRegion] = useState<RegionId>("main");
  const regionRef = useRef<RegionId>("main");
  const [notice, setNotice] = useState("拖动己方据点到目标即可下达命令");
  const [renameDraft, setRenameDraft] = useState("");
  const [renamingSite, setRenamingSite] = useState(false);
  const [showSites, setShowSites] = useState(true);
  const [showControl, setShowControl] = useState(false);
  const [campContext, setCampContext] = useState<CampContext | null>(null);
  const [directControl, setDirectControl] = useState(false);
  const joystickRef = useRef<HTMLDivElement>(null);
  const mobileMoveRef = useRef({ x: 0, z: 0 });
  const [joystickKnob, setJoystickKnob] = useState({ x: 0, y: 0 });
  const [assetOpen, setAssetOpen] = useState(false);
  const [eventLogOpen, setEventLogOpen] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [activeToolMode, setActiveToolMode] =
    useState<BattlefieldToolMode>(null);
  const [decisionZoom, setDecisionZoom] = useState(1);
  const [aiDifficulty, setAiDifficulty] = useState<AiDifficulty>("standard");
  const [observerAiDifficulty, setObserverAiDifficulty] = useState<
    Record<Team, AiDifficulty>
  >({ pku: "standard", thu: "standard" });
  const [qualityMode, setQualityMode] = useState<QualityMode>(() =>
    (localStorage.getItem("qingbei-quality-mode") as QualityMode) || "auto",
  );
  const [eventPopupEnabled, setEventPopupEnabled] = useState(
    () => localStorage.getItem(EVENT_POPUP_SETTING_KEY) !== "false",
  );
  const eventPopupEnabledRef = useRef(eventPopupEnabled);
  const [showPerformance, setShowPerformance] = useState(false);
  const [performanceMetrics, setPerformanceMetrics] =
    useState<PerformanceMetrics>(performanceControllerRef.current.metrics);
  const [unitMaterialUrl, setUnitMaterialUrl] = useState<string | null>(null);
  const [siteMaterialUrl, setSiteMaterialUrl] = useState<string | null>(null);
  const [pluginTeamMaterialUrls, setPluginTeamMaterialUrls] = useState<
    Partial<Record<Team, string>>
  >({});
  const customMaterialsRef = useRef<{
    unit: string | null;
    site: string | null;
    teamUnit: Partial<Record<Team, string>>;
  }>({
    unit: null,
    site: null,
    teamUnit: {},
  });
  const [activeEvents, setActiveEvents] = useState<EventCard[]>([]);
  const networkEventFeedRef = useRef(createNetworkEventFeed());
  const [eventToast, setEventToast] = useState<EventCard | null>(null);
  const eventToastQueueRef = useRef<EventCard[]>([]);
  const eventToastTimerRef = useRef<number | null>(null);
  const [victoryBroadcast, setVictoryBroadcast] = useState<{
    winner: Team;
    title: string;
    body: string;
  } | null>(null);
  const [academicYearBroadcast, setAcademicYearBroadcast] = useState<
    AcademicYearOutcome | null
  >(null);
  const pushEvent = useCallback((event: EventCard) => {
    const campaign = gameRef.current.campaign;
    campaign.eventHistory ??= [];
    if (!campaign.eventHistory.some((entry) => entry.id === event.id))
      campaign.eventHistory.push({
        ...event,
        atHour: campaign.elapsedHours,
      });
    if (eventPopupEnabledRef.current) {
      setActiveEvents((current) =>
        current.some((item) => item.id === event.id)
          ? current
          : [...current, event],
      );
      return;
    }
    eventToastQueueRef.current.push(event);
    if (eventToastTimerRef.current == null) {
      const showNextEvent = () => {
        const next = eventToastQueueRef.current.shift();
        if (!next) {
          setEventToast(null);
          eventToastTimerRef.current = null;
          return;
        }
        setEventToast(next);
        eventToastTimerRef.current = window.setTimeout(showNextEvent, 4200);
      };
      showNextEvent();
    }
  }, []);
  const [stats, setStats] = useState<BattleStats>({
    pku: 0,
    thu: 0,
    pkuSites: 0,
    thuSites: 0,
    pkuGrowth: 0,
    thuGrowth: 0,
  });
  const selectedSite =
    selected == null ? null : gameRef.current.sites[selected];
  const beginDecision = useCallback(
    (decisionId: string, team: Team, silent = false) => {
      const game = gameRef.current,
        campaign = game.campaign,
        decision = DECISIONS.find(
          (candidate) => candidate.id === decisionId && candidate.team === team,
        );
      if (!decision || campaign.decisions.active[team]) return false;
      if (!decisionAvailable(decision, campaign)) return false;
      if (game.resources[team] < decision.cost) {
        if (!silent) setNotice(`战略资源不足：需要${decision.cost}`);
        return false;
      }
      game.resources[team] -= decision.cost;
      campaign.decisions.active[team] = {
        id: decision.id,
        instanceId: nextDecisionInstance(campaign),
        team,
        startedAt: campaign.elapsedHours,
        completesAt: campaign.elapsedHours + decision.days * 24,
      };
      if (!silent)
        setNotice(`${decision.title}已开始，预计${decision.days}天完成`);
      return true;
    },
    [],
  );
  const cancelDecision = useCallback((team: Team, expected?: { id: string; startedAt: number; instanceId?: string }) => {
    const active = gameRef.current.campaign.decisions.active[team];
    if (!active) return;
    if (expected && (expected.id !== active.id || expected.startedAt !== active.startedAt || (expected.instanceId ?? null) !== (active.instanceId ?? null))) return;
    if (clientActionSenderRef.current({ kind: "decision_cancel", id: active.id, startedAt: active.startedAt, instanceId: active.instanceId })) {
      setNotice("取消决策请求已发送，等待服务器确认");
      return;
    }
    if (!applyProgressionAction(gameRef.current, { type: "decision_cancel", team, id: active.id, startedAt: active.startedAt, instanceId: active.instanceId })) return;
    setNotice("决策已取消，返还50%战略资源");
  }, []);
  const beginResearch = useCallback(
    (id: ResearchId, team: Team, silent = false) => {
      if (
        team === playerTeamRef.current &&
        clientActionSenderRef.current({ kind: "research", id })
      ) {
        if (!silent) setNotice("研发请求已发送给服务器");
        return true;
      }
      const game = gameRef.current,
        campaign = game.campaign,
        definition = RESEARCH_DEFINITIONS[id];
      if (
        campaign.research.active[team] ||
        campaign.research.completed[team].includes(id) ||
        (definition.team !== "both" && definition.team !== team) ||
        !definition.requires.every((required) =>
          campaign.research.completed[team].includes(required),
        )
      )
        return false;
      if (game.resources[team] < definition.cost) {
        if (!silent) setNotice(`研发资源不足：需要${definition.cost}`);
        return false;
      }
      game.resources[team] -= definition.cost;
      campaign.research.active[team] = {
        id,
        team,
        startedAt: campaign.elapsedHours,
        completesAt: campaign.elapsedHours + definition.hours,
      };
      if (!silent)
        setNotice(`${definition.title}开始研发，预计${definition.hours}小时完成`);
      return true;
    },
    [],
  );
  const beginProduction = useCallback(
    (id: ResearchId, team: Team, silent = false) => {
      if (
        team === playerTeamRef.current &&
        clientActionSenderRef.current({ kind: "production_start", id })
      ) {
        if (!silent) setNotice("生产启用请求已发送给服务器");
        return true;
      }
      const game = gameRef.current,
        campaign = game.campaign,
        definition = RESEARCH_DEFINITIONS[id];
      if (
        campaign.research.production[team][id] ||
        !campaign.research.completed[team].includes(id) ||
        (definition.team !== "both" && definition.team !== team)
      )
        return false;
      if (game.resources[team] < definition.deploymentCost) {
        if (!silent)
          setNotice(`生产资源不足：需要${definition.deploymentCost}`);
        return false;
      }
      game.resources[team] -= definition.deploymentCost;
      campaign.research.production[team][id] = {
        id: createId(),
        researchId: id,
        startedAt: campaign.elapsedHours,
        completesAt: campaign.elapsedHours + definition.productionHours,
      };
      if (!silent)
        setNotice(`${definition.title}投入生产，预计${definition.productionHours}小时完成`);
      return true;
    },
    [],
  );
  const stopProduction = useCallback((id: ResearchId, team: Team) => {
    if (
      team === playerTeamRef.current &&
      clientActionSenderRef.current({ kind: "production_stop", id })
    ) {
      setNotice("停产请求已发送给服务器");
      return;
    }
    const production = gameRef.current.campaign.research.production[team][id];
    if (!production) return;
    delete gameRef.current.campaign.research.production[team][id];
    setNotice(`${RESEARCH_DEFINITIONS[id].title}已停止生产`);
  }, []);
  const recordServerLog = useCallback(
    (category: ServerLogEntry["category"], text: string) => {
      const serverId = activeServerIdRef.current;
      if (!serverId) return;
      const server = readServerSaves().find((record) => record.id === serverId);
      if (!server) return;
      const entry: ServerLogEntry = {
          id: createId(),
          at: Date.now(),
          category,
          text,
        },
        next = upsertServerSave({
          ...server,
          updatedAt: Date.now(),
          logs: [...(server.logs ?? []), entry].slice(-300),
        });
      setServerSaves(next);
    },
    [],
  );
  const refreshSaves = useCallback(
    () => {
      setSaves(readSaves().sort((a, b) => b.savedAt - a.savedAt));
      setServerSaves(
        readServerSaves().sort((a, b) => b.updatedAt - a.updatedAt),
      );
      const legacyAutosave = readAutosave();
      setAutosave(legacyAutosave);
      void readIndexedSnapshot(AUTOSAVE_KEY).then((indexedAutosave) => {
        if (
          indexedAutosave &&
          (!legacyAutosave || indexedAutosave.savedAt >= legacyAutosave.savedAt)
        )
          setAutosave(indexedAutosave);
      });
    },
    [],
  );
  useEffect(() => refreshSaves(), [refreshSaves]);
  useEffect(() => {
    autoDayRef.current = autoDay;
  }, [autoDay]);
  useEffect(() => {
    timeScaleRef.current = timeScale;
  }, [timeScale]);
  useEffect(() => {
    eventPopupEnabledRef.current = eventPopupEnabled;
    localStorage.setItem(
      EVENT_POPUP_SETTING_KEY,
      eventPopupEnabled ? "true" : "false",
    );
    if (!eventPopupEnabled) {
      setActiveEvents([]);
    } else {
      if (eventToastTimerRef.current != null)
        window.clearTimeout(eventToastTimerRef.current);
      eventToastQueueRef.current = [];
      eventToastTimerRef.current = null;
      setEventToast(null);
    }
  }, [eventPopupEnabled]);
  useEffect(
    () => () => {
      if (eventToastTimerRef.current != null)
        window.clearTimeout(eventToastTimerRef.current);
      eventToastQueueRef.current = [];
    },
    [],
  );
  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);
  useEffect(() => {
    activeServerIdRef.current = activeServerId;
  }, [activeServerId]);
  useEffect(() => {
    pauseOpenRef.current = pauseOpen;
  }, [pauseOpen]);
  useEffect(() => {
    playerTeamRef.current = playerTeam;
  }, [playerTeam]);
  useEffect(() => {
    lanTeamRef.current = lanTeam;
  }, [lanTeam]);
  useEffect(() => {
    sessionStorage.setItem("qingbei-player-id", playerIdRef.current);
    sessionStorage.setItem("qingbei-player-name", playerNickname.trim().slice(0, 16));
  }, [playerNickname]);
  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);
  useEffect(() => {
    chatOpenRef.current = chatOpen;
  }, [chatOpen]);
  useEffect(() => {
    chatChannelRef.current = chatChannel;
  }, [chatChannel]);
  useEffect(() => {
    decisionVoteRef.current = decisionVote;
  }, [decisionVote]);
  useEffect(() => {
    const controller = performanceControllerRef.current;
    controller.setMode(qualityMode);
    localStorage.setItem("qingbei-quality-mode", qualityMode);
    return controller.subscribe(setPerformanceMetrics);
  }, [qualityMode]);
  useEffect(() => {
    if (typeof Worker === "undefined") return;
    const worker = new SaveWorker();
    saveWorkerRef.current = worker;
    worker.onmessage = (
      event: MessageEvent<{
        requestId: number;
        ok: boolean;
        durationMs: number;
      }>,
    ) => {
      if (!event.data.ok) return;
      localStorage.removeItem(AUTOSAVE_KEY);
      if (screenRef.current === "home") refreshSaves();
    };
    return () => {
      worker.terminate();
      saveWorkerRef.current = null;
    };
  }, [refreshSaves]);
  useEffect(() => {
    if (!decisionOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDecisionOpen(false);
    };
    addEventListener("keydown", close);
    return () => removeEventListener("keydown", close);
  }, [decisionOpen]);
  useEffect(() => {
    regionRef.current = region;
  }, [region]);
  useEffect(() => {
    selectedRef.current = selected;
    setRenamingSite(false);
  }, [selected]);
  useEffect(() => {
    aiObserverModeRef.current = aiObserverMode;
  }, [aiObserverMode]);
  useEffect(() => {
    sceneApi.current?.setLayers(showSites, showControl);
    setSelected(null);
    setCampContext(null);
  }, [showSites, showControl]);
  useEffect(() => {
    const unit = localStorage.getItem("qingbei-custom-unit-material"),
      site = localStorage.getItem("qingbei-custom-site-material");
    if (unit) setUnitMaterialUrl(unit);
    if (site) setSiteMaterialUrl(site);
  }, []);
  useEffect(() => {
    customMaterialsRef.current = {
      unit: unitMaterialUrl,
      site: siteMaterialUrl,
      teamUnit: pluginTeamMaterialUrls,
    };
    sceneApi.current?.applyMaterials(
      unitMaterialUrl,
      siteMaterialUrl,
      pluginTeamMaterialUrls,
    );
  }, [unitMaterialUrl, siteMaterialUrl, pluginTeamMaterialUrls]);
  useEffect(() => {
    const receivePluginProfile = (event: Event) => {
      const profile = (event as CustomEvent<Record<string, unknown>>).detail,
        cosmetic = profile?.cosmetic as
          | { team?: unknown; url?: unknown }
          | undefined;
      if (
        (cosmetic?.team === "pku" || cosmetic?.team === "thu") &&
        typeof cosmetic.url === "string" &&
        cosmetic.url.length <= 2_048
      ) {
        setPluginTeamMaterialUrls({ [cosmetic.team]: cosmetic.url });
      } else {
        setPluginTeamMaterialUrls({});
      }
    };
    window.addEventListener("qingbei-plugin-profile", receivePluginProfile);
    return () =>
      window.removeEventListener("qingbei-plugin-profile", receivePluginProfile);
  }, []);

  useEffect(() => {
    if (screen !== "game") { setNetworkWarning(null); networkHealthRef.current.reset(); return; }
    const check = () => setNetworkWarning(lanHostRef.current ? null :
      networkHealthRef.current.warning(Date.now(), !!gameRef.current.campaign.outcome));
    check();
    const timer = window.setInterval(check, 1000);
    return () => window.clearInterval(timer);
  }, [screen]);
  useEffect(()=>{
    const receive=(event:Event)=>{
      const message=(event as CustomEvent<{message?:unknown}>).detail?.message;
      if(typeof message!=="string")return;
      event.preventDefault();setNotice(message.slice(0,180));
    };
    window.addEventListener("qingbei-command-status",receive);
    return ()=>window.removeEventListener("qingbei-command-status",receive);
  },[]);
  useBattlefieldEngine({
    playerCommandSenderRef,
    canIssuePlayerCommandRef,
    screen,
    hostRef,
    sceneApi,
    performanceControllerRef,
    setSelected,
    setCampContext,
    selectedRef,
    gameRef,
    setJoystickKnob,
    mobileMoveRef,
    setDirectControl,
    setNotice,
    playerTeamRef,
    setSelectedUnitCount,
    customMaterialsRef,
    pushEvent,
    pauseOpenRef,
    screenRef,
    lanChannelsRef,
    lanChannelIdentityRef,
    lanHostRef,
    dedicatedServerHostRef,
    timeScaleRef,
    autoDayRef,
    setVictoryBroadcast,
    setAcademicYearBroadcast,
    setClock,
    setStats,
    regionRef,
    minimapRef,
    siteMenuRef,
    setRenameDraft,
    showSites,
    showControl,
    beginDecision,
    beginResearch,
    beginProduction,
    recordServerLog,
    observerAiModeRef: aiObserverModeRef,
  });

  const snapshotCurrentGame = (name: string): Snapshot => {
    const current = gameRef.current,
      data: GameData = {
        timeOfDay: current.timeOfDay,
        resources: { ...current.resources },
        deaths: { ...current.deaths },
        sites: current.sites.map((site) => ({
          ...site,
          orderPath: undefined,
        })),
        units: current.units.map((unit) => ({
          ...unit,
          path: undefined,
          pathIndex: undefined,
        })),
        campaign: structuredClone(current.campaign),
      };
    return {
      version: 4,
      name,
      savedAt: Date.now(),
      ...data,
    };
  };
  const saveUnfinishedGame = (immediate = false) => {
    if (screenRef.current !== "game") return;
    if (autosaveTaskRef.current != null)
      window.clearTimeout(autosaveTaskRef.current);
    const persist = () => {
      autosaveTaskRef.current = null;
      const startedAt = performance.now();
      try {
        const snapshot = {
            ...snapshotCurrentGame("未完成战局"),
            sourceSavedAt: activePlayerSaveRef.current ?? undefined,
          },
          worker = saveWorkerRef.current;
        const serverId = activeServerIdRef.current;
        if (serverId) {
          const server = readServerSaves().find(
            (record) => record.id === serverId,
          );
          if (server) {
            const next = upsertServerSave({
              ...server,
              updatedAt: Date.now(),
              map: { ...snapshot, name: server.map.name || server.name },
              players: [
                ...(dedicatedServerHostRef.current
                  ? []
                  : [
                      {
                        id: playerIdRef.current,
                        nickname:
                          playerNickname.trim().slice(0, 16) || "主机",
                        team: playerTeamRef.current,
                        host: true,
                        local: true,
                      },
                    ]),
                ...[...lanChannelIdentityRef.current.values()],
              ],
            });
            setServerSaves(next);
          }
          return;
        }
        if (worker)
          worker.postMessage({
            type: "put",
            requestId: ++saveWorkerRequestRef.current,
            key: AUTOSAVE_KEY,
            value: snapshot,
          });
        else localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshot));
      } catch {
        // The manual save flow reports storage errors; autosave fails silently.
      } finally {
        performanceControllerRef.current.update({
          saveMs: performance.now() - startedAt,
        });
      }
    };
    if (immediate) persist();
    else
      autosaveTaskRef.current = window.setTimeout(() => {
        if ("requestIdleCallback" in window)
          window.requestIdleCallback(persist, { timeout: 2000 });
        else persist();
      }, 0);
  };
  const clearUnfinishedGame = () => {
    localStorage.removeItem(AUTOSAVE_KEY);
    const worker = saveWorkerRef.current;
    if (worker)
      worker.postMessage({
        type: "delete",
        requestId: ++saveWorkerRequestRef.current,
        key: AUTOSAVE_KEY,
      });
    else void deleteIndexedSnapshot(AUTOSAVE_KEY);
    setAutosave(null);
  };
  const saveGame = () => {
    if (activeServerIdRef.current) {
      saveUnfinishedGame(true);
      setNotice("服务器战局已保存到独立服务器存档");
      return true;
    }
    const baseName =
        saveName.trim() || `存档 ${new Date().toLocaleString("zh-CN")}`,
      existing = readSaves(),
      sourceIndex = activePlayerSaveRef.current == null
        ? -1
        : existing.findIndex(
            (save) => save.savedAt === activePlayerSaveRef.current,
          ),
      existingNames = new Set(
        existing
          .filter((_, index) => index !== sourceIndex)
          .map((save) => save.name),
      );
    let name = baseName,
      suffix = 1;
    while (existingNames.has(name)) name = `${baseName} (${suffix++})`;
    const
      snapshot = snapshotCurrentGame(name),
      next =
        sourceIndex >= 0
          ? [
              snapshot,
              ...existing.filter((_, index) => index !== sourceIndex),
            ].slice(0, 12)
          : [snapshot, ...existing].slice(0, 12);
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(next));
      clearUnfinishedGame();
      activePlayerSaveRef.current = snapshot.savedAt;
      setSaveName(name);
      refreshSaves();
      setNotice(`已保存“${name}”`);
      return true;
    } catch {
      setNotice("存档空间不足，请删除旧存档或恢复默认材质后重试");
      return false;
    }
  };
  const downloadJson = (value: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(value)], {
        type: "application/json;charset=utf-8",
      }),
      url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename.replace(/[\\/:*?"<>|]/g, "_");
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const exportSave = (save: Snapshot) =>
    downloadJson(save, `${save.name || "解放清华园"}.qingbei-save.json`);
  const importPlayerSave = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as Snapshot;
      if (!parsed?.sites?.length || !parsed?.units || !parsed?.campaign)
        throw new Error("invalid save");
      const imported: Snapshot = {
        ...parsed,
        version: 4,
        name: parsed.name || file.name.replace(/\.[^.]+$/, ""),
        savedAt: Date.now(),
      };
      const next = [imported, ...readSaves()].slice(0, 12);
      localStorage.setItem(SAVE_KEY, JSON.stringify(next));
      setSaves(next);
      setNotice(`已导入存档“${imported.name}”`);
    } catch {
      setNotice("存档文件无效或版本不兼容");
    }
  };
  const renameSave = (savedAt: number, name: string) => {
    const next = readSaves().map((save) =>
      save.savedAt === savedAt
        ? { ...save, name: name.trim().slice(0, 24) || save.name }
        : save,
    );
    localStorage.setItem(SAVE_KEY, JSON.stringify(next));
    setSaves(next);
  };
  const changeSaveIcon = (savedAt: number) => {
    const icons: NonNullable<Snapshot["icon"]>[] = [
        "map",
        "tower",
        "book",
        "shield",
      ],
      next = readSaves().map((save) => {
        if (save.savedAt !== savedAt) return save;
        const index = icons.indexOf(save.icon ?? "map");
        return { ...save, icon: icons[(index + 1) % icons.length] };
      });
    localStorage.setItem(SAVE_KEY, JSON.stringify(next));
    setSaves(next);
  };
  const createServer = (
    name: string,
    maxPlayers: number,
    mapSavedAt?: number,
  ) => {
    const now = Date.now(),
      selectedMap =
        mapSavedAt == null
          ? undefined
          : readSaves().find((save) => save.savedAt === mapSavedAt),
      fresh = makeFreshGame(),
      server: ServerRecord = {
        id: createId(),
        name: name.trim().slice(0, 24) || "清北联机服务器",
        createdAt: now,
        updatedAt: now,
        hostTeam: "pku",
        maxPlayers: Math.min(8, Math.max(2, maxPlayers)),
        allowSameTeam: true,
        map: selectedMap
          ? { ...structuredClone(selectedMap), savedAt: now }
          : {
              version: 4,
              name: "新服务器地图",
              savedAt: now,
              ...fresh,
            },
        players: [],
        logs: [],
      };
    setServerSaves(upsertServerSave(server));
    setNotice(`服务器“${server.name}”已创建，可进入控制台详细配置`);
    return server;
  };
  const openServerAdmin = (server?: ServerRecord) => {
    if (!server) return;
    window.open(
      `${import.meta.env.BASE_URL}server.html?id=${encodeURIComponent(server.id)}`,
      `qingbei-server-${server.id}`,
      "popup=yes,width=1440,height=900",
    );
  };
  const removeServer = (id: string) => setServerSaves(deleteServerSave(id));
  const exportServer = (server: ServerRecord) =>
    downloadJson(server, `${server.name}.qingbei-server.json`);
  const importServer = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as ServerRecord;
      if (!parsed?.map?.sites?.length || !parsed?.name)
        throw new Error("invalid server");
      const imported: ServerRecord = {
        ...parsed,
        id: createId(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        players: [],
      };
      setServerSaves(upsertServerSave(imported));
      setNotice(`已导入服务器“${imported.name}”`);
    } catch {
      setNotice("服务器文件无效或版本不兼容");
    }
  };
  const launchServer = (server: ServerRecord) => {
    serverIceServersRef.current = [
      ...DEFAULT_ICE_SERVERS,
      ...(server.turnServer?.urls.length
        ? [
            {
              urls: server.turnServer.urls,
              username: server.turnServer.username,
              credential: server.turnServer.credential,
            } satisfies RTCIceServer,
          ]
        : []),
    ];
    dedicatedServerHostRef.current = true;
    setDedicatedServerHost(true);
    loadGame(server.map, "pku", server.id);
    window.setTimeout(() => void startAutomaticHost(server.id), 0);
  };
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (
      !localRelayModeRef.current ||
      !localServerManagerRef.current ||
      params.get("autostart") !== "1" ||
      autoDedicatedStartedRef.current
    )
      return;
    autoDedicatedStartedRef.current = true;
    const existing = readServerSaves().sort(
      (first, second) => second.updatedAt - first.updatedAt,
    )[0];
    const server = existing ?? createServer("清北本地服务器", 8);
    launchServer(server);
    setLanStatus(
      existing ? "正在自动恢复并启动上次战局" : "正在自动创建并启动新战局",
    );
  }, []);
  const stopServer = (serverId: string) => {
    if (activeServerIdRef.current !== serverId) return;
    recordServerLog("system", "服务器已由控制台停止");
    saveUnfinishedGame(true);
    lanChannelsRef.current.forEach((channel) => channel.close());
    lanChannelsRef.current.clear();
    lanPeersRef.current.forEach((peer) => peer.close());
    lanPeersRef.current.clear();
    automaticHostPeersRef.current.forEach((peer) => peer.close());
    automaticHostPeersRef.current.clear();
    automaticHostChannelsRef.current.clear();
    automaticSignalSourceRef.current?.close();
    automaticSignalSourceRef.current = null;
    localRelayHubRef.current?.close();
    localRelayHubRef.current = null;
    automaticHostCodeRef.current = null;
    dedicatedServerHostRef.current = false;
    setDedicatedServerHost(false);
    lanHostRef.current = false;
    activeServerIdRef.current = null;
    pendingServerIdRef.current = null;
    setActiveServerId(null);
    setConnectedPlayers(0);
    setLanOutput("");
    setLanStatus("服务器已停止");
    const stopped = readServerSaves().find((record) => record.id === serverId);
    if (stopped)
      setServerSaves(
        upsertServerSave({
          ...stopped,
          updatedAt: Date.now(),
        }),
      );
    setPauseOpen(false);
    setHomePage("servers");
    setScreen("home");
  };
  useEffect(() => {
    if (screen !== "game") return;
    const timer = window.setInterval(saveUnfinishedGame, 10_000),
      onVisibility = () => {
        if (document.visibilityState === "hidden") saveUnfinishedGame(true);
      },
      onBeforeUnload = () => saveUnfinishedGame(true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      clearInterval(timer);
      if (autosaveTaskRef.current != null) {
        window.clearTimeout(autosaveTaskRef.current);
        autosaveTaskRef.current = null;
      }
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [screen, saveName]);
  const loadGame = (
    save: Snapshot,
    team: Team = playerTeam,
    serverId: string | null = null,
  ) => {
    setAiObserverMode(false);
    aiObserverModeRef.current = false;
    if (!serverId) clearUnfinishedGame();
    const playerSaves = readSaves(),
      sourceSavedAt = serverId
        ? null
        : save.sourceSavedAt ??
          (playerSaves.some((candidate) => candidate.savedAt === save.savedAt)
            ? save.savedAt
            : null),
      sourceSave =
        sourceSavedAt == null
          ? undefined
          : playerSaves.find(
              (candidate) => candidate.savedAt === sourceSavedAt,
            );
    activePlayerSaveRef.current = sourceSavedAt;
    if (!serverId)
      setSaveName(
        sourceSave?.name ??
          (save.name === "未完成战局" ? "解放清华园" : save.name),
      );
    setActiveServerId(serverId);
    activeServerIdRef.current = serverId;
    setPlayerTeam(team);
    playerTeamRef.current = team;
    if (save.version >= 3 && save.campaign) {
      const { timeOfDay, resources, deaths, sites, units, campaign } =
        structuredClone(save);
      const legacyRulesVersion = campaign.rulesVersion ?? 1,
        defaults = makeFreshGame().campaign,
        maxSiteId = sites.reduce((max, site) => Math.max(max, site.id), -1),
        normalizedCampaign: CampaignState = {
          ...defaults,
          ...campaign,
          rulesVersion: 3,
          startDateISO: campaign.startDateISO || defaults.startDateISO,
          elapsedHours: Number.isFinite(campaign.elapsedHours)
            ? campaign.elapsedHours
            : 0,
          warUnlocked: campaign.warUnlocked ?? false,
          attackBonus: { ...defaults.attackBonus, ...campaign.attackBonus },
          freezeUntil: { ...defaults.freezeUntil, ...campaign.freezeUntil },
          firedEvents: campaign.firedEvents ?? [],
          nextSiteId: Math.max(campaign.nextSiteId ?? 0, maxSiteId + 1),
          lastProductionCycle: campaign.lastProductionCycle ?? 0,
          lastDiningCycle: campaign.lastDiningCycle ?? 0,
          lastMorningEventDay: campaign.lastMorningEventDay ?? -1,
          thuFactionName: campaign.thuFactionName || "清华",
          statuses: campaign.statuses ?? [],
          eventHistory:
            campaign.eventHistory ??
            (campaign.firedEvents ?? []).flatMap((id) => {
              const card = EVENT_CARDS[id as keyof typeof EVENT_CARDS];
              return card ? [{ id, ...card, atHour: 0 }] : [];
            }),
          battleAlerts: campaign.battleAlerts ?? [],
          initialThuSites:
            campaign.initialThuSites ??
            sites.filter((site) => site.team === "thu").length,
          initialPkuSites:
            campaign.initialPkuSites ??
            sites.filter((site) => site.team === "pku").length,
          initialProductionSites: campaign.initialProductionSites ?? {
            pku: sites.filter(
              (site) =>
                site.team === "pku" &&
                (site.type === "dorm" || site.type === "dining"),
            ).length,
            thu: sites.filter(
              (site) =>
                site.team === "thu" &&
                (site.type === "dorm" || site.type === "dining"),
            ).length,
          },
          decisions: campaign.decisions ?? defaults.decisions,
          ai: {
            ...defaults.ai,
            ...(campaign.ai ?? {}),
            difficultyByTeam:
              campaign.ai?.difficultyByTeam ??
              ({
                pku: campaign.ai?.difficulty ?? defaults.ai.difficulty,
                thu: campaign.ai?.difficulty ?? defaults.ai.difficulty,
              } as const),
            seedByTeam:
              campaign.ai?.seedByTeam ?? defaults.ai.seedByTeam,
          },
        };
      normalizedCampaign.decisions.active ??= { pku: null, thu: null };
      normalizedCampaign.decisions.completed ??= [];
      normalizedCampaign.decisions.locked ??= [];
      normalizedCampaign.research ??= defaults.research;
      normalizedCampaign.research.active ??= { pku: null, thu: null };
      normalizedCampaign.research.completed ??= { pku: [], thu: [] };
      normalizedCampaign.research.production ??= { pku: {}, thu: {} };
      normalizedCampaign.research.stockpile ??= defaults.research.stockpile;
      const migrateResearchId = (id: string, team: Team): ResearchId => {
        if (id === "bike") return team === "pku" ? "pku_bike" : "thu_bike";
        if (id === "ebike")
          return team === "pku" ? "pku_phone_bike" : "thu_purple_bike";
        if (id === "armored_bus") return "large_bus";
        return id as ResearchId;
      };
      for (const team of ["pku", "thu"] as Team[]) {
        normalizedCampaign.research.production[team] ??= {};
        const stockpile = normalizedCampaign.research.stockpile[team] as unknown as Record<string, number>,
          migratedCompleted = (normalizedCampaign.research.completed[team] as unknown as string[]).map(
            (id) => migrateResearchId(id, team),
          );
        normalizedCampaign.research.completed[team] = [
          ...new Set(migratedCompleted),
        ];
        const active = normalizedCampaign.research.active[team];
        if (active) active.id = migrateResearchId(active.id, team);
        const legacyProduction = normalizedCampaign.research.production[team] as unknown as
          | { id: string; researchId: string; startedAt: number; completesAt: number }
          | Record<string, { id: string; researchId: string; startedAt: number; completesAt: number }>
          | null;
        if (
          legacyProduction &&
          typeof (legacyProduction as { researchId?: unknown }).researchId ===
            "string"
        ) {
          const legacySingle = legacyProduction as {
              id: string;
              researchId: string;
              startedAt: number;
              completesAt: number;
            },
            migratedId = migrateResearchId(legacySingle.researchId, team);
          normalizedCampaign.research.production[team] = {
            [migratedId]: { ...legacySingle, researchId: migratedId },
          };
        } else {
          const migratedProduction: CampaignState["research"]["production"][Team] = {};
          for (const production of Object.values(legacyProduction ?? {})) {
            if (!production) continue;
            const migratedId = migrateResearchId(production.researchId, team);
            migratedProduction[migratedId] = {
              ...production,
              researchId: migratedId,
            };
          }
          normalizedCampaign.research.production[team] = migratedProduction;
        }
        normalizedCampaign.research.stockpile[team] = {
          pku_bike: team === "pku" ? stockpile.pku_bike ?? stockpile.bike ?? 0 : 0,
          pku_slogan_bike: stockpile.pku_slogan_bike ?? 0,
          pku_phone_bike:
            team === "pku" ? stockpile.pku_phone_bike ?? stockpile.ebike ?? 0 : 0,
          thu_bike: team === "thu" ? stockpile.thu_bike ?? stockpile.bike ?? 0 : 0,
          thu_purple_bike:
            team === "thu" ? stockpile.thu_purple_bike ?? stockpile.ebike ?? 0 : 0,
          bus: stockpile.bus ?? 0,
          large_bus: stockpile.large_bus ?? stockpile.armored_bus ?? 0,
        };
      }
      normalizedCampaign.research.lastBusAllocation ??= {
        pku: -999,
        thu: -999,
      };
      normalizedCampaign.research.lastBikeAllocation ??= {
        pku: -999,
        thu: -999,
      };
      normalizedCampaign.ai.difficulty ??= "standard";
      normalizedCampaign.ai.nextStrategicAt ??= { pku: 0, thu: 0 };
      normalizedCampaign.ai.failedGoals ??= {};
      if (legacyRulesVersion < 2) {
        const qz = sites.find((site) => site.name === "求真书院"),
          legacyQzVictory =
            normalizedCampaign.outcome?.winner === "pku" &&
            normalizedCampaign.outcome.reason.includes("求真书院") &&
            normalizedCampaign.firedEvents.includes("qz_captured");
        if (qz && legacyQzVictory) {
          normalizedCampaign.outcome = undefined;
          qz.team = "thu";
          qz.stance = "defend";
          qz.dispatchRatio = 0.4;
          qz.displayName = qz.name;
        }
      }
      if (
        legacyRulesVersion < 3 &&
        normalizedCampaign.outcome &&
        (normalizedCampaign.outcome.reason.includes("求真书院") ||
          normalizedCampaign.outcome.reason.includes("元培学院"))
      )
        normalizedCampaign.outcome = undefined;
      sites.forEach((site) => {
        site.displayName ??= site.name;
        site.dispatchRatio ??=
          site.stance === "defend" ? 0.45 : site.stance === "guard" ? 0.72 : 1;
        site.orderPath = undefined;
      });
      const expandedUnits: UnitState[] = [],
        expandedIds = new Map<number, number[]>();
      let migratedUnitId =
        units.reduce((maximum, unit) => Math.max(maximum, unit.id), -1) + 1;
      units.forEach((unit) => {
        const copies = Math.max(1, Math.round(unit.strength ?? 5)),
          ids: number[] = [];
        for (let copy = 0; copy < copies; copy++) {
          const angle = (copy / copies) * Math.PI * 2,
            id = copy === 0 ? unit.id : migratedUnitId++;
          ids.push(id);
          expandedUnits.push({
            ...unit,
            id,
            x: unit.x + Math.cos(angle) * copy * 0.035,
            z: unit.z + Math.sin(angle) * copy * 0.035,
            strength: 1,
          });
        }
        expandedIds.set(unit.id, ids);
      });
      normalizedCampaign.statuses.forEach((status) => {
        status.unitIds = status.unitIds.flatMap(
          (id) => expandedIds.get(id) ?? [id],
        );
      });
      units.splice(0, units.length, ...expandedUnits);
      units.forEach((unit) => {
        unit.strength = 1;
        if (unit.transportModel)
          unit.transportModel = migrateResearchId(
            unit.transportModel,
            unit.team,
          );
        unit.morale ??= 100;
        unit.retreating ??= false;
        unit.path = undefined;
        unit.pathIndex = undefined;
      });
      gameRef.current = {
        timeOfDay,
        resources,
        deaths,
        sites,
        units,
        campaign: normalizedCampaign,
      };
    } else {
      const fresh = makeFreshGame(),
        oldSiteById = new Map(save.sites.map((s) => [s.id, s])),
        freshByName = new Map(fresh.sites.map((s) => [s.name, s]));
      fresh.sites.forEach((site) => {
        const old = save.sites.find((s) => s.name === site.name);
        if (!old) return;
        site.team = old.team;
        site.stance = old.stance;
        site.supply = old.supply;
        site.displayName = old.displayName ?? old.name;
        site.dispatchRatio = old.dispatchRatio;
        const oldTarget =
          old.orderTarget == null ? null : oldSiteById.get(old.orderTarget);
        site.orderTarget = oldTarget
          ? freshByName.get(oldTarget.name)?.id
          : undefined;
      });
      fresh.units = save.units.flatMap((unit, index) => {
        const oldHome = oldSiteById.get(unit.siteId),
          home = oldHome ? freshByName.get(oldHome.name) : undefined;
        if (!home) return [];
        const angle = ((index % 7) / 7) * Math.PI * 2;
        return [
          {
            ...unit,
            strength: unit.strength ?? 5,
            siteId: home.id,
            targetSiteId: undefined,
            path: undefined,
            pathIndex: undefined,
            x: home.x + Math.cos(angle) * 1.1,
            z: home.z + Math.sin(angle) * 1.1,
            tx: home.x,
            tz: home.z,
          },
        ];
      });
      fresh.timeOfDay = save.timeOfDay;
      fresh.resources = save.resources;
      fresh.deaths = save.deaths;
      gameRef.current = fresh;
    }
    sceneApi.current?.sync();
    sceneApi.current?.clearUnitSelection();
    setSelected(null);
    setSaveOpen(false);
    setActiveEvents([]);
    setVictoryBroadcast(null);
    setAcademicYearBroadcast(null);
    setPauseOpen(false);
    setScreen("game");
  };
  const deleteSave = (savedAt: number) => {
    const next = readSaves().filter((s) => s.savedAt !== savedAt);
    localStorage.setItem(SAVE_KEY, JSON.stringify(next));
    setSaves(next);
  };
  const newGame = (
    team: Team = playerTeam,
    observeBothAi = false,
    observerDifficulties = observerAiDifficulty,
  ) => {
    clearUnfinishedGame();
    activePlayerSaveRef.current = null;
    setActiveServerId(null);
    activeServerIdRef.current = null;
    setPlayerTeam(team);
    playerTeamRef.current = team;
    setAiObserverMode(observeBothAi);
    aiObserverModeRef.current = observeBothAi;
    gameRef.current = makeFreshGame();
    gameRef.current.campaign.ai.difficulty = aiDifficulty;
    gameRef.current.campaign.ai.difficultyByTeam = {
      pku: observeBothAi ? observerDifficulties.pku : aiDifficulty,
      thu: observeBothAi ? observerDifficulties.thu : aiDifficulty,
    };
    sceneApi.current?.sync();
    sceneApi.current?.clearUnitSelection();
    setSelected(null);
    setActiveEvents([]);
    setVictoryBroadcast(null);
    setAcademicYearBroadcast(null);
    setPauseOpen(false);
    setScreen("game");
  };
  useEffect(() => {
    const scenario = new URLSearchParams(location.search).get("ai-benchmark");
    if (!scenario || aiBenchmarkAutostartedRef.current) return;
    aiBenchmarkAutostartedRef.current = true;
    const humanTeam: Team = scenario.startsWith("pku-") ? "thu" : "pku";
    setSaveName(`AI基准-${scenario}`);
    newGame(humanTeam);
  }, []);
  const stanceText = useMemo(
    () => ({
      defend: { title: "防守", detail: "保留55%驻军" },
      guard: { title: "守卫", detail: "保留28%并主动截击" },
      standby: { title: "待命", detail: "可输送全部兵力" },
    }),
    [],
  );
  const selectedNearbyFriendly = selectedSite
    ? gameRef.current.units
        .filter(
          (unit) =>
            unit.team === selectedSite.team &&
            unit.siteId === selectedSite.id &&
            Math.hypot(
              unit.x - (selectedSite.navX ?? selectedSite.x),
              unit.z - (selectedSite.navZ ?? selectedSite.z),
            ) < 3.4,
        )
        .reduce((sum, unit) => sum + unit.strength, 0)
    : 0;
  const timeScaleLocked = connectedPlayers > 0 && !lanHostRef.current;
  const setStance = (s: Stance) => {
    if (!canIssuePlayerCommandRef.current()) return;
    if (!selectedSite || selectedSite.team !== playerTeam) return;
    selectedSite.stance = s;
    selectedSite.dispatchRatio = s === "defend" ? 0.4 : s === "guard" ? 0.7 : 1;
    playerCommandSenderRef.current({ siteIds: [selectedSite.id] });
    sceneApi.current?.refreshSiteStance(selectedSite.id);
    setNotice(
      `${selectedSite.displayName ?? selectedSite.name}已切换为${stanceText[s].title}，输送${Math.round(selectedSite.dispatchRatio * 100)}%`,
    );
  };
  const renameSelectedSite = () => {
    if (!canIssuePlayerCommandRef.current()) return;
    if (!selectedSite || selectedSite.team !== playerTeam) return;
    const nextName = renameDraft.trim().slice(0, 24);
    if (!nextName) return;
    selectedSite.displayName = nextName;
    playerCommandSenderRef.current({ siteIds: [selectedSite.id] });
    sceneApi.current?.sync();
    setNotice(`据点已改名为“${nextName}”`);
    setRenamingSite(false);
  };
  const handleMaterialUpload = async (kind: "unit" | "site", file?: File) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 2_000_000) {
      setNotice("仅支持2MB以内的 PNG、JPEG 或 WebP 图片");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file),
        canvas = document.createElement("canvas"),
        size = 512;
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d")!;
      context.clearRect(0, 0, size, size);
      const scale = Math.min(size / bitmap.width, size / bitmap.height),
        width = bitmap.width * scale,
        height = bitmap.height * scale;
      context.drawImage(
        bitmap,
        (size - width) / 2,
        (size - height) / 2,
        width,
        height,
      );
      bitmap.close();
      const url = canvas.toDataURL("image/webp", 0.82),
        key = `qingbei-custom-${kind}-material`;
      localStorage.setItem(key, url);
      if (kind === "unit") setUnitMaterialUrl(url);
      else setSiteMaterialUrl(url);
      setNotice(`${kind === "unit" ? "士兵" : "据点"}材质已替换`);
    } catch {
      setNotice("图片处理或本机存储失败，请换用更小的图片");
    }
  };
  const clearMaterial = (kind: "unit" | "site") => {
    localStorage.removeItem(`qingbei-custom-${kind}-material`);
    if (kind === "unit") setUnitMaterialUrl(null);
    else setSiteMaterialUrl(null);
  };
  const waitForIce = (peer: RTCPeerConnection) =>
    new Promise<void>((resolve) => {
      if (peer.iceGatheringState === "complete") return resolve();
      const timeout = window.setTimeout(() => {
        peer.removeEventListener("icegatheringstatechange", listener);
        resolve();
      }, 5_000);
      const listener = () => {
        if (peer.iceGatheringState !== "complete") return;
        window.clearTimeout(timeout);
        peer.removeEventListener("icegatheringstatechange", listener);
        resolve();
      };
      peer.addEventListener("icegatheringstatechange", listener);
    });
  const peerConfiguration = (iceServers = serverIceServersRef.current) => ({
      iceServers,
      iceCandidatePoolSize: 2,
    } satisfies RTCConfiguration),
    watchIceCandidates = (peer: RTCPeerConnection) => {
      const types = new Set<string>();
      iceCandidateTypesRef.current.set(peer, types);
      peer.addEventListener("icecandidate", (event) => {
        const type = event.candidate?.candidate.match(/\btyp\s+(\w+)/)?.[1];
        if (type) types.add(type);
      });
    },
    connectionFailureText = (peer: RTCPeerConnection) => {
      const types = iceCandidateTypesRef.current.get(peer) ?? new Set<string>(),
        hasTurn = (peer.getConfiguration().iceServers ?? []).some((server) =>
          (Array.isArray(server.urls) ? server.urls : [server.urls]).some(
            (url) => url.startsWith("turn:" ) || url.startsWith("turns:"),
          ),
        );
      if (!hasTurn)
        return "直连失败：两端网络存在隔离或NAT限制，服务器尚未配置TURN中继";
      if (!types.has("relay"))
        return "中继失败：TURN地址、用户名或凭据不可用，未生成relay候选";
      return "已生成TURN中继候选，但连接握手失败；请检查防火墙或重试";
    };
  const appendChatMessage = (message: ChatMessage) => {
    if (chatMessagesRef.current.some((item) => item.id === message.id)) return;
    setChatMessages((current) => [...current, message].slice(-100));
    if (
      message.channel !== "system" &&
      (!chatOpenRef.current || chatChannelRef.current !== message.channel)
    )
      setChatUnread((current) => ({
        ...current,
        [message.channel]: current[message.channel as ChatChannel] + 1,
      }));
  };
  const sendToChannel = (
    channel: NetworkChannel,
    envelope: MultiplayerEnvelope,
  ) => {
    if (channel.readyState !== "open") return;
    const serialized = JSON.stringify(envelope),
      chunkSize = 12_000;
    if (
      envelope.type === "network_chunk" ||
      serialized.length <= chunkSize
    ) {
      channel.send(serialized);
      return;
    }
    const transferId = createId(),
      total = Math.ceil(serialized.length / chunkSize),
      chunks = Array.from({ length: total }, (_, index) =>
        JSON.stringify({
          type: "network_chunk",
          transferId,
          index,
          total,
          data: serialized.slice(index * chunkSize, (index + 1) * chunkSize),
        } satisfies MultiplayerEnvelope),
      );
    let index = 0;
    const pump = () => {
      if (channel.readyState !== "open") return;
      while (index < chunks.length && channel.bufferedAmount < 512_000)
        channel.send(chunks[index++]);
      if (index < chunks.length) window.setTimeout(pump, 12);
    };
    pump();
  };
  canIssuePlayerCommandRef.current = () => {
    if (lanHostRef.current) return true;
    const warning = networkHealthRef.current.warning(Date.now(), !!gameRef.current.campaign.outcome);
    if (warning) { setNotice(warning); return false; }
    return true;
  };
  playerCommandSenderRef.current = (selection) => {
    if (!canIssuePlayerCommandRef.current()) return;
    if (lanHostRef.current || !guestHasAuthoritativeStateRef.current) return;
    const channel = [...lanChannelsRef.current].find(c => c.readyState === "open");
    if (!channel) { setNotice("连接已断开，操作未发送"); return; }
    const command = collectPlayerCommands(gameRef.current, playerTeamRef.current, selection);
    if (!command.sites.length && !command.units.length) return;
    sendToChannel(channel, { type: "client_commands", intent: "player", revision: ++networkRevisionRef.current, ...command });
  };
  clientActionSenderRef.current = (action) => {
    if (!canIssuePlayerCommandRef.current()) return true; // Handled: do not fall back to local mutations.
    if (lanHostRef.current || !guestHasAuthoritativeStateRef.current)
      return false;
    const hostChannel = [...lanChannelsRef.current].find(
      (channel) => channel.readyState === "open",
    );
    if (!hostChannel) return false;
    sendToChannel(hostChannel, { type: "client_action", action });
    if (action.kind === "mobilize") {
      const sites = gameRef.current.sites.filter(s => s.team === playerTeamRef.current && !s.destroyed);
      for (const site of sites) {
        site.stance = action.stance;
        site.dispatchRatio = action.stance === "defend" ? .4 : action.stance === "guard" ? .7 : 1;
      }
      playerCommandSenderRef.current({ siteIds: sites.map(s => s.id) });
    }
    return true;
  };
  const flushHostOperations = () => {
    if (hostOperationFlushTimerRef.current != null) {
      window.clearTimeout(hostOperationFlushTimerRef.current);
      hostOperationFlushTimerRef.current = null;
    }
    const batch = hostOperationQueueRef.current.splice(0);
    batch.forEach((queued) => queued());
  };
  const enqueueHostOperation = (operation: () => void) => {
    hostOperationQueueRef.current.push(operation);
    if (
      dedicatedServerHostRef.current &&
      document.visibilityState === "hidden"
    )
      return;
    if (hostOperationFlushTimerRef.current != null) return;
    const frameMs = 50,
      delay = Math.max(1, frameMs - (performance.now() % frameMs));
    hostOperationFlushTimerRef.current = window.setTimeout(() => {
      flushHostOperations();
    }, delay);
  };
  const relayChatMessage = (message: ChatMessage) => {
    appendChatMessage(message);
    recordServerLog(
      message.channel === "system" ? "system" : "chat",
      `${message.senderName}: ${message.text}`,
    );
    lanChannelsRef.current.forEach((channel) => {
      const identity = lanChannelIdentityRef.current.get(channel);
      if (
        message.channel === "team" &&
        identity &&
        identity.team !== message.senderTeam
      )
        return;
      sendToChannel(channel, { type: "chat_message", message });
    });
  };
  const broadcastEnvelope = (envelope: MultiplayerEnvelope) =>
    lanChannelsRef.current.forEach((channel) => sendToChannel(channel, envelope));
  const eligibleDecisionVoters = (vote: DecisionVote) => [
    ...(!dedicatedServerHostRef.current && playerTeamRef.current === vote.team
      ? [playerIdRef.current]
      : []),
    ...[...lanChannelIdentityRef.current.values()]
      .filter((identity) => identity.team === vote.team)
      .map((identity) => identity.id),
  ];
  const finalizeDecisionVote = (voteId: string) => {
    if (!lanHostRef.current) return;
    const vote = decisionVoteRef.current;
    if (!vote || vote.id !== voteId) return;
    const eligible = eligibleDecisionVoters(vote),
      yes = eligible.filter((id) => vote.votes[id] === true).length,
      no = eligible.filter((id) => vote.votes[id] === false).length,
      approved = yes > eligible.length / 2 || (yes === no && yes > 0);
    if (approved) beginDecision(vote.decisionId, vote.team);
    const definition = DECISIONS.find((item) => item.id === vote.decisionId);
    relayChatMessage({
      id: createId(),
      senderId: "system",
      senderName: "系统",
      senderTeam: vote.team,
      channel: "system",
      text: `决策投票${approved ? "通过" : "未通过"}：${definition?.title ?? vote.decisionId}`,
      sentAt: Date.now(),
    });
    decisionVoteRef.current = null;
    setDecisionVote(null);
    broadcastEnvelope({ type: "decision_vote_state", vote: null });
  };
  const finalizeDecisionVoteIfComplete = (vote: DecisionVote) => {
    const eligible = eligibleDecisionVoters(vote);
    if (
      eligible.length > 0 &&
      eligible.every((id) => Object.hasOwn(vote.votes, id))
    )
      finalizeDecisionVote(vote.id);
  };
  const startDecisionVote = (
    decisionId: string,
    team: Team,
    voterId: string,
  ) => {
    if (!lanHostRef.current || decisionVoteRef.current) return;
    const vote: DecisionVote = {
      id: createId(),
      decisionId,
      team,
      deadline: Date.now() + 20_000,
      votes: { [voterId]: true },
    };
    decisionVoteRef.current = vote;
    setDecisionVote(vote);
    broadcastEnvelope({ type: "decision_vote_state", vote });
    finalizeDecisionVoteIfComplete(vote);
    setTimeout(() => finalizeDecisionVote(vote.id), 20_000);
  };
  const requestDecisionStart = (decisionId: string, team: Team) => {
    if (!canIssuePlayerCommandRef.current()) return false;
    if (!lanChannelsRef.current.size) return beginDecision(decisionId, team);
    if (lanHostRef.current) {
      startDecisionVote(decisionId, team, playerIdRef.current);
      return true;
    }
    const host = [...lanChannelsRef.current].find(
      (channel) => channel.readyState === "open",
    );
    if (!host) return false;
    sendToChannel(host, {
      type: "decision_vote_request",
      decisionId,
      team,
      voterId: playerIdRef.current,
    });
    return true;
  };
  const castDecisionVote = (approve: boolean) => {
    const vote = decisionVoteRef.current;
    if (!vote) return;
    if (lanHostRef.current) {
      vote.votes[playerIdRef.current] = approve;
      setDecisionVote({ ...vote, votes: { ...vote.votes } });
      broadcastEnvelope({ type: "decision_vote_state", vote });
      finalizeDecisionVoteIfComplete(vote);
    } else {
      const host = [...lanChannelsRef.current].find(
        (channel) => channel.readyState === "open",
      );
      if (host)
        sendToChannel(host, {
          type: "decision_vote_cast",
          voteId: vote.id,
          voterId: playerIdRef.current,
          approve,
        });
    }
  };
  const submitChatMessage = () => {
    const text = chatInput.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200);
    if (!text) return;
    const now = Date.now();
    chatRateRef.current = chatRateRef.current.filter((time) => now - time < 10_000);
    if (chatRateRef.current.length >= 5) {
      setNotice("发送过快，请稍后再试");
      return;
    }
    chatRateRef.current.push(now);
    const identity: PlayerIdentity = {
      id: playerIdRef.current,
      nickname: playerNickname.trim().slice(0, 16) || "未命名玩家",
      team: playerTeamRef.current,
      host: lanHostRef.current,
    };
    if (lanHostRef.current || !lanChannelsRef.current.size) {
      relayChatMessage({
        id: createId(),
        senderId: identity.id,
        senderName: identity.nickname,
        senderTeam: identity.team,
        channel: chatChannel,
        text,
        sentAt: now,
      });
    } else {
      const hostChannel = [...lanChannelsRef.current].find(
        (channel) => channel.readyState === "open",
      );
      if (hostChannel)
        sendToChannel(hostChannel, { type: "chat_send", channel: chatChannel, text });
      else setNotice("尚未连接服务器");
    }
    setChatInput("");
  };
  const updateActiveServerPlayers = () => {
    const serverId = activeServerIdRef.current;
    if (!serverId) return;
    const server = readServerSaves().find((record) => record.id === serverId);
    if (!server) return;
    const players = [
      ...(dedicatedServerHostRef.current
        ? []
        : [
            {
              id: playerIdRef.current,
              nickname: playerNickname.trim().slice(0, 16) || "主机",
              team: playerTeamRef.current,
              host: true,
              local: true,
            },
          ]),
      ...[...lanChannelIdentityRef.current.values()].map((identity) => ({
        ...identity,
        host: false,
        local: false,
      })),
    ];
    setServerSaves(
      upsertServerSave({ ...server, updatedAt: Date.now(), players }),
    );
  };
  const bindLanChannel = (channel: NetworkChannel, host: boolean) => {
    lanChannelsRef.current.add(channel);
    lanHostRef.current = host;
    const refreshConnectionCount = () =>
      setConnectedPlayers(
        [...lanChannelsRef.current].filter(
          (candidate) => candidate.readyState === "open",
        ).length,
      );
    channel.onopen = () => {
      if (!host) networkHealthRef.current.start(Date.now());
      lastConnectionFailureRef.current = null;
      if (lanConnectionTimeoutRef.current != null) {
        window.clearTimeout(lanConnectionTimeoutRef.current);
        lanConnectionTimeoutRef.current = null;
      }
      if (!host) {
        automaticSignalSourceRef.current?.close();
        automaticSignalSourceRef.current = null;
        automaticJoinRef.current = null;
        automaticPreferredTeamRef.current = null;
        lanConnectionStageRef.current = "connecting";
        setLanConnectionStage("connecting");
        setLanStatus("连接已建立，正在接收服务器地图…");
        lanConnectionTimeoutRef.current = window.setTimeout(() => {
          setLanConnectionStage("failed");
          lanConnectionStageRef.current = "failed";
          setLanStatus("服务器地图传输超时，请重新连接");
        }, 30_000);
      }
      if (!host) {
        setPlayerTeam(lanTeamRef.current);
        playerTeamRef.current = lanTeamRef.current;
      }
      if (!(host && dedicatedServerHostRef.current))
        sendToChannel(channel, {
          type: "hello",
          identity: {
            id: playerIdRef.current,
            nickname: playerNickname.trim().slice(0, 16) || "未命名玩家",
            team: host ? playerTeamRef.current : lanTeamRef.current,
            host,
          },
        });
      if (host)
        sendToChannel(channel, {
          type: "state",
          game: snapshotCurrentGame("联机同步"),
          role: "host",
        });
      if (host) networkLastFullAtRef.current = performance.now();
      refreshConnectionCount();
      updateActiveServerPlayers();
      if (host) setLanStatus("玩家已加入，正在发送主机地图");
    };
    channel.onclose = () => {
      if (!host) networkHealthRef.current.connected = false;
      lanChannelsRef.current.delete(channel);
      lanChannelIdentityRef.current.delete(channel);
      refreshConnectionCount();
      updateActiveServerPlayers();
      setLanStatus(
        lastConnectionFailureRef.current ??
          (lanChannelsRef.current.size ? "部分玩家已离开" : "连接已关闭"),
      );
      recordServerLog("player", "一名玩家离开服务器");
      if (!host) guestHasAuthoritativeStateRef.current = false;
    };
    channel.onmessage = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as MultiplayerEnvelope;
        if (payload.type === "network_chunk") {
          let transfers = networkChunkBuffersRef.current.get(channel);
          if (!transfers) {
            transfers = new Map();
            networkChunkBuffersRef.current.set(channel, transfers);
          }
          const now = Date.now();
          for (const [id, transfer] of transfers)
            if (now - transfer.createdAt > 45_000) transfers.delete(id);
          if (
            payload.total < 1 ||
            payload.total > 2_000 ||
            payload.index < 0 ||
            payload.index >= payload.total
          )
            return;
          let transfer = transfers.get(payload.transferId);
          if (!transfer) {
            transfer = {
              parts: new Array(payload.total),
              received: 0,
              total: payload.total,
              createdAt: now,
            };
            transfers.set(payload.transferId, transfer);
          }
          if (transfer.total !== payload.total) return;
          if (transfer.parts[payload.index] == null) {
            transfer.parts[payload.index] = payload.data;
            transfer.received++;
          }
          if (transfer.received === transfer.total) {
            transfers.delete(payload.transferId);
            const handler = channel.onmessage as
              | ((message: MessageEvent<string>) => unknown)
              | null;
            handler?.(
              new MessageEvent("message", { data: transfer.parts.join("") }),
            );
          }
          return;
        }
        if (payload.type === "ping") {
          sendToChannel(channel, {
            type: "pong",
            id: payload.id,
            sentAt: payload.sentAt,
          });
          return;
        }
        if (payload.type === "pong") {
          const startedAt = networkPendingPingsRef.current.get(payload.id);
          if (startedAt == null) return;
          networkPendingPingsRef.current.delete(payload.id);
          const rtt = Math.max(0, performance.now() - startedAt),
            samples = networkLatencySamplesRef.current;
          samples.push(rtt);
          if (samples.length > 24) samples.shift();
          const latency =
              samples.reduce((sum, sample) => sum + sample, 0) /
              Math.max(1, samples.length),
            jitter =
              samples.length < 2
                ? 0
                : samples
                    .slice(1)
                    .reduce(
                      (sum, sample, index) =>
                        sum + Math.abs(sample - samples[index]),
                      0,
                    ) /
                  (samples.length - 1);
          performanceControllerRef.current.update({
            latencyMs: latency,
            jitterMs: jitter,
          });
          return;
        }
        if (payload.type === "hello") {
          let identity = payload.identity;
          if (host) {
            const expectedTeam = expectedTeamByChannelRef.current.get(channel);
            if (expectedTeam) identity = { ...identity, team: expectedTeam };
            const activeConfiguration = readServerSaves().find(
              (record) => record.id === activeServerIdRef.current,
            );
            if (
              activeConfiguration &&
              lanChannelIdentityRef.current.size >=
                activeConfiguration.maxPlayers
            ) {
              recordServerLog("player", `${identity.nickname}因服务器已满被拒绝`);
              channel.close();
              return;
            }
            if (
              activeConfiguration &&
              !activeConfiguration.allowSameTeam &&
              [...lanChannelIdentityRef.current.values()].some(
                (player) => player.team === identity.team,
              )
            ) {
              recordServerLog(
                "player",
                `${identity.nickname}因阵营已有操作者被拒绝`,
              );
              channel.close();
              return;
            }
            const usedNames = new Set(
                [
                  ...(dedicatedServerHostRef.current
                    ? []
                    : [playerNickname.trim().slice(0, 16) || "主机"]),
                  ...[...lanChannelIdentityRef.current.values()].map(
                    (item) => item.nickname,
                  ),
                ],
              ),
              usedIds = new Set([
                ...(dedicatedServerHostRef.current
                  ? []
                  : [playerIdRef.current]),
                ...[...lanChannelIdentityRef.current.values()].map(
                  (item) => item.id,
                ),
              ]);
            if (usedIds.has(identity.id))
              identity = { ...identity, id: createId() };
            if (usedNames.has(identity.nickname)) {
              let suffix = 2;
              while (usedNames.has(`${identity.nickname}#${suffix}`)) suffix++;
              identity = { ...identity, nickname: `${identity.nickname}#${suffix}` };
            }
          }
          lanChannelIdentityRef.current.set(channel, identity);
          updateActiveServerPlayers();
          recordServerLog(
            "player",
            `${identity.nickname}进入服务器并选择${identity.team === "pku" ? "北大" : "清华"}`,
          );
          if (host) {
            const allowed = chatMessagesRef.current.filter(
              (message) =>
                message.channel === "system" ||
                message.channel === "all" ||
                message.senderTeam === identity.team,
            );
            sendToChannel(channel, { type: "chat_history", messages: allowed });
            relayChatMessage({
              id: createId(),
              senderId: "system",
              senderName: "系统",
              senderTeam: identity.team,
              channel: "system",
              text: `${identity.nickname}加入了战局`,
              sentAt: Date.now(),
            });
          }
          return;
        }
        if (payload.type === "chat_send" && host) {
          const identity = lanChannelIdentityRef.current.get(channel);
          if (!identity) return;
          const text = payload.text
            .replace(/[\u0000-\u001f\u007f]/g, " ")
            .trim()
            .slice(0, 200);
          if (!text) return;
          relayChatMessage({
            id: createId(),
            senderId: identity.id,
            senderName: identity.nickname,
            senderTeam: identity.team,
            channel: payload.channel,
            text,
            sentAt: Date.now(),
          });
          return;
        }
        if (payload.type === "chat_message") {
          appendChatMessage(payload.message);
          return;
        }
        if (payload.type === "chat_history") {
          setChatMessages(payload.messages.slice(-100));
          return;
        }
        if (payload.type === "decision_vote_request" && host) {
          const identity = lanChannelIdentityRef.current.get(channel);
          if (!identity) return;
          startDecisionVote(
            payload.decisionId,
            identity.team,
            identity.id,
          );
          return;
        }
        if (payload.type === "decision_vote_cast" && host) {
          const vote = decisionVoteRef.current;
          if (!vote || vote.id !== payload.voteId) return;
          const identity = lanChannelIdentityRef.current.get(channel);
          if (!identity || identity.team !== vote.team) return;
          vote.votes[identity.id] = payload.approve;
          setDecisionVote({ ...vote, votes: { ...vote.votes } });
          broadcastEnvelope({ type: "decision_vote_state", vote });
          finalizeDecisionVoteIfComplete(vote);
          return;
        }
        if (payload.type === "decision_vote_state") {
          decisionVoteRef.current = payload.vote;
          setDecisionVote(payload.vote);
          return;
        }
        if (payload.type === "client_commands" && host) {
          const identity = lanChannelIdentityRef.current.get(channel);
          if (!identity) return;
          const lastRevision =
            networkReceivedRevisionRef.current.get(channel) ?? -1;
          if (payload.revision <= lastRevision) return;
          networkReceivedRevisionRef.current.set(channel, payload.revision);
          const allowedTeam = identity.team,
            commandPayload = structuredClone(payload);
          enqueueHostOperation(() => {
          const game = gameRef.current;
          for (const command of commandPayload.units.slice(0, 3_500)) {
            const unit = game.units.find((candidate) => candidate.id === command.id);
            if (
              !unit ||
              unit.team !== allowedTeam ||
              command.team !== allowedTeam ||
              unit.retreating
            )
              continue;
            if (
              !Number.isFinite(command.tx) ||
              !Number.isFinite(command.tz) ||
              Math.abs(command.tx) > 70 ||
              Math.abs(command.tz) > 70
            )
              continue;
            const target =
              command.targetSiteId == null
                ? undefined
                : game.sites.find(
                    (site) =>
                      site.id === command.targetSiteId &&
                      !site.destroyed &&
                      (site.team === allowedTeam || game.campaign.warUnlocked),
                  );
            unit.targetSiteId = target?.id;
            unit.tx = command.tx;
            unit.tz = command.tz;
            unit.path = undefined;
            unit.pathIndex = undefined;
          }
          let sitesChanged = false;
          for (const command of commandPayload.sites.slice(0, 300)) {
            const site = game.sites.find((candidate) => candidate.id === command.id);
            if (!site || site.destroyed) continue;
            if (site.team === allowedTeam) {
              if (
                (["defend", "guard", "standby"] as string[]).includes(
                  command.stance,
                )
              )
                site.stance = command.stance;
              if (Number.isFinite(command.dispatchRatio))
                site.dispatchRatio = THREE.MathUtils.clamp(
                  command.dispatchRatio,
                  0.1,
                  1,
                );
              site.orderTarget =
                command.orderTarget == null ||
                !game.sites.some(
                  (target) =>
                    target.id === command.orderTarget && !target.destroyed,
                )
                  ? undefined
                  : command.orderTarget;
              site.orderPath = undefined;
              if (command.displayName?.trim())
                site.displayName = command.displayName.trim().slice(0, 24);
              sitesChanged = true;
            }
            site.plannedOrderTargets ??= {};
            site.plannedOrderPaths ??= {};
            site.plannedOrderTargets[allowedTeam] =
              command.plannedOrderTarget == null ||
              !game.campaign.warUnlocked ||
              !game.sites.some(
                (target) =>
                  target.id === command.plannedOrderTarget && !target.destroyed,
              )
                ? undefined
                : command.plannedOrderTarget;
            site.plannedOrderPaths[allowedTeam] = undefined;
            sitesChanged = true;
          }
          if (sitesChanged) sceneApi.current?.sync();
          });
          return;
        }
        if (payload.type === "client_action" && host) {
          const identity = lanChannelIdentityRef.current.get(channel);
          if (!identity) return;
          const now = Date.now(),
            recent = (clientActionRateRef.current.get(channel) ?? []).filter(
              (at) => now - at < 1_000,
            );
          if (recent.length >= 12) return;
          recent.push(now);
          clientActionRateRef.current.set(channel, recent);
          const team = identity.team,
            action = structuredClone(payload.action);
          enqueueHostOperation(() => {
          if (action.kind === "decision_cancel")
            cancelDecision(team, { id: action.id, startedAt: action.startedAt, instanceId: action.instanceId });
          if (action.kind === "research")
            beginResearch(action.id, team, true);
          if (action.kind === "production_start")
            beginProduction(action.id, team, true);
          if (action.kind === "production_stop")
            stopProduction(action.id, team);
          if (action.kind === "mobilize")
            sceneApi.current?.mobilizeAll(team, action.stance);
          if (
            action.kind === "build_camp" &&
            Number.isFinite(action.x) &&
            Number.isFinite(action.z) &&
            Math.abs(action.x) <= 70 &&
            Math.abs(action.z) <= 70
          )
            sceneApi.current?.buildCampAt(action.x, action.z, team);
          });
          return;
        }
        if (
          payload.type === "state_delta" &&
          !host &&
          payload.role === "host"
        ) {
          const epoch=networkReceivedEpochRef.current.get(channel);
          if(payload.networkEpoch!=null && epoch!=null && payload.networkEpoch!==epoch) return;
          const lastRevision =
            networkReceivedRevisionRef.current.get(channel) ?? -1;
          if (payload.revision <= lastRevision) return;
          networkReceivedRevisionRef.current.set(channel, payload.revision);
          const game = gameRef.current,
            identity = lanChannelIdentityRef.current.get(channel),
            allowedTeam = host ? identity?.team : undefined,
            unitsById = new Map(game.units.map((unit) => [unit.id, unit]));
          networkHealthRef.current.state(Date.now(), payload.elapsedHours, payload.pausedForPlayers);
          const applyExistingUnit = (_existing: UnitState, apply: () => void) => apply();
          const legacyUnits = payload.units.filter(
            (unit): unit is UnitNetworkState => !Array.isArray(unit),
          );
          for (const incoming of [...(payload.newUnits ?? []), ...legacyUnits]) {
            if (allowedTeam && incoming.team !== allowedTeam) continue;
            const existing = unitsById.get(incoming.id);
            if (existing)
              applyExistingUnit(existing, () => Object.assign(existing, incoming));
            else {
              const created: UnitState = { ...incoming };
              game.units.push(created);
              unitsById.set(created.id, created);
            }
          }
          for (const compact of payload.units) {
            if (!Array.isArray(compact)) continue;
            const team: Team = compact[1] === 0 ? "pku" : "thu";
            if (allowedTeam && team !== allowedTeam) continue;
            const existing = unitsById.get(compact[0]);
            if (!existing) continue;
            applyExistingUnit(existing, () => applyCompactUnit(existing, compact));
          }
          if (payload.removedUnitIds.length) {
            const removed = new Set(
              payload.removedUnitIds.filter((id) => {
                const unit = unitsById.get(id);
                return !!unit && (!allowedTeam || unit.team === allowedTeam);
              }),
            );
            if (removed.size)
              game.units = game.units.filter((unit) => !removed.has(unit.id));
          }
          let sitesChanged = false;
          let siteStructureChanged = false;
          for (const incoming of payload.sites ?? []) {
            let existing = game.sites.find((site) => site.id === incoming.id);
            if (!existing) {
              if (!host || (allowedTeam && incoming.team === allowedTeam)) {
                game.sites.push(structuredClone(incoming));
                sitesChanged = true;
                siteStructureChanged = true;
              }
              continue;
            }
            if (!host) {
              if (JSON.stringify(existing) !== JSON.stringify(incoming)) {
                siteStructureChanged ||= existing.team !== incoming.team || existing.destroyed !== incoming.destroyed || existing.displayName !== incoming.displayName;
                existing.orderTarget = incoming.orderTarget;
                existing.orderPath = incoming.orderPath;
                existing.plannedOrderTargets = undefined;
                existing.plannedOrderPaths = undefined;
                Object.assign(existing, structuredClone(incoming));
                sitesChanged = true;
              }
              continue;
            }
            if (!allowedTeam) continue;
            const before = JSON.stringify({
              stance: existing.stance,
              orderTarget: existing.orderTarget,
              dispatchRatio: existing.dispatchRatio,
              displayName: existing.displayName,
              plannedTarget: existing.plannedOrderTargets?.[allowedTeam],
            });
            if (existing.team === allowedTeam) {
              existing.stance = incoming.stance;
              existing.orderTarget = incoming.orderTarget;
              existing.orderPath = incoming.orderPath;
              existing.dispatchRatio = incoming.dispatchRatio;
              existing.displayName = incoming.displayName;
            }
            existing.plannedOrderTargets ??= {};
            existing.plannedOrderPaths ??= {};
            existing.plannedOrderTargets[allowedTeam] =
              incoming.plannedOrderTargets?.[allowedTeam];
            existing.plannedOrderPaths[allowedTeam] =
              incoming.plannedOrderPaths?.[allowedTeam];
            const after = JSON.stringify({
              stance: existing.stance,
              orderTarget: existing.orderTarget,
              dispatchRatio: existing.dispatchRatio,
              displayName: existing.displayName,
              plannedTarget: existing.plannedOrderTargets?.[allowedTeam],
            });
            sitesChanged ||= before !== after;
          }
          if (!host) {
            game.timeOfDay = payload.timeOfDay;
            setTimeScale(payload.timeScale);
            game.campaign.elapsedHours = payload.elapsedHours;
            game.resources = payload.resources;
            game.deaths = payload.deaths;
            if (payload.campaign)
              game.campaign = structuredClone(payload.campaign);
            for (const event of networkEventFeedRef.current(game.campaign, lastAutomaticRoomCodeRef.current ?? "lan"))
              pushEvent(event);
          }
          if (sitesChanged) sceneApi.current?.sync(!siteStructureChanged);
          return;
        }
        if (
          payload.type === "state" &&
          !host &&
          payload.role === "host"
        ) {
          const epoch=networkReceivedEpochRef.current.get(channel);
          if(payload.networkEpoch!=null && epoch!=null && (payload.networkEpoch<epoch || (payload.networkEpoch===epoch && payload.revision!=null && payload.revision<(networkReceivedRevisionRef.current.get(channel)??-1)))) return;
          if(payload.networkEpoch!=null) networkReceivedEpochRef.current.set(channel,payload.networkEpoch);
          gameRef.current = payload.game;
          for (const event of networkEventFeedRef.current(payload.game.campaign, lastAutomaticRoomCodeRef.current ?? "lan"))
            pushEvent(event);
          if (payload.revision != null) networkReceivedRevisionRef.current.set(channel,payload.revision);
          networkHealthRef.current.state(Date.now(), payload.game.campaign.elapsedHours, payload.pausedForPlayers);
          guestHasAuthoritativeStateRef.current = true;
          if (lanConnectionTimeoutRef.current != null) {
            window.clearTimeout(lanConnectionTimeoutRef.current);
            lanConnectionTimeoutRef.current = null;
          }
          lanConnectionStageRef.current = null;
          setLanConnectionStage(null);
          setLanStatus("服务器地图同步完成，已进入战局");
          if (!host) {
            setPlayerTeam(lanTeamRef.current);
            playerTeamRef.current = lanTeamRef.current;
          }
          sceneApi.current?.sync();
          setScreen("game");
        }
      } catch {
        setLanStatus("收到的战局数据无效");
      }
    };
  };
  const createAutomaticHostOffer = async (
    roomCode: string,
    request: Extract<AutomaticSignalMessage, { kind: "join" }>,
  ) => {
    if (automaticHostPeersRef.current.has(request.clientId)) return;
    const peer = new RTCPeerConnection(peerConfiguration()),
      channel = peer.createDataChannel("qingbei-campaign");
    watchIceCandidates(peer);
    automaticHostPeersRef.current.set(request.clientId, peer);
    automaticHostChannelsRef.current.set(request.clientId, channel);
    lanPeerRef.current = peer;
    lanPeersRef.current.add(peer);
    bindLanChannel(channel, true);
    let disconnectedAt = 0;
    peer.addEventListener("connectionstatechange", () => {
      if (peer.connectionState === "connected") {
        disconnectedAt = 0;
        setLanStatus("玩家直连成功，正在同步战局");
        return;
      }
      if (peer.connectionState === "disconnected") {
        disconnectedAt = Date.now();
        setLanStatus("玩家网络暂时中断，等待自动恢复…");
        window.setTimeout(() => {
          if (
            peer.connectionState === "disconnected" &&
            Date.now() - disconnectedAt >= 8_000
          )
            setLanStatus(
              (lastConnectionFailureRef.current = connectionFailureText(peer)),
            );
        }, 8_100);
        return;
      }
      if (["failed", "closed"].includes(peer.connectionState))
        automaticHostPeersRef.current.delete(request.clientId);
      if (["failed", "closed"].includes(peer.connectionState))
        automaticHostChannelsRef.current.delete(request.clientId);
      if (peer.connectionState === "failed")
        setLanStatus(
          (lastConnectionFailureRef.current = connectionFailureText(peer)),
        );
    });
    window.setTimeout(() => {
      if (["connected", "closed"].includes(peer.connectionState)) return;
      setLanStatus(
        (lastConnectionFailureRef.current = connectionFailureText(peer)),
      );
      peer.close();
      automaticHostPeersRef.current.delete(request.clientId);
      automaticHostChannelsRef.current.delete(request.clientId);
    }, 60_000);
    await peer.setLocalDescription(await peer.createOffer());
    await waitForIce(peer);
    const operatorCounts = { pku: 0, thu: 0 };
    if (!dedicatedServerHostRef.current)
      operatorCounts[playerTeamRef.current]++;
    for (const identity of lanChannelIdentityRef.current.values())
      operatorCounts[identity.team]++;
    const invite: ServerInvitePayload = {
      kind: "qingbei-server-invite",
      sdp: peer.localDescription!,
      playerCount: operatorCounts.pku + operatorCounts.thu,
      hostTeam: playerTeamRef.current,
      operatorCounts,
      serverId: activeServerIdRef.current,
      iceServers: serverIceServersRef.current,
    };
    await publishAutomaticSignal(roomCode, {
      kind: "offer",
      senderId: signalingSenderIdRef.current,
      clientId: request.clientId,
      invite,
      sentAt: Date.now(),
    });
    setLanStatus(`已向${request.nickname || "新玩家"}发送自动邀请`);
  };
  const startAutomaticHost = async (serverId: string | null = null) => {
    automaticSignalSourceRef.current?.close();
    const storageKey = `qingbei-room-code:${serverId ?? "quick"}`,
      roomCode =
        sessionStorage.getItem(storageKey) || createRoomCode();
    sessionStorage.setItem(storageKey, roomCode);
    automaticHostCodeRef.current = roomCode;
    setLanMode("host");
    setLanOutput(roomCode);
    if (localRelayModeRef.current) {
      localRelayHubRef.current?.close();
      const hub = new LocalRelayHub(
        "host",
        roomCode,
        null,
        (channel, team) => {
          if (team) expectedTeamByChannelRef.current.set(channel, team);
          bindLanChannel(channel, true);
        },
        setLanStatus,
        (command) =>
          executeServerAdminCommand(command).then((output) => {
            const compactOutput = output.replace(/\s+/g, " ").slice(0, 240);
            recordServerLog(
              "command",
              `${command} → ${compactOutput}${output.length > 240 ? "…" : ""}`,
            );
            return output;
          }),
      );
      localRelayHubRef.current = hub;
      hub.connect();
      setLanStatus("本地WebSocket服务器已启动，等待玩家加入");
      return roomCode;
    }
    setLanStatus("自动房间已启动，玩家输入房间码即可加入");
    const source = subscribeAutomaticSignals(roomCode, (message) => {
      if (message.senderId === signalingSenderIdRef.current) return;
      if (message.kind === "join")
        void createAutomaticHostOffer(roomCode, message).catch((error) =>
          setLanStatus(
            error instanceof Error ? error.message : "自动邀请生成失败",
          ),
        );
      if (message.kind === "answer") {
        const peer = automaticHostPeersRef.current.get(message.clientId),
          channel = automaticHostChannelsRef.current.get(message.clientId);
        if (!peer || !channel || peer.remoteDescription) return;
        if (message.team !== "pku" && message.team !== "thu") {
          peer.close();
          return;
        }
        const operatorCounts = { pku: 0, thu: 0 };
        if (!dedicatedServerHostRef.current)
          operatorCounts[playerTeamRef.current]++;
        for (const identity of lanChannelIdentityRef.current.values())
          operatorCounts[identity.team]++;
        if (
          operatorCounts.pku + operatorCounts.thu === 1 &&
          operatorCounts[message.team] === 1
        ) {
          setLanStatus("该玩家必须选择另一阵营，已拒绝不合法的加入请求");
          peer.close();
          automaticHostPeersRef.current.delete(message.clientId);
          automaticHostChannelsRef.current.delete(message.clientId);
          return;
        }
        expectedTeamByChannelRef.current.set(channel, message.team);
        void peer
          .setRemoteDescription(message.sdp)
          .then(() => {
            setLanStatus("自动握手完成，正在建立直连");
            void publishAutomaticSignal(
              roomCode,
              {
                kind: "accepted",
                senderId: signalingSenderIdRef.current,
                clientId: message.clientId,
                sentAt: Date.now(),
              },
            ).catch(() => {
              // The WebRTC answer is already accepted; this is status-only.
            });
          })
          .catch(() => setLanStatus("自动回应无效，请让玩家重新加入"));
      }
    });
    source.onerror = () =>
      setLanStatus("自动信令暂时不可用，可使用兼容模式邀请码");
    automaticSignalSourceRef.current = source;
    return roomCode;
  };
  const requestAutomaticJoin = async (rawCode: string) => {
    const normalized = normalizeRoomCode(rawCode);
    if (normalized.length < 8) throw new Error("房间码长度不足");
    const roomCode = `${normalized.slice(0, 5)}-${normalized.slice(5)}`,
      clientId = createId();
    if (localRelayModeRef.current) {
      const status = await localRoomStatus(roomCode),
        pluginTeam = new URLSearchParams(location.search).get("pluginTeam"),
        forcedTeam: Team | null =
          pluginTeam === "pku" || pluginTeam === "thu"
            ? pluginTeam
            : status.players === 1
              ? status.counts.pku === 1
                ? "thu"
                : "pku"
              : null;
      if (!status.online) throw new Error("本地服务器房间尚未启动");
      lastAutomaticRoomCodeRef.current = roomCode;
      setTeamSelection({
        mode: "guest",
        invite: {
          kind: "qingbei-server-invite",
          sdp: { type: "offer", sdp: "" },
          playerCount: status.players,
          hostTeam: "pku",
          operatorCounts: status.counts,
          transport: "websocket",
          roomCode,
        },
        counts: status.counts,
        forcedTeam,
      });
      setLanStatus("已找到本地服务器，请选择阵营");
      return;
    }
    automaticSignalSourceRef.current?.close();
    automaticJoinRef.current = { roomCode, clientId };
    lastAutomaticRoomCodeRef.current = roomCode;
    setLanMode("join");
    setLanStatus("正在查找房间并自动握手…");
    const publishJoin = () =>
        publishAutomaticSignal(roomCode, {
          kind: "join",
          senderId: signalingSenderIdRef.current,
          clientId,
          nickname: playerNickname.trim().slice(0, 16) || "未命名玩家",
          sentAt: Date.now(),
        }).catch(() => setLanStatus("无法连接自动信令服务")),
      source = subscribeAutomaticSignals(roomCode, (message) => {
        if (
          message.kind === "accepted" &&
          message.clientId === clientId &&
          message.senderId !== signalingSenderIdRef.current
        ) {
          setLanStatus("主机已接纳，正在建立局域网直连…");
          return;
        }
        if (
          message.kind !== "offer" ||
          message.clientId !== clientId ||
          message.senderId === signalingSenderIdRef.current
        )
          return;
        const invite = message.invite as ServerInvitePayload,
          counts = invite.operatorCounts ?? {
            pku: invite.hostTeam === "pku" ? invite.playerCount : 0,
            thu: invite.hostTeam === "thu" ? invite.playerCount : 0,
          },
          forcedTeam =
            counts.pku + counts.thu === 1
              ? counts.pku === 1
                ? "thu"
                : "pku"
              : null;
        const preferred = automaticPreferredTeamRef.current;
        if (preferred && (!forcedTeam || forcedTeam === preferred)) {
          lanConnectionStageRef.current = "connecting";
          setLanConnectionStage("connecting");
          setLanStatus("已重新找到主机，正在自动连接…");
          void connectToLanHost(invite, preferred);
        } else {
          setTeamSelection({ mode: "guest", invite, counts, forcedTeam });
          setLanStatus("已找到房间，请选择阵营");
        }
      });
    source.onopen = () => void publishJoin();
    source.onerror = () => setLanStatus("房间服务连接中断，正在重试");
    automaticSignalSourceRef.current = source;
    window.setTimeout(() => void publishJoin(), 700);
  };
  const createManualLanHost = async () => {
    const peer = new RTCPeerConnection(peerConfiguration()),
      channel = peer.createDataChannel("qingbei-campaign");
    watchIceCandidates(peer);
    lanPeerRef.current = peer;
    lanPeersRef.current.add(peer);
    bindLanChannel(channel, true);
    await peer.setLocalDescription(await peer.createOffer());
    await waitForIce(peer);
    const operatorCounts = { pku: 0, thu: 0 };
    if (!dedicatedServerHostRef.current)
      operatorCounts[playerTeamRef.current]++;
    for (const identity of lanChannelIdentityRef.current.values())
      operatorCounts[identity.team]++;
    const playerCount = operatorCounts.pku + operatorCounts.thu;
    setLanOutput(
      JSON.stringify({
        kind: "qingbei-server-invite",
        sdp: peer.localDescription,
        playerCount,
        hostTeam: playerTeamRef.current,
        operatorCounts,
        serverId: activeServerIdRef.current,
        iceServers: serverIceServersRef.current,
      }),
    );
    setLanStatus("邀请已生成：复制下方代码给一名玩家");
  };
  const createLanHost = async () => {
    await startAutomaticHost(activeServerIdRef.current);
  };
  const joinLanHost = async () => {
    try {
      const input = lanInput.trim();
      if (!input.startsWith("{")) {
        await requestAutomaticJoin(input);
        return;
      }
      automaticJoinRef.current = null;
      const parsed = JSON.parse(input) as
          | RTCSessionDescriptionInit
          | ServerInvitePayload,
        invite: ServerInvitePayload =
          "kind" in parsed
            ? parsed
            : {
                kind: "qingbei-server-invite",
                sdp: parsed as RTCSessionDescriptionInit,
                playerCount: 0,
                hostTeam: "pku",
                operatorCounts: { pku: 0, thu: 0 },
              },
        counts = invite.operatorCounts ?? {
          pku: invite.hostTeam === "pku" ? invite.playerCount : 0,
          thu: invite.hostTeam === "thu" ? invite.playerCount : 0,
        },
        forcedTeam =
          counts.pku + counts.thu === 1
            ? counts.pku === 1
              ? "thu"
              : "pku"
            : null;
      setTeamSelection({
        mode: "guest",
        invite,
        counts,
        forcedTeam,
      });
    } catch (error) {
      setLanStatus(
        error instanceof Error ? error.message : "房间码或兼容邀请码无效",
      );
    }
  };
  const joinCurrentLocalServer = async () => {
    setLanStatus("正在等待服务器战局启动…");
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        const status = await localRoomStatus();
        if (!status.roomCode) throw new Error("服务器正在初始化战局");
        setLanInput(status.roomCode);
        await requestAutomaticJoin(status.roomCode);
        return;
      } catch (error) {
        if (attempt === 119) {
          const info = await localServerInfo().catch(() => null),
            host = info?.battleHost,
            detail = host
              ? `${host.status}${host.error ? `：${host.error}` : ""}`
              : error instanceof Error
                ? error.message
                : "无法读取本地服务器战局";
          setLanStatus(`共享内核战局未就绪：${detail}；请让管理员在终端输入 status`);
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
    }
  };
  useEffect(() => {
    if (
      !localRelayModeRef.current ||
      localServerManagerRef.current ||
      autoLocalJoinStartedRef.current
    )
      return;
    autoLocalJoinStartedRef.current = true;
    void joinCurrentLocalServer();
  }, []);
  const connectToLanHost = async (
    invite: ServerInvitePayload,
    team: Team,
  ) => {
    try {
      lastConnectionFailureRef.current = null;
      guestHasAuthoritativeStateRef.current = false;
      if (invite.transport === "websocket" && invite.roomCode) {
        setLanTeam(team);
        lanTeamRef.current = team;
        lanConnectionStageRef.current = "connecting";
        setLanConnectionStage("connecting");
        localRelayHubRef.current?.close();
        const hub = new LocalRelayHub(
          "guest",
          invite.roomCode,
          team,
          (channel) => bindLanChannel(channel, false),
          setLanStatus,
          undefined,
          new URLSearchParams(location.search).get("pluginToken") ?? undefined,
        );
        localRelayHubRef.current = hub;
        hub.connect();
        setLanStatus("正在通过本地WebSocket服务器连接…");
        return;
      }
      if (
        lanPeerRef.current &&
        lanPeerRef.current.connectionState !== "connected"
      ) {
        lanConnectionStageRef.current = null;
        lanPeerRef.current.close();
      }
      lanConnectionStageRef.current = "connecting";
      setLanConnectionStage("connecting");
      const peer = new RTCPeerConnection(
        peerConfiguration(invite.iceServers ?? DEFAULT_ICE_SERVERS),
      );
      watchIceCandidates(peer);
      setLanTeam(team);
      lanTeamRef.current = team;
      lanPeerRef.current = peer;
      lanPeersRef.current.add(peer);
      peer.ondatachannel = (event) => bindLanChannel(event.channel, false);
      let disconnectedAt = 0;
      peer.addEventListener("connectionstatechange", () => {
        if (peer.connectionState === "connected") {
          disconnectedAt = 0;
          setLanStatus("直连成功，正在同步主机地图…");
          return;
        }
        if (peer.connectionState === "disconnected") {
          disconnectedAt = Date.now();
          setLanStatus("网络短暂中断，等待自动恢复…");
          window.setTimeout(() => {
            if (
              peer.connectionState !== "disconnected" ||
              Date.now() - disconnectedAt < 8_000
            )
              return;
            lanConnectionStageRef.current = "failed";
            setLanConnectionStage("failed");
            setLanStatus(
              (lastConnectionFailureRef.current = connectionFailureText(peer)),
            );
          }, 8_100);
          return;
        }
        if (peer.connectionState === "failed") {
          if (lanConnectionTimeoutRef.current != null) {
            window.clearTimeout(lanConnectionTimeoutRef.current);
            lanConnectionTimeoutRef.current = null;
          }
          lanConnectionStageRef.current = "failed";
          setLanConnectionStage("failed");
          setLanStatus(
            (lastConnectionFailureRef.current = connectionFailureText(peer)),
          );
        }
      });
      await peer.setRemoteDescription(invite.sdp);
      await peer.setLocalDescription(await peer.createAnswer());
      await waitForIce(peer);
      const automaticJoin = automaticJoinRef.current;
      if (automaticJoin) {
        await publishAutomaticSignal(automaticJoin.roomCode, {
          kind: "answer",
          senderId: signalingSenderIdRef.current,
          clientId: automaticJoin.clientId,
          sdp: peer.localDescription!,
          team,
          sentAt: Date.now(),
        });
        setLanOutput("");
        setLanStatus("阵营已确认，正在自动连接服务器…");
        if (lanConnectionTimeoutRef.current != null)
          window.clearTimeout(lanConnectionTimeoutRef.current);
        lanConnectionTimeoutRef.current = window.setTimeout(() => {
          if (peer.connectionState === "connected") return;
          peer.close();
          lanConnectionStageRef.current = "failed";
          setLanConnectionStage("failed");
          setLanStatus(
            (lastConnectionFailureRef.current = connectionFailureText(peer)),
          );
        }, 45_000);
      } else {
        setLanOutput(JSON.stringify(peer.localDescription));
        setLanStatus("兼容模式回应已生成，请发回主机");
      }
    } catch (error) {
      lanConnectionStageRef.current = "failed";
      setLanConnectionStage("failed");
      setLanStatus(
        error instanceof Error ? error.message : "自动连接建立失败",
      );
    }
  };
  const confirmTeamSelection = (team: Team) => {
    const selection = teamSelection;
    if (!selection) return;
    if (selection.forcedTeam && selection.forcedTeam !== team) return;
    setTeamSelection(null);
    if (selection.mode === "host") {
      const hostIdentity = {
          id: playerIdRef.current,
          nickname: playerNickname.trim().slice(0, 16) || "主机",
          team,
          host: true,
          local: true,
        },
        server = {
          ...selection.server,
          hostTeam: team,
          updatedAt: Date.now(),
          players: [hostIdentity],
        };
      setServerSaves(upsertServerSave(server));
      loadGame(server.map, team, server.id);
      pendingServerIdRef.current = null;
      window.setTimeout(() => void startAutomaticHost(server.id), 0);
    } else {
      automaticPreferredTeamRef.current = team;
      lanConnectionStageRef.current = "connecting";
      setLanConnectionStage("connecting");
      setLanStatus("正在确认阵营并连接服务器…");
      void connectToLanHost(selection.invite, team);
    }
  };
  const cancelLanConnection = () => {
    if (lanConnectionTimeoutRef.current != null) {
      window.clearTimeout(lanConnectionTimeoutRef.current);
      lanConnectionTimeoutRef.current = null;
    }
    lanConnectionStageRef.current = null;
    lanPeerRef.current?.close();
    automaticSignalSourceRef.current?.close();
    automaticSignalSourceRef.current = null;
    localRelayHubRef.current?.close();
    localRelayHubRef.current = null;
    automaticJoinRef.current = null;
    automaticPreferredTeamRef.current = null;
    setLanConnectionStage(null);
    setLanStatus("已取消加入服务器");
  };
  const retryLanConnection = () => {
    const roomCode = lastAutomaticRoomCodeRef.current;
    if (!roomCode) return;
    lanConnectionStageRef.current = "connecting";
    setLanConnectionStage("connecting");
    setLanStatus("正在重新联系服务器…");
    void requestAutomaticJoin(roomCode);
  };
  const buildServerSummary = (serverId: string): ServerBattleSummary => {
    const server = readServerSaves().find((record) => record.id === serverId),
      game = gameRef.current,
      units = { pku: 0, thu: 0 },
      sites = { pku: 0, thu: 0 };
    for (const unit of game.units) units[unit.team] += unit.strength;
    for (const site of game.sites)
      if (!site.destroyed) sites[site.team]++;
    const date = new Date(
        new Date(game.campaign.startDateISO).getTime() +
          game.campaign.elapsedHours * 3_600_000,
      ),
      players =
        activeServerIdRef.current === serverId
          ? [
              ...(dedicatedServerHostRef.current
                ? []
                : [
                    {
                      id: playerIdRef.current,
                      nickname:
                        playerNickname.trim().slice(0, 16) || "主机",
                      team: playerTeamRef.current,
                      host: true,
                      local: true,
                    },
                  ]),
              ...[...lanChannelIdentityRef.current.values()].map((identity) => ({
                ...identity,
                host: false,
                local: false,
              })),
            ]
          : server?.players ?? [];
    return {
      online: activeServerIdRef.current === serverId,
      clock: date.toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
      players,
      units,
      sites,
      deaths: { ...game.deaths },
      resources: { ...game.resources },
      outcome: game.campaign.outcome
        ? `${game.campaign.outcome.winner === "pku" ? "北大" : game.campaign.thuFactionName}胜利：${game.campaign.outcome.reason}`
        : undefined,
      logs: server?.logs ?? [],
      inviteCode: activeServerIdRef.current === serverId ? lanOutput : undefined,
      connectionStatus:
        activeServerIdRef.current === serverId
          ? lanStatus
          : pendingServerIdRef.current === serverId
            ? "等待游戏窗口选择阵营"
            : "服务器离线",
    };
  };
  const publishServerAdminState = (serverId: string) => {
    adminChannelRef.current?.postMessage({
      type: "state",
      serverId,
      summary: buildServerSummary(serverId),
    } satisfies ServerAdminMessage);
  };
  const executeServerAdminCommand = async (raw: string) => {
    const normalized = raw.trim(),
      withoutApi = normalized.startsWith("api ")
        ? normalized.slice(4).trim()
        : normalized,
      splitAt = withoutApi.indexOf(" "),
      action = (splitAt < 0 ? withoutApi : withoutApi.slice(0, splitAt)).toLowerCase(),
      rest = splitAt < 0 ? "" : withoutApi.slice(splitAt + 1).trim(),
      args = rest.split(/\s+/).filter(Boolean);
    if (action === "help")
      return "API: status | players | ai <pku|thu> | config | set <name|maxplayers|sameteam|turn-url|turn-user|turn-credential> <值> | saves | maps | map <savedAt> | logs [数量] | new [名称] | resume [名称/ID] | save | timescale <0.5-64> | resource <pku|thu> <数量> | mobilize <pku|thu> <defend|guard|standby> | say <文本>";
    if (action === "status") {
      const summary = buildServerSummary(activeServerIdRef.current ?? "");
      return JSON.stringify({
        online: summary.online,
        clock: summary.clock,
        outcome: summary.outcome ?? "进行中",
        players: summary.players.map((player) => ({
          nickname: player.nickname,
          team: player.team,
        })),
        units: summary.units,
        sites: summary.sites,
        deaths: summary.deaths,
        resources: summary.resources,
      });
    }
    if (action === "players")
      return buildServerSummary(activeServerIdRef.current ?? "").players
        .map((player) => `${player.nickname}:${player.team}${player.host ? ":host" : ""}`)
        .join(", ");
    if (action === "saves") {
      const records = readServerSaves().sort(
        (first, second) => second.updatedAt - first.updatedAt,
      );
      return records.length
        ? records
            .map(
              (record) =>
                `${record.id.slice(0, 8)} | ${record.name} | ${new Date(record.updatedAt).toLocaleString("zh-CN")} | ${record.map.units.length}人`,
            )
            .join("\n")
        : "没有服务器存档";
    }
    if (action === "maps") {
      const maps = readSaves();
      return maps.length
        ? maps
            .map(
              (map) =>
                `${map.savedAt} | ${map.name} | ${map.units.length}人`,
            )
            .join("\n")
        : "没有可导入的玩家地图存档";
    }
    if (action === "new") {
      saveUnfinishedGame(true);
      const server = createServer(rest || "清北本地服务器", 8);
      launchServer(server);
      recordServerLog("command", "终端创建了全新战局");
      return `已创建并启动全新战局：${server.name}`;
    }
    if (action === "resume") {
      const records = readServerSaves().sort(
          (first, second) => second.updatedAt - first.updatedAt,
        ),
        previous =
          (rest
            ? records.find(
                (record) =>
                  record.id.startsWith(rest) ||
                  record.name.toLowerCase() === rest.toLowerCase(),
              )
            : records.find(
                (record) => record.id !== activeServerIdRef.current,
              )) ?? records[0];
      if (!previous) throw new Error("没有可以恢复的服务器战局");
      launchServer(previous);
      recordServerLog("command", `终端恢复战局：${previous.name}`);
      return `已恢复并启动：${previous.name}`;
    }
    if (!activeServerIdRef.current)
      throw new Error(
        pendingServerIdRef.current
          ? "请回到游戏窗口完成阵营选择；完成后房间码会自动生成"
          : "服务器尚未启动，请先点击“启动服务器”并在游戏窗口选择阵营",
      );
    if (action === "ai") {
      const team = (args[0] || "thu") as Team;
      if (!(team === "pku" || team === "thu"))
        throw new Error("用法：ai <pku|thu>");
      const game = gameRef.current,
        production = game.sites
          .filter(
            (site) =>
              site.team === team &&
              !site.destroyed &&
              (site.type === "dorm" || site.type === "dining"),
          )
          .map((site) => ({
            site: site.displayName ?? site.name,
            type: site.type,
            idle: game.units.filter(
              (unit) =>
                unit.team === team &&
                unit.siteId === site.id &&
                unit.targetSiteId == null,
            ).length,
            threatened: game.units.filter(
              (unit) =>
                unit.team !== team &&
                (unit.targetSiteId === site.id ||
                  Math.hypot(unit.x - site.x, unit.z - site.z) < 7),
            ).length,
          }))
          .sort((a, b) => b.idle - a.idle),
        routes = game.sites
          .filter(
            (site) =>
              site.team === team &&
              !site.destroyed &&
              site.orderTarget != null,
          )
          .map((site) => {
            const target = game.sites[site.orderTarget!];
            return {
              source: site.displayName ?? site.name,
              target: target?.displayName ?? target?.name ?? "失效目标",
              targetType: target?.type,
              relation: target?.team === team ? "调动" : "进攻",
              committed: game.units.filter(
                (unit) =>
                  unit.team === team && unit.targetSiteId === target?.id,
              ).length,
            };
          });
      return JSON.stringify({
        team,
        difficulty: game.campaign.ai.difficulty,
        personality: game.campaign.ai.personality[team],
        intent: game.campaign.ai.intent?.[team] ?? "passive",
        population: game.units.filter((unit) => unit.team === team).length,
        production: production.slice(0, 20),
        routes,
      });
    }
    const activeServer = readServerSaves().find(
      (record) => record.id === activeServerIdRef.current,
    );
    if (action === "config") {
      if (!activeServer) throw new Error("当前服务器配置不存在");
      return JSON.stringify({
        id: activeServer.id,
        name: activeServer.name,
        maxPlayers: activeServer.maxPlayers,
        allowSameTeam: activeServer.allowSameTeam,
        map: activeServer.map.name,
        turnUrls: activeServer.turnServer?.urls ?? [],
        turnUsername: activeServer.turnServer?.username ?? "",
        turnCredentialConfigured: Boolean(activeServer.turnServer?.credential),
      });
    }
    if (action === "logs") {
      if (!activeServer) throw new Error("当前服务器记录不存在");
      const count = Math.min(200, Math.max(1, Number(args[0]) || 30));
      return (activeServer.logs ?? [])
        .slice(-count)
        .map(
          (entry) =>
            `${new Date(entry.at).toLocaleTimeString("zh-CN")} [${entry.category}] ${entry.text}`,
        )
        .join("\n") || "暂无服务器记录";
    }
    if (action === "set") {
      if (!activeServer) throw new Error("当前服务器配置不存在");
      const key = args[0]?.toLowerCase(),
        value = rest.slice(args[0]?.length ?? 0).trim();
      let next = { ...activeServer };
      if (key === "name")
        next.name = value.slice(0, 24) || activeServer.name;
      else if (key === "maxplayers") {
        const maximum = Number(value);
        if (!Number.isInteger(maximum) || maximum < 2 || maximum > 8)
          throw new Error("最大玩家数必须是2—8的整数");
        next.maxPlayers = maximum;
      } else if (key === "sameteam") {
        if (!["on", "off"].includes(value.toLowerCase()))
          throw new Error("用法：set sameteam <on|off>");
        next.allowSameTeam = value.toLowerCase() === "on";
      } else if (["turn-url", "turn-user", "turn-credential"].includes(key)) {
        const turn = {
          urls: activeServer.turnServer?.urls ?? [],
          username: activeServer.turnServer?.username ?? "",
          credential: activeServer.turnServer?.credential ?? "",
        };
        if (key === "turn-url")
          turn.urls = value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
        if (key === "turn-user") turn.username = value;
        if (key === "turn-credential") turn.credential = value;
        next.turnServer = turn;
      } else throw new Error("未知配置项");
      next.updatedAt = Date.now();
      setServerSaves(upsertServerSave(next));
      return `配置已更新：${key}`;
    }
    if (action === "map") {
      if (!activeServer) throw new Error("当前服务器配置不存在");
      const savedAt = Number(args[0]),
        selected = readSaves().find((save) => save.savedAt === savedAt);
      if (!selected) throw new Error("没有找到地图；先使用 maps 查看编号");
      const next = {
        ...activeServer,
        map: structuredClone(selected),
        updatedAt: Date.now(),
      };
      setServerSaves(upsertServerSave(next));
      launchServer(next);
      return `已切换地图：${selected.name}`;
    }
    if (action === "invite") {
      const roomCode = await startAutomaticHost(activeServerIdRef.current);
      return `自动房间码：${roomCode}`;
    }
    if (action === "manual-invite") {
      await createManualLanHost();
      return "已生成兼容模式邀请码";
    }
    if (action === "timescale") {
      const value = Math.min(MAX_TIME_SCALE, Math.max(0.5, Number(args[0])));
      if (!Number.isFinite(value)) throw new Error("倍率必须是数字");
      setTimeScale(value);
      return `时间倍率已设为 ${value}×${value > 16 ? "；超过16×可能造成卡顿" : ""}`;
    }
    if (action === "resource") {
      const team = args[0] as Team,
        amount = Number(args[1]);
      if (!(["pku", "thu"] as string[]).includes(team) || !Number.isFinite(amount))
        throw new Error("用法：resource <pku|thu> <数量>");
      gameRef.current.resources[team] += amount;
      return `${team}资源变更 ${amount >= 0 ? "+" : ""}${amount}`;
    }
    if (action === "mobilize") {
      const team = args[0] as Team,
        stance = args[1] as Stance;
      if (!(["pku", "thu"] as string[]).includes(team) || !(["defend", "guard", "standby"] as string[]).includes(stance))
        throw new Error("用法：mobilize <pku|thu> <defend|guard|standby>");
      sceneApi.current?.mobilizeAll(team, stance);
      return `${team}已执行总动员：${stance}`;
    }
    if (action === "say") {
      relayChatMessage({
        id: createId(),
        senderId: "server-console",
        senderName: "服务器",
        senderTeam: playerTeamRef.current,
        channel: "system",
        text: rest.slice(0, 200),
        sentAt: Date.now(),
      });
      return "系统消息已广播";
    }
    if (action === "save") {
      saveUnfinishedGame(true);
      return "服务器战局已保存";
    }
    if (action === "accept") {
      await lanPeerRef.current?.setRemoteDescription(JSON.parse(rest));
      setLanStatus("正在接纳玩家；连接成功后会出现在玩家列表");
      return "玩家回应已接纳";
    }
    throw new Error(`未知指令：${action || "(空)"}`);
  };
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(SERVER_ADMIN_CHANNEL);
    adminChannelRef.current = channel;
    channel.onmessage = (event: MessageEvent<ServerAdminMessage>) => {
      const message = event.data;
      if (message.type === "request-state")
        publishServerAdminState(message.serverId);
      if (message.type === "launch") {
        const server = readServerSaves().find(
          (record) => record.id === message.serverId,
        );
        if (server) {
          launchServer(server);
          recordServerLog("system", "服务器由独立控制台启动");
          window.setTimeout(() => publishServerAdminState(server.id), 500);
        }
      }
      if (message.type === "stop") stopServer(message.serverId);
      if (message.type === "command")
        void executeServerAdminCommand(message.command)
          .then((output) => {
            recordServerLog("command", `${message.command} → ${output}`);
            channel.postMessage({
              type: "command-result",
              serverId: message.serverId,
              requestId: message.requestId,
              ok: true,
              output,
            } satisfies ServerAdminMessage);
            publishServerAdminState(message.serverId);
          })
          .catch((error) =>
            channel.postMessage({
              type: "command-result",
              serverId: message.serverId,
              requestId: message.requestId,
              ok: false,
              output: error instanceof Error ? error.message : "指令执行失败",
            } satisfies ServerAdminMessage),
          );
    };
    return () => {
      channel.close();
      adminChannelRef.current = null;
    };
  }, [lanOutput, lanStatus, playerNickname]);
  useEffect(
    () => () => {
      automaticSignalSourceRef.current?.close();
      automaticSignalSourceRef.current = null;
      localRelayHubRef.current?.close();
      localRelayHubRef.current = null;
      automaticHostPeersRef.current.forEach((peer) => peer.close());
      automaticHostPeersRef.current.clear();
      automaticHostChannelsRef.current.clear();
    },
    [],
  );
  useEffect(() => {
    const syncNetwork = () => {
      if (lanHostRef.current && hostOperationQueueRef.current.length)
        flushHostOperations();
      const openChannels = [...lanChannelsRef.current].filter(
        (channel) => channel.readyState === "open",
      );
      if (!openChannels.length) return;
      const now = performance.now(),
        role = lanHostRef.current ? "host" : "guest",
        maximumBufferedAmount = Math.max(
          0,
          ...openChannels.map((channel) => channel.bufferedAmount),
        ),
        signatureOf = (unit: UnitState) =>
          [
            unit.team,
            unit.x.toFixed(2),
            unit.z.toFixed(2),
            unit.tx.toFixed(2),
            unit.tz.toFixed(2),
            unit.hp.toFixed(1),
            unit.supply.toFixed(1),
            unit.morale?.toFixed(1) ?? "",
            unit.siteId,
            unit.targetSiteId ?? "",
            unit.retreating ? 1 : 0,
            unit.skin ?? "",
          ].join("/"),
        siteSignatureOf = (site: GameData["sites"][number]) =>
          JSON.stringify({
            team: site.team,
            stance: site.stance,
            orderTarget: site.orderTarget,
            plannedOrderTargets: site.plannedOrderTargets,
            dispatchRatio: site.dispatchRatio,
            displayName: site.displayName,
            destroyed: site.destroyed,
            temporary: site.temporary,
          });
      if (role === "host") {
        if (maximumBufferedAmount > 320_000) return;
        const synchronizationInterval = Math.max(
          50,
          200 / Math.max(1, timeScaleRef.current),
        );
        if (now - networkLastDeltaAtRef.current < synchronizationInterval)
          return;
        networkLastDeltaAtRef.current = now;
      }
      if (now - networkLastPingAtRef.current >= 1_000) {
        networkLastPingAtRef.current = now;
        for (const [id, startedAt] of networkPendingPingsRef.current)
          if (now - startedAt > 10_000)
            networkPendingPingsRef.current.delete(id);
        openChannels.forEach((channel) => {
          const id = createId();
          networkPendingPingsRef.current.set(id, performance.now());
          sendToChannel(channel, { type: "ping", id, sentAt: Date.now() });
        });
      }
      if (role === "guest") {
        // Guest timers only ping. Player controls send commands immediately.
        // A render/state correction is never a command, even if values differ.
        return;
      }
      if (
        role === "host" &&
        now - networkLastFullAtRef.current >= 300_000
      ) {
        networkLastFullAtRef.current = now;
        const envelope: MultiplayerEnvelope = {
          type: "state",
          game: snapshotCurrentGame("联机同步"),
          role,
        };
        openChannels.forEach((channel) => sendToChannel(channel, envelope));
        networkUnitSignaturesRef.current = new Map(
          gameRef.current.units.map((unit) => [unit.id, signatureOf(unit)]),
        );
        networkSiteSignaturesRef.current = new Map(
          gameRef.current.sites.map((site) => [site.id, siteSignatureOf(site)]),
        );
        return;
      }
      const game = gameRef.current,
        unitBatchLimit =
          maximumBufferedAmount > 180_000
            ? 180
            : maximumBufferedAmount > 80_000
              ? 320
              : 560,
        currentIds = new Set<number>(game.units.map((unit) => unit.id)),
        units: CompactUnitNetworkState[] = [],
        newUnits: UnitNetworkState[] = [];
      const unitCount = game.units.length,
        startIndex = unitCount
          ? networkUnitCursorRef.current % unitCount
          : 0;
      let inspectedUnits = 0;
      for (; inspectedUnits < unitCount; inspectedUnits++) {
        const index = (startIndex + inspectedUnits) % unitCount,
          unit = game.units[index];
        const signature = signatureOf(unit);
        const previousSignature = networkUnitSignaturesRef.current.get(unit.id);
        if (previousSignature === signature)
          continue;
        if (units.length + newUnits.length >= unitBatchLimit) break;
        networkUnitSignaturesRef.current.set(unit.id, signature);
        if (previousSignature == null) {
          const { path: _path, pathIndex: _pathIndex, ...networkUnit } = unit;
          newUnits.push(networkUnit);
        } else units.push(encodeCompactUnit(unit));
      }
      if (unitCount)
        networkUnitCursorRef.current =
          (startIndex + inspectedUnits) % unitCount;
      const removedUnitIds: number[] = [];
      for (const id of networkUnitSignaturesRef.current.keys())
        if (!currentIds.has(id)) {
          removedUnitIds.push(id);
          networkUnitSignaturesRef.current.delete(id);
        }
      const sites: GameData["sites"] = [];
      for (const site of game.sites) {
        const signature = siteSignatureOf(site);
        if (networkSiteSignaturesRef.current.get(site.id) === signature)
          continue;
        networkSiteSignaturesRef.current.set(site.id, signature);
        sites.push(structuredClone(site));
      }
      const campaignSignature =
          role === "host"
            ? JSON.stringify({
                firedEvents: game.campaign.firedEvents,
                warUnlocked: game.campaign.warUnlocked,
                attackBonus: game.campaign.attackBonus,
                freezeUntil: game.campaign.freezeUntil,
                cautionUntil: game.campaign.cautionUntil,
                outcome: game.campaign.outcome,
                thuFactionName: game.campaign.thuFactionName,
                statuses: game.campaign.statuses,
                battleAlerts: game.campaign.battleAlerts,
                decisions: game.campaign.decisions,
                research: game.campaign.research,
                academicYearOutcome: game.campaign.academicYearOutcome,
              })
            : "",
        campaignChanged =
          role === "host" &&
          campaignSignature !== networkCampaignSignatureRef.current;
      if (campaignChanged)
        networkCampaignSignatureRef.current = campaignSignature;
      const envelope: MultiplayerEnvelope = {
        type: "state_delta",
        revision: ++networkRevisionRef.current,
        role,
        units,
        newUnits,
        removedUnitIds,
        sites,
        campaign: campaignChanged
          ? structuredClone(game.campaign)
          : undefined,
        timeOfDay: game.timeOfDay,
        timeScale: timeScaleRef.current,
        elapsedHours: game.campaign.elapsedHours,
        resources: game.resources,
        deaths: game.deaths,
      };
      openChannels.forEach((channel) => sendToChannel(channel, envelope));
    };
    const timer = window.setInterval(() => {
        if (
          dedicatedServerHostRef.current &&
          document.visibilityState === "hidden"
        )
          return;
        syncNetwork();
      }, 50),
      worker = dedicatedServerHost
        ? new ServerClockWorker()
        : null;
    let lastWorkerSyncAt = 0;
    if (worker) {
      worker.onmessage = () => {
        const now = performance.now();
        if (
          document.visibilityState !== "hidden" ||
          now - lastWorkerSyncAt < 45
        )
          return;
        lastWorkerSyncAt = now;
        syncNetwork();
      };
      worker.postMessage({ type: "start" });
    }
    return () => {
      clearInterval(timer);
      worker?.postMessage({ type: "stop" });
      worker?.terminate();
    };
  }, [dedicatedServerHost]);
  const updateMobileJoystick = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pad = joystickRef.current;
    if (!pad) return;
    const bounds = pad.getBoundingClientRect(),
      dx = event.clientX - (bounds.left + bounds.width / 2),
      dy = event.clientY - (bounds.top + bounds.height / 2),
      radius = bounds.width * 0.34,
      length = Math.hypot(dx, dy),
      scale = length > radius ? radius / length : 1,
      x = dx * scale,
      y = dy * scale;
    setJoystickKnob({ x, y });
    mobileMoveRef.current = { x: x / radius, z: y / radius };
  };
  const releaseMobileJoystick = () => {
    mobileMoveRef.current = { x: 0, z: 0 };
    setJoystickKnob({ x: 0, y: 0 });
  };
  const decisionBranchMark = (branch: string) =>
    ({
      思想与校园动员: "思",
      基础科学: "理",
      燕园防务: "防",
      后勤治理: "勤",
      工程体系: "工",
      学堂传统: "学",
      校园防务: "卫",
      后勤健康: "健",
    })[branch] ?? branch.slice(0, 1);
  const renderFocusNode = (item: DecisionDefinition) => {
    const campaign = gameRef.current.campaign,
      active = campaign.decisions.active[playerTeam],
      completed = campaign.decisions.completed.includes(item.id),
      locked = campaign.decisions.locked.includes(item.id),
      isActive = active?.id === item.id,
      available = decisionAvailable(item, campaign),
      remaining = isActive
        ? Math.max(0, active.completesAt - campaign.elapsedHours)
        : 0,
      progress = isActive
        ? THREE.MathUtils.clamp(
            (campaign.elapsedHours - active.startedAt) /
              Math.max(1, active.completesAt - active.startedAt),
            0,
            1,
          )
        : completed
          ? 1
          : 0;
    return (
      <button
        key={item.id}
        className={`focus-node ${completed ? "completed" : ""} ${locked ? "locked" : ""} ${isActive ? "active" : ""} ${available ? "available" : ""}`}
        disabled={
          completed ||
          locked ||
          !!campaign.decisions.active[playerTeam] ||
          !available
        }
        onClick={() => requestDecisionStart(item.id, playerTeam)}
        title={`${item.description}\n${item.days}天 · ${item.cost}战略资源`}
      >
        <span className="focus-node-emblem" aria-hidden="true">
          {decisionBranchMark(item.branch)}
        </span>
        <span className="focus-node-copy">
          <strong>{item.title}</strong>
          <small>
            {completed
              ? "已完成"
              : locked
                ? "互斥锁定"
                : isActive
                  ? `剩余 ${(remaining / 24).toFixed(1)}天`
                  : `${item.days}天 · ${item.cost}`}
          </small>
        </span>
        {(isActive || completed) && (
          <span className="focus-progress" aria-hidden="true">
            <i style={{ width: `${progress * 100}%` }} />
          </span>
        )}
      </button>
    );
  };
  return (
    <main className="game-shell">
      {screen === "game" && networkWarning && (
        <aside className="network-sync-warning" role="alert">
          <strong>{networkWarning.startsWith("正在等待玩家") ? "等待玩家" : "战局同步异常"}</strong><span>{networkWarning}</span>
          {!networkWarning.startsWith("正在等待玩家") && <button onClick={() => window.location.reload()}>重新加载</button>}
        </aside>
      )}
      {screen === "game" && <div ref={hostRef} className="webgl-stage" />}
      {screen === "game" && (
        <>
          <nav className="battle-nav" aria-label="战场菜单">
            <button
              aria-label="返回主页面"
              title="返回主页面"
              onClick={() => {
                saveUnfinishedGame();
                setPauseSettingsOpen(false);
                setPauseOpen(true);
              }}
            >
              ‹
            </button>
            <button
              aria-label="打开决策树"
              title="决策树"
              className={`focus-tree-entry ${decisionOpen ? "active" : ""}`}
              onClick={() => {
                setDecisionOpen(true);
                setMoreOpen(false);
                setSettingsOpen(false);
              }}
            >
              <span className="focus-tree-glyph" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </button>
            <button
              aria-label="打开研发"
              title="研发"
              className={researchOpen ? "active" : ""}
              onClick={() => {
                setResearchOpen(true);
                setDecisionOpen(false);
                setMoreOpen(false);
                setSettingsOpen(false);
              }}
            >
              <span className="research-nav-icon" aria-hidden="true">
                <i />
              </span>
            </button>
            <button
              aria-label="打开工具"
              title="工具"
              className={toolsOpen || activeToolMode ? "active" : ""}
              onClick={() => {
                setToolsOpen(true);
                setResearchOpen(false);
                setDecisionOpen(false);
                setMoreOpen(false);
                setSettingsOpen(false);
              }}
            >
              <span className="tools-nav-icon" aria-hidden="true"><i /></span>
            </button>
            <button
              aria-label="更多"
              title="更多"
              className={moreOpen ? "active" : ""}
              onClick={() => {
                setMoreOpen((value) => !value);
                setSettingsOpen(false);
              }}
            >
              ☰
            </button>
            <button
              aria-label="设置"
              title="设置"
              className={settingsOpen ? "active" : ""}
              onClick={() => {
                setSettingsOpen((value) => !value);
                setMoreOpen(false);
              }}
            >
              ⚙︎
            </button>
            <button
              aria-label="多人聊天"
              title="多人聊天"
              className={chatOpen ? "active chat-entry" : "chat-entry"}
              onClick={() => {
                setChatOpen((value) => !value);
                setChatUnread({ team: 0, all: 0 });
              }}
            >
              ◌
              {chatUnread.team + chatUnread.all > 0 && (
                <span className="chat-unread">
                  {Math.min(99, chatUnread.team + chatUnread.all)}
                </span>
              )}
            </button>
            {(selectedUnitCount > 0 || directControl) && (
              <button
                className={`direct-entry ${directControl ? "active" : ""}`}
                aria-label={directControl ? "退出近距离控制" : "进入近距离控制"}
                title={directControl ? "退出近距离控制" : "近距离控制（F）"}
                onClick={() =>
                  directControl
                    ? sceneApi.current?.exitDirectControl()
                    : sceneApi.current?.enterDirectControl()
                }
              >
                近距
              </button>
            )}
          </nav>
          <div className="battle-clock" aria-label="当前游戏时间">
            {clock}
          </div>
          {showPerformance && (
            <PerformanceHud
              metrics={performanceMetrics}
              pixelRatio={performanceControllerRef.current.profile.pixelRatio}
            />
          )}
          {moreOpen && (
            <MoreDrawer
              clock={clock}
              stats={stats}
              deaths={gameRef.current.deaths}
              alerts={gameRef.current.campaign.battleAlerts ?? []}
              onOpenEvents={() => setEventLogOpen(true)}
              onSave={saveGame}
            />
          )}
          {settingsOpen && (
            <SettingsDrawer
              showSites={showSites}
              showControl={showControl}
              autoDay={autoDay}
              eventPopupEnabled={eventPopupEnabled}
              timeScale={timeScale}
              qualityMode={qualityMode}
              showPerformance={showPerformance}
              timeScaleLocked={timeScaleLocked}
              onShowSites={setShowSites}
              onShowControl={setShowControl}
              onAutoDay={setAutoDay}
              onEventPopupEnabled={setEventPopupEnabled}
              onTimeScale={setTimeScale}
              onQualityMode={setQualityMode}
              onShowPerformance={setShowPerformance}
            />
          )}
          {chatOpen && (
            <ChatPanel
              channel={chatChannel}
              messages={chatMessages}
              unread={chatUnread}
              input={chatInput}
              onChannel={(channel) => {
                setChatChannel(channel);
                setChatUnread((current) => ({ ...current, [channel]: 0 }));
              }}
              onInput={setChatInput}
              onSend={submitChatMessage}
              onClose={() => setChatOpen(false)}
            />
          )}
          {decisionVote && decisionVote.team === playerTeam && (
            <DecisionVoteToast
              title={
                DECISIONS.find((item) => item.id === decisionVote.decisionId)?.title ??
                decisionVote.decisionId
              }
              seconds={(decisionVote.deadline - Date.now()) / 1000}
              onVote={castDecisionVote}
            />
          )}
          {pauseOpen && (
            <div className="pause-backdrop">
              <section className="pause-card" aria-label="游戏菜单">
                <h2>游戏菜单</h2>
                {pauseSettingsOpen ? (
                  <div className="pause-settings">
                    <label>
                      <span>显示据点</span>
                      <input
                        type="checkbox"
                        checked={showSites}
                        onChange={(event) => setShowSites(event.target.checked)}
                      />
                    </label>
                    <label>
                      <span>显示控制范围</span>
                      <input
                        type="checkbox"
                        checked={showControl}
                        onChange={(event) => setShowControl(event.target.checked)}
                      />
                    </label>
                    <label>
                      <span>事件弹窗</span>
                      <input
                        type="checkbox"
                        checked={eventPopupEnabled}
                        onChange={(event) =>
                          setEventPopupEnabled(event.target.checked)
                        }
                      />
                    </label>
                    <label>
                      <span>时间倍率</span>
                      <input
                        type="number"
                        min="0.5"
                        max="64"
                        step="0.1"
                        value={timeScale}
                        disabled={timeScaleLocked}
                        onChange={(event) =>
                          setTimeScale(
                            Math.min(
                              MAX_TIME_SCALE,
                              Math.max(0.5, Number(event.target.value) || 0.5),
                            ),
                          )
                        }
                      />
                    </label>
                    {timeScale > 16 && (
                      <small className="time-scale-warning">
                        超过16×可能造成卡顿或降低画面流畅度
                      </small>
                    )}
                    <button onClick={() => setPauseSettingsOpen(false)}>
                      完成
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        if (!saveGame()) return;
                        refreshSaves();
                        setMoreOpen(false);
                        setSettingsOpen(false);
                        setPauseOpen(false);
                        setHomePage("menu");
                        setScreen("home");
                      }}
                    >
                      保存并退出
                    </button>
                    <button onClick={() => setPauseSettingsOpen(true)}>
                      设置
                    </button>
                    <button onClick={() => setPauseOpen(false)}>取消</button>
                  </>
                )}
                <small>未手动保存时，系统仍会保留“未完成战局”。</small>
              </section>
            </div>
          )}
        </>
      )}
      {screen === "home" && (
        <HomeScreen
          page={homePage}
          setPage={setHomePage}
          openAssets={() => setAssetOpen(true)}
          lanStatus={lanStatus}
          lanInput={lanInput}
          setLanInput={setLanInput}
          lanOutput={lanOutput}
          lanMode={lanMode}
          setLanMode={setLanMode}
          connectedPlayers={connectedPlayers}
          playerNickname={playerNickname}
          setPlayerNickname={setPlayerNickname}
          createLanHost={createLanHost}
          joinLanHost={joinLanHost}
          saveName={saveName}
          setSaveName={setSaveName}
          newGameTeam={newGameTeam}
          setNewGameTeam={setNewGameTeam}
          aiObserverMode={aiObserverMode}
          setAiObserverMode={setAiObserverMode}
          openToLan={openToLan}
          setOpenToLan={setOpenToLan}
          aiDifficulty={aiDifficulty}
          setAiDifficulty={setAiDifficulty}
          observerAiDifficulty={observerAiDifficulty}
          setObserverAiDifficulty={setObserverAiDifficulty}
          newGame={newGame}
          autosave={autosave}
          saves={saves}
          loadGame={loadGame}
          clearUnfinishedGame={clearUnfinishedGame}
          deleteSave={deleteSave}
          exportSave={exportSave}
          importPlayerSave={(file) => void importPlayerSave(file)}
          renameSave={renameSave}
          changeSaveIcon={changeSaveIcon}
          servers={serverSaves}
          activeServerId={activeServerId}
          createServer={createServer}
          launchServer={launchServer}
          stopServer={stopServer}
          deleteServer={removeServer}
          exportServer={exportServer}
          importServer={(file) => void importServer(file)}
          openServerAdmin={openServerAdmin}
          localServerMode={localRelayModeRef.current}
          localServerManager={localServerManagerRef.current}
          joinCurrentLocalServer={joinCurrentLocalServer}
        />
      )}
      {teamSelection && (
        <TeamLobby
          mode={teamSelection.mode}
          counts={teamSelection.counts}
          forcedTeam={teamSelection.forcedTeam}
          nickname={playerNickname}
          onNicknameChange={setPlayerNickname}
          onSelect={confirmTeamSelection}
          onCancel={() => setTeamSelection(null)}
        />
      )}
      {lanConnectionStage && (
        <div className="modal-backdrop lan-connection-backdrop">
          <section className="lan-connection-card">
            <span className="lan-connection-spinner" aria-hidden="true" />
            <h2>
              {lanConnectionStage === "connecting"
                ? "正在进入服务器"
                : "连接没有建立"}
            </h2>
            <p>{lanStatus}</p>
            <div>
              {lanConnectionStage === "failed" && (
                <button onClick={retryLanConnection}>重新连接</button>
              )}
              <button onClick={cancelLanConnection}>取消</button>
            </div>
          </section>
        </div>
      )}
      {dedicatedServerHost && activeServerId && (
        <div className="dedicated-host-overlay">
          <section className="dedicated-host-card">
            <small>纯服务器进程</small>
            <h2>
              {serverSaves.find((server) => server.id === activeServerId)?.name ??
                "清北联机服务器"}
            </h2>
            <p>服务器本身不属于任何阵营，也不计入玩家。所有操作者必须通过房间码加入。</p>
            <label>
              <span>房间码</span>
              <strong>{lanOutput || "正在启动…"}</strong>
            </label>
            <p>{lanStatus} · 在线玩家 {connectedPlayers} 人</p>
            <div>
              <button
                disabled={!lanOutput}
                onClick={() =>
                  window.open(
                    `${import.meta.env.BASE_URL}?${localRelayModeRef.current ? "local=1&" : ""}join=${encodeURIComponent(lanOutput)}`,
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
              >
                打开玩家入口
              </button>
              {!localRelayModeRef.current && (
                <button
                  onClick={() => {
                    const server = serverSaves.find(
                      (candidate) => candidate.id === activeServerId,
                    );
                    if (server) openServerAdmin(server);
                  }}
                >
                  控制台
                </button>
              )}
              <button className="danger" onClick={() => stopServer(activeServerId)}>
                停止服务器
              </button>
            </div>
          </section>
        </div>
      )}
      <header className="hud-top">
        <div>
          <h1>解放清华园</h1>
          <p>OSM导航级路网 · 实时战役</p>
        </div>
        <div className="time-pill">
          <span>{clock}</span>
          <button onClick={() => setAutoDay((v) => !v)}>
            {autoDay ? "自动昼夜" : "光照锁定"}
          </button>
        </div>
        <button
          className="save-main"
          onClick={() => {
            refreshSaves();
            setSaveOpen(true);
          }}
        >
          存档管理
        </button>
      </header>
      <nav className="campaign-tools">
        <div className="map-view-switch" aria-label="地图视图">
          <button
            className={showSites ? "active" : ""}
            onClick={() => setShowSites((value) => !value)}
          >
            ◉ 据点视图
          </button>
          <button
            className={showControl ? "active" : ""}
            onClick={() => setShowControl((value) => !value)}
          >
            ◒ 控制范围
          </button>
        </div>
        <button onClick={() => setAssetOpen(true)}>🖼 更换材质</button>
        <button onClick={() => setEventLogOpen(true)}>事件档案</button>
        <span className="camp-hint">右键空地建立临时据点 · 多目标兵线可经营地绕行</span>
        {selectedUnitCount > 0 && (
          <span className="selected-squad">◎ 已选 {selectedUnitCount} 人</span>
        )}
        {selectedUnitCount > 0 && !directControl && (
          <button
            onClick={() => sceneApi.current?.enterDirectControl()}
            title="也可以按 F"
          >
            ⌨ 近距控制
          </button>
        )}
      </nav>
      {directControl && (
        <aside className="direct-control-hud">
          <strong>近距离控制</strong>
          <span>WASD 控制领队 · 队员自动寻路跟随 · Esc 退出</span>
          <canvas ref={minimapRef} width={240} height={160} />
          <small>黄色为领队，青色为自动跟随的队员</small>
          <div className="mobile-direct-controls">
            <div
              ref={joystickRef}
              className="mobile-joystick"
              aria-label="移动摇杆"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                updateMobileJoystick(event);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  updateMobileJoystick(event);
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
                releaseMobileJoystick();
              }}
              onPointerCancel={releaseMobileJoystick}
            >
              <span
                style={{
                  transform: `translate(${joystickKnob.x}px, ${joystickKnob.y}px)`,
                }}
              />
            </div>
            <button onClick={() => sceneApi.current?.exitDirectControl()}>
              退出控制
            </button>
          </div>
        </aside>
      )}
      <div className="command-notice">{notice}</div>
      {eventToast && screen === "game" && (
        <aside className="event-mini-toast" role="status" aria-live="polite">
          <small>事件发生</small>
          <strong>{eventToast.title}</strong>
          <span>{eventToast.effect}</span>
        </aside>
      )}
      {campContext && (
        <div
          className="camp-context-menu"
          style={{
            left: Math.min(campContext.x, globalThis.innerWidth - 250),
            top: Math.min(campContext.y, globalThis.innerHeight - 150),
          }}
        >
          <strong>在此建立临时据点？</strong>
          <small>消耗 80 战略资源，附近需要至少 3 名己方学生</small>
          <div>
            <button
              onClick={() => {
                if (
                  clientActionSenderRef.current({
                    kind: "build_camp",
                    x: campContext.worldX,
                    z: campContext.worldZ,
                  })
                ) {
                  setNotice("建立营地请求已发送给服务器");
                  setCampContext(null);
                  return;
                }
                if (
                  sceneApi.current?.buildCampAt(
                    campContext.worldX,
                    campContext.worldZ,
                  )
                )
                  setCampContext(null);
              }}
            >
              ⛺ 建立营地
            </button>
            <button onClick={() => setCampContext(null)}>取消</button>
          </div>
        </div>
      )}
      <WarOverview
        campaign={gameRef.current.campaign}
        stats={stats}
        resources={gameRef.current.resources}
        deaths={gameRef.current.deaths}
        onRestart={() => newGame(playerTeam)}
      />
      {selectedSite && (
        <SiteCommandMenu
          menuRef={siteMenuRef}
          site={selectedSite}
          playerTeam={playerTeam}
          nearbyFriendly={selectedNearbyFriendly}
          renaming={renamingSite}
          renameDraft={renameDraft}
          stanceText={stanceText}
          onRenameDraft={setRenameDraft}
          onRename={() =>
            renamingSite ? renameSelectedSite() : setRenamingSite(true)
          }
          onCancelRename={() => setRenamingSite(false)}
          onStance={setStance}
        />
      )}
      <DayScaleControl
        timeOfDay={gameRef.current.timeOfDay}
        timeScale={timeScale}
        onTimeScale={setTimeScale}
        locked={timeScaleLocked}
      />
      <div className="map-attribution">
        道路与建筑 © OpenStreetMap contributors · 高程 Open-Meteo
      </div>
      {decisionOpen && (
        <FocusTree
          team={playerTeam}
          campaign={gameRef.current.campaign}
          resources={gameRef.current.resources[playerTeam]}
          zoom={decisionZoom}
          setZoom={setDecisionZoom}
          renderNode={renderFocusNode}
          onCancelDecision={() => cancelDecision(playerTeam)}
          onClose={() => setDecisionOpen(false)}
        />
      )}
      {researchOpen && (
        <ResearchTree
          team={playerTeam}
          campaign={gameRef.current.campaign}
          resources={gameRef.current.resources[playerTeam]}
          onStart={(id) => beginResearch(id, playerTeam)}
          onProduce={(id) => beginProduction(id, playerTeam)}
          onStopProduction={(id) => stopProduction(id, playerTeam)}
          onClose={() => setResearchOpen(false)}
        />
      )}
      {toolsOpen && (
        <ToolsPanel
          activeTool={activeToolMode}
          onTool={(mode) => {
            setActiveToolMode(mode);
            sceneApi.current?.setToolMode(mode);
            if (mode) setToolsOpen(false);
          }}
          onMobilize={(stance) => {
            if (!canIssuePlayerCommandRef.current()) return;
            if (
              clientActionSenderRef.current({ kind: "mobilize", stance })
            )
              setNotice("总动员命令已发送给服务器");
            else sceneApi.current?.mobilizeAll(playerTeam, stance);
            setToolsOpen(false);
          }}
          onClose={() => setToolsOpen(false)}
        />
      )}
      {eventLogOpen && (
        <EventLogOverlay
          campaign={gameRef.current.campaign}
          onClose={() => setEventLogOpen(false)}
        />
      )}
      {victoryBroadcast && (
        <VictoryOverlay
          broadcast={victoryBroadcast}
          onClose={() => setVictoryBroadcast(null)}
        />
      )}
      {academicYearBroadcast && (
        <AcademicYearOverlay
          outcome={academicYearBroadcast}
          thuFactionName={gameRef.current.campaign.thuFactionName}
          onClose={() => setAcademicYearBroadcast(null)}
        />
      )}
      {activeEvents.length > 0 && screen === "game" && (
        <EventBatchOverlay
          events={activeEvents}
          onClose={() => setActiveEvents([])}
        />
      )}
      {assetOpen && (
        <div className="modal-backdrop" onMouseDown={() => setAssetOpen(false)}>
          <section
            className="asset-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="save-head">
              <div>
                <small>本机自定义</small>
                <h2>替换游戏材质</h2>
              </div>
              <button onClick={() => setAssetOpen(false)}>×</button>
            </div>
            <div className="upload-card">
              <strong>士兵球体材质</strong>
              <span>PNG / JPEG / WebP，最大2MB；会缩放至512像素。</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) =>
                  void handleMaterialUpload("unit", event.target.files?.[0])
                }
              />
              <button type="button" onClick={() => clearMaterial("unit")}>
                恢复默认
              </button>
            </div>
            <div className="upload-card">
              <strong>据点标记材质</strong>
              <span>上传后会显示在所有据点标记上方。</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) =>
                  void handleMaterialUpload("site", event.target.files?.[0])
                }
              />
              <button type="button" onClick={() => clearMaterial("site")}>
                恢复默认
              </button>
            </div>
          </section>
        </div>
      )}
      {saveOpen && (
        <div className="modal-backdrop" onMouseDown={() => setSaveOpen(false)}>
          <section
            className="save-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="save-head">
              <div>
                <small>本机存档</small>
                <h2>战局档案馆</h2>
              </div>
              <button onClick={() => setSaveOpen(false)}>×</button>
            </div>
            <div className="new-save">
              <input
                value={saveName}
                maxLength={24}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="输入存档名称"
              />
              <button onClick={saveGame}>保存当前战局</button>
            </div>
            <div className="save-list">
              {!saves.length && <p className="empty">暂无存档</p>}
              {saves.map((s) => (
                <article key={s.savedAt}>
                  <div>
                    <strong>{s.name}</strong>
                    <span>
                      {new Date(s.savedAt).toLocaleString("zh-CN")} ·{" "}
                      {s.units.length}人 · {s.timeOfDay.toFixed(1)}时
                    </span>
                  </div>
                  <button className="enter" onClick={() => loadGame(s)}>
                    进入
                  </button>
                  <button
                    className="delete"
                    onClick={() => deleteSave(s.savedAt)}
                  >
                    删除
                  </button>
                </article>
              ))}
            </div>
            <p className="save-note">
              存档保存在当前浏览器的本地存储中；清除浏览器数据会一并删除。
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
