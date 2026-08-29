import { useState } from "react";
import type {
  AiDifficulty,
  ServerConfigurationDraft,
  ServerRecord,
  Snapshot,
  Team,
} from "../types";

export type HomePage =
  | "menu"
  | "new"
  | "servers"
  | "server-config"
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
  setLanOutput: (value: string) => void;
  lanMode: "host" | "join";
  setLanMode: (mode: "host" | "join") => void;
  lanTeam: Team;
  setLanTeam: (team: Team) => void;
  connectedPlayers: number;
  playerNickname: string;
  setPlayerNickname: (name: string) => void;
  createLanHost: () => Promise<void>;
  joinLanHost: () => Promise<void>;
  acceptLanAnswer: () => Promise<void>;
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
  saveServerConfiguration: (draft: ServerConfigurationDraft) => void;
  launchServer: (server: ServerRecord) => void;
  deleteServer: (id: string) => void;
  exportServer: (server: ServerRecord) => void;
  importServer: (file: File) => void;
  forcedLanTeam: Team | null;
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
    setLanOutput,
    lanMode,
    setLanMode,
    lanTeam,
    setLanTeam,
    connectedPlayers,
    playerNickname,
    setPlayerNickname,
    createLanHost,
    joinLanHost,
    acceptLanAnswer,
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
    saveServerConfiguration,
    launchServer,
    deleteServer,
    exportServer,
    importServer,
    forcedLanTeam,
  } = props;
  const [editingServer, setEditingServer] = useState<ServerRecord | null>(null);
  const [serverName, setServerName] = useState("清北联机服务器");
  const [serverHostTeam, setServerHostTeam] = useState<Team>("pku");
  const [serverMaxPlayers, setServerMaxPlayers] = useState(4);
  const [serverAllowSameTeam, setServerAllowSameTeam] = useState(true);
  const [serverMapSavedAt, setServerMapSavedAt] = useState<number | undefined>();
  const openServerConfiguration = (server?: ServerRecord) => {
    setEditingServer(server ?? null);
    setServerName(server?.name ?? "清北联机服务器");
    setServerHostTeam(server?.hostTeam ?? "pku");
    setServerMaxPlayers(server?.maxPlayers ?? 4);
    setServerAllowSameTeam(server?.allowSameTeam ?? true);
    setServerMapSavedAt(undefined);
    setPage("server-config");
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
          <nav className="home-main-menu" aria-label="主菜单">
            <button onClick={() => setPage("new")}>新建游戏</button>
            <button onClick={() => setPage("servers")}>服务器</button>
            <button onClick={() => setPage("settings")}>设置</button>
          </nav>
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
            <h2>服务器</h2>
            <div className="server-page-actions">
              <button onClick={() => openServerConfiguration()}>创建服务器</button>
              <button onClick={() => setPage("join-server")}>进入服务器</button>
              <label className="file-action">
                上传服务器文件
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) importServer(file);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
            <p className="lan-status">
              {lanStatus} · 当前连接 {connectedPlayers} 名远程玩家
            </p>
            <div className="server-save-list">
              {servers.length ? (
                servers.map((server) => (
                  <article key={server.id}>
                    <div>
                      <strong>{server.name}</strong>
                      <span>
                        地图：{server.map.name} · 玩家 {server.players.length}/
                        {server.maxPlayers}
                      </span>
                    </div>
                    <button onClick={() => launchServer(server)}>
                      快捷邀请自己并启动
                    </button>
                    <button onClick={() => openServerConfiguration(server)}>
                      配置
                    </button>
                    <button onClick={() => exportServer(server)}>导出</button>
                    <button className="delete" onClick={() => deleteServer(server.id)}>
                      删除
                    </button>
                  </article>
                ))
              ) : (
                <p>尚未创建服务器。</p>
              )}
            </div>
            <section className="server-invite-panel">
              <strong>邀请与接纳玩家</strong>
              <textarea
                readOnly
                value={lanOutput}
                placeholder="启动服务器后，邀请代码会显示在这里"
              />
              <textarea
                value={lanInput}
                onChange={(event) => setLanInput(event.target.value)}
                placeholder="粘贴玩家发回的回应代码"
              />
              <button onClick={() => void acceptLanAnswer()}>接纳回应玩家</button>
            </section>
          </div>
        )}
        {page === "server-config" && (
          <div className="world-settings server-config-page">
            <h2>{editingServer ? "服务器配置" : "创建服务器"}</h2>
            <p>此页面仅管理服务器，不显示或运行具体战局。</p>
            <label>
              <span>服务器名称</span>
              <input
                value={serverName}
                maxLength={24}
                onChange={(event) => setServerName(event.target.value)}
              />
            </label>
            <label>
              <span>主机阵营</span>
              <select
                value={serverHostTeam}
                onChange={(event) => setServerHostTeam(event.target.value as Team)}
              >
                <option value="pku">北京大学</option>
                <option value="thu">清华大学</option>
              </select>
            </label>
            <label>
              <span>最大玩家数</span>
              <input
                type="number"
                min={2}
                max={8}
                value={serverMaxPlayers}
                onChange={(event) => setServerMaxPlayers(Number(event.target.value))}
              />
            </label>
            <label>
              <span>导入玩家存档作为地图</span>
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
                <option value="fresh">新战局地图</option>
                {saves.map((save) => (
                  <option key={save.savedAt} value={save.savedAt}>
                    {save.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>后续玩家可同阵营</span>
              <input
                type="checkbox"
                checked={serverAllowSameTeam}
                onChange={(event) => setServerAllowSameTeam(event.target.checked)}
              />
            </label>
            <section className="server-player-list">
              <strong>当前玩家</strong>
              {editingServer?.players.length ? (
                editingServer.players.map((player) => (
                  <span key={player.id}>
                    {player.nickname} · {player.team === "pku" ? "北大" : "清华"}
                    {player.host ? " · 主机" : ""}
                  </span>
                ))
              ) : (
                <span>服务器尚未启动。</span>
              )}
            </section>
            <button
              onClick={() =>
                saveServerConfiguration({
                  id: editingServer?.id,
                  name: serverName,
                  hostTeam: serverHostTeam,
                  maxPlayers: serverMaxPlayers,
                  allowSameTeam: serverAllowSameTeam,
                  mapSavedAt: serverMapSavedAt,
                })
              }
            >
              保存服务器配置
            </button>
          </div>
        )}
        {page === "join-server" && (
          <div className="lan-panel home-server-page">
            <h2>进入服务器</h2>
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
              placeholder="粘贴服务器邀请代码"
            />
            <label className="lan-team-select">
              <span>控制阵营</span>
              <select
                value={lanTeam}
                disabled={forcedLanTeam != null}
                onChange={(event) => setLanTeam(event.target.value as Team)}
              >
                <option value="pku">北京大学</option>
                <option value="thu">清华大学</option>
              </select>
            </label>
            {forcedLanTeam && (
              <small>
                服务器当前只有一名玩家，已强制选择另一阵营以保证对局开始。
              </small>
            )}
            <button onClick={() => void joinLanHost()}>生成回应并加入</button>
            <textarea readOnly value={lanOutput} placeholder="将回应代码发回主机" />
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
