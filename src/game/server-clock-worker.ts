let timer: ReturnType<typeof setInterval> | null = null;

self.onmessage = (event: MessageEvent<{ type: "start" | "stop" }>) => {
  if (event.data.type === "stop") {
    if (timer != null) clearInterval(timer);
    timer = null;
    return;
  }
  if (timer != null) return;
  timer = setInterval(() => {
    self.postMessage({ type: "tick", now: performance.now() });
  }, 50);
};

export {};
