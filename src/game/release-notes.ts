export const RELEASE_NOTES = {
  version: import.meta.env.VITE_RELEASE_VERSION || "开发构建",
  title: "AI、联机与校园地形更新",
  items: [
    "修正密集据点中AI把相邻驻军误判为进攻者的问题；只有真实进攻命令才会触发紧急防守。",
    "生产据点兵力占优时会保留安全驻军并向多个周边目标突破，不再让上千人长期原地堆积。",
    "已经出发的AI部队不会因防守重新评估被清空命令，修复高倍率和长兵线下的移动回溯。",
  ],
} as const;
