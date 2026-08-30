export const RELEASE_NOTES = {
  version: import.meta.env.VITE_RELEASE_VERSION || "v0.1.12",
  title: "AI、联机与校园地形更新",
  items: [
    "重构北大与清华AI：疏散宿舍溢出兵力、保护生产据点、评估Buff风险，并动态组织侧翼与优势兵线。",
    "修复本地服务器延迟累积，加入独立发送队列、背压与紧凑单位同步；服务器瘦身至约6.1MB。",
    "修正操场跑道、内场边界和地形贴合；网页版与本地服务器现由同一版本标签同步发布。",
  ],
} as const;
