"use client";

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
import { decisionAvailable } from "../src/game/decisions";
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

export default function Game3D() {
  const hostRef = useRef<HTMLDivElement>(null);
  const performanceControllerRef = useRef(new PerformanceController());
  const autosaveTaskRef = useRef<number | null>(null);
  const saveWorkerRef = useRef<Worker | null>(null);
  const saveWorkerRequestRef = useRef(0);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const siteMenuRef = useRef<HTMLElement>(null);
  const gameRef = useRef<GameData>(makeFreshGame());
  const sceneApi = useRef<BattlefieldSceneApi | null>(null);
  const [saves, setSaves] = useState<Snapshot[]>([]);
  const [autosave, setAutosave] = useState<Snapshot | null>(null);
  const [serverSaves, setServerSaves] = useState<ServerRecord[]>([]);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const activeServerIdRef = useRef<string | null>(null);
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
  const [homePage, setHomePage] = useState<HomePage>("menu");
  const [newGameTeam, setNewGameTeam] = useState<Team>("pku");
  const [openToLan, setOpenToLan] = useState(false);
  const [lanInput, setLanInput] = useState("");
  const [lanOutput, setLanOutput] = useState("");
  const [lanStatus, setLanStatus] = useState("未连接");
  const [lanMode, setLanMode] = useState<"host" | "join">("host");
  const [lanTeam, setLanTeam] = useState<Team>("pku");
  const [teamSelection, setTeamSelection] =
    useState<TeamSelectionState | null>(null);
  const lanTeamRef = useRef<Team>("pku");
  const [connectedPlayers, setConnectedPlayers] = useState(0);
  const lanPeerRef = useRef<RTCPeerConnection | null>(null);
  const lanPeersRef = useRef(new Set<RTCPeerConnection>());
  const lanChannelsRef = useRef(new Set<RTCDataChannel>());
  const lanChannelIdentityRef = useRef(new Map<RTCDataChannel, PlayerIdentity>());
  const lanHostRef = useRef(false);
  const networkRevisionRef = useRef(0);
  const networkLastFullAtRef = useRef(0);
  const networkUnitSignaturesRef = useRef(new Map<number, string>());
  const networkReceivedRevisionRef = useRef(
    new WeakMap<RTCDataChannel, number>(),
  );
  const [playerNickname, setPlayerNickname] = useState(() =>
    sessionStorage.getItem("qingbei-player-name") ||
    `玩家${Math.floor(100 + Math.random() * 900)}`,
  );
  const playerIdRef = useRef(
    sessionStorage.getItem("qingbei-player-id") || crypto.randomUUID(),
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
  const [timeScale, setTimeScale] = useState(1);
  const timeScaleRef = useRef(1);
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
  const [qualityMode, setQualityMode] = useState<QualityMode>(() =>
    (localStorage.getItem("qingbei-quality-mode") as QualityMode) || "auto",
  );
  const [showPerformance, setShowPerformance] = useState(false);
  const [performanceMetrics, setPerformanceMetrics] =
    useState<PerformanceMetrics>(performanceControllerRef.current.metrics);
  const [unitMaterialUrl, setUnitMaterialUrl] = useState<string | null>(null);
  const [siteMaterialUrl, setSiteMaterialUrl] = useState<string | null>(null);
  const customMaterialsRef = useRef<{
    unit: string | null;
    site: string | null;
  }>({
    unit: null,
    site: null,
  });
  const [activeEvents, setActiveEvents] = useState<EventCard[]>([]);
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
    setActiveEvents((current) =>
      current.some((item) => item.id === event.id)
        ? current
        : [...current, event],
    );
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
  const cancelDecision = useCallback((team: Team) => {
    const active = gameRef.current.campaign.decisions.active[team];
    if (!active) return;
    const definition = DECISIONS.find((item) => item.id === active.id);
    if (definition)
      gameRef.current.resources[team] += Math.floor(definition.cost * 0.5);
    gameRef.current.campaign.decisions.active[team] = null;
    setNotice("决策已取消，返还50%战略资源");
  }, []);
  const beginResearch = useCallback(
    (id: ResearchId, team: Team, silent = false) => {
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
      const game = gameRef.current,
        campaign = game.campaign,
        definition = RESEARCH_DEFINITIONS[id];
      if (
        campaign.research.production[team] ||
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
      campaign.research.production[team] = {
        id: crypto.randomUUID(),
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
  const recordServerLog = useCallback(
    (category: ServerLogEntry["category"], text: string) => {
      const serverId = activeServerIdRef.current;
      if (!serverId) return;
      const server = readServerSaves().find((record) => record.id === serverId);
      if (!server) return;
      const entry: ServerLogEntry = {
          id: crypto.randomUUID(),
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
    const worker = new Worker(new URL("../src/save-worker.ts", import.meta.url), {
      type: "module",
    });
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
    };
    sceneApi.current?.applyMaterials(unitMaterialUrl, siteMaterialUrl);
  }, [unitMaterialUrl, siteMaterialUrl]);

  useBattlefieldEngine({
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
    recordServerLog
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
        const snapshot = snapshotCurrentGame("未完成战局"),
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
                {
                  id: playerIdRef.current,
                  nickname: playerNickname.trim().slice(0, 16) || "主机",
                  team: playerTeamRef.current,
                  host: true,
                },
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
      existingNames = new Set(readSaves().map((save) => save.name));
    let name = baseName,
      suffix = 1;
    while (existingNames.has(name)) name = `${baseName} (${suffix++})`;
    const
      snapshot = snapshotCurrentGame(name),
      next = [snapshot, ...readSaves()].slice(0, 12);
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(next));
      clearUnfinishedGame();
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
  const openServerAdmin = (existing?: ServerRecord) => {
    let server = existing;
    if (!server) {
      const fresh = makeFreshGame(),
        now = Date.now();
      server = {
        id: crypto.randomUUID(),
        name: "清北联机服务器",
        createdAt: now,
        updatedAt: now,
        hostTeam: "pku",
        maxPlayers: 4,
        allowSameTeam: true,
        map: {
          version: 4,
          name: "新服务器地图",
          savedAt: now,
          ...fresh,
        },
        players: [],
        logs: [],
      };
      setServerSaves(upsertServerSave(server));
    }
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
        id: crypto.randomUUID(),
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
    setTeamSelection({
      mode: "host",
      server,
      counts: { pku: 0, thu: 0 },
      forcedTeam: null,
    });
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
    if (!serverId) clearUnfinishedGame();
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
          ai: campaign.ai ?? defaults.ai,
        };
      normalizedCampaign.decisions.active ??= { pku: null, thu: null };
      normalizedCampaign.decisions.completed ??= [];
      normalizedCampaign.decisions.locked ??= [];
      normalizedCampaign.research ??= defaults.research;
      normalizedCampaign.research.active ??= { pku: null, thu: null };
      normalizedCampaign.research.completed ??= { pku: [], thu: [] };
      normalizedCampaign.research.production ??= { pku: null, thu: null };
      normalizedCampaign.research.stockpile ??= defaults.research.stockpile;
      const migrateResearchId = (id: string, team: Team): ResearchId => {
        if (id === "bike") return team === "pku" ? "pku_bike" : "thu_bike";
        if (id === "ebike")
          return team === "pku" ? "pku_phone_bike" : "thu_purple_bike";
        if (id === "armored_bus") return "large_bus";
        return id as ResearchId;
      };
      for (const team of ["pku", "thu"] as Team[]) {
        const stockpile = normalizedCampaign.research.stockpile[team] as unknown as Record<string, number>,
          migratedCompleted = (normalizedCampaign.research.completed[team] as unknown as string[]).map(
            (id) => migrateResearchId(id, team),
          );
        normalizedCampaign.research.completed[team] = [
          ...new Set(migratedCompleted),
        ];
        const active = normalizedCampaign.research.active[team];
        if (active) active.id = migrateResearchId(active.id, team);
        const production = normalizedCampaign.research.production[team];
        if (production)
          production.researchId = migrateResearchId(
            production.researchId,
            team,
          );
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
  const newGame = (team: Team = playerTeam) => {
    clearUnfinishedGame();
    setActiveServerId(null);
    activeServerIdRef.current = null;
    setPlayerTeam(team);
    playerTeamRef.current = team;
    gameRef.current = makeFreshGame();
    gameRef.current.campaign.ai.difficulty = aiDifficulty;
    sceneApi.current?.sync();
    sceneApi.current?.clearUnitSelection();
    setSelected(null);
    setActiveEvents([]);
    setVictoryBroadcast(null);
    setAcademicYearBroadcast(null);
    setPauseOpen(false);
    setScreen("game");
  };
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
    if (!selectedSite || selectedSite.team !== playerTeam) return;
    selectedSite.stance = s;
    selectedSite.dispatchRatio = s === "defend" ? 0.4 : s === "guard" ? 0.7 : 1;
    sceneApi.current?.refreshSiteStance(selectedSite.id);
    setNotice(
      `${selectedSite.displayName ?? selectedSite.name}已切换为${stanceText[s].title}，输送${Math.round(selectedSite.dispatchRatio * 100)}%`,
    );
  };
  const renameSelectedSite = () => {
    if (!selectedSite || selectedSite.team !== playerTeam) return;
    const nextName = renameDraft.trim().slice(0, 24);
    if (!nextName) return;
    selectedSite.displayName = nextName;
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
      const listener = () => {
        if (peer.iceGatheringState !== "complete") return;
        peer.removeEventListener("icegatheringstatechange", listener);
        resolve();
      };
      peer.addEventListener("icegatheringstatechange", listener);
    });
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
  const sendToChannel = (channel: RTCDataChannel, envelope: MultiplayerEnvelope) => {
    if (channel.readyState === "open") channel.send(JSON.stringify(envelope));
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
  const finalizeDecisionVote = (voteId: string) => {
    if (!lanHostRef.current) return;
    const vote = decisionVoteRef.current;
    if (!vote || vote.id !== voteId) return;
    const eligible = [
        ...(playerTeamRef.current === vote.team ? [playerIdRef.current] : []),
        ...[...lanChannelIdentityRef.current.values()]
          .filter((identity) => identity.team === vote.team)
          .map((identity) => identity.id),
      ],
      yes = eligible.filter((id) => vote.votes[id] === true).length,
      no = eligible.filter((id) => vote.votes[id] === false).length,
      approved = yes > eligible.length / 2 || (yes === no && yes > 0);
    if (approved) beginDecision(vote.decisionId, vote.team);
    const definition = DECISIONS.find((item) => item.id === vote.decisionId);
    relayChatMessage({
      id: crypto.randomUUID(),
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
  const startDecisionVote = (
    decisionId: string,
    team: Team,
    voterId: string,
  ) => {
    if (!lanHostRef.current || decisionVoteRef.current) return;
    const vote: DecisionVote = {
      id: crypto.randomUUID(),
      decisionId,
      team,
      deadline: Date.now() + 20_000,
      votes: { [voterId]: true },
    };
    decisionVoteRef.current = vote;
    setDecisionVote(vote);
    broadcastEnvelope({ type: "decision_vote_state", vote });
    setTimeout(() => finalizeDecisionVote(vote.id), 20_000);
  };
  const requestDecisionStart = (decisionId: string, team: Team) => {
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
        id: crypto.randomUUID(),
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
      else setNotice("尚未连接主机");
    }
    setChatInput("");
  };
  const updateActiveServerPlayers = () => {
    const serverId = activeServerIdRef.current;
    if (!serverId) return;
    const server = readServerSaves().find((record) => record.id === serverId);
    if (!server) return;
    const players = [
      {
        id: playerIdRef.current,
        nickname: playerNickname.trim().slice(0, 16) || "主机",
        team: playerTeamRef.current,
        host: true,
      },
      ...[...lanChannelIdentityRef.current.values()].map((identity) => ({
        ...identity,
        host: false,
      })),
    ];
    setServerSaves(
      upsertServerSave({ ...server, updatedAt: Date.now(), players }),
    );
  };
  const bindLanChannel = (channel: RTCDataChannel, host: boolean) => {
    lanChannelsRef.current.add(channel);
    lanHostRef.current = host;
    const refreshConnectionCount = () =>
      setConnectedPlayers(
        [...lanChannelsRef.current].filter(
          (candidate) => candidate.readyState === "open",
        ).length,
      );
    channel.onopen = () => {
      if (!host) {
        setPlayerTeam(lanTeamRef.current);
        playerTeamRef.current = lanTeamRef.current;
      }
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
      refreshConnectionCount();
      updateActiveServerPlayers();
      setLanStatus(host ? "玩家已加入，可继续生成邀请" : "已加入战局");
    };
    channel.onclose = () => {
      lanChannelsRef.current.delete(channel);
      lanChannelIdentityRef.current.delete(channel);
      refreshConnectionCount();
      updateActiveServerPlayers();
      setLanStatus(
        lanChannelsRef.current.size ? "部分玩家已离开" : "连接已关闭",
      );
      recordServerLog("player", "一名玩家离开服务器");
    };
    channel.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as MultiplayerEnvelope;
        if (payload.type === "hello") {
          let identity = payload.identity;
          if (host) {
            const usedNames = new Set(
              [...lanChannelIdentityRef.current.values()].map(
                (item) => item.nickname,
              ),
            );
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
              id: crypto.randomUUID(),
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
            id: crypto.randomUUID(),
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
          startDecisionVote(
            payload.decisionId,
            payload.team,
            payload.voterId,
          );
          return;
        }
        if (payload.type === "decision_vote_cast" && host) {
          const vote = decisionVoteRef.current;
          if (!vote || vote.id !== payload.voteId) return;
          vote.votes[payload.voterId] = payload.approve;
          setDecisionVote({ ...vote, votes: { ...vote.votes } });
          broadcastEnvelope({ type: "decision_vote_state", vote });
          return;
        }
        if (payload.type === "decision_vote_state") {
          decisionVoteRef.current = payload.vote;
          setDecisionVote(payload.vote);
          return;
        }
        if (
          payload.type === "state_delta" &&
          ((host && payload.role === "guest") ||
            (!host && payload.role === "host"))
        ) {
          const lastRevision =
            networkReceivedRevisionRef.current.get(channel) ?? -1;
          if (payload.revision <= lastRevision) return;
          networkReceivedRevisionRef.current.set(channel, payload.revision);
          const game = gameRef.current,
            identity = lanChannelIdentityRef.current.get(channel),
            allowedTeam = host ? identity?.team : undefined,
            unitsById = new Map(game.units.map((unit) => [unit.id, unit]));
          for (const delta of payload.units) {
            if (allowedTeam && delta.team !== allowedTeam) continue;
            const existing = unitsById.get(delta.id);
            if (existing) {
              const targetChanged = existing.targetSiteId !== delta.targetSiteId;
              Object.assign(existing, delta);
              if (targetChanged) {
                existing.path = undefined;
                existing.pathIndex = undefined;
              }
            } else {
              const created: UnitState = { ...delta };
              game.units.push(created);
              unitsById.set(created.id, created);
            }
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
          if (!host) {
            game.timeOfDay = payload.timeOfDay;
            setTimeScale(payload.timeScale);
            game.campaign.elapsedHours = payload.elapsedHours;
            game.resources = payload.resources;
            game.deaths = payload.deaths;
          }
          return;
        }
        if (
          payload.type === "state" &&
          ((host && payload.role === "guest") ||
            (!host && payload.role === "host"))
        ) {
          gameRef.current = payload.game;
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
  const createLanHost = async () => {
    const peer = new RTCPeerConnection({ iceServers: [] }),
      channel = peer.createDataChannel("qingbei-campaign");
    lanPeerRef.current = peer;
    lanPeersRef.current.add(peer);
    bindLanChannel(channel, true);
    await peer.setLocalDescription(await peer.createOffer());
    await waitForIce(peer);
    const operatorCounts = { pku: 0, thu: 0 };
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
      }),
    );
    setLanStatus("邀请已生成：复制下方代码给一名玩家");
  };
  const joinLanHost = async () => {
    try {
      const parsed = JSON.parse(lanInput) as
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
    } catch {
      setLanStatus("邀请码无效");
    }
  };
  const connectToLanHost = async (
    invite: ServerInvitePayload,
    team: Team,
  ) => {
    try {
      const peer = new RTCPeerConnection({ iceServers: [] });
      setLanTeam(team);
      lanTeamRef.current = team;
      lanPeerRef.current = peer;
      lanPeersRef.current.add(peer);
      peer.ondatachannel = (event) => bindLanChannel(event.channel, false);
      await peer.setRemoteDescription(invite.sdp);
      await peer.setLocalDescription(await peer.createAnswer());
      await waitForIce(peer);
      setLanOutput(JSON.stringify(peer.localDescription));
      setLanStatus("回应已生成：复制下方代码发回主机");
    } catch {
      setLanStatus("加入码无效");
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
        },
        server = {
          ...selection.server,
          hostTeam: team,
          updatedAt: Date.now(),
          players: [hostIdentity],
        };
      setServerSaves(upsertServerSave(server));
      loadGame(server.map, team, server.id);
      window.setTimeout(() => void createLanHost(), 0);
    } else void connectToLanHost(selection.invite, team);
  };
  const acceptLanAnswer = async () => {
    try {
      await lanPeerRef.current?.setRemoteDescription(JSON.parse(lanInput));
      setLanStatus("正在接纳玩家；成功后可继续生成下一份邀请");
    } catch {
      setLanStatus("回应码无效");
    }
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
              {
                id: playerIdRef.current,
                nickname: playerNickname.trim().slice(0, 16) || "主机",
                team: playerTeamRef.current,
                host: true,
              },
              ...[...lanChannelIdentityRef.current.values()].map((identity) => ({
                ...identity,
                host: false,
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
        activeServerIdRef.current === serverId ? lanStatus : "服务器离线",
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
      return "API: status | players | invite | timescale <0.5-16> | resource <pku|thu> <数量> | mobilize <pku|thu> <defend|guard|standby> | say <文本> | save | accept <回应JSON>";
    if (action === "status")
      return JSON.stringify(buildServerSummary(activeServerIdRef.current ?? ""));
    if (action === "players")
      return buildServerSummary(activeServerIdRef.current ?? "").players
        .map((player) => `${player.nickname}:${player.team}${player.host ? ":host" : ""}`)
        .join(", ");
    if (!activeServerIdRef.current) throw new Error("服务器尚未在原窗口启动");
    if (action === "invite") {
      await createLanHost();
      return "已生成新的玩家邀请代码";
    }
    if (action === "timescale") {
      const value = Math.min(16, Math.max(0.5, Number(args[0])));
      if (!Number.isFinite(value)) throw new Error("倍率必须是数字");
      setTimeScale(value);
      return `时间倍率已设为 ${value}×`;
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
        id: crypto.randomUUID(),
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
  useEffect(() => {
    const timer = window.setInterval(() => {
      const openChannels = [...lanChannelsRef.current].filter(
        (channel) => channel.readyState === "open",
      );
      if (!openChannels.length) return;
      const now = performance.now(),
        role = lanHostRef.current ? "host" : "guest",
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
          ].join("/");
      if (now - networkLastFullAtRef.current >= 10_000) {
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
        return;
      }
      const game = gameRef.current,
        currentIds = new Set<number>(),
        units: UnitNetworkState[] = [];
      for (const unit of game.units) {
        currentIds.add(unit.id);
        const signature = signatureOf(unit);
        if (networkUnitSignaturesRef.current.get(unit.id) === signature)
          continue;
        networkUnitSignaturesRef.current.set(unit.id, signature);
        const { path: _path, pathIndex: _pathIndex, ...networkUnit } = unit;
        units.push(networkUnit);
      }
      const removedUnitIds: number[] = [];
      for (const id of networkUnitSignaturesRef.current.keys())
        if (!currentIds.has(id)) {
          removedUnitIds.push(id);
          networkUnitSignaturesRef.current.delete(id);
        }
      const envelope: MultiplayerEnvelope = {
        type: "state_delta",
        revision: ++networkRevisionRef.current,
        role,
        units,
        removedUnitIds,
        timeOfDay: game.timeOfDay,
        timeScale: timeScaleRef.current,
        elapsedHours: game.campaign.elapsedHours,
        resources: game.resources,
        deaths: game.deaths,
      };
      openChannels.forEach((channel) => sendToChannel(channel, envelope));
    }, 200);
    return () => clearInterval(timer);
  }, []);
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
              timeScale={timeScale}
              qualityMode={qualityMode}
              showPerformance={showPerformance}
              timeScaleLocked={timeScaleLocked}
              onShowSites={setShowSites}
              onShowControl={setShowControl}
              onAutoDay={setAutoDay}
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
                      <span>时间倍率</span>
                      <input
                        type="number"
                        min="0.5"
                        max="16"
                        step="0.1"
                        value={timeScale}
                        disabled={timeScaleLocked}
                        onChange={(event) =>
                          setTimeScale(
                            Math.min(
                              16,
                              Math.max(0.5, Number(event.target.value) || 0.5),
                            ),
                          )
                        }
                      />
                    </label>
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
          setLanOutput={setLanOutput}
          lanMode={lanMode}
          setLanMode={setLanMode}
          connectedPlayers={connectedPlayers}
          playerNickname={playerNickname}
          setPlayerNickname={setPlayerNickname}
          createLanHost={createLanHost}
          joinLanHost={joinLanHost}
          acceptLanAnswer={acceptLanAnswer}
          saveName={saveName}
          setSaveName={setSaveName}
          newGameTeam={newGameTeam}
          setNewGameTeam={setNewGameTeam}
          openToLan={openToLan}
          setOpenToLan={setOpenToLan}
          aiDifficulty={aiDifficulty}
          setAiDifficulty={setAiDifficulty}
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
          launchServer={launchServer}
          deleteServer={removeServer}
          exportServer={exportServer}
          importServer={(file) => void importServer(file)}
          openServerAdmin={openServerAdmin}
        />
      )}
      {teamSelection && (
        <TeamLobby
          mode={teamSelection.mode}
          counts={teamSelection.counts}
          forcedTeam={teamSelection.forcedTeam}
          onSelect={confirmTeamSelection}
          onCancel={() => setTeamSelection(null)}
        />
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
        <span className="camp-hint">右键空地建立临时据点</span>
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
            sceneApi.current?.mobilizeAll(playerTeam, stance);
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
