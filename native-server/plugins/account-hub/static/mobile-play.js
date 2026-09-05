(() => {
  "use strict";
  const root = document.documentElement;
  const mobile = matchMedia("(pointer:coarse)").matches || navigator.maxTouchPoints > 0 || innerWidth <= 760;
  if (!mobile) return;
  root.classList.add("mobile-play");
  const gate = document.getElementById("mobile-immersion");
  const enter = document.getElementById("mobile-enter-fullscreen");
  const continueButton = document.getElementById("mobile-continue-portrait");
  const fab = document.getElementById("mobile-fullscreen-fab");
  const copy = document.getElementById("mobile-immersion-copy");
  const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  const requestFullscreen = document.documentElement.requestFullscreen?.bind(document.documentElement) ||
    document.documentElement.webkitRequestFullscreen?.bind(document.documentElement);
  const dismissed = () => {
    try { return sessionStorage.getItem("qingbei-mobile-intro") === "dismissed"; }
    catch { return false; }
  };
  const rememberDismissed = () => {
    try { sessionStorage.setItem("qingbei-mobile-intro", "dismissed"); } catch {}
  };
  const updateViewport = () => {
    const viewport = visualViewport;
    root.style.setProperty("--mobile-visual-height", `${Math.round(viewport?.height || innerHeight)}px`);
    root.style.setProperty("--mobile-visual-top", `${Math.round(viewport?.offsetTop || 0)}px`);
  };
  const update = () => {
    updateViewport();
    const portrait = matchMedia("(orientation:portrait)").matches;
    gate.hidden = !portrait || dismissed() || !!fullscreenElement();
    fab.hidden = !!fullscreenElement() || !requestFullscreen;
    if (!requestFullscreen) {
      gate.dataset.fullscreen = "unsupported";
      enter.hidden = true;
      copy.textContent = "请使用浏览器的“添加到主屏幕”获得更大的战场；也可以旋转手机后继续。";
    }
  };
  const immersive = async () => {
    try {
      if (requestFullscreen) await requestFullscreen();
      try { await screen.orientation?.lock?.("landscape"); } catch {}
      rememberDismissed();
      gate.hidden = true;
      update();
      dispatchEvent(new Event("resize"));
    } catch {
      copy.textContent = "浏览器没有允许自动切换，请手动横屏；仍可使用下方按钮继续。";
    }
  };
  enter.addEventListener("click", immersive);
  fab.addEventListener("click", immersive);
  continueButton.addEventListener("click", () => {
    rememberDismissed();
    gate.hidden = true;
    scrollTo(0, 1);
  });
  addEventListener("resize", update, {passive:true});
  visualViewport?.addEventListener("resize", update, {passive:true});
  document.addEventListener("fullscreenchange", update);
  document.addEventListener("webkitfullscreenchange", update);
  update();
})();
