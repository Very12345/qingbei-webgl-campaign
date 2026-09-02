# 账号大厅界面

本次改版参考 KARDS 的实际主菜单及出战界面。网页保留清北校园的身份、原有账号数据和战斗规则。不是将游戏改成卡牌战斗；卡背只用于阵营选择。

## 参考

- [KARDS 官方：New User Interface: Coming Soon!](https://www.kards.com/news/new-ui-coming-soon)
- [KARDS 官方：The New User Interface is Here](https://www.kards.com/news/new-user-interface)
- [KARDS 官方：Player Portraits Coming Soon](https://decks.kards.com/news/united-front-player-portraits-coming-soon)

具体取材是顶部金属账号与资源栏、左侧垂直图标菜单、桌面上的中央主画面、右侧三个模式入口、底部成长信息，以及出战页的模式列表、卡背选择区和右侧出战栏。标题采用粗无衬线字体，白灰为默认文字，橙色为选中状态。没有使用 KARDS 的标志、截图或卡牌图作为产品资源。

## 文件与边界

- `native-server/plugins/account-hub/static/index.html`：主菜单、登录、部署、生涯与军需。样式与脚本保留内联，兼容插件原有 CSP。
- `native-server/plugins/account-hub/static/play.html`：插件加载页、通知、投降及结算窗口。现有客户端加载、协议桥接与生命周期逻辑继续使用。
- `native-server/plugins/account-hub/main.go`：在原有 `/assets/` 路由中为两张明确命名的 PNG 增加内嵌资源响应。不开放任意文件路径，不修改服务器宿主或战斗内核。
- `campus-command.png` 与 `field-table.png`：同一静态目录中的原创图片，由 Go 的 `//go:embed static/*` 打包。

账号数据、会话、匹配、饰品装备和战局创建依旧通过原有 API。主菜单的经验、等级、军需数量全部来自账号响应。模式入口只打开部署页，出战按钮才创建或匹配战局。

## 原创图片

两张图片均使用内置 imagegen 生成，未使用 API/CLI 回退。完整提示词如下。

### 校园主画面：`native-server/plugins/account-hub/static/campus-command.png`

> Create an original panoramic background painting asset for a Chinese campus strategy game's account lobby inspired by vintage 1940s illustrated travel posters and hand-painted strategy card game artwork. Landscape 1536x1024. Atmospheric grand panorama of two Beijing university campuses: left middle distance a traditional Chinese red wooden campus gate with ornate grey tiled roof, and a tall slender brick pagoda rising beside a lake; right middle distance a white three-arch classical university gate and distant pale domed academic building. Foreground lakeside path with a few vintage bicycles leaning beside stone railing, reeds and autumn trees. Distant clouds, warm hazy late afternoon sun. Historic architectural illustration, carefully drawn, painterly oil/gouache brushwork with subtle weathered printed paper grain, sophisticated muted olive green, ochre, faded terracotta and warm ivory palette. Most architecture in middle band. Upper left quarter dark olive tree branches providing negative space for separate HTML UI. Darkened edges naturally. No humans, soldiers, weapons, tanks or planes. No text, no letters, no logos, no watermarks, no cards, no UI, no frames. Original artwork, richly detailed, atmospheric and beautiful, should look like a premium illustrated board game box painting, not a photo or 3D render.

### 桌面材质：`native-server/plugins/account-hub/static/field-table.png`

> Generate a 1536x1024 seamless-looking full-frame material background texture asset for a vintage strategy video game main menu. Orthographic top-down close-up of a flat aged sand khaki military field table surface: worn painted timber and olive-tan canvas-like grain, matte faded beige ochre #9c8d65, dark rubbed brown worn patches and fine scratches more at outside edges, subtle long vertical board seams, scattered scuffs, small irregular paint chips, dense fine realistic material grain. The center is lighter and quieter for UI overlay, outside edges gently vignetted dark olive brown. Low contrast in central 70 percent. Premium realistic game texture, understated period military tabletop. NO objects, no maps, no cards, no letters, no text, no logos, no symbols, no inset panels, no decorative borders, no lighting flare. The entire image is the surface texture, viewed absolutely flat from directly overhead.

## 本地验证

工作前的 Git 存档为 `eb4973b`。隔离的测试账号、配置、工具与构建产物位于 Git 忽略的 `work/ui-review/`；不可作为真实账号数据提交。

验证包含插件 Go 测试、现有 JS 协议与生命周期测试、HTML 内联脚本语法、资源返回值，以及浏览器中的登录、菜单导航、模式和阵营切换、难度奖励、军需显示。UI 验证与线上长局、AI 平衡回归是不同范围。

在本地原生服务器加载新编译插件后，已完成“登录 → 清华阵营/困难训练 → 创建战局 → 进入游戏 → 投降 → 结算 → 返回主菜单”的浏览器流程，清华经验从 160 更新为 210。主菜单和阵营部署做过桌面视觉检查，窄屏控件未发现横向越界。两张 PNG 的 HTTP 响应均为 `image/png`，内容与源码文件逐字节一致；新二进制返回的主页面与源码一致，并保留 CSP。
