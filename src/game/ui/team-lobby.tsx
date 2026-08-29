import type { Team } from "../types";

export function TeamLobby({
  mode,
  counts,
  forcedTeam,
  onSelect,
  onCancel,
}: {
  mode: "host" | "guest";
  counts: Record<Team, number>;
  forcedTeam: Team | null;
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
        <p>选择前可查看双方当前操作者人数。阵营确认后才进入战局。</p>
        <div className="team-lobby-options">
          {(["pku", "thu"] as Team[]).map((team) => {
            const disabled = forcedTeam != null && forcedTeam !== team;
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
