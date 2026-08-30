export const RELEASE_NOTES = {
  version: import.meta.env.VITE_RELEASE_VERSION || "开发构建",
  title: "AI、联机与校园地形更新",
  items: [
    "多目标兵线改为显式战场工具；默认拖动只建立起点到终点的单一兵线，避免经过据点时误触。",
    "时间倍率现在同步加速单位移动、战斗生产和AI思考，并提高高倍率联机同步频率以减少位置回溯。",
    "修正操场跑道、内场边界和地形贴合；网页版与本地服务器现由同一版本标签同步发布。",
  ],
} as const;
