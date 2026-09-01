export const RELEASE_NOTES = {
  version: import.meta.env.VITE_RELEASE_VERSION || "开发构建",
  title: "双方AI独立难度",
  items: [
    "双方AI观察模式现在可以分别设置北大和清华的休闲、标准或困难难度。",
    "支持直接观察困难对标准、标准对休闲等非对称AI组合，双方兵线继续以红色和紫色区分。",
    "新增非对称难度回归测试：休闲北大不会误用困难准备逻辑，困难清华仍会完整建立战前集结线。",
    "保留v0.2.2的双阵营战前动员、事件档案布局和观察模式修复。",
  ],
} as const;
