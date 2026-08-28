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
        <div className="active-status-list">
          {(campaign.statuses ?? []).length ? (
            campaign.statuses.map((status) => (
              <article key={status.id} className={status.team}>
                <strong>{status.title}</strong>
                <span>
                  {status.team === "pku" ? "北大" : "清华"} · 攻击
                  {Math.round(status.attack * 100)}% · 移速
                  {Math.round(status.movement * 100)}% · 意志
                  {Math.round(status.morale * 100)}%
                </span>
                <small>
                  剩余 {Math.max(0, status.until - campaign.elapsedHours).toFixed(1)} 小时
                </small>
              </article>
            ))
          ) : (
            <p>当前没有限时状态。</p>
          )}
        </div>
        <h3>历史事件</h3>
        <div className="event-history-list">
          {[...(campaign.eventHistory ?? [])].reverse().map((entry) => (
            <article key={entry.id}>
              <time>{entry.date}</time>
              <strong>{entry.title}</strong>
              <p>{entry.effect}</p>
            </article>
          ))}
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
                {event.sourceUrl && (
                  <a
                    className="event-source"
                    href={event.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看事件来源
                  </a>
                )}
              </section>
            ))}
          </div>
          <button onClick={onClose}>继续战局</button>
        </div>
      </article>
    </div>
  );
}
