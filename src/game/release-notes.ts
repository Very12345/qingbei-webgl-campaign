export const RELEASE_NOTES = {
  version: import.meta.env.VITE_RELEASE_VERSION || "开发构建",
  title: "困难AI与存档页修复",
  items: [
    "修复单机困难模式把玩家误判为困难AI、导致对方进入镜像均势保护并停止进攻的问题。",
    "困难镜像现在只在双方AI确实启用时生效，不再仅凭难度字段判断。",
    "存档列表底部的创建与导入操作恢复为48像素紧凑按钮，不再被网格行拉伸成巨型卡片。",
  ],
} as const;
