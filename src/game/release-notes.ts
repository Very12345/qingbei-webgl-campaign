export const RELEASE_NOTES = {
  version: import.meta.env.VITE_RELEASE_VERSION || "开发构建",
  title: "AI、联机与校园地形更新",
  items: [
    "重构北大与清华AI：新占宿舍会转为前进据点，停止重复输送，并把超额兵力并行分流到后续目标。",
    "本地服务器更新器支持GitHub Release与Pages CDN双源下载、慢网络重试和SHA-256校验。",
    "修正操场跑道、内场边界和地形贴合；网页版与本地服务器现由同一版本标签同步发布。",
  ],
} as const;
