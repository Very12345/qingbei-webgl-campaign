export const RELEASE_NOTES = {
  version: import.meta.env.VITE_RELEASE_VERSION || "开发构建",
  title: "多内核、插件大厅与战场控制",
  items: [
    "专用服务器支持多个战局各自运行独立JS内核，并新增外部进程插件、Hook和内部战局API。",
    "新增账号与匹配大厅插件：注册登录、双阵营经验、PvP与三档人机、倍速卡及阵营材质饰品。",
    "敌控据点按姿态形成控制半径；穿越控制区会先攻克据点，再恢复原始行军意图。",
    "困难AI会切换守卫/防守姿态、建立绕行营地，并在兵力劣势时停止过度进攻、组织防御恢复。",
  ],
} as const;
