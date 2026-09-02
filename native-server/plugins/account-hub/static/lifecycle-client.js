globalThis.QingbeiLifecycle = {
  message(state, serverNow) {
    if (!state || state.completed) return null;
    const peers = state.participants || [];
    const own = peers.find(p => p.self && p.status === 'disconnected');
    const other = peers.find(p => !p.self && p.status === 'disconnected');
    const joining = peers.find(p => !p.self && p.status === 'joining');
    const remaining = p => p.deadline ? Math.max(0, Math.ceil((p.deadline - serverNow) / 1000)) : null;
    if (own) return { title: '游戏连接已断开', body: `请在${remaining(own) ?? 60}秒内重新加载返回战斗，否则将按离线判负。` };
    if (other) return { title: '对手已离线', body: `${other.id} 正在等待重连，剩余${remaining(other) ?? 60}秒；超时未返回将判负。` };
    if (joining) return { title: '等待对手进入战场', body: `${joining.id} 尚未完成入场${remaining(joining) == null ? '。' : `，剩余${remaining(joining)}秒。`}` };
    return null;
  }
};
