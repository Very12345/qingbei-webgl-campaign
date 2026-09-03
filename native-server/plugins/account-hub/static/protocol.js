// Plugin compatibility boundary: do not change or fork the shared game client.
// Browser peers accept application chunks, but the v0.3.1 native kernel only
// accepts complete commands. WebSocket itself already supports large messages.
globalThis.QingbeiProtocol = {
  createBridge({ send, notify = () => {}, now = Date.now, team = 'pku' }) {
    const transfers = new Map(), pendingCommands = new Map(), knownSites = new Map(), knownUnits = new Map();
    const sameSite = (expected, actual) => !!actual &&
      (actual.team === team ? (actual.orderTarget ?? null) === (expected.orderTarget ?? null) &&
        actual.stance === expected.stance && Math.abs((actual.dispatchRatio ?? .6) - expected.dispatchRatio) < .001 &&
        (expected.displayName == null || actual.displayName === expected.displayName) : true) &&
      (actual.plannedOrderTargets?.[team] ?? null) === (expected.plannedOrderTarget ?? null);
    const sameUnit = (expected, actual) => !!actual &&
      (expected.targetSiteId != null ? actual.targetSiteId === expected.targetSiteId :
        (actual.targetSiteId == null || actual.targetSiteId < 0) && Math.hypot(actual.tx - expected.tx, actual.tz - expected.tz) < .03);
    function observe(payload) {
      if (payload.type !== 'client_commands') return;
      for (const site of payload.sites || []) {
        if (sameSite(site, knownSites.get(site.id))) {
          pendingCommands.delete('s'+site.id);
          continue;
        }
        const key = 's' + site.id, signature = JSON.stringify(site);
        if (pendingCommands.get(key)?.signature !== signature)
          pendingCommands.set(key, { site, signature, at: now() });
      }
      for (const unit of payload.units || []) {
        if (sameUnit(unit, knownUnits.get(unit.id))) { pendingCommands.delete('u'+unit.id); continue; }
        const key = 'u' + unit.id, signature = JSON.stringify(unit);
        if (pendingCommands.get(key)?.signature !== signature)
          pendingCommands.set(key, { unit, signature, at: now() });
      }
    }
    function outgoing(raw) {
      if (typeof raw !== 'string') { send(raw); return; }
      let wire, payload;
      try { wire = JSON.parse(raw); if (wire.type !== 'relay') { send(raw); return; } payload = JSON.parse(wire.data); }
      catch { send(raw); return; }
      for (const [id, t] of transfers) if (now() - t.at > 10000) transfers.delete(id);
      if (payload.type === 'network_chunk') {
        const { transferId: id, total, index, data } = payload;
        if (!id || !Number.isInteger(total) || total < 1 || total > 512 || !Number.isInteger(index) || index < 0 || index >= total || typeof data !== 'string') {
          notify('命令分片无效，请重新下达命令', true); return;
        }
        let t = transfers.get(id);
        if (!t) {
          if (transfers.size >= 16) { notify('命令发送队列过长，请稍候', true); return; }
          t = { at: now(), total, parts: new Map(), bytes: 0 }; transfers.set(id, t);
        }
        if (t.total !== total) { transfers.delete(id); return; }
        if (!t.parts.has(index)) { t.parts.set(index, data); t.bytes += data.length; }
        if (t.bytes > 2 * 1024 * 1024) { transfers.delete(id); notify('命令过大，请分批操作', true); return; }
        if (t.parts.size !== total) return;
        transfers.delete(id);
        wire.data = Array.from({ length: total }, (_, n) => t.parts.get(n)).join('');
        try { payload = JSON.parse(wire.data); } catch { notify('命令组装失败，请重新下达命令', true); return; }
        raw = JSON.stringify(wire);
      }
      // Fail closed for obsolete diff-based clients. Only the explicit player
      // command boundary may send orders; rendering never grants intent.
      if (payload.type === 'client_commands' && payload.intent !== 'player') return;
      observe(payload);
      send(raw);
    }
    function incoming(raw) {
      let payload;
      try { const wire = JSON.parse(raw); if (wire.type !== 'relay') return; payload = JSON.parse(wire.data); } catch { return; }
      if (payload.type !== 'state_delta' && payload.type !== 'state') return;
      const full = payload.type === 'state' ? payload.game : null;
      if (full) { knownSites.clear(); knownUnits.clear(); }
      for (const site of full?.sites || payload.sites || []) knownSites.set(site.id, site);
      for (const unit of [...(full?.units || payload.units || []), ...(payload.newUnits || [])]) {
        const u = Array.isArray(unit) ? { id:unit[0], targetSiteId:unit[10], tx:unit[4]/100, tz:unit[5]/100 } : unit;
        knownUnits.set(u.id,u);
      }
      const removed = new Set(payload.removedUnitIds || []);
      for (const id of removed) knownUnits.delete(id);
      let confirmed = 0, timedOut = 0;
      for (const [key, p] of pendingCommands) {
        let ack = false;
        if (p.site) {
          ack = sameSite(p.site, knownSites.get(p.site.id));
        } else {
          ack = sameUnit(p.unit, knownUnits.get(p.unit.id));
          if (removed.has(p.unit.id)) { pendingCommands.delete(key); continue; }
        }
        if (ack) { pendingCommands.delete(key); confirmed++; }
        else if (now() - p.at > 8000) { pendingCommands.delete(key); timedOut++; }
      }
      if (timedOut) notify('部分调兵命令尚未确认，请检查目标或重新下达', true);
      else if (confirmed) notify('服务器已确认命令；据点连线为持续兵线，每6游戏小时继续派兵');
    }
    return { outgoing, incoming, pendingCommands };
  }
};
