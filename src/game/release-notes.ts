export const RELEASE_NOTES = {
  version: import.meta.env.VITE_RELEASE_VERSION || "开发构建",
  title: "AI、联机与校园地形更新",
  items: [
    "存档管理改为Minecraft式独立列表页：所有存档操作横向排列，点击创建后才进入新战局配置页面。",
    "移除千人战场中的个人血条几何体和逐帧更新，只保留据点人数、选中与交战提示。",
    "紫荆宿舍等据点使用真正可通行的导航锚点；建筑隔开的攻守双方在据点范围内直接交战，不再卡住兵线。",
  ],
} as const;
