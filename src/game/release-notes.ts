export const RELEASE_NOTES = {
  version: import.meta.env.VITE_RELEASE_VERSION || "开发构建",
  title: "AI战前集结与观察模式",
  items: [
    "困难AI会在开战前把宿舍和食堂人员持续疏散到附近集结点，释放生产容量并储备进攻兵力；北大、清华逻辑一致。",
    "网页新建战局增加双方AI观察模式，同时显示北大红色兵线与清华紫色兵线。",
    "修复事件档案列表标题溢出、卡片互相覆盖的问题，并保留两行机制摘要。",
    "保留v0.2.1的困难单机AI启用修复与48像素紧凑存档操作按钮。",
  ],
} as const;
