# 燕园远征：求真书院

基于 Three.js/WebGL 的固定视角实时校园策略游戏。在线版本：

https://very12345.github.io/qingbei-webgl-campaign/

## 本地运行

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

## 地图数据

- 道路、建筑、水体、校区边界和已标注路灯来自 OpenStreetMap，遵循 ODbL。
- 高程采样来自 Open-Meteo Elevation API。
- 主战场覆盖 WGS84 `39.974,116.284,40.027,116.353`，完整导入边界内所有带 `highway` 的 OSM 道路，不做数量截断。
- 坐标统一采用 WGS84 等距近似投影；x/z 使用同一米制比例，不混用 GCJ-02。
- `src/osm-map-data.ts` 是生成产物；运行 `node work/fetch-osm.mjs` 可从当前地图数据重新生成。

北大东门、北大图书馆、清华西门等易混淆地标通过 OSM 对象 ID 锁定。车站和公交站不会被当作实体校门。

## 部署

推送 `main` 后，`.github/workflows/pages.yml` 自动构建并发布到 GitHub Pages。
