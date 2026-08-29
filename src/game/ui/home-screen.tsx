import type {
  AiDifficulty,
  ServerRecord,
  Snapshot,
  Team,
} from "../types";

export type HomePage =
  | "menu"
  | "new"
  | "servers"
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
  launchServer: (server: ServerRecord) => void;
  deleteServer: (id: string) => void;
  exportServer: (server: ServerRecord) => void;
  importServer: (file: File) => void;
  openServerAdmin: (server?: ServerRecord) => void;
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
    launchServer,
    deleteServer,
    exportServer,
    importServer,
    openServerAdmin,
  } = props;

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
              <button onClick={() => openServerAdmin()}>创建服务器</button>
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
                    <button onClick={() => openServerAdmin(server)}>
                      管理控制台
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
