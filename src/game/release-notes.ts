export const RELEASE_NOTES = {
  version: import.meta.env.VITE_RELEASE_VERSION || "v0.1.13",
  title: "AI、联机与校园地形更新",
  items: [
    "重构北大与清华AI：新占宿舍会转为前进据点，停止重复输送，并把超额兵力并行分流到后续目标。",
    "修复本地服务器延迟累积，加入独立发送队列、背压与紧凑单位同步；服务器瘦身至约6.1MB。",
    "修正操场跑道、内场边界和地形贴合；网页版与本地服务器现由同一版本标签同步发布。",
  ],
} as const;
