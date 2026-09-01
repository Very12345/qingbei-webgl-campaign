import type { RefObject } from "react";
import type { BattleStats } from "../engine/contracts";
import type { CampaignState, SiteState, Stance, Team } from "../types";

export function WarOverview({
  campaign,
  stats,
  resources,
  deaths,
  onRestart,
}: {
  campaign: CampaignState;
  stats: BattleStats;
  resources: Record<Team, number>;
  deaths: Record<Team, number>;
  onRestart: () => void;
}) {
  return (
    <aside className="war-overview">
      <h2>总体战况</h2>
      <p className="campaign-phase">
        {campaign.warUnlocked ? "⚔ 交战已开放" : "☮ 校园对峙期"}
      </p>
      {campaign.outcome && (
        <div className={`outcome ${campaign.outcome.winner}`}>
          <strong>
            {campaign.outcome.winner === "pku"
              ? "北大胜利"
              : `${campaign.thuFactionName}胜利`}
          </strong>
          <small>{campaign.outcome.reason} · 战局可继续</small>
        </div>
      )}
      <div className="stat-grid">
        <span>总兵力</span>
        <b className="red">{stats.pku}</b>
        <b className="purple">{stats.thu}</b>
        <span>控制据点</span>
        <b className="red">{stats.pkuSites}</b>
        <b className="purple">{stats.thuSites}</b>
        <span>增长/小时</span>
        <b className="red">+{stats.pkuGrowth.toFixed(1)}</b>
        <b className="purple">+{stats.thuGrowth.toFixed(1)}</b>
        <span>战略资源</span>
        <b className="red">{Math.floor(resources.pku)}</b>
        <b className="purple">{Math.floor(resources.thu)}</b>
        <span>累计阵亡</span>
        <b className="red">{deaths.pku}</b>
        <b className="purple">{deaths.thu}</b>
      </div>
      <button onClick={onRestart}>重新开始</button>
    </aside>
  );
}

export function SiteCommandMenu({
  menuRef,
  site,
  playerTeam,
  nearbyFriendly,
  renaming,
  renameDraft,
  stanceText,
  onRenameDraft,
  onRename,
  onCancelRename,
  onStance,
}: {
  menuRef: RefObject<HTMLElement | null>;
  site: SiteState;
  playerTeam: Team;
  nearbyFriendly: number;
  renaming: boolean;
  renameDraft: string;
  stanceText: Record<Stance, { title: string; detail: string }>;
  onRenameDraft: (value: string) => void;
  onRename: () => void;
  onCancelRename: () => void;
  onStance: (stance: Stance) => void;
}) {
  return (
    <section
      ref={menuRef}
      className={`site-menu floating-site-menu ${site.team}`}
    >
      <div className="site-heading-row">
        {renaming ? (
          <input
            autoFocus
            value={renameDraft}
            maxLength={24}
            onChange={(event) => onRenameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onRename();
              if (event.key === "Escape") onCancelRename();
            }}
            aria-label="据点名称"
          />
        ) : (
          <strong>{site.displayName ?? site.name}</strong>
        )}
        <button
          className="rename-icon"
          disabled={site.team !== playerTeam}
          onClick={onRename}
          aria-label={renaming ? "保存名称" : "修改名称"}
          title={renaming ? "保存名称" : "修改名称"}
        >
          <span className="ui-pencil" aria-hidden="true" />
        </button>
        <span className="metric-icon supply-icon" title="补给" />
        <b className="metric-value supply-value">{Math.round(site.supply)}</b>
        <span className="metric-icon soldier-icon" title="附近友军" />
        <b className="metric-value troop-value">{nearbyFriendly}</b>
      </div>
      <div className="site-mode-actions">
        {(Object.keys(stanceText) as Stance[]).map((stance) => (
          <button
            key={stance}
            title={`${stanceText[stance].title} · 输送${stance === "defend" ? 40 : stance === "guard" ? 70 : 100}%`}
            aria-label={`${stanceText[stance].title}模式`}
            className={site.stance === stance ? "active" : ""}
            disabled={site.team !== playerTeam}
            onClick={() => onStance(stance)}
          >
            <span className={`mode-icon ${stance}`} aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}

export function DayScaleControl({
  timeOfDay,
  timeScale,
  onTimeScale,
  locked = false,
}: {
  timeOfDay: number;
  timeScale: number;
  onTimeScale: (value: number) => void;
  locked?: boolean;
}) {
  return (
    <div className="day-slider">
      <span>昼夜</span>
      <input
        aria-label="时间"
        type="range"
        min="0"
        max="24"
        step=".1"
        value={timeOfDay}
        disabled
      />
      <select
        aria-label="时间流逝倍率"
        value={timeScale}
        disabled={locked}
        onChange={(event) => onTimeScale(Number(event.target.value))}
      >
        {![0.5, 1, 2, 4, 8, 16, 32, 64].includes(timeScale) && (
          <option value={timeScale}>{timeScale}×</option>
        )}
        <option value={0.5}>0.5×</option>
        <option value={1}>1×</option>
        <option value={2}>2×</option>
        <option value={4}>4×</option>
        <option value={8}>8×</option>
        <option value={16}>16×</option>
        <option value={32}>32×（可能卡顿）</option>
        <option value={64}>64×（可能卡顿）</option>
      </select>
      {timeScale > 16 && (
        <small className="time-scale-warning">超过16×可能造成卡顿</small>
      )}
    </div>
  );
}
