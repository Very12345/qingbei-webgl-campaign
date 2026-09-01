import type { QualityMode } from "../../performance-controller";
import type { BattleStats } from "../engine/contracts";
import type { BattleAlert, ChatChannel, ChatMessage, Team } from "../types";

export function MoreDrawer({
  clock,
  stats,
  deaths,
  alerts,
  onOpenEvents,
  onSave,
}: {
  clock: string;
  stats: BattleStats;
  deaths: Record<Team, number>;
  alerts: BattleAlert[];
  onOpenEvents: () => void;
  onSave: () => void;
}) {
  const unseen = alerts.filter((alert) => !alert.seen);
  return (
    <aside className="battle-drawer more-drawer">
      <header>
        <strong>战况与记录</strong>
        <span>{clock}</span>
      </header>
      <div className="drawer-stats">
        <span>总兵力</span>
        <b className="red">{stats.pku}</b>
        <b className="purple">{stats.thu}</b>
        <span>据点</span>
        <b className="red">{stats.pkuSites}</b>
        <b className="purple">{stats.thuSites}</b>
        <span>增长/时</span>
        <b className="red">+{stats.pkuGrowth.toFixed(1)}</b>
        <b className="purple">+{stats.thuGrowth.toFixed(1)}</b>
        <span>阵亡</span>
        <b className="red">{deaths.pku}</b>
        <b className="purple">{deaths.thu}</b>
      </div>
      <div className="drawer-battle-log">
        <strong>战报</strong>
        {unseen
          .slice(-4)
          .reverse()
          .map((alert) => (
            <span key={alert.id}>
              未查看交战 · 坐标 {alert.x.toFixed(1)}, {alert.z.toFixed(1)}
            </span>
          ))}
        {!unseen.length && <span>暂无未查看交战。</span>}
      </div>
      <button onClick={onOpenEvents}>事件档案</button>
      <button onClick={onSave}>保存当前战局</button>
    </aside>
  );
}

export function SettingsDrawer({
  showSites,
  showControl,
  autoDay,
  eventPopupEnabled,
  timeScale,
  qualityMode,
  showPerformance,
  timeScaleLocked,
  onShowSites,
  onShowControl,
  onAutoDay,
  onEventPopupEnabled,
  onTimeScale,
  onQualityMode,
  onShowPerformance,
}: {
  showSites: boolean;
  showControl: boolean;
  autoDay: boolean;
  eventPopupEnabled: boolean;
  timeScale: number;
  qualityMode: QualityMode;
  showPerformance: boolean;
  timeScaleLocked: boolean;
  onShowSites: (value: boolean) => void;
  onShowControl: (value: boolean) => void;
  onAutoDay: (value: boolean) => void;
  onEventPopupEnabled: (value: boolean) => void;
  onTimeScale: (value: number) => void;
  onQualityMode: (value: QualityMode) => void;
  onShowPerformance: (value: boolean) => void;
}) {
  return (
    <aside className="battle-drawer settings-drawer">
      <strong>显示与时间</strong>
      <label>
        <span>显示据点</span>
        <input
          type="checkbox"
          checked={showSites}
          onChange={(event) => onShowSites(event.target.checked)}
        />
      </label>
      <label>
        <span>显示控制范围</span>
        <input
          type="checkbox"
          checked={showControl}
          onChange={(event) => onShowControl(event.target.checked)}
        />
      </label>
      <label>
        <span>自动昼夜</span>
        <input
          type="checkbox"
          checked={autoDay}
          onChange={(event) => onAutoDay(event.target.checked)}
        />
      </label>
      <label>
        <span>事件弹窗</span>
        <input
          type="checkbox"
          checked={eventPopupEnabled}
          onChange={(event) => onEventPopupEnabled(event.target.checked)}
        />
      </label>
      <label className="time-scale-field">
        <span>时间倍率</span>
        <input
          type="number"
          min="0.5"
          max="64"
          step="0.1"
          value={timeScale}
          disabled={timeScaleLocked}
          onChange={(event) =>
            onTimeScale(
              Math.min(64, Math.max(0.5, Number(event.target.value) || 0.5)),
            )
          }
        />
        {timeScaleLocked && <small>联机时间倍率由服务器统一控制</small>}
        {!timeScaleLocked && timeScale > 16 && (
          <small className="time-scale-warning">
            超过16×可能造成卡顿或降低画面流畅度
          </small>
        )}
      </label>
      <label>
        <span>画质模式</span>
        <select
          value={qualityMode}
          onChange={(event) => onQualityMode(event.target.value as QualityMode)}
        >
          <option value="auto">自动</option>
          <option value="low">低</option>
          <option value="medium">中</option>
          <option value="high">高</option>
        </select>
      </label>
      <label>
        <span>性能信息</span>
        <input
          type="checkbox"
          checked={showPerformance}
          onChange={(event) => onShowPerformance(event.target.checked)}
        />
      </label>
    </aside>
  );
}

export function ChatPanel({
  channel,
  messages,
  unread,
  input,
  onChannel,
  onInput,
  onSend,
  onClose,
}: {
  channel: ChatChannel;
  messages: ChatMessage[];
  unread: Record<ChatChannel, number>;
  input: string;
  onChannel: (channel: ChatChannel) => void;
  onInput: (value: string) => void;
  onSend: () => void;
  onClose: () => void;
}) {
  return (
    <aside className="chat-panel" onKeyDown={(event) => event.stopPropagation()}>
      <header>
        <strong>战局通讯</strong>
        <button onClick={onClose}>×</button>
      </header>
      <nav>
        {(["team", "all"] as ChatChannel[]).map((item) => (
          <button
            key={item}
            className={channel === item ? "active" : ""}
            onClick={() => onChannel(item)}
          >
            {item === "team" ? "阵营" : "全体"}
            {unread[item] ? ` (${unread[item]})` : ""}
          </button>
        ))}
      </nav>
      <div className="chat-messages">
        {messages
          .filter(
            (message) =>
              message.channel === "system" || message.channel === channel,
          )
          .map((message) => (
            <p
              key={message.id}
              className={`${message.channel} ${message.senderTeam}`}
            >
              <time>
                {new Date(message.sentAt).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
              <b>{message.senderName}</b>
              <span>{message.text}</span>
            </p>
          ))}
      </div>
      <div className="chat-compose">
        <input
          value={input}
          maxLength={200}
          placeholder={channel === "team" ? "发送阵营消息" : "发送全体消息"}
          onChange={(event) => onInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSend();
            if (event.key === "Escape") onClose();
          }}
        />
        <button onClick={onSend}>发送</button>
      </div>
    </aside>
  );
}

export function DecisionVoteToast({
  title,
  seconds,
  onVote,
}: {
  title: string;
  seconds: number;
  onVote: (approve: boolean) => void;
}) {
  return (
    <aside className="decision-vote-toast">
      <strong>队内决策投票</strong>
      <span>{title}</span>
      <small>剩余 {Math.max(0, Math.ceil(seconds))} 秒</small>
      <div>
        <button onClick={() => onVote(true)}>同意</button>
        <button onClick={() => onVote(false)}>反对</button>
      </div>
    </aside>
  );
}
