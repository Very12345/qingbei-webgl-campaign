"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { osmRegions } from "../src/osm-map-data";

type Team = "pku" | "thu";
type Stance = "defend" | "guard" | "standby";
type RegionId = "main";
type MapViewMode = "sites" | "control";
type SiteKind =
  "dorm" | "dining" | "teaching" | "gate" | "target" | "capital" | "camp";
type SiteState = {
  id: number;
  name: string;
  displayName?: string;
  team: Team;
  x: number;
  z: number;
  navX?: number;
  navZ?: number;
  hasPortal?: boolean;
  type: SiteKind;
  stance: Stance;
  supply: number;
  orderTarget?: number;
  orderPath?: [number, number][];
  dispatchRatio?: number;
  osmKey?: string;
  temporary?: boolean;
  destroyed?: boolean;
  generated?: boolean;
};
type UnitState = {
  id: number;
  team: Team;
  x: number;
  z: number;
  tx: number;
  tz: number;
  hp: number;
  supply: number;
  strength: number;
  siteId: number;
  targetSiteId?: number;
  path?: [number, number][];
  pathIndex?: number;
  attackModifier?: number;
  moveModifier?: number;
  skin?: "ustc" | "zju";
};
type CampaignOutcome = {
  winner: Team;
  reason: string;
  atHour: number;
};
type CampaignState = {
  startDateISO: string;
  elapsedHours: number;
  firedEvents: string[];
  warUnlocked: boolean;
  attackBonus: Record<Team, number>;
  freezeUntil: Record<Team, number>;
  cautionUntil?: number;
  outcome?: CampaignOutcome;
  nextSiteId: number;
  lastProductionCycle: number;
  lastDiningCycle: number;
  lastMorningEventDay: number;
  morningPenaltyUntil?: number;
  thuFactionName: string;
};
type GameData = {
  timeOfDay: number;
  resources: Record<Team, number>;
  deaths: Record<Team, number>;
  sites: SiteState[];
  units: UnitState[];
  campaign: CampaignState;
};
type Snapshot = GameData & {
  version: 1 | 2 | 3;
  name: string;
  savedAt: number;
};
type EventCard = {
  id: string;
  title: string;
  body: string;
  effect: string;
  quadrant: "arrival" | "march" | "lake" | "classroom";
  date: string;
};

const SAVE_KEY = "qingbei-webgl-saves-v1";
const TEAM_COLOR: Record<Team, number> = { pku: 0xa20d27, thu: 0x6f3291 };
const EVENT_CARDS: Record<string, Omit<EventCard, "id">> = {
  thu_arrival: {
    title: "八月十六日：清华报到",
    body: "清华园率先迎来新生。紫荆宿舍区灯火通明，防务委员会宣布维持校园秩序。",
    effect: "清华获得初始兵力优势与30战略资源。",
    quadrant: "arrival",
    date: "2026年8月16日",
  },
  night_mobilization: {
    title: "路灯下的动员",
    body: "两校社团在夜色中清点物资，临时通讯网开始覆盖主要道路。",
    effect: "双方获得20战略资源。",
    quadrant: "march",
    date: "2026年8月17日",
  },
  morning_class: {
    title: "上早八",
    body: "八点钟声响起，战线上的学生突然想起还有一节无法逃掉的早课。道路与教室同时拥挤起来。",
    effect: "持续1个游戏小时：全体士兵移动速度与攻击力下降28%。",
    quadrant: "classroom",
    date: "每日08:00",
  },
  pku_arrival: {
    title: "八月十八日：北大报到",
    body: "燕园宿舍区人声渐盛，迟到的主力终于抵达，原有兵力差被迅速抹平。",
    effect: "北大补充兵力至与清华大致均衡。",
    quadrant: "arrival",
    date: "2026年8月18日",
  },
  war_begins: {
    title: "八月十九日：校门开放",
    body: "此前的对峙宣告结束。巡逻队越过校园边界，第一批正式作战命令开始生效。",
    effect: "双方解除交战限制，清华战略AI开始行动。",
    quadrant: "march",
    date: "2026年8月19日",
  },
  qz_approach: {
    title: "人往高走，水向下流",
    body: "求真书院附近传来紧急动员。走廊、宿舍与课堂中的预备力量突然汇集。",
    effect: "求真书院附近出现清华援军；北大前锋冻结1个游戏日。",
    quadrant: "classroom",
    date: "战时特别报道",
  },
  pku_advantage: {
    title: "這會損害你們的數學思維",
    body: "面对不断扩大的战线，一份措辞严厉的内部讲话被迅速传遍校园。",
    effect: "前线北大单位压制力降低10%。",
    quadrant: "classroom",
    date: "战时特别报道",
  },
  qz_captured: {
    title: "我宣布你們已經不是我的學生了",
    body: "求真书院失守，但一场戏剧性的身份重组随即发生，前线队伍陷入混乱。",
    effect: "求真书院附近一部分北大单位转为清华单位；胜利结果保持不变。",
    quadrant: "classroom",
    date: "终局广播",
  },
  yuanpei_attack: {
    title: "为了自由！",
    body: "元培学院俄文楼遭到进攻。各院系学生沿湖畔道路赶来，临时防线在学院办公区周围形成。",
    effect: "元培附近增兵，北大获得局部攻击加成并吸引附近援军。",
    quadrant: "march",
    date: "燕园紧急广播",
  },
  yuanpei_fallen: {
    title: "自由之门关闭",
    body: "元培学院俄文楼的最后一道防线被突破。战役结果在此刻写定，但校园中的兵线仍未停下。",
    effect:
      "清华取得战役胜利；游戏继续运行，除非一方被完全消灭，结果不再改变。",
    quadrant: "classroom",
    date: "燕园终局广播",
  },
  lake_awakened: {
    title: "胸中未名水",
    body: "敌军接近未名湖，湖畔的沉静被打破。消息传遍燕园，士气陡然上升。",
    effect: "全体北大单位永久获得15%攻击加成。",
    quadrant: "lake",
    date: "燕园特别报道",
  },
  double_fei: {
    title: "双菲学校",
    body: "北大数学科学学院遭到进攻，一则来历不明的数学评价在前线传播，求真方向的队伍陷入争论。",
    effect: "求真书院附近清华单位移动速度与攻击力降低50%。",
    quadrant: "classroom",
    date: "数学战线快讯",
  },
  thu_ustc: {
    title: "清华转进中科大",
    body: "持续的进攻使清华战时委员会作出惊人决定：剩余防线以“中科大远征校区”的名义继续作战。",
    effect: "清华阵营更名为中科大，单位外观与据点名称同步变化。",
    quadrant: "march",
    date: "特别彩蛋",
  },
  zju_invasion: {
    title: "浙大入侵",
    body: "战局长期僵持后，一支自称“紫金港观察团”的队伍从地图边缘出现，并迅速选择较弱一方作为临时盟友。",
    effect: "较弱阵营获得一支带特殊外观的浙大先遣队，并立即向前线推进。",
    quadrant: "arrival",
    date: "特别彩蛋",
  },
  first_camp: {
    title: "没有校门的据点",
    body: "第一座临时营地在道路之外落成，折叠桌、路灯与补给箱构成了新的前线。",
    effect: "解锁营地补给：附近北大单位缓慢恢复补给。",
    quadrant: "arrival",
    date: "前线记录",
  },
  first_blood: {
    title: "第一份伤亡名单",
    body: "双方终于意识到，这不再只是地图上的箭头。战报开始记录每一次损失。",
    effect: "双方攻击节奏暂时降低，持续12小时。",
    quadrant: "classroom",
    date: "战地简报",
  },
  thu_alarm: {
    title: "清华园墙告急",
    body: "数个外围据点连续失守，清华开始收缩战线，并向求真书院方向重新集结。",
    effect: "求真防区获得额外守军与补给。",
    quadrant: "march",
    date: "清华战时委员会",
  },
};

const seeds: Omit<SiteState, "id" | "stance" | "supply">[] = [
  { name: "北大西门", team: "pku", x: -43, z: 26, type: "gate" },
  { name: "北大东门", team: "pku", x: -20.8, z: 17.2, type: "gate" },
  { name: "北京大学图书馆", team: "pku", x: -19, z: 19, type: "teaching" },
  { name: "博雅塔", team: "pku", x: -25, z: 7, type: "teaching" },
  {
    name: "北京大学化学学院A区",
    team: "pku",
    x: -17.19,
    z: 19.64,
    type: "teaching",
  },
  {
    name: "北京大学加速器楼",
    team: "pku",
    x: -11.76,
    z: 15.71,
    type: "teaching",
  },
  { name: "北京大学工学大楼", team: "pku", x: -7.5, z: 18.1, type: "teaching" },
  { name: "北京大学物理学院", team: "pku", x: -4.1, z: 21.4, type: "teaching" },
  { name: "北京大学技物楼", team: "pku", x: -1.54, z: 20.57, type: "teaching" },
  { name: "百周年纪念讲堂", team: "pku", x: -12, z: 27, type: "teaching" },
  { name: "北京国际数学研究中心", team: "pku", x: -35, z: 5, type: "teaching" },
  { name: "文博楼", team: "pku", x: -41, z: 8, type: "teaching" },
  { name: "生物技术楼", team: "pku", x: -36, z: 12, type: "teaching" },
  { name: "李兆基人文学苑", team: "pku", x: -30, z: 11, type: "teaching" },
  { name: "经济学院", team: "pku", x: -23, z: 12, type: "teaching" },
  { name: "政府管理大楼", team: "pku", x: -23.29, z: 10.31, type: "teaching" },
  {
    name: "北京大学数学科学学院（理科一号楼）",
    team: "pku",
    x: -16,
    z: 18,
    type: "teaching",
  },
  { name: "理科二号楼", team: "pku", x: -12, z: 18, type: "teaching" },
  { name: "理科三号楼", team: "pku", x: -8, z: 18, type: "teaching" },
  { name: "第一教学楼", team: "pku", x: -22, z: 25, type: "teaching" },
  { name: "第二教学楼", team: "pku", x: -17, z: 24, type: "teaching" },
  { name: "燕园28楼", team: "pku", x: -39, z: 30, type: "dorm" },
  { name: "燕园29楼", team: "pku", x: -34, z: 30, type: "dorm" },
  { name: "燕园30楼", team: "pku", x: -29, z: 31, type: "dorm" },
  { name: "燕园31楼", team: "pku", x: -24, z: 32, type: "dorm" },
  { name: "燕园34A、34B楼", team: "pku", x: -18, z: 33, type: "dorm" },
  {
    name: "元培学院（俄文楼）",
    team: "pku",
    x: -30.38,
    z: 22.05,
    type: "capital",
  },
  { name: "元培书院宿舍（35楼）", team: "pku", x: -29.8, z: 35, type: "dorm" },
  { name: "北京大学畅春园", team: "pku", x: -45.13, z: 13.85, type: "dorm" },
  { name: "北京大学畅春新园", team: "pku", x: -44.24, z: 17.9, type: "dorm" },
  { name: "北京大学蔚秀园", team: "pku", x: -46.49, z: 10.2, type: "dorm" },
  { name: "北京大学承泽园", team: "pku", x: -54.9, z: 13.84, type: "teaching" },
  { name: "北京大学中关园", team: "pku", x: -20.8, z: 21.75, type: "dorm" },
  { name: "北京大学燕东园", team: "pku", x: -18, z: 10, type: "teaching" },
  { name: "北京大学朗润园", team: "pku", x: -32, z: 5.7, type: "teaching" },
  { name: "北大农园餐厅", team: "pku", x: -23.6, z: 32.2, type: "dining" },
  { name: "北大学一食堂", team: "pku", x: -32.1, z: 35.3, type: "dining" },
  { name: "北大家园食堂", team: "pku", x: -32.1, z: 33.4, type: "dining" },
  { name: "北大燕南食堂", team: "pku", x: -27.5, z: 28, type: "dining" },
  { name: "北大勺园食堂", team: "pku", x: -36.4, z: 25.1, type: "dining" },
  { name: "清华西门", team: "thu", x: -21.5, z: 6.9, type: "gate" },
  { name: "二校门", team: "thu", x: 10, z: 1, type: "gate" },
  { name: "清华学堂", team: "thu", x: 16, z: -5, type: "teaching" },
  { name: "大礼堂", team: "thu", x: 22, z: -8, type: "teaching" },
  { name: "老图书馆", team: "thu", x: 17, z: 1, type: "teaching" },
  { name: "科学馆", team: "thu", x: 12, z: 8, type: "teaching" },
  { name: "主楼", team: "thu", x: 31, z: 3, type: "teaching" },
  { name: "六教", team: "thu", x: 23, z: 13, type: "teaching" },
  { name: "新清华学堂", team: "thu", x: 28, z: 11, type: "teaching" },
  { name: "艺术博物馆", team: "thu", x: 38, z: 14, type: "teaching" },
  { name: "综合体育馆", team: "thu", x: 25, z: -20, type: "teaching" },
  { name: "校医院", team: "thu", x: 8, z: 15, type: "teaching" },
  { name: "紫荆1号楼", team: "thu", x: 30, z: -24, type: "dorm" },
  { name: "紫荆2号楼", team: "thu", x: 35, z: -24, type: "dorm" },
  { name: "紫荆3号楼", team: "thu", x: 40, z: -23, type: "dorm" },
  { name: "紫荆6号楼", team: "thu", x: 29, z: -29, type: "dorm" },
  { name: "紫荆9号楼", team: "thu", x: 36, z: -29, type: "dorm" },
  { name: "求真书院", team: "thu", x: 43, z: -29, type: "target" },
  { name: "清华南门", team: "thu", x: 22, z: 26, type: "gate" },
  { name: "清华东南门", team: "thu", x: 45, z: 22, type: "gate" },
  { name: "清华荷清苑", team: "thu", x: 3.47, z: -25.7, type: "dorm" },
  { name: "清华双清园", team: "thu", x: 26.5, z: -18.2, type: "dorm" },
  { name: "清华紫荆园餐厅", team: "thu", x: 7.6, z: -24.8, type: "dining" },
  { name: "清华桃李园餐厅", team: "thu", x: 2.6, z: -22.9, type: "dining" },
  { name: "清华清芬园餐厅", team: "thu", x: 6.8, z: -10.1, type: "dining" },
  { name: "清华观畴园餐厅", team: "thu", x: -4.5, z: -12.6, type: "dining" },
  { name: "清华听涛园餐厅", team: "thu", x: 4.4, z: -11.8, type: "dining" },
];

const osmAliases: Record<string, string[]> = {
  北大西门: ["北大西门"],
  北京大学加速器楼: ["北京大学-加速器楼"],
  北京大学工学大楼: ["新奥工学大楼"],
  北京大学物理学院: ["物理学院楼"],
  政府管理大楼: ["政府管理学院（廖凯原楼）"],
  理科二号楼: ["理科二号楼（逸夫苑）"],
  "北京大学数学科学学院（理科一号楼）": ["理科一号楼"],
  理科三号楼: ["理科三号楼（曙东楼）"],
  经济学院: ["经济学院（孝义金晖楼）"],
  燕园28楼: ["28楼"],
  燕园29楼: ["29楼"],
  燕园30楼: ["30楼"],
  燕园31楼: ["31楼"],
  "燕园34A、34B楼": ["34A、34B楼"],
  "元培学院（俄文楼）": ["俄文楼"],
  "元培书院宿舍（35楼）": ["35楼"],
  第二教学楼: ["第二教学楼（李兆基楼）"],
  北京大学朗润园: ["北京大学朗润园居住区"],
  北京大学中关园: ["北京大学中关园北区", "北京大学中关园南区"],
  老图书馆: ["老馆"],
  主楼: ["中央主楼"],
  六教: ["第六教学楼A区"],
  艺术博物馆: ["清华大学艺术博物馆"],
  校医院: ["清华大学校医院"],
  紫荆1号楼: ["紫荆学生公寓1号楼"],
  紫荆2号楼: ["紫荆学生公寓2号楼"],
  紫荆3号楼: ["紫荆学生公寓3号楼"],
  紫荆6号楼: ["紫荆学生公寓6号楼"],
  紫荆9号楼: ["紫荆学生公寓9号楼"],
  求真书院: ["清华大学求真书院"],
  清华荷清苑: ["荷清苑教师住宅区"],
  清华双清园: ["清华大学双清园"],
  北大农园餐厅: ["农园餐厅"],
  北大学一食堂: ["学一食堂"],
  北大家园食堂: ["餐饮综合楼（家园食堂）"],
  北大燕南食堂: ["燕南食堂"],
  北大勺园食堂: ["勺园食堂"],
  清华紫荆园餐厅: ["紫荆园餐厅"],
  清华桃李园餐厅: ["桃李园餐厅"],
  清华清芬园餐厅: ["清芬园餐厅"],
  清华观畴园餐厅: ["观畴园餐厅（万人大食堂）"],
  清华听涛园餐厅: ["听涛园餐厅"],
};
const auditedOsmIds: Record<string, string> = {
  北大东门: "node/2748949454",
  清华西门: "node/380418396",
  清华南门: "node/529544520",
  清华东南门: "node/1363454895",
  北京大学图书馆: "relation/3249649",
  北京大学化学学院A区: "way/295071478",
  北京大学工学大楼: "relation/15596323",
  北京大学物理学院: "relation/11823279",
  政府管理大楼: "way/163926083",
  经济学院: "way/783033431",
  "北京大学数学科学学院（理科一号楼）": "relation/13059307",
  理科二号楼: "relation/14962081",
  理科三号楼: "relation/11975585",
  北京大学承泽园: "relation/17308238",
};
function geolocateSeed(seed: Omit<SiteState, "id" | "stance" | "supply">) {
  const region = osmRegions.main,
    landmarks = region.landmarks as readonly any[],
    audited = auditedOsmIds[seed.name];
  let hit = audited
    ? landmarks.find((p) => `${p.osmType}/${p.osmId}` === audited)
    : undefined;
  const aliases = osmAliases[seed.name] ?? [seed.name];
  if (!hit) {
    const candidates = landmarks.filter((p) => aliases.includes(p.name));
    hit = candidates.sort(
      (a, b) =>
        Math.hypot(a.x - seed.x, a.z - seed.z) -
        Math.hypot(b.x - seed.x, b.z - seed.z),
    )[0];
  }
  return hit
    ? { ...seed, x: hit.x, z: hit.z, osmKey: `${hit.osmType}/${hit.osmId}` }
    : { ...seed };
}

function pointInPolygon(
  x: number,
  z: number,
  points: readonly (readonly number[])[],
) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][0],
      zi = points[i][1],
      xj = points[j][0],
      zj = points[j][1],
      crosses =
        zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function generatedPkuDormSites(
  existing: Omit<SiteState, "id" | "stance" | "supply">[],
) {
  const main = osmRegions.main as unknown as {
      campuses: readonly {
        name: string;
        points: readonly (readonly number[])[];
      }[];
      buildings: readonly {
        name: string;
        osmType: string;
        osmId: number;
        points: readonly (readonly number[])[];
      }[];
      landmarks: readonly {
        name: string;
        osmType: string;
        osmId: number;
        x: number;
        z: number;
      }[];
    },
    campus = main.campuses.find((item) => item.name === "北京大学");
  if (!campus) return [];
  const buildingKeys = new Set(
      main.buildings.map((item) => `${item.osmType}/${item.osmId}`),
    ),
    usedKeys = new Set(existing.map((site) => site.osmKey).filter(Boolean)),
    usedPoints = existing.map((site) => [site.x, site.z] as const),
    dormPattern =
      /^(?:1[9]|2[0-4]|2[8-9]|3[0-5]|4[3-8])楼$|34A、34B楼|学生宿舍|学生公寓|宿舍楼|勺园.*楼/,
    generated: Omit<SiteState, "id" | "stance" | "supply">[] = [];
  for (const item of main.landmarks) {
    const key = `${item.osmType}/${item.osmId}`;
    if (
      !buildingKeys.has(key) ||
      usedKeys.has(key) ||
      !dormPattern.test(item.name) ||
      !pointInPolygon(item.x, item.z, campus.points)
    )
      continue;
    if (
      [
        ...usedPoints,
        ...generated.map((site) => [site.x, site.z] as const),
      ].some(([x, z]) => Math.hypot(x - item.x, z - item.z) < 0.7)
    )
      continue;
    usedKeys.add(key);
    generated.push({
      name: `燕园${item.name}`,
      displayName: `燕园${item.name}`,
      team: "pku",
      x: item.x,
      z: item.z,
      type: "dorm",
      osmKey: key,
      generated: true,
    });
  }
  return generated;
}

function generatedTsinghuaSites(
  existing: Omit<SiteState, "id" | "stance" | "supply">[],
) {
  const main = osmRegions.main as unknown as {
      campuses: readonly {
        name: string;
        points: readonly (readonly number[])[];
      }[];
      buildings: readonly {
        name: string;
        osmType: string;
        osmId: number;
        points: readonly (readonly number[])[];
      }[];
      landmarks: readonly {
        name: string;
        osmType: string;
        osmId: number;
        x: number;
        z: number;
      }[];
    },
    campus = main.campuses.find((item) => item.name === "清华大学");
  if (!campus) return [];
  const buildingKeys = new Set(
      main.buildings.map((item) => `${item.osmType}/${item.osmId}`),
    ),
    usedNames = new Set(existing.map((site) => site.name)),
    usedPoints = existing.map((site) => [site.x, site.z] as const),
    useful =
      /教学楼|学院|学系|学堂|科学馆|理科|工学|化学|物理|生物|电子|机械|土木|水利|环境|经管|法律|人文|文史|科研|研究所|实验|工程馆|技术馆|图书馆|博物馆|礼堂|建筑馆|生命|科技|宿舍|学生公寓|紫荆|西北\d+|西南\d+|中\d+楼|东\d+楼|南\d+楼/,
    excluded =
      /食堂|餐厅|商店|超市|邮局|浴室|快递|宾馆|停车|游泳馆|故居|咖啡|服务台/,
    generated: Omit<SiteState, "id" | "stance" | "supply">[] = [];
  const candidates = main.landmarks
    .filter((item) => buildingKeys.has(`${item.osmType}/${item.osmId}`))
    .filter(
      (item) =>
        item.name &&
        item.name.length <= 20 &&
        useful.test(item.name) &&
        !excluded.test(item.name) &&
        pointInPolygon(item.x, item.z, campus.points),
    )
    .sort((a, b) => a.osmId - b.osmId);
  for (const item of candidates) {
    if (
      existing.filter((site) => site.team === "thu").length +
        generated.length >=
      80
    )
      break;
    if (usedNames.has(item.name)) continue;
    if (
      [
        ...usedPoints,
        ...generated.map((site) => [site.x, site.z] as const),
      ].some(([x, z]) => Math.hypot(x - item.x, z - item.z) < 1.05)
    )
      continue;
    usedNames.add(item.name);
    generated.push({
      name: item.name,
      displayName: item.name,
      team: "thu",
      x: item.x,
      z: item.z,
      type: /宿舍|学生公寓|紫荆|西北\d+|西南\d+|中\d+楼|东\d+楼|南\d+楼/.test(
        item.name,
      )
        ? "dorm"
        : "teaching",
      osmKey: `${item.osmType}/${item.osmId}`,
      generated: true,
    });
  }
  return generated;
}

export function makeFreshGame(): GameData {
  const locatedMain = seeds
    .map((seed) => ({ seed, located: geolocateSeed(seed) }))
    .filter(({ seed, located }) => seed.x < 100 && located.osmKey)
    .map(({ located }) => ({
      ...located,
      displayName: located.name,
    }));
  const sites: SiteState[] = [
    ...locatedMain,
    ...generatedPkuDormSites(locatedMain),
    ...generatedTsinghuaSites(locatedMain),
  ].map((located, id) => ({
    ...located,
    id,
    stance: "defend",
    supply: 100,
  }));
  const units: UnitState[] = [];
  let uid = 0;
  const initialBudget: Record<Team, number> = { pku: 90, thu: 108 };
  (["pku", "thu"] as Team[]).forEach((team) => {
    const teamSites = sites.filter((site) => site.team === team);
    for (let i = 0; i < initialBudget[team]; i++) {
      const s = teamSites[i % teamSites.length],
        layer = Math.floor(i / teamSites.length),
        a = (i * 2.399963 + layer * 0.3) % (Math.PI * 2),
        radius = 0.78 + (layer % 3) * 0.2;
      units.push({
        id: uid++,
        team,
        x: s.x + Math.cos(a) * radius,
        z: s.z + Math.sin(a) * radius,
        tx: s.x,
        tz: s.z,
        hp: 100,
        supply: 100,
        strength: 5,
        siteId: s.id,
      });
    }
  });
  return {
    timeOfDay: 8,
    resources: { pku: 160, thu: 190 },
    deaths: { pku: 0, thu: 0 },
    sites,
    units,
    campaign: {
      startDateISO: "2026-08-16T08:00:00+08:00",
      elapsedHours: 0,
      firedEvents: [],
      warUnlocked: false,
      attackBonus: { pku: 1, thu: 1 },
      freezeUntil: { pku: 0, thu: 0 },
      nextSiteId: sites.length,
      lastProductionCycle: 0,
      lastDiningCycle: 0,
      lastMorningEventDay: -1,
      thuFactionName: "清华",
    },
  };
}
function readSaves(): Snapshot[] {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY) || "[]") as Snapshot[];
  } catch {
    return [];
  }
}

export default function Game3D() {
  const hostRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<GameData>(makeFreshGame());
  const sceneApi = useRef<{
    sync: () => void;
    focus: (region: RegionId) => void;
    applyMaterials: (unitUrl: string | null, siteUrl: string | null) => void;
    clearUnitSelection: () => void;
    setViewMode: (mode: MapViewMode) => void;
    buildCampAt: (x: number, z: number) => boolean;
    enterDirectControl: () => boolean;
    exitDirectControl: () => void;
  } | null>(null);
  const [saves, setSaves] = useState<Snapshot[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("解放清华园");
  const [autoDay, setAutoDay] = useState(true);
  const autoDayRef = useRef(true);
  const [timeScale, setTimeScale] = useState(1);
  const timeScaleRef = useRef(1);
  const [clock, setClock] = useState("8月16日 08:00");
  const [selected, setSelected] = useState<number | null>(null);
  const [selectedUnitCount, setSelectedUnitCount] = useState(0);
  const [region, setRegion] = useState<RegionId>("main");
  const regionRef = useRef<RegionId>("main");
  const [notice, setNotice] = useState("拖动己方据点到目标即可下达命令");
  const [renameDraft, setRenameDraft] = useState("");
  const [viewMode, setViewMode] = useState<MapViewMode>("sites");
  const viewModeRef = useRef<MapViewMode>("sites");
  const [campContext, setCampContext] = useState<{
    x: number;
    y: number;
    worldX: number;
    worldZ: number;
  } | null>(null);
  const [directControl, setDirectControl] = useState(false);
  const [assetOpen, setAssetOpen] = useState(false);
  const [unitMaterialUrl, setUnitMaterialUrl] = useState<string | null>(null);
  const [siteMaterialUrl, setSiteMaterialUrl] = useState<string | null>(null);
  const customMaterialsRef = useRef<{
    unit: string | null;
    site: string | null;
  }>({
    unit: null,
    site: null,
  });
  const [activeEvent, setActiveEvent] = useState<EventCard | null>(null);
  const [victoryBroadcast, setVictoryBroadcast] = useState<{
    winner: Team;
    title: string;
    body: string;
  } | null>(null);
  const [, setUiRevision] = useState(0);
  const eventQueueRef = useRef<EventCard[]>([]);
  const pushEvent = useCallback((event: EventCard) => {
    setActiveEvent((current) => {
      if (!current) return event;
      eventQueueRef.current.push(event);
      return current;
    });
  }, []);
  const [stats, setStats] = useState({
    pku: 0,
    thu: 0,
    pkuSites: 0,
    thuSites: 0,
  });
  const selectedSite =
    selected == null ? null : gameRef.current.sites[selected];
  const refreshSaves = useCallback(
    () => setSaves(readSaves().sort((a, b) => b.savedAt - a.savedAt)),
    [],
  );
  useEffect(() => refreshSaves(), [refreshSaves]);
  useEffect(() => {
    autoDayRef.current = autoDay;
  }, [autoDay]);
  useEffect(() => {
    timeScaleRef.current = timeScale;
  }, [timeScale]);
  useEffect(() => {
    regionRef.current = region;
  }, [region]);
  useEffect(() => {
    viewModeRef.current = viewMode;
    if (viewMode === "control") sceneApi.current?.exitDirectControl();
    sceneApi.current?.setViewMode(viewMode);
    setSelected(null);
    setCampContext(null);
  }, [viewMode]);
  useEffect(() => {
    const unit = localStorage.getItem("qingbei-custom-unit-material"),
      site = localStorage.getItem("qingbei-custom-site-material");
    if (unit) setUnitMaterialUrl(unit);
    if (site) setSiteMaterialUrl(site);
  }, []);
  useEffect(() => {
    customMaterialsRef.current = {
      unit: unitMaterialUrl,
      site: siteMaterialUrl,
    };
    sceneApi.current?.applyMaterials(unitMaterialUrl, siteMaterialUrl);
  }, [unitMaterialUrl, siteMaterialUrl]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9fc5d8);
    scene.fog = new THREE.FogExp2(0x9fc5d8, 0.007);
    const camera = new THREE.PerspectiveCamera(
      38,
      host.clientWidth / host.clientHeight,
      0.1,
      300,
    );
    camera.position.set(-22, 24, 36);
    camera.lookAt(-22, 0, 14);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(-22, 0, 14);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableRotate = false;
    controls.enableZoom = true;
    controls.minDistance = 13;
    controls.maxDistance = 58;
    controls.zoomSpeed = 0.72;
    controls.enablePan = true;
    controls.screenSpacePanning = false;
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    controls.touches.ONE = THREE.TOUCH.PAN;
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    const hideSitePanel = () => setSelected(null);
    controls.addEventListener("start", hideSitePanel);
    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x324226, 1.9);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d0, 3.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -65;
    sun.shadow.camera.right = 65;
    sun.shadow.camera.top = 55;
    sun.shadow.camera.bottom = -55;
    sun.shadow.bias = -0.00018;
    sun.shadow.normalBias = 0.075;
    sun.shadow.radius = 2;
    scene.add(sun);
    const moon = new THREE.DirectionalLight(0x91b7ff, 0.25);
    scene.add(moon);
    const mapGroup = new THREE.Group();
    scene.add(mapGroup);
    const regions = osmRegions as unknown as Record<string, any>;
    const windowMaterials: THREE.MeshStandardMaterial[] = [];
    const terrainMeshes: THREE.Mesh[] = [];
    const regionForX = (_x: number) => regions.main;
    const terrainHeight = (r: any, x: number, z: number) => {
      const { cols, rows, heights } = r.terrain,
        u =
          THREE.MathUtils.clamp(
            (x - (r.offsetX - r.width / 2)) / r.width,
            0,
            1,
          ) *
          (cols - 1),
        v =
          THREE.MathUtils.clamp((r.depth / 2 - z) / r.depth, 0, 1) * (rows - 1),
        i = Math.floor(u),
        j = Math.floor(v),
        fu = u - i,
        fv = v - j,
        at = (ii: number, jj: number) =>
          heights[Math.min(rows - 1, jj) * cols + Math.min(cols - 1, ii)] || 0;
      return THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(at(i, j), at(i + 1, j), fu),
        THREE.MathUtils.lerp(at(i, j + 1), at(i + 1, j + 1), fu),
        fv,
      );
    };
    type NavGrid = {
      cell: number;
      cols: number;
      rows: number;
      minX: number;
      minZ: number;
      blocked: Uint8Array;
      road: Uint8Array;
      component: Int32Array;
      mainComponent: number;
    };
    const buildNavGrid = (r: any): NavGrid => {
      const cell = 0.42,
        minX = r.offsetX - r.width / 2,
        minZ = -r.depth / 2,
        cols = Math.ceil(r.width / cell),
        rows = Math.ceil(r.depth / cell),
        blocked = new Uint8Array(cols * rows),
        road = new Uint8Array(cols * rows),
        markPolygons = (polygons: readonly any[]) => {
          for (const polygon of polygons) {
            const xs = polygon.points.map((p: number[]) => p[0]),
              zs = polygon.points.map((p: number[]) => p[1]),
              x0 = Math.max(0, Math.floor((Math.min(...xs) - minX) / cell) - 1),
              x1 = Math.min(
                cols - 1,
                Math.ceil((Math.max(...xs) - minX) / cell) + 1,
              ),
              z0 = Math.max(0, Math.floor((Math.min(...zs) - minZ) / cell) - 1),
              z1 = Math.min(
                rows - 1,
                Math.ceil((Math.max(...zs) - minZ) / cell) + 1,
              );
            for (let gz = z0; gz <= z1; gz++)
              for (let gx = x0; gx <= x1; gx++) {
                const x = minX + (gx + 0.5) * cell,
                  z = minZ + (gz + 0.5) * cell;
                if (pointInPolygon(x, z, polygon.points))
                  blocked[gz * cols + gx] = 1;
              }
          }
        };
      markPolygons(r.buildings);
      markPolygons(r.waters);
      for (const route of r.roads) {
        for (let i = 1; i < route.points.length; i++) {
          const [x1, z1] = route.points[i - 1],
            [x2, z2] = route.points[i],
            length = Math.hypot(x2 - x1, z2 - z1),
            steps = Math.max(1, Math.ceil(length / (cell * 0.35)));
          for (let step = 0; step <= steps; step++) {
            const t = step / steps,
              gx = Math.floor((x1 + (x2 - x1) * t - minX) / cell),
              gz = Math.floor((z1 + (z2 - z1) * t - minZ) / cell);
            if (gx < 0 || gz < 0 || gx >= cols || gz >= rows) continue;
            road[gz * cols + gx] = 1;
          }
        }
      }
      const component = new Int32Array(cols * rows);
      component.fill(-1);
      let componentId = 0,
        mainComponent = -1,
        mainSize = 0;
      const queue = new Int32Array(cols * rows),
        directions = [-1, 1, -cols, cols];
      for (let start = 0; start < component.length; start++) {
        if (blocked[start] || component[start] !== -1) continue;
        let head = 0,
          tail = 0,
          size = 0;
        queue[tail++] = start;
        component[start] = componentId;
        while (head < tail) {
          const current = queue[head++],
            cx = current % cols;
          size++;
          for (const delta of directions) {
            const next = current + delta;
            if (next < 0 || next >= component.length) continue;
            if ((delta === -1 && cx === 0) || (delta === 1 && cx === cols - 1))
              continue;
            if (blocked[next] || component[next] !== -1) continue;
            component[next] = componentId;
            queue[tail++] = next;
          }
        }
        if (size > mainSize) {
          mainSize = size;
          mainComponent = componentId;
        }
        componentId++;
      }
      return {
        cell,
        cols,
        rows,
        minX,
        minZ,
        blocked,
        road,
        component,
        mainComponent,
      };
    };
    const navGrid = buildNavGrid(regions.main),
      navIndex = (grid: NavGrid, x: number, z: number) => {
        const gx = Math.floor((x - grid.minX) / grid.cell),
          gz = Math.floor((z - grid.minZ) / grid.cell);
        return gx < 0 || gz < 0 || gx >= grid.cols || gz >= grid.rows
          ? -1
          : gz * grid.cols + gx;
      },
      navPoint = (grid: NavGrid, index: number): [number, number] => [
        grid.minX + ((index % grid.cols) + 0.5) * grid.cell,
        grid.minZ + (Math.floor(index / grid.cols) + 0.5) * grid.cell,
      ],
      nearestOpenIndex = (grid: NavGrid, x: number, z: number) => {
        const center = navIndex(grid, x, z);
        if (
          center >= 0 &&
          !grid.blocked[center] &&
          grid.component[center] === grid.mainComponent
        )
          return center;
        const cx = THREE.MathUtils.clamp(
            Math.floor((x - grid.minX) / grid.cell),
            0,
            grid.cols - 1,
          ),
          cz = THREE.MathUtils.clamp(
            Math.floor((z - grid.minZ) / grid.cell),
            0,
            grid.rows - 1,
          );
        for (let radius = 1; radius < 32; radius++)
          for (let dz = -radius; dz <= radius; dz++)
            for (let dx = -radius; dx <= radius; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
              const gx = cx + dx,
                gz = cz + dz;
              if (gx < 0 || gz < 0 || gx >= grid.cols || gz >= grid.rows)
                continue;
              const index = gz * grid.cols + gx;
              if (
                !grid.blocked[index] &&
                grid.component[index] === grid.mainComponent
              )
                return index;
            }
        return -1;
      },
      nearestRoadIndex = (grid: NavGrid, x: number, z: number) => {
        const cx = THREE.MathUtils.clamp(
            Math.floor((x - grid.minX) / grid.cell),
            0,
            grid.cols - 1,
          ),
          cz = THREE.MathUtils.clamp(
            Math.floor((z - grid.minZ) / grid.cell),
            0,
            grid.rows - 1,
          );
        for (let radius = 0; radius < 80; radius++)
          for (let dz = -radius; dz <= radius; dz++)
            for (let dx = -radius; dx <= radius; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
              const gx = cx + dx,
                gz = cz + dz;
              if (gx < 0 || gz < 0 || gx >= grid.cols || gz >= grid.rows)
                continue;
              const index = gz * grid.cols + gx;
              if (
                grid.road[index] &&
                !grid.blocked[index] &&
                grid.component[index] === grid.mainComponent
              )
                return index;
            }
        return -1;
      },
      findPath = (fromX: number, fromZ: number, toX: number, toZ: number) => {
        const grid = navGrid,
          start = nearestOpenIndex(grid, fromX, fromZ),
          goal = nearestOpenIndex(grid, toX, toZ);
        if (start < 0 || goal < 0) return [];
        if (start === goal) return [navPoint(grid, goal)];
        const total = grid.cols * grid.rows,
          cost = new Float32Array(total),
          came = new Int32Array(total),
          closed = new Uint8Array(total),
          heap: { index: number; score: number }[] = [];
        cost.fill(Number.POSITIVE_INFINITY);
        came.fill(-1);
        cost[start] = 0;
        const goalX = goal % grid.cols,
          goalZ = Math.floor(goal / grid.cols),
          push = (entry: { index: number; score: number }) => {
            heap.push(entry);
            let i = heap.length - 1;
            while (i > 0) {
              const parent = Math.floor((i - 1) / 2);
              if (heap[parent].score <= entry.score) break;
              heap[i] = heap[parent];
              i = parent;
            }
            heap[i] = entry;
          },
          pop = () => {
            const first = heap[0],
              last = heap.pop()!;
            if (heap.length) {
              let i = 0;
              while (true) {
                let child = i * 2 + 1;
                if (child >= heap.length) break;
                if (
                  child + 1 < heap.length &&
                  heap[child + 1].score < heap[child].score
                )
                  child++;
                if (heap[child].score >= last.score) break;
                heap[i] = heap[child];
                i = child;
              }
              heap[i] = last;
            }
            return first;
          };
        push({ index: start, score: 0 });
        const directions = [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ];
        while (heap.length) {
          const current = pop();
          if (!current || closed[current.index]) continue;
          if (current.index === goal) break;
          closed[current.index] = 1;
          const cx = current.index % grid.cols,
            cz = Math.floor(current.index / grid.cols);
          for (const [dx, dz] of directions) {
            const nx = cx + dx,
              nz = cz + dz;
            if (nx < 0 || nz < 0 || nx >= grid.cols || nz >= grid.rows)
              continue;
            const next = nz * grid.cols + nx;
            if (grid.blocked[next] || closed[next]) continue;
            if (
              dx &&
              dz &&
              (grid.blocked[cz * grid.cols + nx] ||
                grid.blocked[nz * grid.cols + cx])
            )
              continue;
            const stepCost =
                Math.hypot(dx, dz) * (grid.road[next] ? 0.68 : 1.18),
              nextCost = cost[current.index] + stepCost;
            if (nextCost >= cost[next]) continue;
            cost[next] = nextCost;
            came[next] = current.index;
            const heuristic = Math.hypot(goalX - nx, goalZ - nz) * 0.68;
            push({ index: next, score: nextCost + heuristic });
          }
        }
        if (came[goal] < 0) return [];
        const reversed: [number, number][] = [];
        let cursor = goal;
        while (cursor !== start && cursor >= 0) {
          reversed.push(navPoint(grid, cursor));
          cursor = came[cursor];
        }
        reversed.reverse();
        const simplified = reversed;
        const goalPoint = navPoint(grid, goal),
          lastPoint = simplified.at(-1);
        if (
          !lastPoint ||
          Math.hypot(lastPoint[0] - goalPoint[0], lastPoint[1] - goalPoint[1]) >
            0.05
        )
          simplified.push(goalPoint);
        return simplified;
      };
    const refreshNavAnchors = () => {
      gameRef.current.sites.forEach((site) => {
        if (site.destroyed) return;
        let anchor = nearestOpenIndex(navGrid, site.x, site.z);
        if (anchor < 0) return;
        let anchorPoint = navPoint(navGrid, anchor),
          needsPortal =
            Math.hypot(anchorPoint[0] - site.x, anchorPoint[1] - site.z) > 2.2;
        if (needsPortal) {
          const roadAnchor = nearestRoadIndex(navGrid, site.x, site.z);
          if (roadAnchor >= 0) {
            anchor = roadAnchor;
            anchorPoint = navPoint(navGrid, roadAnchor);
          }
        }
        [site.navX, site.navZ] = anchorPoint;
        site.hasPortal =
          needsPortal &&
          Math.hypot(anchorPoint[0] - site.x, anchorPoint[1] - site.z) > 0.6;
      });
      gameRef.current.units.forEach((unit, index) => {
        const current = navIndex(navGrid, unit.x, unit.z);
        if (current >= 0 && !navGrid.blocked[current]) return;
        const home = gameRef.current.sites[unit.siteId];
        if (!home) return;
        const angle = ((index % 9) / 9) * Math.PI * 2;
        unit.x = (home.navX ?? home.x) + Math.cos(angle) * 0.45;
        unit.z = (home.navZ ?? home.z) + Math.sin(angle) * 0.45;
        unit.tx = home.navX ?? home.x;
        unit.tz = home.navZ ?? home.z;
      });
    };
    refreshNavAnchors();
    const surfaceGeometry = (r: any, points: number[][], lift: number) => {
      const clean = points.filter(
        (p, i, a) =>
          !i || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 0.001,
      );
      if (
        clean.length > 2 &&
        Math.hypot(
          clean[0][0] - clean.at(-1)![0],
          clean[0][1] - clean.at(-1)![1],
        ) < 0.001
      )
        clean.pop();
      const contour = clean.map((p) => new THREE.Vector2(p[0], p[1])),
        faces = THREE.ShapeUtils.triangulateShape(contour, []),
        g = new THREE.BufferGeometry();
      g.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          clean.flatMap((p) => [
            p[0],
            terrainHeight(r, p[0], p[1]) + lift,
            p[1],
          ]),
          3,
        ),
      );
      g.setIndex(faces.flat());
      g.computeVertexNormals();
      return g;
    };
    const addRegion = (r: any) => {
      const { cols, rows, heights } = r.terrain,
        pos: number[] = [],
        idx: number[] = [];
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
          const x = r.offsetX - r.width / 2 + (i / (cols - 1)) * r.width,
            z = r.depth / 2 - (j / (rows - 1)) * r.depth;
          pos.push(x, heights[j * cols + i] || 0, z);
        }
      for (let j = 0; j < rows - 1; j++)
        for (let i = 0; i < cols - 1; i++) {
          const a = j * cols + i,
            b = a + 1,
            c = a + cols,
            d = c + 1;
          idx.push(a, b, c, b, d, c);
        }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const terrain = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          color: r.offsetX ? 0x6d8955 : 0x718d58,
          roughness: 0.98,
          side: THREE.FrontSide,
        }),
      );
      terrain.receiveShadow = true;
      mapGroup.add(terrain);
      terrainMeshes.push(terrain);
      for (const campus of r.campuses ?? []) {
        const team: Team | null =
          campus.name === "北京大学"
            ? "pku"
            : campus.name === "清华大学"
              ? "thu"
              : null;
        if (!team || campus.points.length < 3) continue;
        const fill = new THREE.Mesh(
          surfaceGeometry(r, campus.points, 0.025),
          new THREE.MeshBasicMaterial({
            color: TEAM_COLOR[team],
            transparent: true,
            opacity: 0.095,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        fill.renderOrder = 0;
        fill.visible = false;
        mapGroup.add(fill);
        const borderPoints = campus.points.map(
            (p: number[]) =>
              new THREE.Vector3(
                p[0],
                terrainHeight(r, p[0], p[1]) + 0.16,
                p[1],
              ),
          ),
          border = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(borderPoints),
            new THREE.LineBasicMaterial({
              color: TEAM_COLOR[team],
              transparent: true,
              opacity: 0.68,
            }),
          );
        border.renderOrder = 3;
        border.visible = false;
        mapGroup.add(border);
      }
      type RoadBucket = {
        positions: number[];
        indices: number[];
        vertexIndex: number;
        color: number;
        lift: number;
        renderOrder: number;
      };
      const roadBuckets: Record<"asphalt" | "path" | "dirt", RoadBucket> = {
          asphalt: {
            positions: [],
            indices: [],
            vertexIndex: 0,
            color: 0x303840,
            lift: 0.18,
            renderOrder: 2,
          },
          dirt: {
            positions: [],
            indices: [],
            vertexIndex: 0,
            color: 0x9a805a,
            lift: 0.194,
            renderOrder: 3,
          },
          path: {
            positions: [],
            indices: [],
            vertexIndex: 0,
            color: 0xb9ad91,
            lift: 0.208,
            renderOrder: 4,
          },
        },
        waterAreas = r.waters.map((water: any) => ({
          points: water.points,
          minX: Math.min(...water.points.map((point: number[]) => point[0])),
          maxX: Math.max(...water.points.map((point: number[]) => point[0])),
          minZ: Math.min(...water.points.map((point: number[]) => point[1])),
          maxZ: Math.max(...water.points.map((point: number[]) => point[1])),
        })),
        inWater = (x: number, z: number) =>
          waterAreas.some(
            (water: any) =>
              x >= water.minX &&
              x <= water.maxX &&
              z >= water.minZ &&
              z <= water.maxZ &&
              pointInPolygon(x, z, water.points),
          );
      const addRoadCap = (
          bucket: RoadBucket,
          x: number,
          z: number,
          radius: number,
        ) => {
          const ring: [number, number][] = [];
          for (let step = 0; step <= 10; step++) {
            const angle = (step / 10) * Math.PI * 2;
            ring.push([
              x + Math.cos(angle) * radius,
              z + Math.sin(angle) * radius,
            ]);
          }
          const flatY =
              Math.max(
                terrainHeight(r, x, z),
                ...ring.map(([edgeX, edgeZ]) => terrainHeight(r, edgeX, edgeZ)),
              ) +
              bucket.lift +
              0.004,
            centerIndex = bucket.vertexIndex;
          bucket.positions.push(x, flatY, z);
          bucket.vertexIndex++;
          ring.forEach(([edgeX, edgeZ], step) => {
            bucket.positions.push(edgeX, flatY, edgeZ);
            bucket.vertexIndex++;
            if (step > 0)
              bucket.indices.push(
                centerIndex,
                centerIndex + step,
                centerIndex + step + 1,
              );
          });
        },
        addRoadStrip = (
          bucket: RoadBucket,
          points: [number, number][],
          width: number,
        ) => {
          if (points.length < 2) return;
          const firstVertex = bucket.vertexIndex,
            halfWidth = width / 2;
          points.forEach(([x, z], index) => {
            const previous = points[Math.max(0, index - 1)],
              next = points[Math.min(points.length - 1, index + 1)],
              incomingX = x - previous[0],
              incomingZ = z - previous[1],
              outgoingX = next[0] - x,
              outgoingZ = next[1] - z,
              incomingLength = Math.hypot(incomingX, incomingZ),
              outgoingLength = Math.hypot(outgoingX, outgoingZ);
            let offsetX = 0,
              offsetZ = 0;
            if (!index || index === points.length - 1) {
              const dx = !index ? outgoingX : incomingX,
                dz = !index ? outgoingZ : incomingZ,
                length = Math.max(0.0001, Math.hypot(dx, dz));
              offsetX = (-dz / length) * halfWidth;
              offsetZ = (dx / length) * halfWidth;
            } else {
              const inX = incomingX / Math.max(0.0001, incomingLength),
                inZ = incomingZ / Math.max(0.0001, incomingLength),
                outX = outgoingX / Math.max(0.0001, outgoingLength),
                outZ = outgoingZ / Math.max(0.0001, outgoingLength),
                tangentX = inX + outX,
                tangentZ = inZ + outZ,
                tangentLength = Math.hypot(tangentX, tangentZ);
              if (tangentLength < 0.08) {
                offsetX = -inZ * halfWidth;
                offsetZ = inX * halfWidth;
              } else {
                const miterX = -tangentZ / tangentLength,
                  miterZ = tangentX / tangentLength,
                  normalX = -inZ,
                  normalZ = inX,
                  denominator = miterX * normalX + miterZ * normalZ,
                  rawLength =
                    Math.abs(denominator) < 0.2
                      ? halfWidth
                      : halfWidth / denominator,
                  miterLength = THREE.MathUtils.clamp(
                    rawLength,
                    -halfWidth * 1.8,
                    halfWidth * 1.8,
                  );
                offsetX = miterX * miterLength;
                offsetZ = miterZ * miterLength;
              }
            }
            const leftX = x + offsetX,
              leftZ = z + offsetZ,
              rightX = x - offsetX,
              rightZ = z - offsetZ;
            bucket.positions.push(
              leftX,
              terrainHeight(r, leftX, leftZ) + bucket.lift,
              leftZ,
              rightX,
              terrainHeight(r, rightX, rightZ) + bucket.lift,
              rightZ,
            );
            bucket.vertexIndex += 2;
            if (index > 0) {
              const previousLeft = firstVertex + (index - 1) * 2,
                previousRight = previousLeft + 1,
                currentLeft = firstVertex + index * 2,
                currentRight = currentLeft + 1;
              bucket.indices.push(
                previousLeft,
                currentLeft,
                previousRight,
                currentLeft,
                currentRight,
                previousRight,
              );
            }
          });
          addRoadCap(bucket, points[0][0], points[0][1], halfWidth);
          const lastPoint = points.at(-1)!;
          addRoadCap(bucket, lastPoint[0], lastPoint[1], halfWidth);
        };
      for (const road of r.roads) {
        const kind = road.kind as string,
          pedestrianRoad = [
            "footway",
            "path",
            "pedestrian",
            "steps",
            "cycleway",
            "corridor",
          ].includes(kind),
          bucket = pedestrianRoad
            ? roadBuckets.path
            : kind === "track"
              ? roadBuckets.dirt
              : roadBuckets.asphalt,
          displayWidth = Math.max(road.width, pedestrianRoad ? 0.15 : 0.24);
        let chunk: [number, number][] = [];
        const flushChunk = () => {
          if (chunk.length > 1) addRoadStrip(bucket, chunk, displayWidth);
          chunk = [];
        };
        for (let k = 1; k < road.points.length; k++) {
          const [x1, z1] = road.points[k - 1],
            [x2, z2] = road.points[k],
            dx = x2 - x1,
            dz = z2 - z1,
            len = Math.hypot(dx, dz);
          if (len < 0.01) continue;
          const steps = Math.max(1, Math.ceil(len / 0.18));
          for (let step = 0; step <= steps; step++) {
            const t = step / steps,
              sampleX = x1 + dx * t,
              sampleZ = z1 + dz * t;
            if (inWater(sampleX, sampleZ)) {
              flushChunk();
              continue;
            }
            const previousPoint = chunk.at(-1);
            if (
              previousPoint &&
              Math.hypot(
                sampleX - previousPoint[0],
                sampleZ - previousPoint[1],
              ) > 0.3
            )
              flushChunk();
            if (
              !chunk.length ||
              Math.hypot(
                sampleX - chunk.at(-1)![0],
                sampleZ - chunk.at(-1)![1],
              ) > 0.002
            )
              chunk.push([sampleX, sampleZ]);
          }
        }
        flushChunk();
      }
      Object.values(roadBuckets).forEach((bucket) => {
        if (!bucket.positions.length) return;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(bucket.positions, 3),
        );
        geometry.setIndex(bucket.indices);
        const roads = new THREE.Mesh(
          geometry,
          new THREE.MeshBasicMaterial({
            color: bucket.color,
            polygonOffset: true,
            polygonOffsetFactor: -bucket.renderOrder,
            polygonOffsetUnits: -bucket.renderOrder,
          }),
        );
        roads.receiveShadow = false;
        roads.renderOrder = bucket.renderOrder;
        mapGroup.add(roads);
      });
      const bp: number[] = [],
        bi: number[] = [],
        bc: number[] = [],
        buildingPalette = [
          0x9aa7a3, 0xaca99f, 0xa49a90, 0x93a2aa, 0xb1a58f, 0x9da69a,
        ];
      let bv = 0;
      for (const b of r.buildings) {
        const pts = b.points.filter(
          (p: number[], i: number, a: number[][]) =>
            !i || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 0.001,
        );
        if (
          pts.length > 2 &&
          Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) <
            0.001
        )
          pts.pop();
        if (pts.length < 3) continue;
        const x =
            pts.reduce((a: number, p: number[]) => a + p[0], 0) / pts.length,
          z = pts.reduce((a: number, p: number[]) => a + p[1], 0) / pts.length,
          base = terrainHeight(r, x, z),
          h = b.levels
            ? Math.min(7, b.levels * 0.58)
            : 0.95 + (b.osmId % 6) * 0.17,
          start = bv,
          tone = new THREE.Color(
            buildingPalette[Math.abs(b.osmId) % buildingPalette.length],
          ),
          wallTone = tone.clone().multiplyScalar(0.78),
          roofTone = tone.clone().lerp(new THREE.Color(0xd0b09b), 0.26);
        for (const p of pts) {
          bp.push(p[0], base, p[1], p[0], base + h, p[1]);
          bc.push(
            wallTone.r,
            wallTone.g,
            wallTone.b,
            roofTone.r,
            roofTone.g,
            roofTone.b,
          );
          bv += 2;
        }
        for (let i = 0; i < pts.length; i++) {
          const j = (i + 1) % pts.length,
            a = start + i * 2,
            c = start + j * 2;
          bi.push(a, c, a + 1, a + 1, c, c + 1);
        }
        for (const face of THREE.ShapeUtils.triangulateShape(
          pts.map((p: number[]) => new THREE.Vector2(p[0], p[1])),
          [],
        ))
          bi.push(
            start + face[0] * 2 + 1,
            start + face[1] * 2 + 1,
            start + face[2] * 2 + 1,
          );
      }
      const bg = new THREE.BufferGeometry();
      bg.setAttribute("position", new THREE.Float32BufferAttribute(bp, 3));
      bg.setAttribute("color", new THREE.Float32BufferAttribute(bc, 3));
      bg.setIndex(bi);
      bg.computeVertexNormals();
      const buildings = new THREE.Mesh(
        bg,
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.82,
          side: THREE.DoubleSide,
          flatShading: true,
        }),
      );
      buildings.receiveShadow = false;
      buildings.castShadow = true;
      mapGroup.add(buildings);
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(bg, 32),
        new THREE.LineBasicMaterial({
          color: 0x65706e,
          transparent: true,
          opacity: 0.48,
        }),
      );
      outline.renderOrder = 5;
      mapGroup.add(outline);
      const windowMatrices: THREE.Matrix4[] = [],
        doorMatrices: THREE.Matrix4[] = [],
        roofMatrices: THREE.Matrix4[] = [],
        detailDummy = new THREE.Object3D(),
        windowLimit = r === regions.main ? 13500 : 2600;
      for (const b of r.buildings) {
        const pts = b.points.filter(
          (p: number[], i: number, a: number[][]) =>
            !i || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 0.001,
        );
        if (
          pts.length > 2 &&
          Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) <
            0.001
        )
          pts.pop();
        if (pts.length < 3) continue;
        const signedArea = pts.reduce((sum: number, p: number[], i: number) => {
            const next = pts[(i + 1) % pts.length];
            return sum + p[0] * next[1] - next[0] * p[1];
          }, 0),
          outwardSign = signedArea > 0 ? -1 : 1;
        const x =
            pts.reduce((a: number, p: number[]) => a + p[0], 0) / pts.length,
          z = pts.reduce((a: number, p: number[]) => a + p[1], 0) / pts.length,
          base = terrainHeight(r, x, z),
          h = b.levels
            ? Math.min(7, b.levels * 0.58)
            : 0.95 + (b.osmId % 6) * 0.17,
          rows = Math.min(4, Math.max(1, Math.floor(h / 0.48)));
        let longest: { a: number[]; c: number[]; len: number } | null = null;
        for (
          let i = 0;
          i < pts.length && windowMatrices.length < windowLimit;
          i++
        ) {
          const a = pts[i],
            c = pts[(i + 1) % pts.length],
            dx = c[0] - a[0],
            dz = c[1] - a[1],
            len = Math.hypot(dx, dz);
          if (!longest || len > longest.len) longest = { a, c, len };
          if (len < 0.42) continue;
          const cols = Math.min(5, Math.max(1, Math.floor(len / 0.42))),
            angle = Math.atan2(-dz, dx),
            nx = (-dz / len) * outwardSign,
            nz = (dx / len) * outwardSign;
          for (
            let row = 0;
            row < rows && windowMatrices.length < windowLimit;
            row++
          )
            for (
              let col = 0;
              col < cols && windowMatrices.length < windowLimit;
              col++
            ) {
              const t = (col + 1) / (cols + 1);
              detailDummy.position.set(
                a[0] + dx * t + nx * 0.025,
                base + (h * (row + 1)) / (rows + 1),
                a[1] + dz * t + nz * 0.025,
              );
              detailDummy.rotation.set(0, angle, 0);
              detailDummy.scale.set(
                Math.min(0.18, (len / (cols + 1)) * 0.5),
                0.12,
                1,
              );
              detailDummy.updateMatrix();
              windowMatrices.push(detailDummy.matrix.clone());
            }
        }
        if (longest && longest.len > 0.45) {
          const dx = longest.c[0] - longest.a[0],
            dz = longest.c[1] - longest.a[1],
            len = longest.len,
            nx = (-dz / len) * outwardSign,
            nz = (dx / len) * outwardSign;
          detailDummy.position.set(
            (longest.a[0] + longest.c[0]) / 2 + nx * 0.03,
            base + 0.17,
            (longest.a[1] + longest.c[1]) / 2 + nz * 0.03,
          );
          detailDummy.rotation.set(0, Math.atan2(-dz, dx), 0);
          detailDummy.scale.set(0.23, 0.34, 1);
          detailDummy.updateMatrix();
          doorMatrices.push(detailDummy.matrix.clone());
        }
        if (
          h > 1.2 &&
          Math.abs(b.osmId) % 4 === 0 &&
          roofMatrices.length < 1400
        ) {
          const xs = pts.map((p: number[]) => p[0]),
            zs = pts.map((p: number[]) => p[1]),
            width = Math.max(...xs) - Math.min(...xs),
            depth = Math.max(...zs) - Math.min(...zs);
          detailDummy.position.set(x, base + h + 0.09, z);
          detailDummy.rotation.set(0, ((b.osmId % 12) * Math.PI) / 12, 0);
          detailDummy.scale.set(
            Math.min(0.42, width * 0.28),
            0.18,
            Math.min(0.38, depth * 0.26),
          );
          detailDummy.updateMatrix();
          roofMatrices.push(detailDummy.matrix.clone());
        }
      }
      const windowMaterial = new THREE.MeshStandardMaterial({
        color: 0x31566a,
        emissive: 0xffc45e,
        emissiveIntensity: 0,
        roughness: 0.28,
        metalness: 0.08,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      windowMaterials.push(windowMaterial);
      const windows = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        windowMaterial,
        windowMatrices.length,
      );
      windowMatrices.forEach((m, i) => windows.setMatrixAt(i, m));
      windows.instanceMatrix.needsUpdate = true;
      windows.renderOrder = 6;
      mapGroup.add(windows);
      const doors = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshStandardMaterial({
          color: 0x493a31,
          roughness: 0.8,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
        doorMatrices.length,
      );
      doorMatrices.forEach((m, i) => doors.setMatrixAt(i, m));
      doors.instanceMatrix.needsUpdate = true;
      doors.renderOrder = 6;
      mapGroup.add(doors);
      const roofFixtures = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({
          color: 0x6e7774,
          roughness: 0.7,
          metalness: 0.12,
        }),
        roofMatrices.length,
      );
      roofMatrices.forEach((m, i) => roofFixtures.setMatrixAt(i, m));
      roofFixtures.instanceMatrix.needsUpdate = true;
      roofFixtures.castShadow = true;
      roofFixtures.receiveShadow = true;
      mapGroup.add(roofFixtures);
      const waterMat = new THREE.MeshStandardMaterial({
        color: 0x478ca5,
        transparent: true,
        opacity: 0.83,
        roughness: 0.24,
        metalness: 0.1,
        side: THREE.DoubleSide,
      });
      for (const water of r.waters) {
        if (water.points.length < 3) continue;
        const wm = new THREE.Mesh(
          surfaceGeometry(r, water.points, 0.15),
          waterMat,
        );
        wm.renderOrder = 4;
        mapGroup.add(wm);
      }
    };
    addRegion(regions.main);
    for (const r of [regions.main]) {
      const apron = new THREE.Mesh(
        new THREE.BoxGeometry(r.width + 34, 0.12, r.depth + 34),
        new THREE.MeshStandardMaterial({
          color: r.offsetX ? 0x617c4f : 0x668351,
          roughness: 1,
        }),
      );
      apron.position.set(r.offsetX, -0.12, 0);
      apron.receiveShadow = true;
      mapGroup.add(apron);
    }
    const buildingGroup = new THREE.Group();
    scene.add(buildingGroup);
    const unitGroup = new THREE.Group();
    scene.add(unitGroup);
    const commandGroup = new THREE.Group();
    scene.add(commandGroup);
    const combatGroup = new THREE.Group();
    scene.add(combatGroup);
    const territoryGroup = new THREE.Group();
    territoryGroup.visible = false;
    scene.add(territoryGroup);
    const siteObjects = new Map<number, THREE.Group>();
    const unitObjects = new Map<number, THREE.Group>();
    const selectedUnitIds = new Set<number>();
    const directKeys = new Set<string>();
    let directControlActive = false,
      cameraBeforeDirect: {
        position: THREE.Vector3;
        target: THREE.Vector3;
      } | null = null;
    const exitDirectControl = () => {
        if (!directControlActive) return;
        directControlActive = false;
        directKeys.clear();
        controls.enabled = true;
        if (cameraBeforeDirect) {
          camera.position.copy(cameraBeforeDirect.position);
          controls.target.copy(cameraBeforeDirect.target);
          controls.update();
        }
        cameraBeforeDirect = null;
        setDirectControl(false);
        setNotice("已退出近距离控制");
      },
      enterDirectControl = () => {
        const selectedUnits = gameRef.current.units.filter(
          (unit) => unit.team === "pku" && selectedUnitIds.has(unit.id),
        );
        if (!selectedUnits.length || viewModeRef.current !== "sites")
          return false;
        cameraBeforeDirect = {
          position: camera.position.clone(),
          target: controls.target.clone(),
        };
        selectedUnits.forEach((unit) => {
          unit.path = undefined;
          unit.pathIndex = undefined;
          unit.targetSiteId = undefined;
          unit.tx = unit.x;
          unit.tz = unit.z;
        });
        directControlActive = true;
        controls.enabled = false;
        setDirectControl(true);
        setSelected(null);
        setNotice("近距离控制：WASD移动所选学生，Esc退出");
        return true;
      };
    const onDirectKeyDown = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement | null,
          typing =
            target?.tagName === "INPUT" ||
            target?.tagName === "TEXTAREA" ||
            target?.tagName === "SELECT";
        if (typing) return;
        const key = event.key.toLowerCase();
        if (key === "escape") {
          exitDirectControl();
          return;
        }
        if (key === "f" && !directControlActive) {
          if (!enterDirectControl()) setNotice("请先双击选中一批北大学生");
          return;
        }
        if (directControlActive && ["w", "a", "s", "d"].includes(key)) {
          directKeys.add(key);
          event.preventDefault();
        }
      },
      onDirectKeyUp = (event: KeyboardEvent) => {
        directKeys.delete(event.key.toLowerCase());
      };
    addEventListener("keydown", onDirectKeyDown);
    addEventListener("keyup", onDirectKeyUp);
    let customSiteTexture: THREE.Texture | null = null,
      customUnitTexture: THREE.Texture | null = null,
      unitMaterialRequest = 0,
      siteMaterialRequest = 0;
    const combatEffects: { sprite: THREE.Sprite; born: number }[] = [];
    const fightCanvas = document.createElement("canvas");
    fightCanvas.width = 192;
    fightCanvas.height = 192;
    const fightCtx = fightCanvas.getContext("2d")!;
    fightCtx.font = "150px Segoe UI Symbol";
    fightCtx.textAlign = "center";
    fightCtx.textBaseline = "middle";
    fightCtx.fillStyle = "#fff2b8";
    fightCtx.strokeStyle = "#b51f39";
    fightCtx.lineWidth = 9;
    fightCtx.strokeText("⚔", 96, 104);
    fightCtx.fillText("⚔", 96, 104);
    const fightTexture = new THREE.CanvasTexture(fightCanvas);
    fightTexture.colorSpace = THREE.SRGBColorSpace;
    const arrowCanvas = document.createElement("canvas");
    arrowCanvas.width = 128;
    arrowCanvas.height = 128;
    const arrowContext = arrowCanvas.getContext("2d")!;
    arrowContext.fillStyle = "#ffffff";
    arrowContext.beginPath();
    arrowContext.moveTo(64, 8);
    arrowContext.lineTo(112, 112);
    arrowContext.lineTo(64, 84);
    arrowContext.lineTo(16, 112);
    arrowContext.closePath();
    arrowContext.fill();
    const commandArrowTexture = new THREE.CanvasTexture(arrowCanvas);
    commandArrowTexture.colorSpace = THREE.SRGBColorSpace;
    const spawnCombatEffect = (x: number, z: number) => {
      const r = regionForX(x),
        sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: fightTexture,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            opacity: 1,
          }),
        );
      sprite.position.set(x, terrainHeight(r, x, z) + 2, z);
      sprite.scale.set(1.05, 1.05, 1);
      sprite.renderOrder = 60;
      combatGroup.add(sprite);
      combatEffects.push({ sprite, born: performance.now() });
    };
    const disposeCommandObject = (
      object: THREE.Object3D,
      disposeMaps = true,
    ) => {
      object.traverse((child) => {
        const renderable = child as THREE.Mesh & {
          material?: THREE.Material | THREE.Material[];
          geometry?: THREE.BufferGeometry;
        };
        renderable.geometry?.dispose();
        const materials = Array.isArray(renderable.material)
          ? renderable.material
          : renderable.material
            ? [renderable.material]
            : [];
        materials.forEach((material) => {
          const map = (material as THREE.SpriteMaterial).map;
          if (
            disposeMaps &&
            map &&
            map !== fightTexture &&
            map !== commandArrowTexture
          )
            map.dispose();
          material.dispose();
        });
      });
    };
    const clearCommandVisuals = () => {
      commandGroup.children.slice().forEach((child) => {
        commandGroup.remove(child);
        disposeCommandObject(child);
      });
    };
    const commandAnimations: {
        curve: THREE.Curve<THREE.Vector3>;
        movers: THREE.Sprite[];
        label: THREE.Sprite;
        phase: number;
      }[] = [],
      commandTangent = new THREE.Vector3(),
      commandLineMaterials: LineMaterial[] = [];
    const commandLabelTexture = (text: string, color: string) => {
      const c = document.createElement("canvas");
      c.width = 384;
      c.height = 80;
      const x = c.getContext("2d")!;
      x.fillStyle = "rgba(12,20,18,.92)";
      x.roundRect(4, 4, 376, 72, 18);
      x.fill();
      x.strokeStyle = color;
      x.lineWidth = 5;
      x.stroke();
      x.fillStyle = "#fff8de";
      x.font = "700 31px Microsoft YaHei";
      x.textAlign = "center";
      x.fillText(text, 192, 53);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const addCommandLine = (
      a: THREE.Vector3,
      b: THREE.Vector3,
      preview = false,
      attack = true,
      troops = 0,
      path?: [number, number][],
      dispatchRatio = 0.6,
    ) => {
      const makeLine = (
          curve: THREE.Curve<THREE.Vector3>,
          color: number,
          width: number,
          opacity: number,
          renderOrder: number,
          track = true,
        ) => {
          const distance = curve.getLength(),
            segments = Math.max(12, Math.ceil(distance * 1.6)),
            positions: number[] = [];
          for (let i = 0; i <= segments; i++) {
            const point = curve.getPoint(i / segments);
            positions.push(point.x, point.y, point.z);
          }
          const geometry = new LineGeometry();
          geometry.setPositions(positions);
          const material = new LineMaterial({
            color,
            linewidth: width,
            transparent: true,
            opacity,
            depthTest: false,
            depthWrite: false,
            worldUnits: false,
          });
          material.resolution.set(host.clientWidth, host.clientHeight);
          if (track) commandLineMaterials.push(material);
          const line = new Line2(geometry, material);
          line.computeLineDistances();
          line.renderOrder = renderOrder;
          return line;
        },
        makeArrowSprite = (color: number, scale: number) => {
          const sprite = new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: commandArrowTexture,
              color,
              transparent: true,
              depthTest: false,
              depthWrite: false,
            }),
          );
          sprite.scale.set(scale, scale, 1);
          return sprite;
        };
      if (preview) {
        const start = a.clone(),
          end = b.clone(),
          curve = new THREE.LineCurve3(start, end),
          group = new THREE.Group(),
          line = makeLine(curve, 0xffffff, 3.5, 0.92, 40, false),
          head = makeArrowSprite(0xffffff, 0.72);
        group.add(line);
        head.position.copy(end);
        const previewTangent = curve.getTangent(1);
        (head.material as THREE.SpriteMaterial).rotation =
          Math.atan2(previewTangent.x, previewTangent.z) + Math.PI;
        head.renderOrder = 41;
        group.add(head);
        commandGroup.add(group);
        return group;
      }
      const color = attack ? 0xff684d : 0x79dcff,
        pathPoints = path?.length
          ? [
              a.clone(),
              ...path.map(
                ([x, z]) =>
                  new THREE.Vector3(
                    x,
                    terrainHeight(regionForX(x), x, z) + 1.45,
                    z,
                  ),
              ),
              b.clone(),
            ]
          : [a.clone(), b.clone()],
        curve = new THREE.CatmullRomCurve3(
          pathPoints,
          false,
          "centripetal",
          0.3,
        ),
        group = new THREE.Group(),
        line = makeLine(curve, color, 5, 0.86, 32),
        head = makeArrowSprite(color, 0.78);
      group.add(line);
      head.position.copy(curve.getPoint(0.94));
      const headTangent = curve.getTangent(0.94);
      (head.material as THREE.SpriteMaterial).rotation =
        Math.atan2(headTangent.x, headTangent.z) + Math.PI;
      head.renderOrder = 35;
      group.add(head);
      const movers: THREE.Sprite[] = [];
      for (let i = 0; i < 5; i++) {
        const mover = makeArrowSprite(0xfff5cf, 0.5);
        mover.renderOrder = 36;
        group.add(mover);
        movers.push(mover);
      }
      const label = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: commandLabelTexture(
            `${attack ? "⚔ 进攻" : "✚ 增援"} · ${troops ? `${troops}人` : `持续${Math.round(dispatchRatio * 100)}%`}`,
            attack ? "#ff684d" : "#79dcff",
          ),
          transparent: true,
          depthTest: false,
          depthWrite: false,
        }),
      );
      label.scale.set(2.9, 0.6, 1);
      label.position.copy(curve.getPoint(0.5));
      label.position.y += 0.55;
      label.renderOrder = 38;
      label.visible = false;
      group.add(label);
      commandGroup.add(group);
      commandAnimations.push({
        curve,
        movers,
        label,
        phase: (a.x + a.z) * 0.071,
      });
      return group;
    };
    const rebuildCommandLines = () => {
      clearCommandVisuals();
      commandAnimations.splice(0);
      commandLineMaterials.splice(0);
      gameRef.current.sites.forEach((s) => {
        if (s.team !== "pku") return;
        if (s.destroyed || s.orderTarget == null) return;
        const t = gameRef.current.sites[s.orderTarget];
        if (!t || t.destroyed) return;
        const troops = gameRef.current.units
          .filter((u) => u.siteId === s.id && u.targetSiteId === t.id)
          .reduce((sum, unit) => sum + unit.strength, 0);
        const route = addCommandLine(
          new THREE.Vector3(
            s.x,
            terrainHeight(regionForX(s.x), s.x, s.z) + 1.75,
            s.z,
          ),
          new THREE.Vector3(
            t.x,
            terrainHeight(regionForX(t.x), t.x, t.z) + 1.75,
            t.z,
          ),
          false,
          s.team !== t.team,
          troops,
          s.orderPath,
          s.dispatchRatio ?? 0.6,
        );
        route.traverse((object) => {
          object.userData.commandSourceId = s.id;
        });
      });
    };
    const issueOrder = (
      team: Team,
      source: SiteState,
      target: SiteState,
      requested = Number.POSITIVE_INFINITY,
      emergency = false,
    ) => {
      if (source.destroyed || target.destroyed || source.team !== team)
        return 0;
      if (target.team !== team && !gameRef.current.campaign.warUnlocked)
        return 0;
      source.dispatchRatio ??=
        source.stance === "defend"
          ? 0.45
          : source.stance === "guard"
            ? 0.72
            : 1;
      const idle = gameRef.current.units.filter(
          (unit) =>
            unit.team === team &&
            unit.siteId === source.id &&
            unit.targetSiteId == null &&
            (!directControlActive || !selectedUnitIds.has(unit.id)) &&
            Math.hypot(
              unit.x - (source.navX ?? source.x),
              unit.z - (source.navZ ?? source.z),
            ) < 3.2,
        ),
        reserve = emergency
          ? Math.min(1, idle.length)
          : source.stance === "defend"
            ? Math.max(4, Math.ceil(idle.length * 0.55))
            : source.stance === "guard"
              ? Math.max(2, Math.ceil(idle.length * 0.28))
              : 0,
        desired = Number.isFinite(requested)
          ? requested
          : Math.ceil(idle.length * source.dispatchRatio),
        moving = idle.slice(
          0,
          Math.max(0, Math.min(desired, idle.length - reserve)),
        );
      const targetX = target.navX ?? target.x,
        targetZ = target.navZ ?? target.z,
        sharedPath = findPath(
          source.navX ?? source.x,
          source.navZ ?? source.z,
          targetX,
          targetZ,
        );
      if (!sharedPath.length) return 0;
      source.orderTarget = target.id;
      source.orderPath = sharedPath;
      moving.forEach((unit) => {
        unit.targetSiteId = target.id;
        unit.path = sharedPath;
        unit.pathIndex = 0;
        unit.tx = targetX + ((unit.id % 5) - 2) * 0.24;
        unit.tz = targetZ + ((unit.id % 4) - 1.5) * 0.24;
      });
      rebuildCommandLines();
      refreshRouteHighlights();
      return moving.reduce((sum, unit) => sum + unit.strength, 0);
    };
    const labelTexture = (text: string, color: string) => {
      const c = document.createElement("canvas");
      c.width = 512;
      c.height = 96;
      const x = c.getContext("2d")!;
      x.fillStyle = "rgba(21,30,25,.86)";
      x.roundRect(4, 4, 504, 88, 16);
      x.fill();
      x.strokeStyle = color;
      x.lineWidth = 5;
      x.stroke();
      x.fillStyle = "#fff6dc";
      x.font = "700 34px Microsoft YaHei";
      x.textAlign = "center";
      x.fillText(text, 256, 61);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    const stanceTextureCache = new Map<string, THREE.CanvasTexture>(),
      stanceIconTexture = (stance: Stance, color: string) => {
        const key = `${stance}/${color}`;
        const cached = stanceTextureCache.get(key);
        if (cached) return cached;
        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 128;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "rgba(15,24,21,.92)";
        context.beginPath();
        context.arc(64, 64, 55, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = color;
        context.fillStyle = color;
        context.lineWidth = 10;
        context.lineCap = "round";
        context.lineJoin = "round";
        if (stance === "defend") {
          context.beginPath();
          context.moveTo(64, 23);
          context.lineTo(94, 36);
          context.lineTo(88, 82);
          context.quadraticCurveTo(64, 108, 40, 82);
          context.lineTo(34, 36);
          context.closePath();
          context.stroke();
        } else if (stance === "guard") {
          context.beginPath();
          context.arc(64, 64, 12, 0, Math.PI * 2);
          context.fill();
          context.beginPath();
          context.arc(64, 64, 30, -0.8, 0.8);
          context.arc(64, 64, 45, -0.8, 0.8);
          context.stroke();
        } else {
          context.fillRect(39, 32, 13, 64);
          context.fillRect(76, 32, 13, 64);
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        stanceTextureCache.set(key, texture);
        return texture;
      };
    const siteTypeTextureCache = new Map<SiteKind, THREE.CanvasTexture>(),
      siteTypeIconTexture = (kind: SiteKind) => {
        const cached = siteTypeTextureCache.get(kind);
        if (cached) return cached;
        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 128;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "rgba(15,24,21,.92)";
        context.beginPath();
        context.arc(64, 64, 55, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "#ffe39a";
        context.fillStyle = "#ffe39a";
        context.lineWidth = 9;
        context.lineCap = "round";
        context.lineJoin = "round";
        if (kind === "dorm") {
          context.strokeRect(27, 56, 74, 34);
          context.fillRect(33, 43, 24, 18);
          context.fillRect(25, 87, 12, 19);
          context.fillRect(91, 87, 12, 19);
        } else if (kind === "dining") {
          context.beginPath();
          context.arc(64, 70, 34, 0, Math.PI);
          context.stroke();
          context.fillRect(31, 82, 66, 10);
          [47, 64, 81].forEach((x) => {
            context.beginPath();
            context.moveTo(x, 52);
            context.quadraticCurveTo(x - 8, 39, x, 27);
            context.stroke();
          });
        } else if (kind === "gate") {
          context.strokeRect(29, 35, 70, 62);
          context.beginPath();
          context.arc(64, 67, 22, Math.PI, 0);
          context.stroke();
          context.fillRect(42, 67, 44, 32);
        } else if (kind === "camp") {
          context.beginPath();
          context.moveTo(24, 94);
          context.lineTo(64, 29);
          context.lineTo(104, 94);
          context.closePath();
          context.stroke();
          context.beginPath();
          context.moveTo(64, 29);
          context.lineTo(64, 94);
          context.stroke();
        } else {
          context.strokeRect(28, 38, 72, 52);
          context.beginPath();
          context.moveTo(28, 38);
          context.lineTo(64, 24);
          context.lineTo(100, 38);
          context.stroke();
          context.fillRect(42, 50, 10, 28);
          context.fillRect(59, 50, 10, 28);
          context.fillRect(76, 50, 10, 28);
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        siteTypeTextureCache.set(kind, texture);
        return texture;
      };
    const nodeTextureCache = new Map<string, THREE.CanvasTexture>(),
      haloTextureCache = new Map<string, THREE.CanvasTexture>(),
      siteNodeTexture = (team: Team, stance: Stance) => {
        const key = `${team}/${stance}`,
          cached = nodeTextureCache.get(key);
        if (cached) return cached;
        const canvas = document.createElement("canvas");
        canvas.width = 192;
        canvas.height = 192;
        const context = canvas.getContext("2d")!;
        context.beginPath();
        context.arc(96, 96, 78, 0, Math.PI * 2);
        context.fillStyle = "rgba(12,20,18,.96)";
        context.fill();
        context.lineWidth = 18;
        context.strokeStyle = team === "pku" ? "#d62b46" : "#9153b9";
        context.stroke();
        const drawShield = (inset: number, width: number, opacity: number) => {
          context.beginPath();
          context.moveTo(96, 38 + inset);
          context.lineTo(140 - inset, 55 + inset * 0.35);
          context.lineTo(133 - inset * 0.7, 111 - inset * 0.25);
          context.quadraticCurveTo(
            96,
            151 - inset,
            59 + inset * 0.7,
            111 - inset * 0.25,
          );
          context.lineTo(52 + inset, 55 + inset * 0.35);
          context.closePath();
          context.globalAlpha = opacity;
          context.strokeStyle = "#ffe39a";
          context.lineWidth = width;
          context.stroke();
          context.globalAlpha = 1;
        };
        if (stance === "guard" || stance === "defend") drawShield(0, 8, 0.92);
        if (stance === "defend") drawShield(13, 5, 0.74);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        nodeTextureCache.set(key, texture);
        return texture;
      },
      haloTexture = (color: string) => {
        const cached = haloTextureCache.get(color);
        if (cached) return cached;
        const canvas = document.createElement("canvas");
        canvas.width = 192;
        canvas.height = 192;
        const context = canvas.getContext("2d")!;
        context.beginPath();
        context.arc(96, 96, 76, 0, Math.PI * 2);
        context.lineWidth = 16;
        context.strokeStyle = color;
        context.shadowColor = color;
        context.shadowBlur = 22;
        context.stroke();
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        haloTextureCache.set(color, texture);
        return texture;
      },
      nearbyFriendlyPeople = (site: SiteState) =>
        gameRef.current.units
          .filter(
            (unit) =>
              unit.team === site.team &&
              Math.hypot(
                unit.x - (site.navX ?? site.x),
                unit.z - (site.navZ ?? site.z),
              ) < 3.4,
          )
          .reduce((sum, unit) => sum + unit.strength, 0),
      drawCountBadge = (context: CanvasRenderingContext2D, count: number) => {
        context.clearRect(0, 0, 256, 72);
        context.fillStyle = "rgba(9,16,14,.94)";
        context.roundRect(3, 3, 250, 66, 18);
        context.fill();
        context.strokeStyle = "#f2d478";
        context.lineWidth = 4;
        context.stroke();
        context.fillStyle = "#fff4c4";
        context.font = "800 30px Microsoft YaHei";
        context.textAlign = "center";
        context.fillText(`友军 ${count}人`, 128, 47);
      };
    const rebuildTerritory = () => {
      territoryGroup.children.slice().forEach((child) => {
        territoryGroup.remove(child);
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material))
          mesh.material.forEach((material) => material.dispose());
        else mesh.material?.dispose();
      });
      const region = regions.main,
        cols = 72,
        rows = 56,
        activeSites = gameRef.current.sites.filter((site) => !site.destroyed),
        positions: number[] = [],
        colors: number[] = [],
        indices: number[] = [],
        pkuColor = new THREE.Color(0xd92845),
        thuColor = new THREE.Color(0x7a3fa2),
        blended = new THREE.Color();
      for (let row = 0; row <= rows; row++) {
        const z = region.depth / 2 - (row / rows) * region.depth;
        for (let col = 0; col <= cols; col++) {
          const x =
            region.offsetX - region.width / 2 + (col / cols) * region.width;
          let pkuInfluence = 0,
            thuInfluence = 0;
          activeSites.forEach((site) => {
            const distanceSquared =
                (x - site.x) * (x - site.x) + (z - site.z) * (z - site.z),
              strategicWeight =
                site.type === "capital" || site.type === "target"
                  ? 1.65
                  : site.type === "gate"
                    ? 1.25
                    : site.type === "camp"
                      ? 0.65
                      : 1,
              influence =
                strategicWeight / Math.pow(distanceSquared + 18, 0.82);
            if (site.team === "pku") pkuInfluence += influence;
            else thuInfluence += influence;
          });
          const balance =
              (pkuInfluence - thuInfluence) /
              Math.max(0.0001, pkuInfluence + thuInfluence),
            teamMix = THREE.MathUtils.smoothstep(balance, -0.075, 0.075);
          blended.copy(thuColor).lerp(pkuColor, teamMix);
          positions.push(x, terrainHeight(region, x, z) + 0.22, z);
          colors.push(blended.r, blended.g, blended.b);
        }
      }
      for (let row = 0; row < rows; row++)
        for (let col = 0; col < cols; col++) {
          const topLeft = row * (cols + 1) + col,
            topRight = topLeft + 1,
            bottomLeft = topLeft + cols + 1,
            bottomRight = bottomLeft + 1;
          indices.push(
            topLeft,
            bottomLeft,
            topRight,
            topRight,
            bottomLeft,
            bottomRight,
          );
        }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geometry.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(colors, 3),
      );
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        }),
      );
      mesh.renderOrder = 7;
      territoryGroup.add(mesh);
    };
    const rebuildBuildings = () => {
      buildingGroup.children.slice().forEach((child) => {
        buildingGroup.remove(child);
        disposeCommandObject(child, false);
      });
      siteObjects.clear();
      gameRef.current.sites
        .filter((site) => !site.destroyed)
        .forEach((site) => {
          const g = new THREE.Group(),
            region = regionForX(site.x),
            isTarget = false,
            isRouteTarget = gameRef.current.sites.some(
              (source) =>
                source.team === "pku" &&
                !source.destroyed &&
                source.orderTarget === site.id,
            );
          g.position.set(site.x, terrainHeight(region, site.x, site.z), site.z);
          if (site.hasPortal && site.navX != null && site.navZ != null) {
            const portalX = site.navX - site.x,
              portalZ = site.navZ - site.z,
              portalGeometry = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(0, 0.48, 0),
                new THREE.Vector3(portalX, 0.48, portalZ),
              ]),
              portalLine = new THREE.Line(
                portalGeometry,
                new THREE.LineDashedMaterial({
                  color: 0x6cecff,
                  dashSize: 0.38,
                  gapSize: 0.22,
                  transparent: true,
                  opacity: 0.9,
                  depthTest: false,
                }),
              ),
              portalRing = new THREE.Mesh(
                new THREE.RingGeometry(0.32, 0.48, 28),
                new THREE.MeshBasicMaterial({
                  color: 0x6cecff,
                  transparent: true,
                  opacity: 0.95,
                  side: THREE.DoubleSide,
                  depthTest: false,
                }),
              );
            portalLine.computeLineDistances();
            portalLine.renderOrder = 26;
            portalRing.rotation.x = -Math.PI / 2;
            portalRing.position.set(portalX, 0.5, portalZ);
            portalRing.renderOrder = 27;
            g.add(portalLine, portalRing);
          }
          const nodeSprite = new THREE.Sprite(
              new THREE.SpriteMaterial({
                map: siteNodeTexture(site.team, site.stance),
                transparent: true,
                depthTest: false,
                depthWrite: false,
              }),
            ),
            routeHighlight = new THREE.Sprite(
              new THREE.SpriteMaterial({
                map: haloTexture("#ffe16d"),
                transparent: true,
                depthTest: false,
                depthWrite: false,
              }),
            ),
            hoverHighlight = new THREE.Sprite(
              new THREE.SpriteMaterial({
                map: haloTexture("#ffffff"),
                transparent: true,
                depthTest: false,
                depthWrite: false,
              }),
            );
          nodeSprite.scale.set(1.15, 1.15, 1);
          nodeSprite.position.y = 1.75;
          nodeSprite.renderOrder = 22;
          routeHighlight.scale.set(1.5, 1.5, 1);
          routeHighlight.position.y = 1.75;
          routeHighlight.visible = isRouteTarget;
          routeHighlight.renderOrder = 23;
          hoverHighlight.scale.set(1.78, 1.78, 1);
          hoverHighlight.position.y = 1.75;
          hoverHighlight.visible = false;
          hoverHighlight.renderOrder = 24;
          const countCanvas = document.createElement("canvas");
          countCanvas.width = 256;
          countCanvas.height = 72;
          const countContext = countCanvas.getContext("2d")!,
            initialCount = nearbyFriendlyPeople(site);
          drawCountBadge(countContext, initialCount);
          const countTexture = new THREE.CanvasTexture(countCanvas),
            countSprite = new THREE.Sprite(
              new THREE.SpriteMaterial({
                map: countTexture,
                transparent: true,
                depthTest: false,
                depthWrite: false,
              }),
            );
          countTexture.colorSpace = THREE.SRGBColorSpace;
          countSprite.scale.set(1.65, 0.46, 1);
          countSprite.position.y = 0.92;
          countSprite.renderOrder = 22;
          g.add(routeHighlight, hoverHighlight, nodeSprite, countSprite);
          g.userData.routeHighlight = routeHighlight;
          g.userData.hoverHighlight = hoverHighlight;
          g.userData.nodeSprite = nodeSprite;
          g.userData.countBadge = {
            context: countContext,
            texture: countTexture,
            last: initialCount,
          };
          let materialBadge: THREE.Sprite | null = null;
          if (customSiteTexture) {
            materialBadge = new THREE.Sprite(
              new THREE.SpriteMaterial({
                map: customSiteTexture,
                transparent: true,
                depthTest: false,
                depthWrite: false,
              }),
            );
            materialBadge.scale.set(0.72, 0.72, 1);
            materialBadge.position.y = 1.75;
            materialBadge.renderOrder = 25;
            g.add(materialBadge);
          }
          if (isTarget) {
            const beacon = new THREE.Mesh(
              new THREE.RingGeometry(1.48, 1.62, 48),
              new THREE.MeshBasicMaterial({
                color: 0xffd96b,
                transparent: true,
                opacity: 0.9,
                side: THREE.DoubleSide,
                depthTest: false,
              }),
            );
            beacon.rotation.x = -Math.PI / 2;
            beacon.position.y = 0.22;
            beacon.userData.targetBeacon = true;
            g.add(beacon);
          }
          const labelColor = site.team === "pku" ? "#df3b50" : "#a569d0",
            sprite = new THREE.Sprite(
              new THREE.SpriteMaterial({
                map: labelTexture(site.displayName ?? site.name, labelColor),
                transparent: true,
                depthTest: false,
              }),
            );
          const labelScaleX = isTarget ? 4.6 : 3.7,
            labelScaleY = isTarget ? 0.82 : 0.68,
            labelY = 2.75 + (site.id % 3) * 0.42;
          sprite.scale.set(labelScaleX, labelScaleY, 1);
          sprite.position.y = labelY;
          sprite.renderOrder = 20;
          g.add(sprite);
          const typeSprite = new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: siteTypeIconTexture(site.type),
              transparent: true,
              depthTest: false,
              depthWrite: false,
            }),
          );
          typeSprite.scale.set(0.44, 0.44, 1);
          typeSprite.position.set(0, 1.75, 0);
          typeSprite.renderOrder = 26;
          g.add(typeSprite);
          g.userData.fixedMarkerIcons = [
            {
              object: routeHighlight,
              x: 0,
              y: 1.75,
              scaleX: 1.5,
              scaleY: 1.5,
            },
            {
              object: hoverHighlight,
              x: 0,
              y: 1.75,
              scaleX: 1.78,
              scaleY: 1.78,
            },
            {
              object: nodeSprite,
              x: 0,
              y: 1.75,
              scaleX: 1.15,
              scaleY: 1.15,
            },
            {
              object: typeSprite,
              x: 0,
              y: 1.75,
              scaleX: 0.44,
              scaleY: 0.44,
            },
            {
              object: countSprite,
              x: 0,
              y: 0.92,
              scaleX: 1.65,
              scaleY: 0.46,
            },
            {
              object: sprite,
              x: 0,
              y: labelY,
              scaleX: labelScaleX,
              scaleY: labelScaleY,
            },
            ...(materialBadge
              ? [
                  {
                    object: materialBadge,
                    x: 0,
                    y: 1.75,
                    scaleX: 0.72,
                    scaleY: 0.72,
                  },
                ]
              : []),
          ];
          const hit = new THREE.Mesh(
            new THREE.CylinderGeometry(1.15, 1.15, 2.8, 12),
            new THREE.MeshBasicMaterial({
              transparent: true,
              opacity: 0,
              depthWrite: false,
            }),
          );
          hit.position.y = 1.75;
          hit.userData.siteHitProxy = true;
          g.add(hit);
          g.traverse((o) => {
            o.userData.siteId = site.id;
          });
          buildingGroup.add(g);
          siteObjects.set(site.id, g);
        });
      rebuildTerritory();
    };
    const refreshRouteHighlights = () => {
      const targets = new Set(
        gameRef.current.sites
          .filter(
            (source) =>
              source.team === "pku" &&
              !source.destroyed &&
              source.orderTarget != null,
          )
          .map((source) => source.orderTarget as number),
      );
      siteObjects.forEach((object, id) => {
        const highlight = object.userData.routeHighlight as
          THREE.Object3D | undefined;
        if (highlight) highlight.visible = targets.has(id);
      });
    };
    const textureLoader = new THREE.TextureLoader(),
      makeBallTexture = (
        file: string | null,
        fallbackText: string,
        teamColor: string,
        sealColor: string,
      ) => {
        const canvas = document.createElement("canvas");
        canvas.width = 1024;
        canvas.height = 512;
        const context = canvas.getContext("2d")!;
        context.fillStyle = teamColor;
        context.fillRect(0, 0, 1024, 512);
        const drawBacking = (centerX: number) => {
          context.beginPath();
          context.arc(centerX, 256, 188, 0, Math.PI * 2);
          context.fillStyle = "#fffaf0";
          context.fill();
          context.lineWidth = 16;
          context.strokeStyle = "#e1c56d";
          context.stroke();
          context.fillStyle = sealColor;
          context.font = "900 270px Microsoft YaHei";
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.fillText(fallbackText, centerX, 270);
        };
        drawBacking(256);
        drawBacking(768);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        if (file)
          textureLoader.load(`${import.meta.env.BASE_URL}${file}`, (loaded) => {
            const image = loaded.image as HTMLImageElement;
            [256, 768].forEach((centerX) => {
              context.beginPath();
              context.arc(centerX, 256, 176, 0, Math.PI * 2);
              context.fillStyle = "#fffaf0";
              context.fill();
              context.drawImage(image, centerX - 166, 90, 332, 332);
            });
            texture.needsUpdate = true;
          });
        return texture;
      },
      unitBallTextures = {
        pku: makeBallTexture("pku-seal.png", "北", "#b5102b", "#b40019"),
        thu: makeBallTexture("thu-seal.png", "清", "#6f3291", "#6f2c91"),
        ustc: makeBallTexture(null, "科", "#174f78", "#174f78"),
        zju: makeBallTexture(null, "浙", "#175b9b", "#175b9b"),
      };
    const UNIT_RENDER_SCALE = 0.56 / 3,
      UNIT_SEPARATION_DISTANCE = 0.48 / 3,
      hpGeometry = new THREE.PlaneGeometry(1, 0.1),
      hpBackMaterial = new THREE.MeshBasicMaterial({
        color: 0x17201c,
        transparent: true,
        opacity: 0.9,
        depthTest: true,
        depthWrite: false,
      }),
      hpFillMaterials = {
        pku: new THREE.MeshBasicMaterial({
          color: 0xff5368,
          depthTest: true,
          depthWrite: false,
        }),
        thu: new THREE.MeshBasicMaterial({
          color: 0xb67aff,
          depthTest: true,
          depthWrite: false,
        }),
      },
      unitBodyGeometry = new THREE.SphereGeometry(0.58, 24, 18),
      unitLimbGeometry = new THREE.CylinderGeometry(0.055, 0.055, 0.68, 7),
      unitHandGeometry = new THREE.SphereGeometry(0.09, 8, 6),
      unitGlowGeometry = new THREE.RingGeometry(0.68, 0.86, 28),
      unitSelectionGeometry = new THREE.RingGeometry(0.91, 1.04, 32),
      unitBodyMaterials = {
        pku: new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: unitBallTextures.pku,
          roughness: 0.24,
          metalness: 0.08,
          emissive: 0xc91f3a,
          emissiveIntensity: 0.035,
        }),
        thu: new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: unitBallTextures.thu,
          roughness: 0.24,
          metalness: 0.08,
          emissive: 0x74429d,
          emissiveIntensity: 0.035,
        }),
        ustc: new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: unitBallTextures.ustc,
          roughness: 0.24,
          metalness: 0.08,
          emissive: 0x174f78,
          emissiveIntensity: 0.035,
        }),
        zju: new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: unitBallTextures.zju,
          roughness: 0.24,
          metalness: 0.08,
          emissive: 0x175b9b,
          emissiveIntensity: 0.035,
        }),
      },
      unitLimbMaterial = new THREE.MeshStandardMaterial({
        color: 0x242824,
        roughness: 0.8,
      }),
      unitGlowMaterials = {
        pku: new THREE.MeshBasicMaterial({
          color: 0xc91f3a,
          transparent: true,
          opacity: 0.72,
          side: THREE.DoubleSide,
        }),
        thu: new THREE.MeshBasicMaterial({
          color: 0x74429d,
          transparent: true,
          opacity: 0.72,
          side: THREE.DoubleSide,
        }),
      },
      unitSelectionMaterial = new THREE.MeshBasicMaterial({
        color: 0xffdf63,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
      sharedUnitGeometries = new Set<THREE.BufferGeometry>([
        hpGeometry,
        unitBodyGeometry,
        unitLimbGeometry,
        unitHandGeometry,
        unitGlowGeometry,
        unitSelectionGeometry,
      ]),
      sharedUnitMaterials = new Set<THREE.Material>([
        hpBackMaterial,
        hpFillMaterials.pku,
        hpFillMaterials.thu,
        unitBodyMaterials.pku,
        unitBodyMaterials.thu,
        unitBodyMaterials.ustc,
        unitBodyMaterials.zju,
        unitLimbMaterial,
        unitGlowMaterials.pku,
        unitGlowMaterials.thu,
        unitSelectionMaterial,
      ]);
    const disposeUnitObject = (object: THREE.Object3D) => {
      const geometries = new Set<THREE.BufferGeometry>(),
        materials = new Set<THREE.Material>();
      object.traverse((child) => {
        const renderable = child as THREE.Mesh & {
          material?: THREE.Material | THREE.Material[];
          geometry?: THREE.BufferGeometry;
        };
        if (
          renderable.geometry &&
          !sharedUnitGeometries.has(renderable.geometry)
        )
          geometries.add(renderable.geometry);
        const childMaterials = Array.isArray(renderable.material)
          ? renderable.material
          : renderable.material
            ? [renderable.material]
            : [];
        childMaterials.forEach((material) => {
          if (!sharedUnitMaterials.has(material)) materials.add(material);
        });
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
    };
    const rebuildUnits = () => {
      unitGroup.children.slice().forEach((child) => {
        unitGroup.remove(child);
        disposeUnitObject(child);
      });
      unitObjects.clear();
      gameRef.current.units.forEach((u) => {
        const g = new THREE.Group(),
          region = regionForX(u.x);
        const body = new THREE.Mesh(
          unitBodyGeometry,
          u.skin ? unitBodyMaterials[u.skin] : unitBodyMaterials[u.team],
        );
        body.position.y = 0.98;
        body.castShadow = true;
        body.receiveShadow = true;
        g.add(body);
        const arms: THREE.Mesh[] = [],
          legs: THREE.Mesh[] = [];
        [-1, 1].forEach((s) => {
          const arm = new THREE.Mesh(unitLimbGeometry, unitLimbMaterial);
          arm.position.set(s * 0.54, 0.9, 0);
          arm.rotation.z = s * 0.95;
          g.add(arm);
          arms.push(arm);
          const leg = new THREE.Mesh(unitLimbGeometry, unitLimbMaterial);
          leg.position.set(s * 0.25, 0.35, 0);
          leg.rotation.z = s * 0.28;
          g.add(leg);
          legs.push(leg);
          const hand = new THREE.Mesh(unitHandGeometry, unitLimbMaterial);
          hand.position.set(s * 0.82, 0.71, 0);
          g.add(hand);
        });
        const glow = new THREE.Mesh(
          unitGlowGeometry,
          unitGlowMaterials[u.team],
        );
        glow.rotation.x = -Math.PI / 2;
        glow.position.y = 0.05;
        g.add(glow);
        const selectionRing = new THREE.Mesh(
          unitSelectionGeometry,
          unitSelectionMaterial,
        );
        selectionRing.rotation.x = -Math.PI / 2;
        selectionRing.position.y = 0.075;
        selectionRing.visible = selectedUnitIds.has(u.id);
        selectionRing.renderOrder = 45;
        g.add(selectionRing);
        const hpBack = new THREE.Mesh(hpGeometry, hpBackMaterial),
          hpFill = new THREE.Mesh(hpGeometry, hpFillMaterials[u.team]);
        hpBack.scale.set(0.78, 1, 1);
        hpBack.position.set(0, 1.72, 0.05);
        hpBack.renderOrder = 42;
        hpBack.visible = false;
        hpFill.scale.set(0.74, 0.62, 1);
        hpFill.position.set(0, 1.72, 0.06);
        hpFill.renderOrder = 43;
        hpFill.visible = false;
        g.add(hpBack, hpFill);
        g.position.set(u.x, terrainHeight(region, u.x, u.z), u.z);
        g.scale.setScalar(UNIT_RENDER_SCALE);
        g.userData = {
          unitId: u.id,
          arms,
          legs,
          body,
          glow,
          hpBack,
          hpFill,
          selectionRing,
          fightingUntil: 0,
        };
        unitGroup.add(g);
        unitObjects.set(u.id, g);
      });
    };
    const refreshUnitSelection = () => {
      unitObjects.forEach((object, id) => {
        const ring = object.userData.selectionRing as THREE.Mesh | undefined;
        if (ring) ring.visible = selectedUnitIds.has(id);
      });
      setSelectedUnitCount(
        gameRef.current.units
          .filter((unit) => selectedUnitIds.has(unit.id))
          .reduce((sum, unit) => sum + unit.strength, 0),
      );
    };
    const applyMaterials = (unitUrl: string | null, siteUrl: string | null) => {
      const unitRequest = ++unitMaterialRequest,
        siteRequest = ++siteMaterialRequest;
      if (unitUrl) {
        textureLoader.load(unitUrl, (texture) => {
          if (unitRequest !== unitMaterialRequest) {
            texture.dispose();
            return;
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
          customUnitTexture?.dispose();
          customUnitTexture = texture;
          unitBodyMaterials.pku.map = texture;
          unitBodyMaterials.thu.map = texture;
          unitBodyMaterials.pku.needsUpdate = true;
          unitBodyMaterials.thu.needsUpdate = true;
        });
      } else {
        customUnitTexture?.dispose();
        customUnitTexture = null;
        unitBodyMaterials.pku.map = unitBallTextures.pku;
        unitBodyMaterials.thu.map = unitBallTextures.thu;
        unitBodyMaterials.pku.needsUpdate = true;
        unitBodyMaterials.thu.needsUpdate = true;
      }
      if (siteUrl) {
        textureLoader.load(siteUrl, (texture) => {
          if (siteRequest !== siteMaterialRequest) {
            texture.dispose();
            return;
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          customSiteTexture?.dispose();
          customSiteTexture = texture;
          rebuildBuildings();
        });
      } else {
        customSiteTexture?.dispose();
        customSiteTexture = null;
        rebuildBuildings();
      }
    };
    rebuildBuildings();
    rebuildUnits();
    rebuildCommandLines();
    const treeGroup = new THREE.Group();
    scene.add(treeGroup);
    let seed = 91723;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const tg = new THREE.CylinderGeometry(0.07, 0.11, 0.86, 7),
      tm = new THREE.MeshStandardMaterial({ color: 0x61412f, roughness: 1 }),
      cg = new THREE.SphereGeometry(0.52, 10, 8),
      cms = [0x315d36, 0x467648, 0x5b8a4e].map(
        (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.92 }),
      );
    for (const [r, count] of [[regions.main, 340]] as [any, number][]) {
      for (let i = 0; i < count; i++) {
        const x = r.offsetX - r.width / 2 + rnd() * r.width,
          z = -r.depth / 2 + rnd() * r.depth;
        if (
          gameRef.current.sites.some(
            (s) => Math.hypot(s.x - x, s.z - z) < 3.2,
          ) ||
          r.roads.some((road: any) =>
            road.points.some(
              (p: number[]) => Math.hypot(p[0] - x, p[1] - z) < 0.5,
            ),
          )
        )
          continue;
        const g = new THREE.Group(),
          tr = new THREE.Mesh(tg, tm);
        tr.position.y = 0.43;
        tr.castShadow = true;
        g.add(tr);
        cms.forEach((m, j) => {
          const cr = new THREE.Mesh(cg, m);
          cr.scale.set(1.1 - j * 0.18, 0.65, 1.1 - j * 0.18);
          cr.position.y = 0.92 + j * 0.32;
          cr.castShadow = true;
          g.add(cr);
        });
        g.position.set(x, terrainHeight(r, x, z), z);
        treeGroup.add(g);
      }
    }
    const lampPositions: { x: number; z: number; r: any }[] = [],
      lampSeen = new Set<string>();
    for (const r of [regions.main]) {
      const cap = r === regions.main ? 650 : 90,
        pushLamp = (x: number, z: number) => {
          const key = `${Math.round(x * 2)}/${Math.round(z * 2)}`;
          if (
            lampSeen.has(key) ||
            lampPositions.filter((p) => p.r === r).length >= cap
          )
            return;
          lampSeen.add(key);
          lampPositions.push({ x, z, r });
        };
      for (const [x, z] of r.lamps ?? []) pushLamp(x, z);
      for (const road of r.roads) {
        if (
          ["footway", "path", "steps", "corridor", "track"].includes(road.kind)
        )
          continue;
        for (let k = 1; k < road.points.length; k++) {
          const [x1, z1] = road.points[k - 1],
            [x2, z2] = road.points[k],
            dx = x2 - x1,
            dz = z2 - z1,
            len = Math.hypot(dx, dz);
          if (len < 1.8) continue;
          const count = Math.floor(len / 3.1),
            nx = -dz / len,
            nz = dx / len;
          for (let n = 1; n <= count; n++) {
            const t = n / (count + 1),
              side = (n + k) % 2 ? 1 : -1;
            pushLamp(
              x1 + dx * t + nx * (road.width / 2 + 0.16) * side,
              z1 + dz * t + nz * (road.width / 2 + 0.16) * side,
            );
          }
        }
      }
    }
    const poleGeometry = new THREE.CylinderGeometry(0.025, 0.038, 0.82, 6),
      poleMaterial = new THREE.MeshStandardMaterial({
        color: 0x303735,
        roughness: 0.76,
      }),
      bulbGeometry = new THREE.SphereGeometry(0.065, 8, 6),
      lampBulbMaterial = new THREE.MeshStandardMaterial({
        color: 0xffe3a6,
        emissive: 0xffb23f,
        emissiveIntensity: 0.1,
        roughness: 0.25,
      }),
      poles = new THREE.InstancedMesh(
        poleGeometry,
        poleMaterial,
        lampPositions.length,
      ),
      bulbs = new THREE.InstancedMesh(
        bulbGeometry,
        lampBulbMaterial,
        lampPositions.length,
      ),
      lampDummy = new THREE.Object3D();
    lampPositions.forEach((p, i) => {
      const base = terrainHeight(p.r, p.x, p.z);
      lampDummy.position.set(p.x, base + 0.41, p.z);
      lampDummy.updateMatrix();
      poles.setMatrixAt(i, lampDummy.matrix);
      lampDummy.position.y = base + 0.86;
      lampDummy.updateMatrix();
      bulbs.setMatrixAt(i, lampDummy.matrix);
    });
    poles.instanceMatrix.needsUpdate = true;
    bulbs.instanceMatrix.needsUpdate = true;
    scene.add(poles, bulbs);
    const lights: THREE.PointLight[] = [];
    lampPositions
      .filter((_, i) => i % 41 === 0)
      .slice(0, 22)
      .forEach((p) => {
        const l = new THREE.PointLight(0xffc66f, 0, 5, 2);
        l.position.set(p.x, terrainHeight(p.r, p.x, p.z) + 0.9, p.z);
        scene.add(l);
        lights.push(l);
      });
    const ray = new THREE.Raycaster(),
      mouse = new THREE.Vector2(),
      projectedSiteNode = new THREE.Vector3(),
      projectedSiteEdge = new THREE.Vector3(),
      siteNodeWorld = new THREE.Vector3(),
      siteNodeCameraRight = new THREE.Vector3(),
      siteNodeWorldPosition = (site: SiteState, target = new THREE.Vector3()) =>
        target.set(
          site.x,
          terrainHeight(regionForX(site.x), site.x, site.z) + 1.75,
          site.z,
        );
    let down: {
        x: number;
        y: number;
        site?: number;
        sourceSite?: number;
        selection?: boolean;
      } | null = null,
      previewLine: THREE.Object3D | null = null,
      rightGesture: {
        x: number;
        y: number;
        moved: boolean;
      } | null = null;
    const setRay = (ev: MouseEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      mouse.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
      mouse.y = (-(ev.clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(mouse, camera);
    };
    const hitSiteNode = (ev: MouseEvent, radiusMultiplier = 1) => {
      const rect = renderer.domElement.getBoundingClientRect(),
        pointerX = ev.clientX - rect.left,
        pointerY = ev.clientY - rect.top,
        markerScale = THREE.MathUtils.clamp(
          camera.position.distanceTo(controls.target) / Math.hypot(24, 22),
          0.45,
          1.9,
        );
      camera.updateMatrixWorld();
      siteNodeCameraRight
        .setFromMatrixColumn(camera.matrixWorld, 0)
        .normalize();
      const screenHit = gameRef.current.sites
        .filter((site) => !site.destroyed)
        .map((site) => {
          siteNodeWorldPosition(site, siteNodeWorld);
          projectedSiteNode.copy(siteNodeWorld).project(camera);
          projectedSiteEdge
            .copy(siteNodeWorld)
            .addScaledVector(siteNodeCameraRight, (1.15 * markerScale) / 2)
            .project(camera);
          const centerX = ((projectedSiteNode.x + 1) * rect.width) / 2,
            centerY = ((1 - projectedSiteNode.y) * rect.height) / 2,
            edgeX = ((projectedSiteEdge.x + 1) * rect.width) / 2,
            edgeY = ((1 - projectedSiteEdge.y) * rect.height) / 2,
            radius = Math.hypot(edgeX - centerX, edgeY - centerY);
          return {
            id: site.id,
            visible: projectedSiteNode.z >= -1 && projectedSiteNode.z <= 1,
            distance: Math.hypot(pointerX - centerX, pointerY - centerY),
            radius,
          };
        })
        .filter(
          (candidate) =>
            candidate.visible &&
            candidate.distance <= candidate.radius * radiusMultiplier,
        )
        .sort((a, b) => a.distance - b.distance)[0];
      return screenHit?.id;
    };
    const hitSite = (ev: MouseEvent) => {
      const screenHit = hitSiteNode(ev);
      if (screenHit != null) return screenHit;
      setRay(ev);
      const hit = ray
        .intersectObjects(buildingGroup.children, true)
        .find((item) => item.object.userData.siteHitProxy);
      if (hit) return hit.object.userData.siteId as number;
      return undefined;
    };
    const groundAt = (ev: MouseEvent) => {
      setRay(ev);
      return ray.intersectObjects(terrainMeshes, false)[0]?.point ?? null;
    };
    const commandHoverPoint = new THREE.Vector3(),
      hideCommandLabels = () =>
        commandAnimations.forEach((animation) => {
          animation.label.visible = false;
        }),
      pointSegmentDistance = (
        px: number,
        py: number,
        ax: number,
        ay: number,
        bx: number,
        by: number,
      ) => {
        const dx = bx - ax,
          dy = by - ay,
          lengthSquared = dx * dx + dy * dy;
        if (!lengthSquared) return Math.hypot(px - ax, py - ay);
        const t = THREE.MathUtils.clamp(
          ((px - ax) * dx + (py - ay) * dy) / lengthSquared,
          0,
          1,
        );
        return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
      },
      updateCommandLabelHover = (ev: MouseEvent) => {
        const rect = renderer.domElement.getBoundingClientRect(),
          pointerX = ev.clientX - rect.left,
          pointerY = ev.clientY - rect.top;
        camera.updateMatrixWorld();
        let closest: (typeof commandAnimations)[number] | undefined,
          closestDistance = 11;
        commandAnimations.forEach((animation) => {
          animation.curve.getPoint(0, commandHoverPoint).project(camera);
          let previousX = ((commandHoverPoint.x + 1) * rect.width) / 2,
            previousY = ((1 - commandHoverPoint.y) * rect.height) / 2;
          for (let step = 1; step <= 32; step++) {
            animation.curve
              .getPoint(step / 32, commandHoverPoint)
              .project(camera);
            const currentX = ((commandHoverPoint.x + 1) * rect.width) / 2,
              currentY = ((1 - commandHoverPoint.y) * rect.height) / 2,
              distance = pointSegmentDistance(
                pointerX,
                pointerY,
                previousX,
                previousY,
                currentX,
                currentY,
              );
            if (distance < closestDistance) {
              closestDistance = distance;
              closest = animation;
            }
            previousX = currentX;
            previousY = currentY;
          }
        });
        commandAnimations.forEach((animation) => {
          animation.label.visible = animation === closest;
        });
      };
    const buildCampAt = (point: THREE.Vector3) => {
      const g = gameRef.current,
        index = navIndex(navGrid, point.x, point.z),
        activeCamps = g.sites.filter(
          (site) => site.type === "camp" && !site.destroyed,
        );
      if (g.resources.pku < 80)
        return (setNotice("建立营地需要80战略资源"), false);
      if (activeCamps.length >= 4)
        return (setNotice("主战场最多同时维持4座临时营地"), false);
      if (
        index < 0 ||
        navGrid.blocked[index] ||
        navGrid.component[index] !== navGrid.mainComponent
      )
        return (
          setNotice("这里被建筑、水体或封闭庭院占用，无法建立营地"),
          false
        );
      if (
        g.sites.some(
          (site) =>
            !site.destroyed &&
            Math.hypot(site.x - point.x, site.z - point.z) < 2.2,
        )
      )
        return (setNotice("营地距离现有据点过近"), false);
      const nearbyPku = g.units.filter(
          (unit) =>
            unit.team === "pku" &&
            Math.hypot(unit.x - point.x, unit.z - point.z) < 4.5,
        ).length,
        nearbyThu = g.units.some(
          (unit) =>
            unit.team === "thu" &&
            Math.hypot(unit.x - point.x, unit.z - point.z) < 5,
        );
      if (nearbyPku < 3 || nearbyThu)
        return (setNotice("需要附近至少3名北大学生且5格内没有清华部队"), false);
      const id = g.campaign.nextSiteId++,
        name = `临时营地 ${activeCamps.length + 1}`,
        camp: SiteState = {
          id,
          name,
          displayName: name,
          team: "pku",
          x: point.x,
          z: point.z,
          navX: point.x,
          navZ: point.z,
          type: "camp",
          stance: "guard",
          supply: 45,
          temporary: true,
          dispatchRatio: 0.65,
        };
      g.resources.pku -= 80;
      g.sites.push(camp);
      rebuildBuildings();
      setSelected(id);
      setRenameDraft(name);
      if (!g.campaign.firedEvents.includes("first_camp")) {
        g.campaign.firedEvents.push("first_camp");
        pushEvent({ id: "first_camp", ...EVENT_CARDS.first_camp });
      }
      setNotice("临时营地已建立；敌军攻克后会直接拆除");
      return true;
    };
    const selectedCentroid = () => {
      const units = gameRef.current.units.filter((unit) =>
        selectedUnitIds.has(unit.id),
      );
      if (!units.length) return null;
      const x = units.reduce((sum, unit) => sum + unit.x, 0) / units.length,
        z = units.reduce((sum, unit) => sum + unit.z, 0) / units.length;
      return new THREE.Vector3(x, terrainHeight(regionForX(x), x, z) + 1.35, z);
    };
    let hoveredSiteId: number | null = null;
    const setHoveredSite = (siteId: number | null) => {
      if (hoveredSiteId != null) {
        const previous = siteObjects.get(hoveredSiteId)?.userData
          .hoverHighlight as THREE.Object3D | undefined;
        if (previous) previous.visible = false;
      }
      hoveredSiteId = siteId;
      if (siteId != null) {
        const next = siteObjects.get(siteId)?.userData.hoverHighlight as
          THREE.Object3D | undefined;
        if (next) next.visible = true;
      }
    };
    renderer.domElement.addEventListener("pointerdown", (e) => {
      hideCommandLabels();
      setCampContext(null);
      if (e.button === 2) {
        rightGesture = {
          x: e.clientX,
          y: e.clientY,
          moved: false,
        };
        down = null;
        return;
      }
      const site = hitSite(e),
        sourceSite = hitSiteNode(e, 0.9),
        point = site == null ? groundAt(e) : null,
        selection =
          !!point &&
          [...selectedUnitIds].some((id) => {
            const unit = gameRef.current.units.find(
              (candidate) => candidate.id === id,
            );
            return !!unit && Math.hypot(unit.x - point.x, unit.z - point.z) < 3;
          });
      down = { x: e.clientX, y: e.clientY, site, sourceSite, selection };
      if (site == null) setSelected(null);
      if (sourceSite != null || selection) {
        controls.enabled = false;
        renderer.domElement.setPointerCapture(e.pointerId);
      }
    });
    renderer.domElement.addEventListener("pointermove", (e) => {
      if (rightGesture && (e.buttons & 2) !== 0) {
        if (
          Math.hypot(e.clientX - rightGesture.x, e.clientY - rightGesture.y) > 7
        )
          rightGesture.moved = true;
        return;
      }
      if (!down) {
        updateCommandLabelHover(e);
        return;
      }
      hideCommandLabels();
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8) return;
      const p = groundAt(e);
      if (!p) return;
      if (previewLine) {
        commandGroup.remove(previewLine);
        disposeCommandObject(previewLine);
      }
      if (down.selection) {
        const hovered = hitSite(e);
        setHoveredSite(hovered ?? null);
        const center = selectedCentroid();
        if (!center) return;
        const target = hovered != null ? gameRef.current.sites[hovered] : null;
        previewLine = addCommandLine(
          center,
          target ? siteNodeWorldPosition(target) : p.clone(),
          true,
        );
        return;
      }
      if (down.sourceSite == null) return;
      const s = gameRef.current.sites[down.sourceSite];
      if (!s) return;
      const hovered = hitSite(e);
      setHoveredSite(
        hovered != null && hovered !== down.sourceSite ? hovered : null,
      );
      previewLine = addCommandLine(
        siteNodeWorldPosition(s),
        hovered != null && hovered !== down.sourceSite
          ? siteNodeWorldPosition(gameRef.current.sites[hovered])
          : p.clone(),
        true,
      );
    });
    renderer.domElement.addEventListener("pointerup", (e) => {
      if (!down) return;
      controls.enabled = true;
      if (renderer.domElement.hasPointerCapture(e.pointerId))
        renderer.domElement.releasePointerCapture(e.pointerId);
      if (previewLine) {
        commandGroup.remove(previewLine);
        disposeCommandObject(previewLine);
        previewLine = null;
      }
      setHoveredSite(null);
      const end = hitSite(e),
        moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8;
      if (moved && down.selection) {
        const target = end != null ? gameRef.current.sites[end] : null,
          point = groundAt(e),
          center = selectedCentroid();
        if (
          target &&
          target.team !== "pku" &&
          !gameRef.current.campaign.warUnlocked
        ) {
          setNotice("8月19日前可自由调兵，但不能向清华据点发起进攻");
          down = null;
          return;
        }
        if (point && center) {
          const destinationX = target?.navX ?? point.x,
            destinationZ = target?.navZ ?? point.z,
            path = findPath(center.x, center.z, destinationX, destinationZ);
          if (path.length) {
            const destination = path.at(-1)!;
            const selectedUnits = gameRef.current.units.filter(
              (unit) => unit.team === "pku" && selectedUnitIds.has(unit.id),
            );
            selectedUnits.forEach((unit, index) => {
              unit.targetSiteId = target?.id;
              unit.path = path;
              unit.pathIndex = 0;
              unit.tx = destination[0] + ((index % 5) - 2) * 0.18;
              unit.tz = destination[1] + ((index % 4) - 1.5) * 0.18;
            });
            const people = selectedUnits.reduce(
              (sum, unit) => sum + unit.strength,
              0,
            );
            setNotice(
              target
                ? `已命令 ${people} 名零散北大学生${target.team === "pku" ? "支援" : "进攻"}${target.displayName ?? target.name}`
                : `已调动 ${people} 名北大学生`,
            );
          } else setNotice("目标位置无法到达，调兵命令未执行");
        }
        setSelected(null);
        down = null;
        return;
      }
      if (!moved && down.site != null) {
        setSelected(down.site);
        const site = gameRef.current.sites[down.site];
        setRenameDraft(site?.displayName ?? site?.name ?? "");
      }
      if (
        moved &&
        down.sourceSite != null &&
        end != null &&
        end !== down.sourceSite
      ) {
        const source = gameRef.current.sites[down.sourceSite],
          target = gameRef.current.sites[end];
        if (source.team === "pku") {
          if (target.team !== "pku" && !gameRef.current.campaign.warUnlocked) {
            setNotice("8月19日前尚未开放交战：可以自由调兵或增援友方据点");
            down = null;
            return;
          }
          const troops = issueOrder("pku", source, target);
          setNotice(
            troops
              ? `${source.displayName ?? source.name} → ${target.displayName ?? target.name}：${troops}名学生出发`
              : source.orderTarget === target.id
                ? `已建立 ${source.displayName ?? source.name} → ${target.displayName ?? target.name} 持续兵线；当前无可调动兵力，后续新兵会自动输送`
                : `未找到可行路径，兵线建立失败`,
          );
          setSelected(null);
        } else setNotice("只能从北大控制的据点发出命令");
      }
      down = null;
    });
    renderer.domElement.addEventListener("pointercancel", (e) => {
      controls.enabled = true;
      if (renderer.domElement.hasPointerCapture(e.pointerId))
        renderer.domElement.releasePointerCapture(e.pointerId);
      if (previewLine) {
        commandGroup.remove(previewLine);
        disposeCommandObject(previewLine);
        previewLine = null;
      }
      setHoveredSite(null);
      down = null;
    });
    renderer.domElement.addEventListener("pointerleave", hideCommandLabels);
    renderer.domElement.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (rightGesture?.moved) {
        rightGesture = null;
        return;
      }
      setRay(e);
      const hit = ray
          .intersectObjects(commandGroup.children, true)
          .find((item) => item.object.userData.commandSourceId != null),
        sourceId = hit?.object.userData.commandSourceId as number | undefined;
      if (sourceId != null) {
        const source = gameRef.current.sites[sourceId];
        rightGesture = null;
        if (!source) return;
        source.orderTarget = undefined;
        source.orderPath = undefined;
        gameRef.current.units
          .filter((unit) => unit.siteId === sourceId)
          .forEach((unit) => {
            unit.targetSiteId = undefined;
            unit.path = undefined;
            unit.pathIndex = undefined;
            unit.tx = unit.x;
            unit.tz = unit.z;
          });
        rebuildCommandLines();
        rebuildBuildings();
        setNotice(`已右键取消 ${source.displayName ?? source.name} 的持续兵线`);
        return;
      }
      const point = groundAt(e);
      rightGesture = null;
      if (!point) return;
      setSelected(null);
      setCampContext({
        x: e.clientX,
        y: e.clientY,
        worldX: point.x,
        worldZ: point.z,
      });
    });
    renderer.domElement.addEventListener("dblclick", (e) => {
      const point = groundAt(e);
      const nearby = point
        ? gameRef.current.units.filter(
            (unit) =>
              unit.team === "pku" &&
              Math.hypot(unit.x - point.x, unit.z - point.z) < 2.6,
          )
        : [];
      if (nearby.some((unit) => selectedUnitIds.has(unit.id))) {
        selectedUnitIds.clear();
      } else {
        selectedUnitIds.clear();
        nearby.forEach((unit) => selectedUnitIds.add(unit.id));
      }
      refreshUnitSelection();
      setSelected(null);
      const selectedPeople = gameRef.current.units
        .filter((unit) => selectedUnitIds.has(unit.id))
        .reduce((sum, unit) => sum + unit.strength, 0);
      setNotice(
        selectedPeople
          ? `已选中附近 ${selectedPeople} 名北大学生；再次双击可释放控制`
          : nearby.length
            ? "已释放对这批北大学生的控制"
            : "附近没有可选中的北大学生",
      );
    });
    const fireEvent = (id: keyof typeof EVENT_CARDS, apply?: () => void) => {
        const campaign = gameRef.current.campaign;
        if (campaign.firedEvents.includes(id)) return false;
        campaign.firedEvents.push(id);
        apply?.();
        pushEvent({ id, ...EVENT_CARDS[id] });
        return true;
      },
      nextUnitId = () =>
        gameRef.current.units.reduce(
          (max, unit) => Math.max(max, unit.id),
          -1,
        ) + 1,
      spawnUnitsAt = (
        site: SiteState,
        team: Team,
        count: number,
        attackModifier = 1,
        refresh = true,
        supply = 100,
        skin?: "ustc" | "zju",
      ) => {
        let id = nextUnitId();
        for (let i = 0; i < count; i++) {
          const angle = (i / Math.max(1, count)) * Math.PI * 2,
            radius = 0.48 + (i % 3) * 0.15,
            anchorX = site.navX ?? site.x,
            anchorZ = site.navZ ?? site.z;
          gameRef.current.units.push({
            id: id++,
            team,
            x: anchorX + Math.cos(angle) * radius,
            z: anchorZ + Math.sin(angle) * radius,
            tx: anchorX,
            tz: anchorZ,
            hp: 100,
            supply,
            strength: 5,
            skin,
            siteId: site.id,
            attackModifier,
          });
        }
        if (refresh) rebuildUnits();
      },
      setOutcome = (winner: Team, reason: string) => {
        const campaign = gameRef.current.campaign;
        if (campaign.outcome) return;
        campaign.outcome = {
          winner,
          reason,
          atHour: campaign.elapsedHours,
        };
        setVictoryBroadcast({
          winner,
          title:
            winner === "pku"
              ? "胜利广播：解放清华园"
              : "战役广播：燕园防线失守",
          body:
            winner === "pku"
              ? `求真书院已经被北大控制。${reason}，战役结果正式记为北大胜利；地图仍可继续游玩。`
              : `${reason}，战役结果正式记为清华胜利；地图仍可继续游玩。`,
        });
      };
    let combatPulse = 0;
    const combatTimer = window.setInterval(() => {
      const g = gameRef.current,
        now = performance.now(),
        used = new Set<number>(),
        dead = new Set<number>();
      let ordersChanged = false;
      combatPulse++;
      const cellSize = 1.5,
        grid = new Map<string, UnitState[]>(),
        cellKey = (x: number, z: number) =>
          `${Math.floor(x / cellSize)}/${Math.floor(z / cellSize)}`;
      g.units.forEach((unit) => {
        const key = cellKey(unit.x, unit.z),
          bucket = grid.get(key);
        if (bucket) bucket.push(unit);
        else grid.set(key, [unit]);
      });
      for (const unit of g.units) {
        if (!g.campaign.warUnlocked) break;
        if (used.has(unit.id) || unit.hp <= 0) continue;
        let enemy: UnitState | undefined,
          best = 1.35;
        const gx = Math.floor(unit.x / cellSize),
          gz = Math.floor(unit.z / cellSize),
          nearby: UnitState[] = [];
        for (let ox = -1; ox <= 1; ox++)
          for (let oz = -1; oz <= 1; oz++)
            nearby.push(...(grid.get(`${gx + ox}/${gz + oz}`) ?? []));
        for (const candidate of nearby) {
          if (
            candidate.team === unit.team ||
            candidate.hp <= 0 ||
            used.has(candidate.id)
          )
            continue;
          const distance = Math.hypot(
            candidate.x - unit.x,
            candidate.z - unit.z,
          );
          if (distance < best) {
            best = distance;
            enemy = candidate;
          }
        }
        if (!enemy) continue;
        used.add(unit.id);
        used.add(enemy.id);
        const unitMesh = unitObjects.get(unit.id),
          enemyMesh = unitObjects.get(enemy.id);
        if (unitMesh) unitMesh.userData.fightingUntil = now + 260;
        if (enemyMesh) enemyMesh.userData.fightingUntil = now + 260;
        const defenseStats = (fighter: UnitState) => {
            const home = g.sites[fighter.siteId];
            if (
              !home ||
              home.destroyed ||
              home.team !== fighter.team ||
              Math.hypot(
                fighter.x - (home.navX ?? home.x),
                fighter.z - (home.navZ ?? home.z),
              ) > 2.3
            )
              return { attack: 1, taken: 1 };
            if (home.type === "gate") return { attack: 1.55, taken: 0.62 };
            if (
              home.type === "teaching" ||
              home.type === "capital" ||
              home.type === "target"
            )
              return { attack: 1.25, taken: 0.82 };
            return { attack: 1, taken: 1 };
          },
          unitDefense = defenseStats(unit),
          enemyDefense = defenseStats(enemy),
          caution =
            (g.campaign.cautionUntil ?? 0) > g.campaign.elapsedHours ? 0.9 : 1,
          morningPenalty =
            (g.campaign.morningPenaltyUntil ?? 0) > g.campaign.elapsedHours
              ? 0.72
              : 1,
          unitPower =
            (unit.attackModifier ?? 1) *
            g.campaign.attackBonus[unit.team] *
            caution *
            morningPenalty *
            unitDefense.attack,
          enemyPower =
            (enemy.attackModifier ?? 1) *
            g.campaign.attackBonus[enemy.team] *
            caution *
            morningPenalty *
            enemyDefense.attack;
        unit.hp -=
          (1.25 + enemy.supply * 0.007) * enemyPower * unitDefense.taken;
        enemy.hp -=
          (1.25 + unit.supply * 0.007) * unitPower * enemyDefense.taken;
        unit.supply = Math.max(0, unit.supply - 0.07);
        enemy.supply = Math.max(0, enemy.supply - 0.07);
        if (unit.hp <= 0) dead.add(unit.id);
        if (enemy.hp <= 0) dead.add(enemy.id);
        if (combatPulse % 3 === 0 && combatEffects.length < 18)
          spawnCombatEffect((unit.x + enemy.x) / 2, (unit.z + enemy.z) / 2);
      }
      for (const unit of g.units) {
        if (used.has(unit.id)) continue;
        if (unit.targetSiteId != null) {
          const target = g.sites[unit.targetSiteId];
          if (!target) continue;
          const targetX = target.navX ?? target.x,
            targetZ = target.navZ ?? target.z,
            distance = Math.hypot(unit.x - targetX, unit.z - targetZ);
          if (target.team === unit.team && distance < 1.18) {
            unit.siteId = target.id;
            unit.targetSiteId = undefined;
            unit.path = undefined;
            unit.pathIndex = undefined;
            const angle = ((unit.id % 7) / 7) * Math.PI * 2;
            unit.tx = targetX + Math.cos(angle) * 0.92;
            unit.tz = targetZ + Math.sin(angle) * 0.92;
            ordersChanged = true;
          } else {
            if (!unit.path || (unit.pathIndex ?? 0) >= unit.path.length) {
              const nextPath = findPath(unit.x, unit.z, targetX, targetZ);
              if (!nextPath.length) {
                unit.path = undefined;
                unit.pathIndex = undefined;
                unit.tx = unit.x;
                unit.tz = unit.z;
                continue;
              }
              unit.path = nextPath;
              unit.pathIndex = 0;
            }
            unit.tx = targetX + ((unit.id % 5) - 2) * 0.24;
            unit.tz = targetZ + ((unit.id % 4) - 1.5) * 0.24;
          }
          continue;
        }
        let home = g.sites[unit.siteId];
        if (!home || home.destroyed) {
          home = g.sites
            .filter((site) => site.team === unit.team && !site.destroyed)
            .sort(
              (a, b) =>
                Math.hypot(a.x - unit.x, a.z - unit.z) -
                Math.hypot(b.x - unit.x, b.z - unit.z),
            )[0];
          if (!home) continue;
          unit.siteId = home.id;
          unit.path = findPath(
            unit.x,
            unit.z,
            home.navX ?? home.x,
            home.navZ ?? home.z,
          );
          if (!unit.path.length) {
            unit.path = undefined;
            unit.pathIndex = undefined;
            unit.tx = unit.x;
            unit.tz = unit.z;
            continue;
          }
          unit.pathIndex = 0;
        }
        const angle = ((unit.id % 7) / 7) * Math.PI * 2;
        unit.tx = (home.navX ?? home.x) + Math.cos(angle) * 0.92;
        unit.tz = (home.navZ ?? home.z) + Math.sin(angle) * 0.92;
      }
      if (ordersChanged) {
        rebuildCommandLines();
      }
      if (dead.size) {
        for (const unit of g.units) {
          if (!dead.has(unit.id)) continue;
          g.deaths[unit.team] += unit.strength;
          const mesh = unitObjects.get(unit.id);
          if (mesh) {
            unitGroup.remove(mesh);
            disposeUnitObject(mesh);
          }
          unitObjects.delete(unit.id);
          selectedUnitIds.delete(unit.id);
        }
        g.units = g.units.filter((unit) => !dead.has(unit.id));
        refreshUnitSelection();
        rebuildCommandLines();
      }
      for (const site of g.sites) {
        if (!g.campaign.warUnlocked) break;
        if (site.destroyed) continue;
        const siteX = site.navX ?? site.x,
          siteZ = site.navZ ?? site.z;
        const attackers = g.units.filter(
          (unit) =>
            unit.targetSiteId === site.id &&
            unit.team !== site.team &&
            Math.hypot(unit.x - siteX, unit.z - siteZ) < 1.55,
        );
        if (!attackers.length) continue;
        const defenders = g.units.filter(
          (unit) =>
            unit.team === site.team &&
            Math.hypot(unit.x - siteX, unit.z - siteZ) < 1.85,
        );
        if (defenders.length) continue;
        const newTeam = attackers[0].team,
          oldTeam = site.team;
        if (site.type === "camp") {
          site.destroyed = true;
          site.orderTarget = undefined;
          site.orderPath = undefined;
          g.sites.forEach((source) => {
            if (source.orderTarget === site.id) {
              source.orderTarget = undefined;
              source.orderPath = undefined;
            }
          });
          g.units.forEach((unit) => {
            if (unit.targetSiteId !== site.id && unit.siteId !== site.id)
              return;
            unit.targetSiteId = undefined;
            unit.path = undefined;
            unit.pathIndex = undefined;
            const fallback = g.sites
              .filter(
                (candidate) =>
                  candidate.team === unit.team &&
                  !candidate.destroyed &&
                  candidate.id !== site.id,
              )
              .sort(
                (a, b) =>
                  Math.hypot(a.x - unit.x, a.z - unit.z) -
                  Math.hypot(b.x - unit.x, b.z - unit.z),
              )[0];
            if (fallback) {
              unit.siteId = fallback.id;
              unit.path = findPath(
                unit.x,
                unit.z,
                fallback.navX ?? fallback.x,
                fallback.navZ ?? fallback.z,
              );
              if (unit.path.length) {
                unit.pathIndex = 0;
                unit.tx = fallback.navX ?? fallback.x;
                unit.tz = fallback.navZ ?? fallback.z;
              } else {
                unit.path = undefined;
                unit.pathIndex = undefined;
                unit.tx = unit.x;
                unit.tz = unit.z;
              }
            } else {
              unit.tx = unit.x;
              unit.tz = unit.z;
            }
          });
          rebuildBuildings();
          rebuildCommandLines();
          setSelected(null);
          setNotice(`${site.displayName ?? site.name}已被攻克并拆除`);
          continue;
        }
        site.team = newTeam;
        site.supply = 45;
        site.stance = "standby";
        site.dispatchRatio = 1;
        const baseName = site.name.replace(
          /^北大清华园校区·|^清华燕园校区·/,
          "",
        );
        site.displayName =
          newTeam === "pku"
            ? `北大清华园校区·${baseName}`
            : `清华燕园校区·${baseName}`;
        attackers.forEach((unit, index) => {
          unit.siteId = site.id;
          unit.targetSiteId = undefined;
          unit.path = undefined;
          unit.pathIndex = undefined;
          const angle = (index / attackers.length) * Math.PI * 2;
          unit.tx = siteX + Math.cos(angle) * 0.9;
          unit.tz = siteZ + Math.sin(angle) * 0.9;
        });
        site.orderTarget = undefined;
        site.orderPath = undefined;
        if (site.type === "target" && newTeam === "pku") {
          setOutcome("pku", "攻克求真书院");
          fireEvent("qz_captured", () => {
            g.units
              .filter(
                (unit) =>
                  unit.team === "pku" &&
                  Math.hypot(unit.x - site.x, unit.z - site.z) < 6,
              )
              .forEach((unit) => {
                unit.team = "thu";
                unit.siteId = site.id;
                unit.targetSiteId = undefined;
                unit.path = undefined;
                unit.pathIndex = undefined;
              });
            rebuildUnits();
          });
        }
        if (site.type === "capital" && oldTeam === "pku" && newTeam === "thu") {
          setOutcome("thu", "元培学院失守");
          fireEvent("yuanpei_fallen");
        }
        rebuildBuildings();
        rebuildCommandLines();
        setNotice(
          site.type === "target" && newTeam === "pku"
            ? `胜利：北京大学已攻克求真书院（战局仍可继续）`
            : `${site.displayName ?? site.name}已被${newTeam === "pku" ? "北大" : g.campaign.thuFactionName}控制`,
        );
      }
    }, 120);
    const campaignTimer = window.setInterval(() => {
      const g = gameRef.current,
        campaign = g.campaign,
        qz = g.sites.find(
          (site) => site.name === "求真书院" && !site.destroyed,
        ),
        yuanpei = g.sites.find(
          (site) => site.name === "元培学院（俄文楼）" && !site.destroyed,
        ),
        mathSchool = g.sites.find(
          (site) =>
            site.name === "北京大学数学科学学院（理科一号楼）" &&
            !site.destroyed,
        );
      if (campaign.elapsedHours >= 0) fireEvent("thu_arrival");
      const morningDay = Math.floor(campaign.elapsedHours / 24);
      if (morningDay > campaign.lastMorningEventDay) {
        campaign.lastMorningEventDay = morningDay;
        campaign.morningPenaltyUntil = campaign.elapsedHours + 1;
        const id = `morning_class_${morningDay}`;
        if (!campaign.firedEvents.includes(id)) {
          campaign.firedEvents.push(id);
          pushEvent({
            id,
            ...EVENT_CARDS.morning_class,
            date: `战役第${morningDay + 1}日 · 08:00`,
          });
        }
      }
      if (campaign.elapsedHours >= 24)
        fireEvent("night_mobilization", () => {
          g.resources.pku += 20;
          g.resources.thu += 20;
        });
      if (campaign.elapsedHours >= 48)
        fireEvent("pku_arrival", () => {
          const difference = Math.max(
              0,
              g.units.filter((unit) => unit.team === "thu").length -
                g.units.filter((unit) => unit.team === "pku").length,
            ),
            dorms = g.sites.filter(
              (site) =>
                site.team === "pku" && site.type === "dorm" && !site.destroyed,
            );
          for (let i = 0; i < difference; i++)
            spawnUnitsAt(dorms[i % dorms.length], "pku", 1, 1, false);
          if (difference) rebuildUnits();
        });
      if (campaign.elapsedHours >= 72)
        fireEvent("war_begins", () => {
          campaign.warUnlocked = true;
        });
      if (
        campaign.warUnlocked &&
        qz &&
        g.units.some(
          (unit) =>
            unit.team === "pku" &&
            (unit.targetSiteId === qz.id ||
              Math.hypot(unit.x - qz.x, unit.z - qz.z) < 8),
        )
      )
        fireEvent("qz_approach", () => {
          spawnUnitsAt(qz, "thu", 10, 1.15);
          campaign.freezeUntil.pku = campaign.elapsedHours + 24;
          const emergencySources = g.sites
            .filter(
              (site) =>
                site.team === "thu" &&
                site.id !== qz.id &&
                !site.destroyed &&
                Math.hypot(site.x - qz.x, site.z - qz.z) < 20,
            )
            .sort(
              (a, b) =>
                Math.hypot(a.x - qz.x, a.z - qz.z) -
                Math.hypot(b.x - qz.x, b.z - qz.z),
            )
            .slice(0, 6);
          emergencySources.forEach((source) =>
            spawnUnitsAt(source, "thu", 2, 1.05, false),
          );
          rebuildUnits();
          emergencySources.forEach((source) => {
            source.stance = "guard";
            source.dispatchRatio = 0.9;
            issueOrder("thu", source, qz, 6, true);
          });
        });
      const pkuSites = g.sites.filter(
          (site) => site.team === "pku" && !site.destroyed,
        ).length,
        thuSites = g.sites.filter(
          (site) => site.team === "thu" && !site.destroyed,
        ).length;
      if (campaign.warUnlocked && pkuSites > thuSites + 3)
        fireEvent("pku_advantage", () => {
          g.units
            .filter(
              (unit) =>
                unit.team === "pku" &&
                qz &&
                Math.hypot(unit.x - qz.x, unit.z - qz.z) < 18,
            )
            .forEach(
              (unit) =>
                (unit.attackModifier = (unit.attackModifier ?? 1) * 0.9),
            );
        });
      if (
        campaign.warUnlocked &&
        yuanpei &&
        g.units.some(
          (unit) => unit.team === "thu" && unit.targetSiteId === yuanpei.id,
        )
      )
        fireEvent("yuanpei_attack", () => {
          spawnUnitsAt(yuanpei, "pku", 10, 1.25);
          g.units
            .filter(
              (unit) =>
                unit.team === "pku" &&
                Math.hypot(unit.x - yuanpei.x, unit.z - yuanpei.z) < 10,
            )
            .forEach((unit) => {
              unit.attackModifier = Math.max(1.25, unit.attackModifier ?? 1);
              if (unit.targetSiteId == null) {
                unit.targetSiteId = yuanpei.id;
                unit.path = findPath(unit.x, unit.z, yuanpei.x, yuanpei.z);
                unit.pathIndex = 0;
              }
            });
        });
      if (
        campaign.warUnlocked &&
        mathSchool &&
        g.units.some(
          (unit) => unit.team === "thu" && unit.targetSiteId === mathSchool.id,
        )
      )
        fireEvent("double_fei", () => {
          if (!qz) return;
          g.units
            .filter(
              (unit) =>
                unit.team === "thu" &&
                Math.hypot(unit.x - qz.x, unit.z - qz.z) < 14,
            )
            .forEach((unit) => {
              unit.attackModifier = (unit.attackModifier ?? 1) * 0.5;
              unit.moveModifier = (unit.moveModifier ?? 1) * 0.5;
            });
        });
      if (
        campaign.warUnlocked &&
        g.units.some(
          (unit) =>
            unit.team === "thu" &&
            Math.hypot(unit.x + 29.413, unit.z - 18.145) < 6,
        )
      )
        fireEvent("lake_awakened", () => {
          campaign.attackBonus.pku *= 1.15;
        });
      if (g.deaths.pku + g.deaths.thu > 0)
        fireEvent("first_blood", () => {
          campaign.cautionUntil = campaign.elapsedHours + 12;
        });
      if (g.deaths.thu >= 180 || thuSites <= 60)
        fireEvent("thu_ustc", () => {
          campaign.thuFactionName = "中科大";
          g.units
            .filter((unit) => unit.team === "thu")
            .forEach((unit) => (unit.skin = "ustc"));
          g.sites
            .filter((site) => site.team === "thu" && !site.destroyed)
            .forEach(
              (site) => (site.displayName = `中科大清华园校区·${site.name}`),
            );
          rebuildUnits();
          rebuildBuildings();
        });
      if (campaign.elapsedHours >= 120)
        fireEvent("zju_invasion", () => {
          const pkuPeople = g.units
              .filter((unit) => unit.team === "pku")
              .reduce((sum, unit) => sum + unit.strength, 0),
            thuPeople = g.units
              .filter((unit) => unit.team === "thu")
              .reduce((sum, unit) => sum + unit.strength, 0),
            ally: Team = pkuPeople <= thuPeople ? "pku" : "thu",
            enemy: Team = ally === "pku" ? "thu" : "pku",
            border = g.sites
              .filter((site) => site.team === ally && !site.destroyed)
              .sort((a, b) => b.x - a.x)[0];
          if (!border) return;
          const target = g.sites
            .filter((site) => site.team === enemy && !site.destroyed)
            .sort(
              (a, b) =>
                Math.hypot(a.x - border.x, a.z - border.z) -
                Math.hypot(b.x - border.x, b.z - border.z),
            )[0];
          border.displayName = `浙大先遣驻地·${border.name}`;
          spawnUnitsAt(border, ally, 14, 1.12, false, 135, "zju");
          rebuildUnits();
          if (target) {
            const previousStance = border.stance;
            border.stance = "standby";
            issueOrder(ally, border, target, 14);
            border.stance = previousStance;
          }
          rebuildBuildings();
        });
      if (campaign.warUnlocked && qz && thuSites < 48)
        fireEvent("thu_alarm", () => {
          qz.supply = 100;
          spawnUnitsAt(qz, "thu", 8, 1.1);
        });
      const productionCycle = Math.floor(campaign.elapsedHours / 6);
      if (productionCycle > campaign.lastProductionCycle) {
        campaign.lastProductionCycle = productionCycle;
        let produced = false;
        for (const team of ["pku", "thu"] as Team[]) {
          const dorms = g.sites.filter(
            (site) =>
              site.team === team && site.type === "dorm" && !site.destroyed,
          );
          for (let i = 0; i < 5 && dorms.length; i++) {
            const site = dorms[(productionCycle + i * 3) % dorms.length];
            spawnUnitsAt(site, team, 1, 1, false);
            produced = true;
          }
          g.resources[team] += 6;
        }
        if (produced) rebuildUnits();
        g.sites.forEach((source) => {
          if (source.destroyed || source.orderTarget == null) return;
          const target = g.sites[source.orderTarget];
          if (!target || target.destroyed) return;
          const idle = g.units.filter(
            (unit) => unit.siteId === source.id && unit.targetSiteId == null,
          ).length;
          issueOrder(
            source.team,
            source,
            target,
            Math.ceil(idle * (source.dispatchRatio ?? 0.6)),
          );
        });
      }
      const diningCycle = Math.floor(campaign.elapsedHours / 12);
      if (diningCycle > campaign.lastDiningCycle) {
        campaign.lastDiningCycle = diningCycle;
        const producingDining: SiteState[] = [];
        for (const team of ["pku", "thu"] as Team[]) {
          const diningSites = g.sites.filter(
            (site) =>
              site.team === team && site.type === "dining" && !site.destroyed,
          );
          for (let i = 0; i < 2 && diningSites.length; i++) {
            const site =
              diningSites[(diningCycle + i * 2) % diningSites.length];
            spawnUnitsAt(site, team, 1, 1, false, 145);
            producingDining.push(site);
          }
        }
        if (producingDining.length) rebuildUnits();
        producingDining.forEach((source) => {
          if (source.orderTarget == null) return;
          const target = g.sites[source.orderTarget];
          if (!target || target.destroyed) return;
          issueOrder(source.team, source, target, 1);
        });
      }
      g.sites
        .filter(
          (site) =>
            site.type === "camp" && !site.destroyed && site.team === "pku",
        )
        .forEach((camp) => {
          g.units
            .filter(
              (unit) =>
                unit.team === "pku" &&
                Math.hypot(unit.x - camp.x, unit.z - camp.z) < 2.3,
            )
            .forEach(
              (unit) => (unit.supply = Math.min(100, unit.supply + 1.2)),
            );
        });
      if (campaign.outcome) {
        const pkuAlive = g.sites.some(
            (site) => site.team === "pku" && !site.destroyed,
          ),
          thuAlive = g.sites.some(
            (site) => site.team === "thu" && !site.destroyed,
          );
        if (!pkuAlive || !thuAlive)
          campaign.outcome = {
            winner: pkuAlive ? "pku" : "thu",
            reason: "完全消灭对方势力",
            atHour: campaign.elapsedHours,
          };
      }
    }, 1000);
    const aiTimer = window.setInterval(() => {
      const g = gameRef.current;
      if (!g.campaign.warUnlocked) return;
      const qz = g.sites.find(
          (site) => site.name === "求真书院" && !site.destroyed,
        ),
        activeThuRoutes = g.sites.filter(
          (site) =>
            site.team === "thu" &&
            site.orderTarget != null &&
            g.sites[site.orderTarget]?.team === "pku" &&
            !site.destroyed,
        ).length;
      if (qz) {
        const threat = g.units.filter(
          (unit) =>
            unit.team === "pku" &&
            (unit.targetSiteId === qz.id ||
              Math.hypot(unit.x - qz.x, unit.z - qz.z) < 10),
        ).length;
        if (threat > 0) {
          g.sites
            .filter(
              (site) =>
                site.team === "thu" &&
                site.id !== qz.id &&
                !site.destroyed &&
                Math.hypot(site.x - qz.x, site.z - qz.z) < 14,
            )
            .sort(
              (a, b) =>
                Math.hypot(a.x - qz.x, a.z - qz.z) -
                Math.hypot(b.x - qz.x, b.z - qz.z),
            )
            .slice(0, 3)
            .forEach((source) =>
              issueOrder("thu", source, qz, Math.ceil(threat / 2) + 2, true),
            );
          return;
        }
      }
      const pkuSites = g.sites.filter(
          (site) => site.team === "pku" && !site.destroyed,
        ),
        thuSites = g.sites.filter(
          (site) => site.team === "thu" && !site.destroyed,
        ),
        idleAt = (site: SiteState) =>
          g.units.filter(
            (unit) =>
              unit.team === "thu" &&
              unit.siteId === site.id &&
              unit.targetSiteId == null &&
              Math.hypot(
                unit.x - (site.navX ?? site.x),
                unit.z - (site.navZ ?? site.z),
              ) < 3.2,
          ).length,
        threatAt = (site: SiteState) =>
          g.units.filter(
            (unit) =>
              unit.team === "pku" &&
              (unit.targetSiteId === site.id ||
                Math.hypot(unit.x - site.x, unit.z - site.z) < 7),
          ).length,
        frontier = thuSites
          .slice()
          .sort((a, b) => {
            const da = Math.min(
                ...pkuSites.map((site) =>
                  Math.hypot(site.x - a.x, site.z - a.z),
                ),
              ),
              db = Math.min(
                ...pkuSites.map((site) =>
                  Math.hypot(site.x - b.x, site.z - b.z),
                ),
              );
            return threatAt(b) * 8 - threatAt(a) * 8 + da - db;
          })
          .slice(0, 6),
        rearSources = thuSites
          .filter(
            (site) =>
              (site.type === "dorm" || site.type === "dining") &&
              site.orderTarget == null &&
              idleAt(site) >= 2,
          )
          .sort((a, b) => idleAt(b) - idleAt(a));
      for (
        let i = 0;
        i < Math.min(2, rearSources.length, frontier.length);
        i++
      ) {
        const source = rearSources[i],
          target = frontier[i % frontier.length];
        if (source.id !== target.id)
          issueOrder(
            "thu",
            source,
            target,
            Math.max(1, idleAt(source) - 1),
            true,
          );
      }
      if (activeThuRoutes >= 6) return;
      const attackSources = thuSites
        .filter(
          (site) =>
            site.orderTarget == null &&
            idleAt(site) >= 2 &&
            (!qz || Math.hypot(site.x - qz.x, site.z - qz.z) > 4),
        )
        .sort((a, b) => idleAt(b) - idleAt(a));
      let routesCreated = 0;
      for (const source of attackSources) {
        if (activeThuRoutes + routesCreated >= 6 || routesCreated >= 2) break;
        const target = pkuSites.slice().sort((a, b) => {
          const valueA =
              (a.type === "capital" ? -18 : 0) +
              Math.hypot(a.x - source.x, a.z - source.z),
            valueB =
              (b.type === "capital" ? -18 : 0) +
              Math.hypot(b.x - source.x, b.z - source.z);
          return valueA - valueB;
        })[0];
        if (
          target &&
          issueOrder(
            "thu",
            source,
            target,
            Math.max(1, idleAt(source) - 1),
            true,
          )
        )
          routesCreated++;
      }
    }, 2200);
    let raf = 0,
      last = performance.now(),
      statAt = 0;
    const directCenter = new THREE.Vector3(),
      directCameraGoal = new THREE.Vector3();
    const animate = (now: number) => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const g = gameRef.current;
      if (directControlActive) {
        const controlled = g.units.filter(
          (unit) => unit.team === "pku" && selectedUnitIds.has(unit.id),
        );
        if (!controlled.length) exitDirectControl();
        else {
          const moveX =
              (directKeys.has("d") ? 1 : 0) - (directKeys.has("a") ? 1 : 0),
            moveZ =
              (directKeys.has("s") ? 1 : 0) - (directKeys.has("w") ? 1 : 0),
            moveLength = Math.hypot(moveX, moveZ);
          controlled.forEach((unit) => {
            unit.path = undefined;
            unit.pathIndex = undefined;
            unit.targetSiteId = undefined;
            if (moveLength) {
              unit.tx = unit.x + (moveX / moveLength) * 1.2;
              unit.tz = unit.z + (moveZ / moveLength) * 1.2;
            } else {
              unit.tx = unit.x;
              unit.tz = unit.z;
            }
          });
          const centerX =
              controlled.reduce((sum, unit) => sum + unit.x, 0) /
              controlled.length,
            centerZ =
              controlled.reduce((sum, unit) => sum + unit.z, 0) /
              controlled.length,
            centerY = terrainHeight(regionForX(centerX), centerX, centerZ);
          directCenter.set(centerX, centerY + 0.15, centerZ);
          directCameraGoal.set(centerX, centerY + 5.4, centerZ + 4.4);
          camera.position.lerp(directCameraGoal, 0.16);
          controls.target.copy(directCenter);
          camera.lookAt(directCenter);
          const minimap = minimapRef.current;
          if (minimap) {
            const context = minimap.getContext("2d")!,
              region = regions.main,
              mapX = (x: number) =>
                ((x - (region.offsetX - region.width / 2)) / region.width) *
                minimap.width,
              mapY = (z: number) =>
                ((region.depth / 2 - z) / region.depth) * minimap.height;
            context.clearRect(0, 0, minimap.width, minimap.height);
            context.fillStyle = "rgba(6,14,18,.92)";
            context.fillRect(0, 0, minimap.width, minimap.height);
            context.strokeStyle = "rgba(255,255,255,.12)";
            context.strokeRect(0.5, 0.5, minimap.width - 1, minimap.height - 1);
            g.sites
              .filter((site) => !site.destroyed)
              .forEach((site) => {
                context.fillStyle = site.team === "pku" ? "#e52c49" : "#9855bd";
                context.beginPath();
                context.arc(mapX(site.x), mapY(site.z), 1.6, 0, Math.PI * 2);
                context.fill();
              });
            context.fillStyle = "#72edff";
            controlled.forEach((unit) => {
              context.beginPath();
              context.arc(mapX(unit.x), mapY(unit.z), 2.5, 0, Math.PI * 2);
              context.fill();
            });
            context.strokeStyle = "#fff2a6";
            context.lineWidth = 2;
            context.beginPath();
            context.arc(mapX(centerX), mapY(centerZ), 7, 0, Math.PI * 2);
            context.stroke();
          }
        }
      }
      g.campaign.elapsedHours += dt * 0.18 * timeScaleRef.current;
      if (autoDayRef.current) {
        g.timeOfDay = (8 + g.campaign.elapsedHours) % 24;
      }
      const angle = ((g.timeOfDay - 6) / 24) * Math.PI * 2,
        day = THREE.MathUtils.smoothstep(Math.sin(angle), -0.12, 0.35),
        night = 1 - day;
      sun.position.set(
        Math.cos(angle) * 55,
        Math.max(-4, Math.sin(angle) * 55),
        25,
      );
      sun.intensity = day * 3.4;
      moon.position.set(-sun.position.x, Math.max(10, -sun.position.y), -25);
      moon.intensity = night * 0.6;
      hemi.intensity = 0.18 + day * 1.72;
      hemi.color.set(day > 0.35 ? 0xcfe8ff : 0x29436e);
      hemi.groundColor.set(day > 0.35 ? 0x324226 : 0x101721);
      const sky = new THREE.Color(0x07101f).lerp(
        new THREE.Color(0x9fc5d8),
        day,
      );
      scene.background = sky;
      (scene.fog as THREE.FogExp2).color.copy(sky);
      windowMaterials.forEach((m) => (m.emissiveIntensity = night * 3.2));
      lampBulbMaterial.emissiveIntensity = 0.08 + night * 4.8;
      unitBodyMaterials.pku.emissiveIntensity = 0.035 + night * 0.24;
      unitBodyMaterials.thu.emissiveIntensity = 0.035 + night * 0.24;
      unitBodyMaterials.ustc.emissiveIntensity = 0.035 + night * 0.24;
      unitBodyMaterials.zju.emissiveIntensity = 0.035 + night * 0.24;
      lights.forEach((l) => (l.intensity = night * 5.5));
      renderer.toneMappingExposure = 0.72 + day * 0.38;
      commandAnimations.forEach((animation) => {
        animation.movers.forEach((mover, index) => {
          const t = (now * 0.00016 + animation.phase + index / 5) % 1;
          animation.curve.getPoint(t, mover.position);
          animation.curve.getTangent(t, commandTangent).normalize();
          (mover.material as THREE.SpriteMaterial).rotation =
            Math.atan2(commandTangent.x, commandTangent.z) + Math.PI;
        });
      });
      for (let i = combatEffects.length - 1; i >= 0; i--) {
        const effect = combatEffects[i],
          progress = (now - effect.born) / 720;
        if (progress >= 1) {
          combatGroup.remove(effect.sprite);
          effect.sprite.material.dispose();
          combatEffects.splice(i, 1);
          continue;
        }
        effect.sprite.position.y += dt * 0.45;
        effect.sprite.scale.setScalar(1 + progress * 1.3);
        (effect.sprite.material as THREE.SpriteMaterial).opacity = 1 - progress;
      }
      const separationCell = 0.24,
        separationGrid = new Map<string, UnitState[]>(),
        separationKey = (x: number, z: number) =>
          `${Math.floor(x / separationCell)}/${Math.floor(z / separationCell)}`;
      g.units.forEach((unit) => {
        const key = separationKey(unit.x, unit.z),
          bucket = separationGrid.get(key);
        if (bucket) bucket.push(unit);
        else separationGrid.set(key, [unit]);
      });
      g.units.forEach((u) => {
        const mesh = unitObjects.get(u.id);
        if (!mesh) return;
        const pathPoint =
            u.path && (u.pathIndex ?? 0) < u.path.length
              ? u.path[u.pathIndex ?? 0]
              : null,
          destinationX = pathPoint?.[0] ?? u.tx,
          destinationZ = pathPoint?.[1] ?? u.tz,
          dx = destinationX - u.x,
          dz = destinationZ - u.z,
          dist = Math.hypot(dx, dz),
          fighting = mesh.userData.fightingUntil > now,
          phase = now * 0.014 + u.id;
        (mesh.userData.arms as THREE.Mesh[]).forEach(
          (arm, index) =>
            (arm.rotation.x =
              (fighting ? 0.95 : dist > 0.18 ? 0.42 : 0) *
              Math.sin(phase + index * Math.PI)),
        );
        (mesh.userData.legs as THREE.Mesh[]).forEach(
          (leg, index) =>
            (leg.rotation.x =
              (fighting ? 0.38 : dist > 0.18 ? 0.5 : 0) *
              Math.sin(phase + index * Math.PI)),
        );
        mesh.userData.body.position.y =
          0.98 + (fighting ? Math.abs(Math.sin(phase * 1.7)) * 0.18 : 0);
        mesh.userData.glow.scale.setScalar(
          fighting ? 1 + Math.sin(phase * 2) * 0.16 : 1,
        );
        const hpRatio = THREE.MathUtils.clamp(u.hp / 100, 0, 1),
          hpBack = mesh.userData.hpBack as THREE.Mesh,
          hpFill = mesh.userData.hpFill as THREE.Mesh;
        hpBack.visible = fighting;
        hpFill.visible = fighting;
        hpFill.scale.x = 0.74 * hpRatio;
        hpFill.position.x = -0.37 * (1 - hpRatio);
        if (fighting) return;
        if (pathPoint && dist < 0.24) {
          u.pathIndex = (u.pathIndex ?? 0) + 1;
          return;
        }
        if (dist > 0.18) {
          if (g.campaign.freezeUntil[u.team] > g.campaign.elapsedHours) return;
          const gridIndex = navIndex(navGrid, u.x, u.z),
            roadSpeed = gridIndex >= 0 && navGrid.road[gridIndex] ? 0.78 : 0.5,
            morningMove =
              (g.campaign.morningPenaltyUntil ?? 0) > g.campaign.elapsedHours
                ? 0.68
                : 1,
            s = roadSpeed * (u.moveModifier ?? 1) * morningMove * dt;
          const forwardX = dx / dist,
            forwardZ = dz / dist,
            gx = Math.floor(u.x / separationCell),
            gz = Math.floor(u.z / separationCell);
          let separateX = 0,
            separateZ = 0;
          for (let ox = -1; ox <= 1; ox++)
            for (let oz = -1; oz <= 1; oz++)
              for (const neighbor of separationGrid.get(
                `${gx + ox}/${gz + oz}`,
              ) ?? []) {
                if (neighbor.id === u.id) continue;
                const awayX = u.x - neighbor.x,
                  awayZ = u.z - neighbor.z,
                  distance = Math.hypot(awayX, awayZ);
                if (distance <= 0.001 || distance >= UNIT_SEPARATION_DISTANCE)
                  continue;
                const pressure =
                  (UNIT_SEPARATION_DISTANCE - distance) /
                  UNIT_SEPARATION_DISTANCE;
                separateX += (awayX / distance) * pressure;
                separateZ += (awayZ / distance) * pressure;
              }
          let moveX = forwardX + separateX * 0.58,
            moveZ = forwardZ + separateZ * 0.58,
            moveLength = Math.hypot(moveX, moveZ);
          if (
            moveLength < 0.001 ||
            (moveX * forwardX + moveZ * forwardZ) / moveLength < 0.3
          ) {
            moveX = forwardX;
            moveZ = forwardZ;
            moveLength = 1;
          }
          const nextX = u.x + (moveX / moveLength) * s,
            nextZ = u.z + (moveZ / moveLength) * s,
            nextIndex = navIndex(navGrid, nextX, nextZ);
          if (nextIndex < 0 || navGrid.blocked[nextIndex]) return;
          u.x = nextX;
          u.z = nextZ;
          mesh.position.set(u.x, terrainHeight(regionForX(u.x), u.x, u.z), u.z);
          mesh.rotation.y = 0;
        }
      });
      if (now - statAt > 500) {
        statAt = now;
        setStats({
          pku: g.units
            .filter((u) => u.team === "pku")
            .reduce((sum, unit) => sum + unit.strength, 0),
          thu: g.units
            .filter((u) => u.team === "thu")
            .reduce((sum, unit) => sum + unit.strength, 0),
          pkuSites: g.sites.filter((s) => s.team === "pku" && !s.destroyed)
            .length,
          thuSites: g.sites.filter((s) => s.team === "thu" && !s.destroyed)
            .length,
        });
        const campaignDate = new Date(
          new Date(g.campaign.startDateISO).getTime() +
            g.campaign.elapsedHours * 3_600_000,
        );
        setClock(
          campaignDate.toLocaleString("zh-CN", {
            timeZone: "Asia/Shanghai",
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }),
        );
        siteObjects.forEach((object, id) => {
          const site = g.sites[id],
            badge = object.userData.countBadge as
              | {
                  context: CanvasRenderingContext2D;
                  texture: THREE.CanvasTexture;
                  last: number;
                }
              | undefined;
          if (!site || !badge) return;
          const count = nearbyFriendlyPeople(site);
          if (count === badge.last) return;
          drawCountBadge(badge.context, count);
          badge.texture.needsUpdate = true;
          badge.last = count;
        });
      }
      if (!directControlActive) controls.update();
      const fixedRingScale = THREE.MathUtils.clamp(
        camera.position.distanceTo(controls.target) / Math.hypot(24, 22),
        0.45,
        1.9,
      );
      siteObjects.forEach((object) => {
        const icons = object.userData.fixedMarkerIcons as
          | {
              object: THREE.Sprite;
              x: number;
              y: number;
              scaleX: number;
              scaleY: number;
            }[]
          | undefined;
        icons?.forEach((icon) => {
          icon.object.position.x = icon.x * fixedRingScale;
          icon.object.position.y = 1.75 + (icon.y - 1.75) * fixedRingScale;
          icon.object.scale.set(
            icon.scaleX * fixedRingScale,
            icon.scaleY * fixedRingScale,
            1,
          );
        });
      });
      const active = regions[regionRef.current],
        marginX = Math.min(18, active.width * 0.32),
        marginZ = Math.min(14, active.depth * 0.32),
        cx = THREE.MathUtils.clamp(
          controls.target.x,
          active.offsetX - active.width / 2 + marginX,
          active.offsetX + active.width / 2 - marginX,
        ),
        cz = THREE.MathUtils.clamp(
          controls.target.z,
          -active.depth / 2 + marginZ,
          active.depth / 2 - marginZ,
        ),
        shiftX = cx - controls.target.x,
        shiftZ = cz - controls.target.z;
      if (shiftX || shiftZ) {
        controls.target.x = cx;
        controls.target.z = cz;
        camera.position.x += shiftX;
        camera.position.z += shiftZ;
      }
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(animate);
    const resize = () => {
      renderer.setSize(host.clientWidth, host.clientHeight);
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      commandLineMaterials.forEach((material) =>
        material.resolution.set(host.clientWidth, host.clientHeight),
      );
    };
    addEventListener("resize", resize);
    sceneApi.current = {
      sync: () => {
        refreshNavAnchors();
        gameRef.current.sites.forEach((source) => {
          if (source.destroyed || source.orderTarget == null) return;
          const target = gameRef.current.sites[source.orderTarget];
          if (!target || target.destroyed) return;
          source.orderPath = findPath(
            source.navX ?? source.x,
            source.navZ ?? source.z,
            target.navX ?? target.x,
            target.navZ ?? target.z,
          );
          if (!source.orderPath.length) {
            source.orderPath = undefined;
            source.orderTarget = undefined;
          }
        });
        gameRef.current.units.forEach((unit) => {
          if (unit.targetSiteId == null) return;
          const target = gameRef.current.sites[unit.targetSiteId];
          if (!target || target.destroyed) return;
          unit.path = findPath(
            unit.x,
            unit.z,
            target.navX ?? target.x,
            target.navZ ?? target.z,
          );
          if (!unit.path.length) {
            unit.path = undefined;
            unit.targetSiteId = undefined;
            unit.tx = unit.x;
            unit.tz = unit.z;
            return;
          }
          unit.pathIndex = 0;
        });
        rebuildBuildings();
        rebuildUnits();
        rebuildCommandLines();
      },
      focus: (id) => {
        regionRef.current = id;
        const [x, z] = [-22, 14];
        controls.target.set(x, 0, z);
        camera.position.set(x, 24, z + 22);
        controls.update();
      },
      applyMaterials,
      clearUnitSelection: () => {
        selectedUnitIds.clear();
        refreshUnitSelection();
      },
      setViewMode: (mode) => {
        const detailed = mode === "sites";
        buildingGroup.visible = detailed;
        unitGroup.visible = detailed;
        commandGroup.visible = detailed;
        combatGroup.visible = detailed;
        territoryGroup.visible = !detailed;
        if (!detailed) {
          const direction = camera.position
            .clone()
            .sub(controls.target)
            .normalize();
          controls.target.set(regions.main.offsetX, 0, 0);
          camera.position
            .copy(controls.target)
            .addScaledVector(direction, controls.maxDistance);
          controls.update();
        }
      },
      buildCampAt: (x, z) =>
        buildCampAt(
          new THREE.Vector3(x, terrainHeight(regionForX(x), x, z), z),
        ),
      enterDirectControl,
      exitDirectControl,
    };
    sceneApi.current.setViewMode(viewModeRef.current);
    applyMaterials(
      customMaterialsRef.current.unit,
      customMaterialsRef.current.site,
    );
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(combatTimer);
      clearInterval(campaignTimer);
      clearInterval(aiTimer);
      removeEventListener("resize", resize);
      removeEventListener("keydown", onDirectKeyDown);
      removeEventListener("keyup", onDirectKeyUp);
      controls.removeEventListener("start", hideSitePanel);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === host)
        host.removeChild(renderer.domElement);
    };
  }, []);

  const saveGame = () => {
    const name =
        saveName.trim() || `存档 ${new Date().toLocaleString("zh-CN")}`,
      data = structuredClone(gameRef.current);
    data.units.forEach((unit) => {
      unit.path = undefined;
      unit.pathIndex = undefined;
    });
    data.sites.forEach((site) => (site.orderPath = undefined));
    const snapshot: Snapshot = {
        version: 3,
        name,
        savedAt: Date.now(),
        ...data,
      },
      next = [snapshot, ...readSaves().filter((s) => s.name !== name)].slice(
        0,
        6,
      );
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(next));
      refreshSaves();
      setNotice(`已保存“${name}”`);
    } catch {
      setNotice("存档空间不足，请删除旧存档或恢复默认材质后重试");
    }
  };
  const loadGame = (save: Snapshot) => {
    if (save.version === 3 && save.campaign) {
      const { timeOfDay, resources, deaths, sites, units, campaign } =
        structuredClone(save);
      const defaults = makeFreshGame().campaign,
        maxSiteId = sites.reduce((max, site) => Math.max(max, site.id), -1),
        normalizedCampaign: CampaignState = {
          ...defaults,
          ...campaign,
          startDateISO: campaign.startDateISO || defaults.startDateISO,
          elapsedHours: Number.isFinite(campaign.elapsedHours)
            ? campaign.elapsedHours
            : 0,
          warUnlocked: campaign.warUnlocked ?? false,
          attackBonus: { ...defaults.attackBonus, ...campaign.attackBonus },
          freezeUntil: { ...defaults.freezeUntil, ...campaign.freezeUntil },
          firedEvents: campaign.firedEvents ?? [],
          nextSiteId: Math.max(campaign.nextSiteId ?? 0, maxSiteId + 1),
          lastProductionCycle: campaign.lastProductionCycle ?? 0,
          lastDiningCycle: campaign.lastDiningCycle ?? 0,
          lastMorningEventDay: campaign.lastMorningEventDay ?? -1,
          thuFactionName: campaign.thuFactionName || "清华",
        };
      sites.forEach((site) => {
        site.displayName ??= site.name;
        site.dispatchRatio ??=
          site.stance === "defend" ? 0.45 : site.stance === "guard" ? 0.72 : 1;
        site.orderPath = undefined;
      });
      units.forEach((unit) => {
        unit.strength ??= 5;
        unit.path = undefined;
        unit.pathIndex = undefined;
      });
      gameRef.current = {
        timeOfDay,
        resources,
        deaths,
        sites,
        units,
        campaign: normalizedCampaign,
      };
    } else {
      const fresh = makeFreshGame(),
        oldSiteById = new Map(save.sites.map((s) => [s.id, s])),
        freshByName = new Map(fresh.sites.map((s) => [s.name, s]));
      fresh.sites.forEach((site) => {
        const old = save.sites.find((s) => s.name === site.name);
        if (!old) return;
        site.team = old.team;
        site.stance = old.stance;
        site.supply = old.supply;
        site.displayName = old.displayName ?? old.name;
        site.dispatchRatio = old.dispatchRatio;
        const oldTarget =
          old.orderTarget == null ? null : oldSiteById.get(old.orderTarget);
        site.orderTarget = oldTarget
          ? freshByName.get(oldTarget.name)?.id
          : undefined;
      });
      fresh.units = save.units.flatMap((unit, index) => {
        const oldHome = oldSiteById.get(unit.siteId),
          home = oldHome ? freshByName.get(oldHome.name) : undefined;
        if (!home) return [];
        const angle = ((index % 7) / 7) * Math.PI * 2;
        return [
          {
            ...unit,
            strength: unit.strength ?? 5,
            siteId: home.id,
            targetSiteId: undefined,
            path: undefined,
            pathIndex: undefined,
            x: home.x + Math.cos(angle) * 1.1,
            z: home.z + Math.sin(angle) * 1.1,
            tx: home.x,
            tz: home.z,
          },
        ];
      });
      fresh.timeOfDay = save.timeOfDay;
      fresh.resources = save.resources;
      fresh.deaths = save.deaths;
      gameRef.current = fresh;
    }
    sceneApi.current?.sync();
    sceneApi.current?.clearUnitSelection();
    setSelected(null);
    setSaveOpen(false);
    eventQueueRef.current = [];
    setActiveEvent(null);
    setVictoryBroadcast(null);
  };
  const deleteSave = (savedAt: number) => {
    const next = readSaves().filter((s) => s.savedAt !== savedAt);
    localStorage.setItem(SAVE_KEY, JSON.stringify(next));
    setSaves(next);
  };
  const newGame = () => {
    gameRef.current = makeFreshGame();
    sceneApi.current?.sync();
    sceneApi.current?.clearUnitSelection();
    setSelected(null);
    eventQueueRef.current = [];
    setActiveEvent(null);
    setVictoryBroadcast(null);
  };
  const stanceText = useMemo(
    () => ({
      defend: { icon: "🛡️", title: "防守", detail: "保留55%驻军" },
      guard: { icon: "📡", title: "守卫", detail: "保留28%并主动截击" },
      standby: { icon: "⏸", title: "待命", detail: "可输送全部兵力" },
    }),
    [],
  );
  const siteTypeInfo = useMemo<
    Record<SiteKind, { icon: string; text: string }>
  >(
    () => ({
      dorm: { icon: "🛏️", text: "宿舍：每6小时补充兵力" },
      dining: { icon: "🍚", text: "食堂：每12小时补充高补给兵力" },
      teaching: { icon: "🎓", text: "教学/学院楼：防守交换加成25%" },
      gate: { icon: "🚪", text: "校门：防守交换加成55%" },
      target: { icon: "🎓", text: "学院据点：防守交换加成25%" },
      capital: { icon: "★", text: "核心学院：失守将判定战役失败" },
      camp: { icon: "⛺", text: "临时营地：补给周边部队，被攻克后拆除" },
    }),
    [],
  );
  const setStance = (s: Stance) => {
    if (!selectedSite || selectedSite.team !== "pku") return;
    selectedSite.stance = s;
    selectedSite.dispatchRatio =
      s === "defend" ? 0.45 : s === "guard" ? 0.72 : 1;
    sceneApi.current?.sync();
    setNotice(
      `${selectedSite.displayName ?? selectedSite.name}已切换为${stanceText[s].title}`,
    );
    setSelected(null);
  };
  const renameSelectedSite = () => {
    if (!selectedSite || selectedSite.team !== "pku") return;
    const nextName = renameDraft.trim().slice(0, 24);
    if (!nextName) return;
    selectedSite.displayName = nextName;
    sceneApi.current?.sync();
    setNotice(`据点已改名为“${nextName}”`);
    setSelected(null);
  };
  const handleMaterialUpload = async (kind: "unit" | "site", file?: File) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 2_000_000) {
      setNotice("仅支持2MB以内的 PNG、JPEG 或 WebP 图片");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file),
        canvas = document.createElement("canvas"),
        size = 512;
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d")!;
      context.clearRect(0, 0, size, size);
      const scale = Math.min(size / bitmap.width, size / bitmap.height),
        width = bitmap.width * scale,
        height = bitmap.height * scale;
      context.drawImage(
        bitmap,
        (size - width) / 2,
        (size - height) / 2,
        width,
        height,
      );
      bitmap.close();
      const url = canvas.toDataURL("image/webp", 0.82),
        key = `qingbei-custom-${kind}-material`;
      localStorage.setItem(key, url);
      if (kind === "unit") setUnitMaterialUrl(url);
      else setSiteMaterialUrl(url);
      setNotice(`${kind === "unit" ? "士兵" : "据点"}材质已替换`);
    } catch {
      setNotice("图片处理或本机存储失败，请换用更小的图片");
    }
  };
  const clearMaterial = (kind: "unit" | "site") => {
    localStorage.removeItem(`qingbei-custom-${kind}-material`);
    if (kind === "unit") setUnitMaterialUrl(null);
    else setSiteMaterialUrl(null);
  };
  return (
    <main className="game-shell">
      <div ref={hostRef} className="webgl-stage" />
      <header className="hud-top">
        <div>
          <h1>解放清华园</h1>
          <p>OSM导航级路网 · 实时战役</p>
        </div>
        <div className="time-pill">
          <span>{clock}</span>
          <button onClick={() => setAutoDay((v) => !v)}>
            {autoDay ? "自动昼夜" : "光照锁定"}
          </button>
        </div>
        <button
          className="save-main"
          onClick={() => {
            refreshSaves();
            setSaveOpen(true);
          }}
        >
          存档管理
        </button>
      </header>
      <nav className="campaign-tools">
        <div className="map-view-switch" aria-label="地图视图">
          <button
            className={viewMode === "sites" ? "active" : ""}
            onClick={() => setViewMode("sites")}
          >
            ◉ 据点视图
          </button>
          <button
            className={viewMode === "control" ? "active" : ""}
            onClick={() => setViewMode("control")}
          >
            ◒ 控制范围
          </button>
        </div>
        <button onClick={() => setAssetOpen(true)}>🖼 更换材质</button>
        <span className="camp-hint">右键空地建立临时据点</span>
        {selectedUnitCount > 0 && (
          <span className="selected-squad">◎ 已选 {selectedUnitCount} 人</span>
        )}
        {selectedUnitCount > 0 && !directControl && (
          <button
            onClick={() => sceneApi.current?.enterDirectControl()}
            title="也可以按 F"
          >
            ⌨ 近距控制
          </button>
        )}
      </nav>
      {directControl && (
        <aside className="direct-control-hud">
          <strong>近距离控制</strong>
          <span>WASD 移动 · Esc 退出</span>
          <canvas ref={minimapRef} width={240} height={160} />
          <small>青色标记为当前控制的学生在全图中的位置</small>
        </aside>
      )}
      <div className="command-notice">{notice}</div>
      {campContext && (
        <div
          className="camp-context-menu"
          style={{
            left: Math.min(campContext.x, globalThis.innerWidth - 250),
            top: Math.min(campContext.y, globalThis.innerHeight - 150),
          }}
        >
          <strong>在此建立临时据点？</strong>
          <small>消耗 80 战略资源，附近需要至少 3 名北大学生</small>
          <div>
            <button
              onClick={() => {
                if (
                  sceneApi.current?.buildCampAt(
                    campContext.worldX,
                    campContext.worldZ,
                  )
                )
                  setCampContext(null);
              }}
            >
              ⛺ 建立营地
            </button>
            <button onClick={() => setCampContext(null)}>取消</button>
          </div>
        </div>
      )}
      <aside className="war-overview">
        <h2>总体战况</h2>
        <p className="campaign-phase">
          {gameRef.current.campaign.warUnlocked
            ? "⚔ 交战已开放"
            : "☮ 校园对峙期"}
        </p>
        {gameRef.current.campaign.outcome && (
          <div className={`outcome ${gameRef.current.campaign.outcome.winner}`}>
            <strong>
              {gameRef.current.campaign.outcome.winner === "pku"
                ? "北大胜利"
                : "清华胜利"}
            </strong>
            <small>
              {gameRef.current.campaign.outcome.reason} · 战局可继续
            </small>
          </div>
        )}
        <div className="stat-grid">
          <span>总兵力</span>
          <b className="red">{stats.pku}</b>
          <b className="purple">{stats.thu}</b>
          <span>控制据点</span>
          <b className="red">{stats.pkuSites}</b>
          <b className="purple">{stats.thuSites}</b>
          <span>战略资源</span>
          <b className="red">{Math.floor(gameRef.current.resources.pku)}</b>
          <b className="purple">{Math.floor(gameRef.current.resources.thu)}</b>
          <span>累计阵亡</span>
          <b className="red">{gameRef.current.deaths.pku}</b>
          <b className="purple">{gameRef.current.deaths.thu}</b>
        </div>
        <button onClick={newGame}>重新开始</button>
      </aside>
      {selectedSite && (
        <section className="site-menu">
          <strong>{selectedSite.displayName ?? selectedSite.name}</strong>
          <p className={selectedSite.team === "pku" ? "red" : "purple"}>
            {selectedSite.team === "pku"
              ? "北大控制"
              : `${gameRef.current.campaign.thuFactionName}控制`}{" "}
            · 补给 {Math.round(selectedSite.supply)}
          </p>
          <div className="site-mechanic">
            <span>{siteTypeInfo[selectedSite.type].icon}</span>
            <small>{siteTypeInfo[selectedSite.type].text}</small>
          </div>
          {selectedSite.hasPortal && (
            <div className="portal-note">◎ 已连接最近道路的传送通道</div>
          )}
          <div className="rename-row">
            <input
              value={renameDraft}
              maxLength={24}
              disabled={selectedSite.team !== "pku"}
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") renameSelectedSite();
              }}
              aria-label="据点名称"
            />
            <button
              disabled={selectedSite.team !== "pku"}
              onClick={renameSelectedSite}
            >
              改名
            </button>
          </div>
          <div className="stance-actions">
            {(Object.keys(stanceText) as Stance[]).map((s) => (
              <button
                key={s}
                className={selectedSite.stance === s ? "active" : ""}
                disabled={selectedSite.team !== "pku"}
                onClick={() => setStance(s)}
              >
                <span>{stanceText[s].icon}</span>
                <b>{stanceText[s].title}</b>
                <small>{stanceText[s].detail}</small>
              </button>
            ))}
          </div>
          <label className="dispatch-control">
            <span>持续输送比例</span>
            <b>{Math.round((selectedSite.dispatchRatio ?? 0.6) * 100)}%</b>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={selectedSite.dispatchRatio ?? 0.6}
              disabled={selectedSite.team !== "pku"}
              onChange={(event) => {
                selectedSite.dispatchRatio = Number(event.target.value);
                setUiRevision((value) => value + 1);
                setNotice(
                  `${selectedSite.displayName ?? selectedSite.name}持续输送比例已调整`,
                );
              }}
            />
          </label>
          <small>
            拖向友方建立持续增援线，拖向敌方建立持续进攻线；右键兵线取消。
          </small>
        </section>
      )}
      <div className="day-slider">
        <span>昼夜</span>
        <input
          aria-label="时间"
          type="range"
          min="0"
          max="24"
          step=".1"
          value={gameRef.current.timeOfDay}
          disabled
        />
        <select
          aria-label="时间流逝倍率"
          value={timeScale}
          onChange={(event) => setTimeScale(Number(event.target.value))}
        >
          <option value={0.5}>0.5×</option>
          <option value={1}>1×</option>
          <option value={2}>2×</option>
          <option value={4}>4×</option>
        </select>
      </div>
      <div className="map-attribution">
        道路与建筑 © OpenStreetMap contributors · 高程 Open-Meteo
      </div>
      {victoryBroadcast && (
        <div className="victory-backdrop">
          <section className={`victory-card ${victoryBroadcast.winner}`}>
            <small>战役结果已记录</small>
            <h2>{victoryBroadcast.title}</h2>
            <p>{victoryBroadcast.body}</p>
            <button onClick={() => setVictoryBroadcast(null)}>继续游戏</button>
          </section>
        </div>
      )}
      {activeEvent && (
        <div className="event-backdrop">
          <article className="event-card">
            <div
              className={`event-photo ${activeEvent.quadrant}`}
              style={{
                backgroundImage: `linear-gradient(#0002,#0005),url(${import.meta.env.BASE_URL}event-archive-sheet.webp)`,
              }}
            />
            <div className="event-copy">
              <small>{activeEvent.date}</small>
              <h2>{activeEvent.title}</h2>
              <p>{activeEvent.body}</p>
              <div className="event-effect">机制效果：{activeEvent.effect}</div>
              <button
                onClick={() =>
                  setActiveEvent(eventQueueRef.current.shift() ?? null)
                }
              >
                继续战局
              </button>
            </div>
          </article>
        </div>
      )}
      {assetOpen && (
        <div className="modal-backdrop" onMouseDown={() => setAssetOpen(false)}>
          <section
            className="asset-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="save-head">
              <div>
                <small>本机自定义</small>
                <h2>替换游戏材质</h2>
              </div>
              <button onClick={() => setAssetOpen(false)}>×</button>
            </div>
            <div className="upload-card">
              <strong>士兵球体材质</strong>
              <span>PNG / JPEG / WebP，最大2MB；会缩放至512像素。</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) =>
                  void handleMaterialUpload("unit", event.target.files?.[0])
                }
              />
              <button type="button" onClick={() => clearMaterial("unit")}>
                恢复默认
              </button>
            </div>
            <div className="upload-card">
              <strong>据点标记材质</strong>
              <span>上传后会显示在所有据点标记上方。</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) =>
                  void handleMaterialUpload("site", event.target.files?.[0])
                }
              />
              <button type="button" onClick={() => clearMaterial("site")}>
                恢复默认
              </button>
            </div>
          </section>
        </div>
      )}
      {saveOpen && (
        <div className="modal-backdrop" onMouseDown={() => setSaveOpen(false)}>
          <section
            className="save-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="save-head">
              <div>
                <small>本机存档</small>
                <h2>战局档案馆</h2>
              </div>
              <button onClick={() => setSaveOpen(false)}>×</button>
            </div>
            <div className="new-save">
              <input
                value={saveName}
                maxLength={24}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="输入存档名称"
              />
              <button onClick={saveGame}>保存当前战局</button>
            </div>
            <div className="save-list">
              {!saves.length && <p className="empty">暂无存档</p>}
              {saves.map((s) => (
                <article key={s.savedAt}>
                  <div>
                    <strong>{s.name}</strong>
                    <span>
                      {new Date(s.savedAt).toLocaleString("zh-CN")} ·{" "}
                      {s.units.length}人 · {s.timeOfDay.toFixed(1)}时
                    </span>
                  </div>
                  <button className="enter" onClick={() => loadGame(s)}>
                    进入
                  </button>
                  <button
                    className="delete"
                    onClick={() => deleteSave(s.savedAt)}
                  >
                    删除
                  </button>
                </article>
              ))}
            </div>
            <p className="save-note">
              存档保存在当前浏览器的本地存储中；清除浏览器数据会一并删除。
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
