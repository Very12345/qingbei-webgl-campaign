import { useState } from "react";
import type { PerformanceMetrics } from "../../performance-controller";
import type {
  AcademicYearOutcome,
  CampaignState,
  EventCard,
  Team,
} from "../types";

export function PerformanceHud({
  metrics,
  pixelRatio,
}: {
  metrics: PerformanceMetrics;
  pixelRatio: number;
}) {
  return (
    <aside className="performance-hud">
      <strong>{metrics.fps.toFixed(0)} FPS</strong>
      <span>{metrics.frameMs.toFixed(1)} ms</span>
      <span>{metrics.drawCalls} draw</span>
      <span>{metrics.instancedUnits} 人</span>
      <span>模拟 {metrics.simulationMs.toFixed(1)} ms</span>
      <span>寻路 {metrics.pathfindingMs.toFixed(1)} ms</span>
      <span>存档 {metrics.saveMs.toFixed(1)} ms</span>
      <small>
        {metrics.quality} · DPR {pixelRatio}
      </small>
    </aside>
  );
}

export function EventLogOverlay({
  campaign,
  onClose,
}: {
  campaign: CampaignState;
  onClose: () => void;
}) {
  const history = [...(campaign.eventHistory ?? [])].reverse();
  const [selectedId, setSelectedId] = useState<string | null>(
    history[0]?.id ?? null,
  );
  const selected = history.find((entry) => entry.id === selectedId) ?? history[0];
  const modifier = (
    label: string,
    value: number | undefined,
    inverse = false,
  ) => {
    if (value == null || Math.abs(value - 1) < 0.001) return null;
    const delta = Math.round((value - 1) * 100),
      good = inverse ? delta < 0 : delta > 0;
    return (
      <span className={good ? "positive" : "negative"} key={label}>
        {label} {delta > 0 ? "+" : ""}{delta}%
      </span>
    );
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="event-log-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2>事件档案</h2>
            <small>历史事件与当前生效状态</small>
          </div>
          <button onClick={onClose}>关闭</button>
        </header>
        <h3>当前状态</h3>
        <div className="faction-base-status">
          <article className="pku">
            <strong>北大全局</strong>
            <span>攻击 {Math.round(campaign.attackBonus.pku * 100)}%</span>
          </article>
          <article className="thu">
            <strong>{campaign.thuFactionName}全局</strong>
            <span>攻击 {Math.round(campaign.attackBonus.thu * 100)}%</span>
          </article>
        </div>
        <div className="active-status-list">
          {(campaign.statuses ?? []).length ? (
            campaign.statuses.map((status) => (
              <article key={status.id} className={status.team}>
                <header>
                  <strong>{status.team === "pku" ? "北大状态" : `${campaign.thuFactionName}状态`}</strong>
                  <small>剩余 {Math.max(0, status.until - campaign.elapsedHours).toFixed(1)} 小时</small>
                </header>
                <div className="status-effect-chips">
                  {modifier("攻击", status.attack)}
                  {modifier("移动", status.movement)}
                  {modifier("意志", status.morale)}
                  {modifier("生产", status.production)}
                  {modifier("防守", status.defense)}
                  {modifier("治疗", status.healing)}
                  {modifier("补给消耗", status.supplyUse, true)}
                  {modifier("渡河", status.riverMovement)}
                </div>
                <small className="status-origin">状态来源：{status.title}</small>
              </article>
            ))
          ) : (
            <p>当前没有限时状态。</p>
          )}
        </div>
        <h3>历史事件</h3>
        <div className="event-history-browser">
          <div className="event-history-list">
            {history.map((entry) => (
              <button
                key={entry.id}
                className={entry.id === selected?.id ? "active" : ""}
                onClick={() => setSelectedId(entry.id)}
              >
                <time>{entry.date}</time>
                <strong>{entry.title}</strong>
                <small>{entry.effect}</small>
              </button>
            ))}
          </div>
          {selected ? (
            <article className="event-history-detail">
              <div
                className={`event-history-image ${selected.quadrant} event-${selected.id}`}
                style={{
                  backgroundImage: `linear-gradient(#0002,#0005),url(${selected.image ? `${import.meta.env.BASE_URL}${selected.image}` : `${import.meta.env.BASE_URL}event-archive-sheet-v2.webp`})`,
                  backgroundSize: selected.image ? "contain" : "400% 200%",
                }}
              />
              <time>{selected.date}</time>
              <h2>{selected.title}</h2>
              <p>{selected.body}</p>
              <div className="event-effect">机制效果：{selected.effect}</div>
            </article>
          ) : (
            <p>尚未发生历史事件。</p>
          )}
        </div>
      </section>
    </div>
  );
}

export function VictoryOverlay({
  broadcast,
  onClose,
}: {
  broadcast: { winner: Team; title: string; body: string };
  onClose: () => void;
}) {
  return (
    <div className="victory-backdrop">
      <section className={`victory-card ${broadcast.winner}`}>
        <small>战役结果已记录</small>
        <h2>{broadcast.title}</h2>
        <p>{broadcast.body}</p>
        <button onClick={onClose}>继续游戏</button>
      </section>
    </div>
  );
}

export function AcademicYearOverlay({
  outcome,
  thuFactionName,
  onClose,
}: {
  outcome: AcademicYearOutcome;
  thuFactionName: string;
  onClose: () => void;
}) {
  return (
    <div className="victory-backdrop">
      <section className={`victory-card academic ${outcome.result}`}>
        <small>2026—2027学年结语</small>
        <h2>
          {outcome.result === "draw"
            ? "清北长期僵持"
            : outcome.result === "pku"
              ? "北大学年优势"
              : `${thuFactionName}学年优势`}
        </h2>
        <div className="academic-score">
          <strong>北大 {outcome.pkuScore.toFixed(1)}</strong>
          <strong>
            {thuFactionName} {outcome.thuScore.toFixed(1)}
          </strong>
        </div>
        <p>{outcome.summary}</p>
        <p>这是学年阶段记录，不覆盖求真或元培产生的正式胜负。</p>
        <button onClick={onClose}>继续游戏</button>
      </section>
    </div>
  );
}

export function EventBatchOverlay({
  events,
  onClose,
}: {
  events: EventCard[];
  onClose: () => void;
}) {
  const lead = events[0];
  if (!lead) return null;
  return (
    <div className="event-backdrop">
      <article className="event-card event-batch-card">
        <div
          className={`event-photo ${lead.quadrant} event-${lead.id}`}
          style={{
            backgroundImage: `linear-gradient(#0002,#0005),url(${lead.image ? `${import.meta.env.BASE_URL}${lead.image}` : `${import.meta.env.BASE_URL}event-archive-sheet-v2.webp`})`,
            backgroundSize: lead.image ? "contain" : "400% 200%",
            backgroundRepeat: lead.image ? "no-repeat" : "repeat",
            backgroundPosition: lead.image ? "center" : undefined,
            backgroundColor: lead.image ? "#070909" : undefined,
          }}
        />
        <div className="event-copy">
          <small>同时发生 {events.length} 项事件</small>
          <div className="event-batch-items">
            {events.map((event) => (
              <section key={event.id}>
                <time>{event.date}</time>
                <h2>{event.title}</h2>
                <p>{event.body}</p>
                <div className="event-effect">机制效果：{event.effect}</div>
              </section>
            ))}
          </div>
          <button onClick={onClose}>继续战局</button>
        </div>
      </article>
    </div>
  );
}
