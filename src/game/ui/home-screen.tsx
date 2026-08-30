import { useState } from "react";
import type {
  AiDifficulty,
  ServerRecord,
  Snapshot,
  Team,
} from "../types";

const LOCAL_SERVER_HISTORY_KEY = "qingbei-local-server-addresses-v1";
const DEFAULT_LOCAL_SERVER_PORT = "17890";

function normalizeLocalServerAddress(rawAddress: string) {
  const trimmed = rawAddress.trim();
  if (!trimmed) return null;
  const address = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  try {
    const url = new URL(address);
    if (!url.port) url.port = DEFAULT_LOCAL_SERVER_PORT;
    return url.origin;
  } catch {
    return null;
  }
}

function readLocalServerHistory() {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(
      window.localStorage.getItem(LOCAL_SERVER_HISTORY_KEY) ?? "[]",
    );
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

export type HomePage =
  | "menu"
  | "new"
  | "servers"
  | "create-server"
  | "join-server"
  | "settings";

type HomeScreenProps = {
  page: HomePage;
  setPage: (page: HomePage) => void;
  openAssets: () => void;
  lanStatus: string;
  lanInput: string;
  setLanInput: (value: string) => void;
  lanOutput: string;
  lanMode: "host" | "join";
  setLanMode: (mode: "host" | "join") => void;
  connectedPlayers: number;
  playerNickname: string;
  setPlayerNickname: (name: string) => void;
  createLanHost: () => Promise<void>;
  joinLanHost: () => Promise<void>;
  saveName: string;
  setSaveName: (name: string) => void;
  newGameTeam: Team;
  setNewGameTeam: (team: Team) => void;
  openToLan: boolean;
  setOpenToLan: (open: boolean) => void;
  aiDifficulty: AiDifficulty;
  setAiDifficulty: (difficulty: AiDifficulty) => void;
  newGame: (team: Team) => void;
  autosave: Snapshot | null;
  saves: Snapshot[];
  loadGame: (save: Snapshot, team: Team) => void;
  clearUnfinishedGame: () => void;
  deleteSave: (savedAt: number) => void;
  exportSave: (save: Snapshot) => void;
  importPlayerSave: (file: File) => void;
  renameSave: (savedAt: number, name: string) => void;
  changeSaveIcon: (savedAt: number) => void;
  servers: ServerRecord[];
  activeServerId: string | null;
  createServer: (name: string, maxPlayers: number, mapSavedAt?: number) => void;
  launchServer: (server: ServerRecord) => void;
  stopServer: (id: string) => void;
  deleteServer: (id: string) => void;
  exportServer: (server: ServerRecord) => void;
  importServer: (file: File) => void;
  openServerAdmin: (server?: ServerRecord) => void;
  localServerMode: boolean;
  localServerManager: boolean;
  joinCurrentLocalServer: () => Promise<void>;
};

export function HomeScreen(props: HomeScreenProps) {
  const {
    page,
    setPage,
    openAssets,
    lanStatus,
    lanInput,
    setLanInput,
    lanOutput,
    lanMode,
    setLanMode,
    connectedPlayers,
    playerNickname,
    setPlayerNickname,
    createLanHost,
    joinLanHost,
    saveName,
    setSaveName,
    newGameTeam,
    setNewGameTeam,
    openToLan,
    setOpenToLan,
    aiDifficulty,
    setAiDifficulty,
    newGame,
    autosave,
    saves,
    loadGame,
    clearUnfinishedGame,
    deleteSave,
    exportSave,
    importPlayerSave,
    renameSave,
    changeSaveIcon,
    servers,
    activeServerId,
    createServer,
    launchServer,
    stopServer,
    deleteServer,
    exportServer,
    importServer,
    openServerAdmin,
    localServerMode,
    localServerManager,
    joinCurrentLocalServer,
  } = props;
  const [serverName, setServerName] = useState("清北联机服务器"),
    [serverMaxPlayers, setServerMaxPlayers] = useState(4),
    [serverMapSavedAt, setServerMapSavedAt] = useState<number | undefined>(),
    [localServerAddress, setLocalServerAddress] = useState(""),
    [localServerError, setLocalServerError] = useState(""),
    [localServerHistory, setLocalServerHistory] = useState<string[]>(
      readLocalServerHistory,
    );

  const openLocalServer = (rawAddress: string) => {
    const origin = normalizeLocalServerAddress(rawAddress);
    if (!origin) {
      setLocalServerError("请输入有效的 IP 与端口，例如 192.168.1.10:17890");
      return;
    }
    setLocalServerError("");
    const nextHistory = [
      origin,
      ...localServerHistory.filter((entry) => entry !== origin),
    ].slice(0, 6);
    setLocalServerHistory(nextHistory);
    window.localStorage.setItem(
      LOCAL_SERVER_HISTORY_KEY,
      JSON.stringify(nextHistory),
    );
    window.location.assign(
      `${origin}/qingbei-webgl-campaign/?local=1`,
    );
  };

  const forgetLocalServer = (origin: string) => {
    const nextHistory = localServerHistory.filter((entry) => entry !== origin);
    setLocalServerHistory(nextHistory);
    window.localStorage.setItem(
      LOCAL_SERVER_HISTORY_KEY,
      JSON.stringify(nextHistory),
    );
  };

  return (
    <section
      className="home-screen"
      style={{
        backgroundImage: `linear-gradient(90deg,#0308076b,#07100bc4 44%,#07100bc4 56%,#0308076b),url(${import.meta.env.BASE_URL}menu-poster-v2.webp)`,
      }}
    >
      <div className="home-card">
        <header className="home-title">
          <h1>解放清华园</h1>
          <small>燕园—清华园实时战役</small>
        </header>
        {page === "menu" && (
          <>
            <nav className="home-main-menu" aria-label="主菜单">
              <button onClick={() => setPage("new")}>新建游戏</button>
              <button onClick={() => setPage("servers")}>服务器</button>
              <button onClick={() => setPage("settings")}>设置</button>
            </nav>
            <details className="home-changelog">
              <summary>更新日志 · 已更新</summary>
              <p>新增自动房间码联机、多目标兵线与连续装备生产；优化大规模交战和载具显示。</p>
            </details>
          </>
        )}
        {page === "settings" && (
          <div className="home-settings-panel">
            <div className="home-setting-row">
              <strong>设置</strong>
              <button onClick={openAssets}>更换士兵与据点材质</button>
            </div>
            <small>玩家存档与服务器存档相互独立；均可导入或导出文件。</small>
          </div>
        )}
        {page === "servers" && (
          <div className="lan-panel home-server-page">
            <h2>{localServerManager ? "本地服务器管理" : "服务器"}</h2>
            {localServerManager && (
              <div className="local-server-connected-banner manager">
                <strong>服务器程序已连接</strong>
                <span>创建或启动一个战局后，局域网玩家即可通过 IP 与端口直接进入。</span>
              </div>
            )}
            <div
              className={`server-page-actions${localServerMode ? " local" : ""}`}
            >
              <button onClick={() => setPage("create-server")}>创建服务器</button>
              <button onClick={() => setPage("join-server")}>进入服务器</button>
              {!localServerMode && (
                <a
                  className="local-server-download"
                  href="https://github.com/Very12345/qingbei-webgl-campaign/releases/latest/download/qingbei-server-windows-amd64.exe"
                >
                  下载本地服务器
                </a>
              )}
            </div>
            <p className="lan-status">
              {lanStatus} · 当前连接 {connectedPlayers} 名远程玩家
            </p>
            <small>本地服务器版使用WebSocket/TCP，无需WebRTC、STUN或TURN，并支持自动更新。</small>
            <div className="server-save-list">
              {servers.length ? (
                servers.map((server) => (
                  <article
                    key={server.id}
                    className={activeServerId === server.id ? "online" : "offline"}
                  >
                    <div>
                      <strong>
                        <i className="server-status-dot" />
                        {server.name}
                      </strong>
                      <span>
                        {activeServerId === server.id ? "运行中" : "已停止"} · 地图：
                        {server.map.name} · {activeServerId === server.id ? "当前" : "上次"}玩家 {server.players.length}/
                        {server.maxPlayers} · {new Date(server.updatedAt).toLocaleString("zh-CN")}
                      </span>
                    </div>
                    {activeServerId === server.id ? (
                      <button className="server-stop" onClick={() => stopServer(server.id)}>
                        停止
                      </button>
                    ) : (
                      <button onClick={() => launchServer(server)}>启动</button>
                    )}
                    <button onClick={() => openServerAdmin(server)}>
                      控制台
                    </button>
                    <button onClick={() => exportServer(server)}>导出</button>
                    <button
                      className="delete"
                      disabled={activeServerId === server.id}
                      onClick={() => deleteServer(server.id)}
                    >
                      删除
                    </button>
                  </article>
                ))
              ) : (
                <p>尚未创建服务器。</p>
              )}
            </div>
          </div>
        )}
        {page === "create-server" && (
          <div className="world-settings server-create-panel">
            <h2>创建服务器</h2>
            <label>
              <span>服务器名称</span>
              <input
                value={serverName}
                maxLength={24}
                onChange={(event) => setServerName(event.target.value)}
              />
            </label>
            <label>
              <span>最大玩家</span>
              <select
                value={serverMaxPlayers}
                onChange={(event) => setServerMaxPlayers(Number(event.target.value))}
              >
                {[2, 3, 4, 5, 6, 7, 8].map((count) => (
                  <option value={count} key={count}>{count}人</option>
                ))}
              </select>
            </label>
            <label>
              <span>基础地图</span>
              <select
                value={serverMapSavedAt ?? "fresh"}
                onChange={(event) =>
                  setServerMapSavedAt(
                    event.target.value === "fresh"
                      ? undefined
                      : Number(event.target.value),
                  )
                }
              >
                <option value="fresh">新服务器地图</option>
                {saves.map((save) => (
                  <option value={save.savedAt} key={save.savedAt}>{save.name}</option>
                ))}
              </select>
            </label>
            <button
              onClick={() => {
                createServer(serverName, serverMaxPlayers, serverMapSavedAt);
                setPage("servers");
              }}
            >
              创建
            </button>
            <label className="file-action server-import-action">
              上传服务器文件
              <input
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) importServer(file);
                  event.currentTarget.value = "";
                  setPage("servers");
                }}
              />
            </label>
            <small>详细地图、同阵营规则和运行参数可在创建后的“控制台”中配置。</small>
          </div>
        )}
        {page === "join-server" && (
          <div className="lan-panel home-server-page">
            <h2>进入服务器</h2>
            {localServerMode ? (
              <section className="local-server-connected-banner">
                <small>已连接本地服务器</small>
                <h3>{window.location.host}</h3>
                <p>点击后将自动查找这台服务器当前运行的战局，并进入阵营选择。</p>
                <button onClick={() => void joinCurrentLocalServer()}>
                  进入这台服务器
                </button>
                <span>{lanStatus}</span>
              </section>
            ) : (
              <section className="local-server-address-panel">
              <h3>本地服务器</h3>
              <label>
                <span>IP 与端口</span>
                <input
                  value={localServerAddress}
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="192.168.1.10:17890"
                  onChange={(event) => {
                    setLocalServerAddress(event.target.value);
                    setLocalServerError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      openLocalServer(localServerAddress);
                    }
                  }}
                />
              </label>
              <button onClick={() => openLocalServer(localServerAddress)}>
                添加并打开服务器
              </button>
              {localServerError && (
                <p className="local-server-error" role="alert">
                  {localServerError}
                </p>
              )}
              <small>
                将打开服务器提供的游戏页面；首次使用前，请在主机上运行本地服务器程序。
              </small>
              {localServerHistory.length > 0 && (
                <div className="local-server-history">
                  <strong>历史服务器</strong>
                  {localServerHistory.map((origin) => (
                    <article key={origin}>
                      <span>{origin.replace(/^https?:\/\//, "")}</span>
                      <button onClick={() => openLocalServer(origin)}>打开</button>
                      <button
                        className="delete"
                        aria-label={`删除服务器 ${origin}`}
                        onClick={() => forgetLocalServer(origin)}
                      >
                        删除
                      </button>
                    </article>
                  ))}
                </div>
              )}
              </section>
            )}
            <div className="server-join-divider">
              <span>{localServerMode ? "高级：指定房间码" : "或使用房间码联机"}</span>
            </div>
            <label className="lan-team-select">
              <span>玩家昵称</span>
              <input
                value={playerNickname}
                maxLength={16}
                onChange={(event) => setPlayerNickname(event.target.value)}
              />
            </label>
            <textarea
              value={lanInput}
              onChange={(event) => setLanInput(event.target.value)}
              placeholder="输入房间码，例如 ABCDE-12345"
            />
            <button onClick={() => void joinLanHost()}>
              查找房间并进入阵营大厅
            </button>
            {lanOutput.startsWith("{") && (
              <details className="legacy-connection-details">
                <summary>兼容模式回应码</summary>
                <textarea readOnly value={lanOutput} />
              </details>
            )}
          </div>
        )}
        {page === "new" && (
          <div className="world-settings">
            <h2>新建游戏</h2>
            <label>
              <span>战局名称</span>
              <input
                value={saveName}
                maxLength={24}
                onChange={(event) => setSaveName(event.target.value)}
              />
            </label>
            <label>
              <span>玩家视角</span>
              <select
                value={newGameTeam}
                onChange={(event) => setNewGameTeam(event.target.value as Team)}
              >
                <option value="pku">北京大学</option>
                <option value="thu">清华大学</option>
              </select>
            </label>
            <label>
              <span>对局域网开放</span>
              <select
                value={openToLan ? "yes" : "no"}
                onChange={(event) => setOpenToLan(event.target.value === "yes")}
              >
                <option value="no">关闭</option>
                <option value="yes">开放</option>
              </select>
            </label>
            <label>
              <span>人机难度</span>
              <select
                value={aiDifficulty}
                onChange={(event) =>
                  setAiDifficulty(event.target.value as AiDifficulty)
                }
              >
                <option value="casual">休闲</option>
                <option value="standard">标准</option>
                <option value="hard">困难</option>
              </select>
            </label>
            <button
              className="new-game-button"
              onClick={() => {
                newGame(newGameTeam);
                if (openToLan) void createLanHost();
              }}
            >
              创建新战局
            </button>
          </div>
        )}
        <div className={`home-save-list ${page !== "new" ? "home-page-hidden" : ""}`}>
          <h2>选择存档</h2>
          <label className="file-action save-import-action">
            上传存档文件
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) importPlayerSave(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
          {autosave && (
            <article className="unfinished-save">
              <div>
                <strong>未完成战局</strong>
                <span>
                  {new Date(autosave.savedAt).toLocaleString("zh-CN")} · {autosave.units.length}人 · 自动保存
                </span>
              </div>
              <button onClick={() => loadGame(autosave, newGameTeam)}>继续</button>
              <button onClick={clearUnfinishedGame}>放弃</button>
            </article>
          )}
          {!autosave && !saves.length && <p>暂无存档，可直接开始新游戏。</p>}
          {saves.map((save) => (
            <article key={save.savedAt}>
              <button
                className={`save-icon ${save.icon ?? "map"}`}
                onClick={() => changeSaveIcon(save.savedAt)}
                title="更换存档图标"
                aria-label="更换存档图标"
              />
              <div>
                <strong>{save.name}</strong>
                <span>
                  {new Date(save.savedAt).toLocaleString("zh-CN")} · {save.units.length}人
                </span>
              </div>
              <button onClick={() => loadGame(save, newGameTeam)}>进入</button>
              <button
                onClick={() => {
                  const name = window.prompt("新的存档名称", save.name);
                  if (name != null) renameSave(save.savedAt, name);
                }}
              >
                改名
              </button>
              <button onClick={() => exportSave(save)}>导出</button>
              <button className="delete" onClick={() => deleteSave(save.savedAt)}>
                删除
              </button>
            </article>
          ))}
        </div>
        {page !== "menu" && (
          <nav className="home-bottom-nav">
            <button onClick={() => setPage("menu")}>返回主菜单</button>
          </nav>
        )}
      </div>
    </section>
  );
}
