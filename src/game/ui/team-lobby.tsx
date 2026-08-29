import type { Team } from "../types";

export function TeamLobby({
  mode,
  counts,
  forcedTeam,
  nickname,
  onNicknameChange,
  onSelect,
  onCancel,
}: {
  mode: "host" | "guest";
  counts: Record<Team, number>;
  forcedTeam: Team | null;
  nickname: string;
  onNicknameChange: (nickname: string) => void;
  onSelect: (team: Team) => void;
  onCancel: () => void;
}) {
  return (
    <div className="modal-backdrop team-lobby-backdrop">
      <section className="team-lobby-card">
        <header>
          <div>
            <small>{mode === "host" ? "启动服务器" : "进入服务器"}</small>
            <h2>选择操作者阵营</h2>
          </div>
          <button onClick={onCancel}>取消</button>
        </header>
        <p>先填写本机玩家名称，再选择阵营。阵营确认后才进入战局。</p>
        <label className="team-lobby-name">
          <span>本机玩家名称</span>
          <input
            value={nickname}
            minLength={2}
            maxLength={16}
            autoFocus
            onChange={(event) => onNicknameChange(event.target.value)}
            placeholder="2—16个字符"
          />
        </label>
        <div className="team-lobby-options">
          {(["pku", "thu"] as Team[]).map((team) => {
            const disabled =
              nickname.trim().length < 2 ||
              (forcedTeam != null && forcedTeam !== team);
            return (
              <button
                key={team}
                className={team}
                disabled={disabled}
                onClick={() => onSelect(team)}
              >
                <span className="team-lobby-seal">{team === "pku" ? "北" : "清"}</span>
                <strong>{team === "pku" ? "北京大学" : "清华大学"}</strong>
                <b>{counts[team]}</b>
                <small>名操作者</small>
              </button>
            );
          })}
        </div>
        {forcedTeam && (
          <p className="team-lobby-rule">
            当前仅有一方存在操作者；为确保对局能够开始，第二名玩家必须加入另一方。
          </p>
        )}
      </section>
    </div>
  );
}
