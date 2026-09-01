export const RELEASE_NOTES = {
  version: import.meta.env.VITE_RELEASE_VERSION || "开发构建",
  title: "统一内核与专用服务器",
  items: [
    "网页、无界面基准与本地服务器现共用同一套 TypeScript 战斗、事件、研发、载具和 AI 内核。",
    "本地服务器不再依赖后台浏览器或焦点标签页；客户端只发送操作，由服务器返回权威增量状态。",
    "服务器启动即创建战局，支持终端配置、独立存档、恢复、聊天和全员表决后立即执行。",
    "新增固定日期的路径、伤亡与九场景 AI 回归门禁，修复宿舍/校门抵达建筑外缘却无法占领的问题。",
  ],
} as const;
