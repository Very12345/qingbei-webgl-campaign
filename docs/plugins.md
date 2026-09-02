# 专用服务器多内核与插件开发

从 v0.3.0 起，专用服务器可以让多个战局各自运行在独立的 JavaScript VM 中，并用外部进程加载插件。无插件配置时仍是原来的单战局服务器；插件不需要修改或重新编译服务器本体。

## 启动配置

服务器默认读取与可执行文件同目录的 `qingbei-server.json`，也可以显式指定：

```bash
qingbei-server --config ./qingbei-server.json --port 17890
```

最小配置：

```json
{
  "initialKernels": 1,
  "maxKernels": 4,
  "plugins": []
}
```

- `initialKernels`：启动时立即创建的独立战局数，可设为 0，让大厅插件按需创建。
- `maxKernels`：同时存在的独立 JS VM 上限，范围 1—16。每个 VM 独占状态和执行锁，战局之间不会互相排队。
- `landingPlugin`：访问服务器根路径时打开的插件 ID；不填写则进入原版游戏主页。
- `plugins`：外部插件进程列表。

插件配置示例：

```json
{
  "initialKernels": 0,
  "maxKernels": 4,
  "landingPlugin": "account-hub",
  "plugins": [
    {
      "id": "account-hub",
      "name": "账号与匹配大厅",
      "command": "./qingbei-account-hub",
      "basePath": "/plugins/account-hub/",
      "required": true,
      "env": {
        "QINGBEI_ACCOUNT_DATA": "./data/accounts.json"
      }
    }
  ]
}
```

Windows 将 `command` 写为 `qingbei-account-hub.exe`。相对路径以配置文件所在目录为基准。

## 插件进程约定

服务器启动插件时会注入：

| 环境变量 | 含义 |
| --- | --- |
| `QINGBEI_PLUGIN_PORT` | 插件必须监听的 `127.0.0.1` 端口 |
| `QINGBEI_PLUGIN_ID` | 规范化后的插件 ID |
| `QINGBEI_PLUGIN_SECRET` | 调用服务器内部 API、验证 Hook 的随机密钥 |
| `QINGBEI_SERVER_ORIGIN` | 服务器内部地址，例如 `http://127.0.0.1:17890` |

插件必须提供 `GET /health`，返回 HTTP 200。服务器等待最多 8 秒，然后把插件的 `basePath` 反向代理到插件根路径。插件的标准输出和错误输出会直接进入彩色服务器终端。

插件是独立进程：崩溃不会破坏普通战局；标记为 `required: true` 的插件启动失败时，服务器会拒绝启动，避免误以为账号验证已经生效。

## 内部战局 API

请求必须带头：

```text
X-Qingbei-Plugin-Secret: <QINGBEI_PLUGIN_SECRET>
```

### 创建独立内核

`POST /api/internal/battles`

```json
{
  "name": "困难人机",
  "mode": "ai",
  "difficulty": "hard",
  "difficultyByTeam": { "pku": "hard", "thu": "hard" },
  "timeScale": 1,
  "maxPlayers": 2,
  "allowSameTeam": false,
  "authPlugin": "account-hub",
  "metadata": { "owner": "player_id" }
}
```

响应包含 `roomCode`。`authPlugin` 非空时，加入该房间的玩家必须通过对应插件的加入 Hook。

### 查看、控制和停止

- `GET /api/internal/battles`：列出独立内核。
- `POST /api/internal/battles/{roomCode}/command`：请求体 `{"command":"timescale 2"}`。
- `DELETE /api/internal/battles/{roomCode}`：保存并停止内核。

## Hook

服务器调用 Hook 时同样携带 `X-Qingbei-Plugin-Secret`。

### 玩家加入

`POST /hooks/player/join`

输入包含 `token`、`roomCode`、`team` 和 `peerId`。允许加入时返回：

```json
{
  "allow": true,
  "accountId": "player_id",
  "profile": {
    "cosmetic": {
      "team": "pku",
      "url": "/plugins/example/assets/pku.svg"
    }
  }
}
```

拒绝时返回 `{"allow":false,"message":"原因"}`。`profile` 会在 WebSocket 建立后发给该玩家；内置网页识别 `cosmetic`，只替换指定阵营的单位材质。

### 战局结算

`POST /hooks/battle/result`

只在首次产生正式胜负时调用，包含房间码、胜方、原因、游戏时、阵亡数据、模式、难度、创建战局时的 metadata，以及带 `accountId` 的玩家列表。插件应按房间码做幂等处理。

## 内置账号大厅插件

源码位于 `native-server/plugins/account-hub`。它使用单个 JSON 文件持久化账号和进度，不依赖数据库或 Node.js：

- ID/密码注册与 30 天 HttpOnly 会话；密码使用随机盐和 210,000 轮 PBKDF2-HMAC-SHA256 派生后保存，旧账号会在下次成功登录时自动迁移。
- 默认加入链接不包含会话令牌；服务器从同源 Cookie 完成 WebSocket 鉴权，并对连续登录失败实施十分钟限速。
- 北大、清华经验与独立等级。
- 休闲/标准/困难人机分别按胜负奖励不同经验。
- PvP 自动匹配，胜方 120、负方 60 经验。
- 等级奖励 2×/4×倍速卡和两档阵营材质；倍速卡只在创建人机独立内核时消耗。

示例部署配置见 `examples/account-hub/qingbei-server.json`。

## 插件拥有对局页面（账号大厅 0.3.2）

插件可以通过自己的路由返回完整 HTML、CSS 和 JS，并以 `landingPlugin` 接管首页。
账号大厅的 `/plugins/account-hub/play/` 是同源页面，不是 iframe：它加载同一份已发布的游戏客户端资源，由插件适配界面入口、账号阵营、投降与结算流程。没有另写模拟内核，也没有修改服务器本体。

目前客户端没有稳定的 UI 生命周期扩展 API，因此 `static/play.html` 的适配器仍依赖 `.team-lobby-card`、`.webgl-stage` 等结构和退出按钮文案。升级客户端时须回归这些选择器，不能将其视为通用且永不变化的 Hook。不同插件也可以提供自己的完整客户端，但仍应复用共享内核和网络协议。

账号插件自有接口（均需要账号 Cookie）：

| 路径 | 用途 |
| --- | --- |
| `GET /api/match/status?room=…` | 查询本账号参与战局及结算结果 |
| `GET /api/match/presence?room=…&connectionId=…` | SSE 在线连接；每 10 秒发状态，页面确认心跳 |
| `POST /api/match/heartbeat` | `{roomCode, connectionId}`，确认页面收到状态 |
| `POST /api/match/disconnect` | 相同参数，幂等记录离开时间；旧页面标识不能关闭新页面 |
| `POST /api/match/surrender` | `{roomCode}`，幂等投降和经验结算 |

明确关窗或连接关闭从检测时间起提供 60 秒宽限，清理周期最多增加约 3 秒。突然断网时通过未确认的 SSE 心跳识别：从预计下一次心跳时刻起计 60 秒，因此检测存在最多约一个心跳周期的误差。后台标签页不依赖定时器发送心跳，而是在 SSE 收到数据时确认；被浏览器完全冻结的页面视为失联。

插件每轮先通过内部 API 核对存活内核，仅成功获取完整列表才处理不存在的战局，避免短暂 API 故障被算成失败。中断不发经验；正常胜负、投降、超时判负沿用原有奖励且每局只结算一次。插件重启后会话需重新登录。

`static/protocol.js` 是旧服务器的协议兼容层：在浏览器一侧把 `network_chunk` 还原为完整消息再发送，不伪造 ACK、不增加命令权限、不重发已经处理的序号。服务器仍只接受操作并校验阵营，客户端不能上传权威兵力或胜负。

测试与独立发布：

```bash
cd native-server
go test ./plugins/account-hub
node --test plugins/account-hub/protocol.test.mjs
# 对一次性、无账号保护的本地测试内核运行调兵回归：
node plugins/account-hub/protocol-e2e.mjs http://127.0.0.1:17991
```

`hub-v*` 标签仅构建和发布四个平台的插件及 SHA-256 校验文件，不重建服务器。`GET /plugins/account-hub/health` 包含独立插件版本；服务器 `/api/info` 的版本可以保持不变。

### 0.3.3 明确操作接口

通用网页的玩家控件通过 `collectPlayerCommands` / `playerCommandSenderRef` 明确提交 `intent: "player"` 的操作。联机定时器不再扫描状态差异或重发旧值。插件只转发这类明确命令，并保留原来的服务器阵营校验；该标记不是反作弊权限凭证。总动员、研发等仍走 `client_action`。服务器程序和 JS 模拟内核无需修改。

显示层不得回写服务器单位坐标、目标或通行点；轻量据点同步仅更新节点和兵线，位置插值只保存在显示缓存中。连接断开后也不能自动改用本地模拟。请同时部署网页和0.3.3插件，否则旧网页的自动差异命令会被插件拒绝。
