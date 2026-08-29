import { osmRegions } from "../osm-map-data";
import type { GameData, SiteState, Team, UnitState } from "./types";
import { defaultResearchState } from "./research";

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

export function pointInPolygon(
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
      /^(?:1[9]|2[0-4]|2[8-9]|3[0-9]|4[0-8])楼$|^(?:34A、34B|36、37|38、39|40、41、42)楼$|学生宿舍|学生公寓|宿舍楼|勺园.*楼/,
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
  const initialBudget: Record<Team, number> = { pku: 450, thu: 540 };
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
        strength: 1,
        morale: 100,
        siteId: s.id,
      });
    }
  });
  const aiSeed = Math.floor(Math.random() * 2_147_483_647),
    pkuPersonalities = ["学术联动", "快速穿插", "燕园坚守"],
    thuPersonalities = ["工程统筹", "紫荆纵深", "主楼反攻"];
  return {
    timeOfDay: 8,
    resources: { pku: 160, thu: 190 },
    deaths: { pku: 0, thu: 0 },
    sites,
    units,
    campaign: {
      rulesVersion: 3,
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
      statuses: [],
      eventHistory: [],
      battleAlerts: [],
      initialThuSites: sites.filter((site) => site.team === "thu").length,
      initialPkuSites: sites.filter((site) => site.team === "pku").length,
      initialProductionSites: {
        pku: sites.filter(
          (site) =>
            site.team === "pku" &&
            (site.type === "dorm" || site.type === "dining"),
        ).length,
        thu: sites.filter(
          (site) =>
            site.team === "thu" &&
            (site.type === "dorm" || site.type === "dining"),
        ).length,
      },
      decisions: {
        active: { pku: null, thu: null },
        completed: [],
        locked: [],
      },
      research: defaultResearchState(),
      ai: {
        difficulty: "standard",
        seed: aiSeed,
        personality: {
          pku: pkuPersonalities[aiSeed % pkuPersonalities.length],
          thu: thuPersonalities[(aiSeed >>> 3) % thuPersonalities.length],
        },
        nextStrategicAt: { pku: 0, thu: 0 },
        failedGoals: {},
      },
    },
  };
}
