import type { AiDifficulty, Snapshot, Team } from "../types";

export type HomePage = "menu" | "new" | "servers" | "settings";

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
            <div className="lan-panel legacy-lan-panel">
              <strong>局域网联机（点对点）</strong>
              <small>{lanStatus}</small>
              <div>
                <button onClick={() => void createLanHost()}>开放当前战局</button>
                <button onClick={() => void joinLanHost()}>使用主机码加入</button>
                <button onClick={() => void acceptLanAnswer()}>
                  主机确认回应码
                </button>
              </div>
              <textarea
                value={lanInput}
                onChange={(event) => setLanInput(event.target.value)}
                placeholder="粘贴对方提供的主机码或回应码"
              />
              <textarea
                readOnly
                value={lanOutput}
                placeholder="生成的联机码会显示在这里"
              />
              <small>同一局域网内手动交换一次连接码；主机负责同步战局。</small>
            </div>
          </div>
        )}
        {page === "servers" && (
          <div className="lan-panel home-server-page">
            <h2>多人联机</h2>
            <label className="lan-team-select">
              <span>玩家昵称</span>
              <input
                value={playerNickname}
                maxLength={16}
                onChange={(event) => setPlayerNickname(event.target.value)}
              />
            </label>
            <div className="lan-mode-switch">
              <button
                className={lanMode === "host" ? "active" : ""}
                onClick={() => {
                  setLanMode("host");
                  setLanInput("");
                  setLanOutput("");
                }}
              >
                创建房间
              </button>
              <button
                className={lanMode === "join" ? "active" : ""}
                onClick={() => {
                  setLanMode("join");
                  setLanInput("");
                  setLanOutput("");
                }}
              >
                加入房间
              </button>
            </div>
            <p className="lan-status">
              {lanStatus} · 已连接 {connectedPlayers} 名玩家
            </p>
            {lanMode === "host" ? (
              <>
                <button onClick={() => void createLanHost()}>
                  1. 生成一份玩家邀请
                </button>
                <textarea
                  readOnly
                  value={lanOutput}
                  placeholder="邀请代码会显示在这里，复制给玩家"
                />
                <textarea
                  value={lanInput}
                  onChange={(event) => setLanInput(event.target.value)}
                  placeholder="2. 粘贴玩家发回的回应代码"
                />
                <button onClick={() => void acceptLanAnswer()}>
                  3. 接纳这名玩家
                </button>
                <small>需要更多玩家时，再生成一份新邀请即可。</small>
              </>
            ) : (
              <>
                <label className="lan-team-select">
                  <span>控制阵营</span>
                  <select
                    value={lanTeam}
                    onChange={(event) => setLanTeam(event.target.value as Team)}
                  >
                    <option value="pku">北京大学</option>
                    <option value="thu">清华大学</option>
                  </select>
                </label>
                <textarea
                  value={lanInput}
                  onChange={(event) => setLanInput(event.target.value)}
                  placeholder="1. 粘贴主机发来的邀请代码"
                />
                <button onClick={() => void joinLanHost()}>
                  2. 生成回应代码
                </button>
                <textarea
                  readOnly
                  value={lanOutput}
                  placeholder="3. 将这里的回应代码发回主机"
                />
                <small>多名玩家可以选择同一个阵营并共同控制。</small>
              </>
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
              <div>
                <strong>{save.name}</strong>
                <span>
                  {new Date(save.savedAt).toLocaleString("zh-CN")} · {save.units.length}人
                </span>
              </div>
              <button onClick={() => loadGame(save, newGameTeam)}>进入</button>
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
