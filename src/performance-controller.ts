export type QualityMode = "auto" | "low" | "medium" | "high";
export type QualityLevel = Exclude<QualityMode, "auto">;

export type QualityProfile = {
  pixelRatio: number;
  shadowSize: number;
  dynamicLights: number;
  detailedUnits: number;
  windowDetails: boolean;
  roofDetails: boolean;
  combatParticles: number;
  combatParticleIntervalMs: number;
  shadowIntervalMs: number;
};

export type PerformanceMetrics = {
  fps: number;
  frameMs: number;
  simulationMs: number;
  pathfindingMs: number;
  saveMs: number;
  latencyMs: number;
  jitterMs: number;
  drawCalls: number;
  triangles: number;
  detailedUnits: number;
  instancedUnits: number;
  quality: QualityLevel;
};

export const QUALITY_PROFILES: Record<QualityLevel, QualityProfile> = {
  high: {
    pixelRatio: 1.25,
    shadowSize: 1024,
    dynamicLights: 8,
    detailedUnits: 220,
    windowDetails: true,
    roofDetails: true,
    combatParticles: 24,
    combatParticleIntervalMs: 260,
    shadowIntervalMs: 2200,
  },
  medium: {
    pixelRatio: 1,
    shadowSize: 768,
    dynamicLights: 4,
    detailedUnits: 120,
    windowDetails: true,
    roofDetails: false,
    combatParticles: 14,
    combatParticleIntervalMs: 460,
    shadowIntervalMs: 3200,
  },
  low: {
    pixelRatio: 0.75,
    shadowSize: 512,
    dynamicLights: 0,
    detailedUnits: 60,
    windowDetails: false,
    roofDetails: false,
    combatParticles: 8,
    combatParticleIntervalMs: 780,
    shadowIntervalMs: 4500,
  },
};

const order: QualityLevel[] = ["low", "medium", "high"];

export class PerformanceController {
  mode: QualityMode = "auto";
  level: QualityLevel = "medium";
  metrics: PerformanceMetrics = {
    fps: 30,
    frameMs: 33.3,
    simulationMs: 0,
    pathfindingMs: 0,
    saveMs: 0,
    latencyMs: 0,
    jitterMs: 0,
    drawCalls: 0,
    triangles: 0,
    detailedUnits: 0,
    instancedUnits: 0,
    quality: "medium",
  };
  private listeners = new Set<(metrics: PerformanceMetrics) => void>();
  private samples: number[] = [];
  private lastChangeAt = 0;
  private slowSince = 0;
  private fastSince = 0;
  private interacting = false;

  get profile() {
    const base = QUALITY_PROFILES[this.level];
    if (!this.interacting) return base;
    const index = Math.max(0, order.indexOf(this.level) - 1);
    return QUALITY_PROFILES[order[index]];
  }

  setMode(mode: QualityMode) {
    this.mode = mode;
    if (mode !== "auto") this.level = mode;
    this.publish();
  }

  beginCameraInteraction() {
    this.interacting = true;
    this.publish();
  }

  endCameraInteraction() {
    this.interacting = false;
    this.publish();
  }

  reportFrame(frameMs: number, now = performance.now()) {
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250) return;
    this.samples.push(frameMs);
    if (this.samples.length > 120) this.samples.shift();
    const average =
      this.samples.reduce((sum, sample) => sum + sample, 0) /
      Math.max(1, this.samples.length);
    this.metrics.frameMs = average;
    this.metrics.fps = 1000 / Math.max(1, average);
    if (this.mode === "auto" && now - this.lastChangeAt > 10_000) {
      if (average > 30) {
        this.slowSince ||= now;
        this.fastSince = 0;
        if (now - this.slowSince > 3000) this.shift(-1, now);
      } else if (average < 24) {
        this.fastSince ||= now;
        this.slowSince = 0;
        if (now - this.fastSince > 15_000) this.shift(1, now);
      } else {
        this.slowSince = 0;
        this.fastSince = 0;
      }
    }
  }

  update(partial: Partial<PerformanceMetrics>) {
    Object.assign(this.metrics, partial, { quality: this.level });
    this.publish();
  }

  subscribe(listener: (metrics: PerformanceMetrics) => void) {
    this.listeners.add(listener);
    listener({ ...this.metrics, quality: this.level });
    return () => {
      this.listeners.delete(listener);
    };
  }

  private shift(delta: number, now: number) {
    const next = Math.max(0, Math.min(order.length - 1, order.indexOf(this.level) + delta));
    if (order[next] === this.level) return;
    this.level = order[next];
    this.lastChangeAt = now;
    this.slowSince = 0;
    this.fastSince = 0;
    this.publish();
  }

  private publish() {
    this.metrics.quality = this.level;
    for (const listener of this.listeners) listener({ ...this.metrics });
  }
}
