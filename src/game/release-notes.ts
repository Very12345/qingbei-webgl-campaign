export const RELEASE_NOTES = {
  version: import.meta.env.VITE_RELEASE_VERSION || "开发构建",
  title: "AI、联机与校园地形更新",
  items: [
    "同一据点的双方被宿舍或建筑碰撞隔开时会进入据点级范围交战，消除大量单位隔墙滞留和持续聚集。",
    "困难AI能够识别消极对手、单路突进和阵地战：会截断兵力来源、追尾并夺回失地，兵力不足时主动收缩而非继续消耗。",
    "困难AI可建立临时营地绕开高防核心，优先穿插薄弱宿舍，并把大巴集中配发给道路上的突破队伍。",
  ],
} as const;
