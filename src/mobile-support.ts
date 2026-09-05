export type MobileSignals = {
  width: number;
  height: number;
  coarsePointer: boolean;
  touchPoints: number;
};

export const isMobileSignals = (signals: MobileSignals) =>
  signals.coarsePointer ||
  (signals.touchPoints > 0 && Math.min(signals.width, signals.height) <= 900);

export const mobileSignals = (): MobileSignals => ({
  width: globalThis.innerWidth ?? 1920,
  height: globalThis.innerHeight ?? 1080,
  coarsePointer: globalThis.matchMedia?.("(pointer: coarse)").matches ?? false,
  touchPoints: globalThis.navigator?.maxTouchPoints ?? 0,
});

export const isMobileClient = () => isMobileSignals(mobileSignals());

export const mobileSiteHitRadius = (projectedRadius: number, multiplier = 1) =>
  Math.max(28, projectedRadius * multiplier * 1.65);

