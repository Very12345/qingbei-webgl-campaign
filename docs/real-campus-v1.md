# real-campus-v1（2026 年 8 月基准）

`real-campus-v1` 是与 `classic` 并存的地图配置。建筑、道路、水体、校园边界、导航和碰撞均从同一份固定数据生成；普通新战局、特色服务器 AI 和 PvP 均可选择地图，PvP 按地图分别排队。旧存档缺少 `mapProfile` 时继续使用 `classic`，玩家显式升级后才迁移落入新障碍物的单位，并保留目标、持续命令和运输状态。

## 数据范围

- 校内建筑：925 栋（北京大学 249、清华大学 676）。
- 战局据点：143 个；121 个直接绑定建筑轮廓，22 个绑定校门、道路、广场或其他 OSM 要素。
- 道路：6,922 条；水体 99 处；绿地、花园、林地和运动场地 831 处；广场、步行区和停车场 292 处。
- 植被证据：OSM 单树 444 株、树列 125 条；卫星树冠候选点北大 2,701、清华 7,738，客户端按固定空间采样显示。
- 建筑尺寸可信度：官方资料 11 栋，OSM 高度或层数 58 栋，固定规则估算且待实地核验 856 栋。835 栋校内建筑另有卫星影像屋顶色取样。

每栋建筑的 OSM 要素、用途、层数、高度、材料、屋顶、年代、入口方向、来源、检索入口与可信度见 [real-campus-building-audit.csv](real-campus-building-audit.csv)。143 个据点的结构特征、轮廓来源和照片参考入口见 [real-campus-landmark-audit.csv](real-campus-landmark-audit.csv)。空白入口方向和 `pending-field-check` 是明确的资料缺口，不会用随机值补齐。三类照片栏在取得可确认的正面、侧面和斜视图前保持 `pending-verification`；来源目录和搜索页只是检索入口，不计作已核验照片。

## 来源与许可

- [OpenStreetMap](https://www.openstreetmap.org/copyright)：建筑轮廓、道路、水体、校园边界和公开标签，ODbL 1.0。
- [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9)：校准建筑群、道路、硬质地面、草坪、树冠和屋顶主色，仅作本地建模参考；原始影像不进入仓库或游戏资源包。
- [北京大学燕园校区地图](https://isdplus.pku.edu.cn/dfiles/pdf/map.pdf)、[校园参观与建筑](https://www.pku.edu.cn/visit.html)、[北京大学影像站](https://photo.pku.edu.cn/)和[北京大学图书馆馆舍资料](https://www.lib.pku.edu.cn/portal/cn/node/2128)：名称、用途、年代、外观和个别尺寸核对，仅作建模参考。
- [清华大学校园地图](https://www.tsinghua.edu.cn/zjqh/xyfg/xydt.htm)、[校园景观](https://www.tsinghua.edu.cn/zjqh/xyfg/xyjg.htm)、[校园规划资料](https://xsg.tsinghua.edu.cn/info/1003/1156.htm)、[主楼资料](https://www.tsinghua.edu.cn/info/1360/1408.htm)和[官方组图](https://www.tsinghua.edu.cn/info/1181/94400.htm)：名称、用途、年代、外观和个别尺寸核对，仅作建模参考。
- [Wikimedia 北京大学建筑](https://commons.wikimedia.org/wiki/Category:Buildings_of_Peking_University)与[清华大学建筑](https://commons.wikimedia.org/wiki/Category:Buildings_in_Tsinghua_University)：照片检索目录；图片是否可进入资源包须逐文件核对许可和署名。
- [Open-Meteo elevation](https://github.com/open-meteo/open-meteo/blob/main/openapi/elevation.yml)：地形高程，CC BY 4.0。

学校官网和卫星图片没有复制进游戏。当前建筑外观使用本地固定 PBR 参数、原创可平铺纹理与程序化结构，运行时不请求外部图片或地图服务。

## 实现与性能

真实地图按固定数据选择高度、立面材料、屋顶和标志结构；校园内不再使用建筑 ID 随机高度、颜色、屋顶或随机树木。校园外建筑也按 OSM 米制高度或固定用途层高生成。道路按真实宽度合批并修补近距离断头，人行道不再在路口被主动截断。树木位置来自 OSM 与卫星树冠，按阔叶、柱形落叶、松柏和滨水树分组实例化。

高程网格由 20×15 提高到 72×72，并进行两次邻域平滑。渲染高度使用与地形三角网相同的插值；建筑底边逐顶点贴地、屋顶保持水平。水体使用岸线低点确定水面，湖底在地形网格中下挖，桥梁保留。草地、沥青、铺装、立面和水面法线使用本地原创 512px 可平铺材质。

当前桌面高画质复查为 56～60 FPS。双地图客户端 gzip 资源相对 v0.3.13 增加约 0.84 MB，仍低于手机 3 MB 和桌面 6 MB 门槛。此前粗地形版本的服务器 CPU 测试已经作废；完成外观验收后会用最终导航数据重新执行 1/2/4 房间测试，未复测前不发布。

## 复现

`npm run test:real-campus` 检查 925/143 条覆盖、来源引用、固定尺寸/材质/屋顶、据点可达、旧存档升级和 v0.3.13 经典几何哈希。更新数据时依次运行 `node work/fetch-osm.mjs`、`node scripts/fetch-satellite-references.mjs`、`python scripts/build-satellite-roof-colors.py` 和 `npx tsx scripts/build-real-campus-data.ts`；卫星原图只保存在被 Git 忽略的 `work/references`。`python scripts/build-campus-materials.py` 可重建本地原创材质。
