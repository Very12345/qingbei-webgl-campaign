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
