export const RELEASE_NOTES = {
  version: import.meta.env.VITE_RELEASE_VERSION || "开发构建",
  title: "事件提示与高速推演",
  items: [
    "新增“事件弹窗”设置，默认开启；关闭后事件改为短暂的小浮窗提示，不再打断操作，事件档案仍完整保留。",
    "时间倍率上限由16×提高至64×，网页、共享模拟内核与专用服务器控制台保持一致。",
    "32×和64×会明确提示可能造成卡顿，便于在快速推演与画面流畅度之间取舍。",
  ],
} as const;
