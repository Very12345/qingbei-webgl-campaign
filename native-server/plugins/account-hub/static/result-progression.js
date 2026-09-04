(function (root) {
  function frames(progression) {
    if (!progression?.levels?.length) return [];
    const {before, after, levels} = progression;
    if (!Number.isFinite(before) || !Number.isFinite(after) || after < before) return [];
    return levels.map((level, index) => {
      const size = Math.max(0, level.next - level.start);
      const from = Math.max(0, Math.min(size, before - level.start));
      const to = Math.max(0, Math.min(size, after - level.start));
      return {...level, size, from, to, last: index === levels.length - 1};
    });
  }
  function show(element, progression, {animate = true, reducedMotion = false} = {}) {
    const steps = frames(progression);
    if (!steps.length) { element.hidden = true; return; }
    element.hidden = false;
    const level = element.querySelector('[data-level]');
    const fill = element.querySelector('[data-fill]');
    const value = element.querySelector('[data-value]');
    const status = element.querySelector('[data-status]');
    const bar = element.querySelector('[role="progressbar"]');
    const final = steps.at(-1);
    const paint = (step, amount) => {
      level.textContent = `Lv.${step.level}`;
      fill.style.width = `${step.size ? amount / step.size * 100 : 100}%`;
      value.textContent = step.size ? `${Math.round(amount).toLocaleString()} / ${step.size.toLocaleString()} EXP` : '已达最高等级';
      bar.setAttribute('aria-valuemax', String(step.size || 1));
      bar.setAttribute('aria-valuenow', String(step.size ? Math.round(amount) : 1));
      bar.setAttribute('aria-valuetext', `${level.textContent}，${value.textContent}`);
    };
    const complete = () => {
      paint(final, final.to);
      const gained = final.level - steps[0].level;
      status.textContent = gained > 0 ? `晋升 ${gained} 级 · Lv.${steps[0].level} → Lv.${final.level}` : '生涯进度已保存';
    };
    element.querySelector('[data-earned]').textContent = `+${(progression.after - progression.before).toLocaleString()} EXP`;
    if (!animate || reducedMotion || progression.after === progression.before) { complete(); return; }
    let index = 0, started;
    const duration = Math.max(240, Math.min(1400, 2800 / steps.length));
    const tick = now => {
      if (!element.isConnected) return;
      started ??= now;
      const step = steps[index], t = Math.min(1, (now - started) / duration);
      paint(step, step.from + (step.to - step.from) * (1 - (1 - t) ** 3));
      status.textContent = index ? `等级提升 · Lv.${step.level}` : '战斗经验结算';
      if (t < 1) requestAnimationFrame(tick);
      else if (++index < steps.length) { started = undefined; requestAnimationFrame(tick); }
      else complete();
    };
    paint(steps[0], steps[0].from);
    requestAnimationFrame(tick);
  }
  root.QingbeiResultProgression = {frames, show};
})(globalThis);
