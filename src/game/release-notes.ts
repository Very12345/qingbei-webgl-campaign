export const RELEASE_NOTES = {
  version: import.meta.env.VITE_RELEASE_VERSION || "开发构建",
  title: "统一战斗大厅与账号安全",
  items: [
    "联机匹配与人机挑战合并为统一战斗选择卡：先选模式，再选阵营、难度和倍速卡。",
    "默认加入链接移除会话令牌，WebSocket改用同源HttpOnly Cookie鉴权，并加入登录失败限速。",
    "密码派生升级为210,000轮PBKDF2-HMAC-SHA256；旧账号在成功登录后自动迁移。",
    "大厅补充内容安全、禁止跨站引用与敏感响应不缓存策略。",
  ],
} as const;
