// RTT proves only that the transport answers. Simulation progress is a separate
// signal; inspect it even if no further packets arrive at all.
export class NetworkHealth {
  startedAt = 0;
  lastStateAt = 0;
  lastProgressAt = 0;
  elapsedHours: number | null = null;
  connected = false;
  pausedForPlayers = false;
  start(now: number) {
    this.startedAt = now;
    this.lastStateAt = 0;
    this.lastProgressAt = now;
    this.elapsedHours = null;
    this.connected = true;
    this.pausedForPlayers = false;
  }
  state(now: number, hour: number, pausedForPlayers = false) {
    if (!this.startedAt) this.start(now);
    this.connected = true;
    this.lastStateAt = now;
    if (pausedForPlayers || this.pausedForPlayers) this.lastProgressAt = now;
    this.pausedForPlayers = pausedForPlayers;
    if (Number.isFinite(hour) && (this.elapsedHours == null || hour !== this.elapsedHours)) {
      this.lastProgressAt = now;
      this.elapsedHours = hour;
    }
  }
  warning(now: number, completed = false): string | null {
    if (!this.startedAt || completed) return null;
    if (!this.connected) return "已与服务器断开连接，战局停止同步；操作不会发送，请重新连接。";
    if (now - (this.lastStateAt || this.startedAt) >= 6000)
      return "超过6秒未收到服务器战局状态，当前画面可能已过期；操作暂停发送，请检查连接。";
    if (this.pausedForPlayers) return "正在等待玩家入场或重连，对局已暂停；双方就绪后自动继续。";
    if (now - this.lastProgressAt >= 10000)
      return "服务器连接仍在，但战局时间已超过10秒没有推进；模拟可能暂停或卡住，操作暂停发送。";
    return null;
  }
  reset() { this.startedAt = 0; this.connected = false; }
}
