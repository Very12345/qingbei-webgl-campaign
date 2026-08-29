export type CampaignTeam = "pku" | "thu";
export type EventSourceType =
  | "calendar"
  | "annual_activity"
  | "historical"
  | "war_scenario"
  | "easter_egg"
  | "weather";

export type CalendarEffect = {
  attack?: number;
  movement?: number;
  morale?: number;
  production?: number;
  defense?: number;
  supplyUse?: number;
  healing?: number;
  resources?: number;
  spawn?: number;
  riverMovement?: number;
  durationHours?: number;
};

export type CalendarEventDefinition = {
  id: string;
  team: CampaignTeam | "both";
  title: string;
  body: string;
  effect: string;
  startISO: string;
  endISO?: string;
  sourceType: EventSourceType;
  sourceUrl?: string;
  effects: CalendarEffect;
  image: string;
};

const pkuCalendar = "https://www.pku.edu.cn/detail/3377.html";
const thuFall = "https://www.tsinghua.edu.cn/xl/2026qiuji.jpg";
const thuSpring = "https://www.tsinghua.edu.cn/xl/2027chunji.jpg";
const image = (id: string) => `events/calendar/${id}.webp`;

export const ACADEMIC_YEAR_END_ISO = "2027-08-15T23:59:00+08:00";

export const CALENDAR_EVENTS: CalendarEventDefinition[] = [
  {
    id: "pku_undergrad_registration", team: "pku", title: "燕园新生报到",
    body: "本科新生抵达燕园，各宿舍开始编组。", effect: "北大宿舍增援20人；产兵提升25%，持续24小时。",
    startISO: "2026-08-18T08:00:00+08:00", sourceType: "calendar", sourceUrl: pkuCalendar,
    effects: { spawn: 20, production: 1.25, durationHours: 24 }, image: image("pku_undergrad_registration"),
  },
  {
    id: "pku_orientation_medical", team: "pku", title: "新生体检",
    body: "校医院连续开放，新生队伍暂时退出高强度行动。", effect: "攻击降低10%、治疗效率提升30%，持续3天。",
    startISO: "2026-08-19T08:00:00+08:00", endISO: "2026-08-21T23:59:00+08:00", sourceType: "calendar", sourceUrl: pkuCalendar,
    effects: { attack: .9, healing: 1.3, durationHours: 72 }, image: image("pku_orientation_medical"),
  },
  {
    id: "pku_military_training", team: "pku", title: "军训与入学教育",
    body: "新生按照校历进入军训与入学教育阶段。", effect: "移动提升15%、意志提升20%、攻击降低10%，持续至9月2日。",
    startISO: "2026-08-22T08:00:00+08:00", endISO: "2026-09-02T23:59:00+08:00", sourceType: "calendar", sourceUrl: pkuCalendar,
    effects: { attack: .9, movement: 1.15, morale: 1.2, durationHours: 288 }, image: image("pku_military_training"),
  },
  {
    id: "pku_opening_ceremony", team: "pku", title: "北京大学开学典礼",
    body: "新生在开学典礼后正式进入燕园生活。", effect: "全体意志提升15%，当前决策获得24小时进度。",
    startISO: "2026-09-04T09:00:00+08:00", sourceType: "calendar", sourceUrl: pkuCalendar,
    effects: { morale: 1.15, durationHours: 168 }, image: image("pku_opening_ceremony"),
  },
  {
    id: "pku_classes_begin", team: "pku", title: "燕园正式上课",
    body: "校本部正式上课，北大的工作日作息开始生效。", effect: "北大从此日起加入工作日上早八判定。",
    startISO: "2026-09-07T08:00:00+08:00", sourceType: "calendar", sourceUrl: pkuCalendar,
    effects: { morale: 1.05, durationHours: 168 }, image: image("pku_classes_begin"),
  },
  {
    id: "pku_autumn_club_fair", team: "pku", title: "秋季社团文化节",
    body: "学生社团集中招新，燕园重新变得拥挤而活跃。", effect: "产兵和意志提升10%，持续7天。",
    startISO: "2026-09-19T09:00:00+08:00", endISO: "2026-09-20T18:00:00+08:00", sourceType: "annual_activity",
    sourceUrl: "https://news.pku.edu.cn/xwzh/18401c5e0e0948f79bf66bda45fd4076.htm",
    effects: { production: 1.1, morale: 1.1, durationHours: 168 }, image: image("pku_autumn_club_fair"),
  },
  {
    id: "pku_autumn_sports", team: "pku", title: "北京大学秋季运动会",
    body: "运动会占用部分战斗力量，却显著提升了校园士气。", effect: "移动提升25%、意志提升15%、攻击降低5%，持续2天。",
    startISO: "2026-10-10T08:00:00+08:00", endISO: "2026-10-11T18:00:00+08:00", sourceType: "calendar", sourceUrl: pkuCalendar,
    effects: { movement: 1.25, morale: 1.15, attack: .95, durationHours: 48 }, image: image("pku_autumn_sports"),
  },
  {
    id: "pku_degree_committee", team: "pku", title: "学位评定委员会会议",
    body: "校务系统集中运转，长期计划得到额外推进。", effect: "战略资源增加40；当前决策推进24小时。",
    startISO: "2026-11-27T09:00:00+08:00", sourceType: "calendar", sourceUrl: pkuCalendar,
    effects: { resources: 40 }, image: image("pku_degree_committee"),
  },
  {
    id: "pku_december_choir", team: "pku", title: "一二·九师生歌会",
    body: "百周年纪念讲堂响起院系合唱，集体意志迅速凝聚。", effect: "意志提升25%、溃退倾向降低，持续7天。",
    startISO: "2026-12-09T18:00:00+08:00", endISO: "2026-12-10T22:00:00+08:00", sourceType: "annual_activity",
    sourceUrl: "https://news.pku.edu.cn/xwzh/6fe7de87456444d49c4a1ffe5ae28af5.htm",
    effects: { morale: 1.25, defense: 1.1, durationHours: 168 }, image: image("pku_december_choir"),
  },
  {
    id: "pku_fall_exams", team: "pku", title: "停课复习考试",
    body: "燕园进入复习考试阶段，大量学生回到教学楼与图书馆。", effect: "攻击、移动降低15%，建筑防守提升15%，产兵降低20%。",
    startISO: "2026-12-28T08:00:00+08:00", endISO: "2027-01-10T23:59:00+08:00", sourceType: "calendar", sourceUrl: pkuCalendar,
    effects: { attack: .85, movement: .85, defense: 1.15, production: .8, durationHours: 336 }, image: image("pku_fall_exams"),
  },
  {
    id: "pku_lake_ice_rink", team: "pku", title: "未名湖冰场",
    body: "冬季冰场开放，未名湖成为一条特殊的临时通道。", effect: "水中移动惩罚减半，移动提升10%，持续14天。",
    startISO: "2027-01-02T10:00:00+08:00", sourceType: "annual_activity",
    sourceUrl: "https://news.pku.edu.cn/xwzh/c12539d9b31543bfb3f4840502e12f02.htm",
    effects: { riverMovement: 1.5, movement: 1.1, durationHours: 336 }, image: image("pku_lake_ice_rink"),
  },
  {
    id: "pku_spring_sports", team: "pku", title: "北京大学春季运动会",
    body: "春季运动会带来新的体能动员。", effect: "移动提升25%、治疗提升15%、意志提升15%，持续3天。",
    startISO: "2027-04-23T08:00:00+08:00", endISO: "2027-04-25T18:00:00+08:00", sourceType: "calendar", sourceUrl: pkuCalendar,
    effects: { movement: 1.25, healing: 1.15, morale: 1.15, durationHours: 72 }, image: image("pku_spring_sports"),
  },
  {
    id: "pku_anniversary", team: "pku", title: "五四与北京大学校庆",
    body: "校友返校，五四与校庆活动共同汇聚燕园。", effect: "校门增援40人、资源增加120、意志提升20%。",
    startISO: "2027-05-04T08:00:00+08:00", sourceType: "calendar", sourceUrl: pkuCalendar,
    effects: { spawn: 40, resources: 120, morale: 1.2, durationHours: 168 }, image: image("pku_anniversary"),
  },
  {
    id: "pku_graduation_summer", team: "pku", title: "毕业典礼与暑期学校",
    body: "毕业典礼结束后，燕园逐步转入暑期学校节奏。", effect: "意志提升20%；教学楼防守提升10%、产兵降低15%，持续至8月8日。",
    startISO: "2027-07-01T08:00:00+08:00", endISO: "2027-08-08T23:59:00+08:00", sourceType: "calendar", sourceUrl: pkuCalendar,
    effects: { morale: 1.2, defense: 1.1, production: .85, durationHours: 936 }, image: image("pku_graduation_summer"),
  },

  {
    id: "thu_undergrad_registration", team: "thu", title: "清华本科新生报到",
    body: "本科新生抵达清华园，紫荆宿舍开始编组。", effect: "清华宿舍增援20人；产兵提升25%，持续24小时。",
    startISO: "2026-08-19T08:00:00+08:00", sourceType: "calendar", sourceUrl: thuFall,
    effects: { spawn: 20, production: 1.25, durationHours: 24 }, image: image("thu_undergrad_registration"),
  },
  {
    id: "thu_opening_ceremony", team: "thu", title: "清华本科生开学典礼",
    body: "本科生开学典礼结束，清华园完成第一轮动员。", effect: "全体意志提升15%，当前决策推进24小时。",
    startISO: "2026-08-20T09:00:00+08:00", sourceType: "calendar", sourceUrl: thuFall,
    effects: { morale: 1.15, durationHours: 168 }, image: image("thu_opening_ceremony"),
  },
  {
    id: "thu_orientation_training", team: "thu", title: "军训与入学教育",
    body: "新生进入持续至9月13日的军训和入学教育。", effect: "移动提升15%、意志提升20%、攻击降低10%。",
    startISO: "2026-08-21T08:00:00+08:00", endISO: "2026-09-13T23:59:00+08:00", sourceType: "calendar", sourceUrl: thuFall,
    effects: { attack: .9, movement: 1.15, morale: 1.2, durationHours: 576 }, image: image("thu_orientation_training"),
  },
  {
    id: "thu_graduate_registration", team: "thu", title: "研究生报到与开学典礼",
    body: "研究生新生抵达，主楼和科学馆获得新的组织力量。", effect: "主楼、科学馆补给恢复并增援15人。",
    startISO: "2026-08-26T08:00:00+08:00", endISO: "2026-08-27T18:00:00+08:00", sourceType: "calendar", sourceUrl: thuFall,
    effects: { spawn: 15, resources: 30 }, image: image("thu_graduate_registration"),
  },
  {
    id: "thu_classes_begin", team: "thu", title: "清华全校正式上课",
    body: "全校本科生和研究生正式开始上课。", effect: "清华从此日起加入工作日上早八判定。",
    startISO: "2026-09-14T08:00:00+08:00", sourceType: "calendar", sourceUrl: thuFall,
    effects: { morale: 1.05, durationHours: 168 }, image: image("thu_classes_begin"),
  },
  {
    id: "thu_ma_john_season", team: "thu", title: "马约翰杯赛季",
    body: "贯穿学年的马约翰杯系列赛事开始，各院系不断组织训练。", effect: "移动和意志提升10%，持续14天。",
    startISO: "2026-09-14T12:00:00+08:00", sourceType: "annual_activity",
    sourceUrl: "https://www.tsinghua.edu.cn/xtw/info/1019/1134.htm",
    effects: { movement: 1.1, morale: 1.1, durationHours: 336 }, image: image("thu_ma_john_season"),
  },
  {
    id: "thu_autumn_club_fair", team: "thu", title: "清华秋季百团大战",
    body: "学生社团在秋季集中招新，校园组织能力迅速提升。", effect: "产兵和意志提升10%，持续7天。",
    startISO: "2026-10-17T09:00:00+08:00", endISO: "2026-10-18T18:00:00+08:00", sourceType: "annual_activity",
    sourceUrl: "https://www.is.tsinghua.edu.cn/guojixueshengshenghuozhinanzhongwen8.23.pdf",
    effects: { production: 1.1, morale: 1.1, durationHours: 168 }, image: image("thu_autumn_club_fair"),
  },
  {
    id: "thu_student_festival_season", team: "thu", title: "院系学生节季",
    body: "各院系学生节进入集中演出期。", effect: "新清华学堂和大礼堂方向防守、意志提升15%，持续14天。",
    startISO: "2026-11-15T18:00:00+08:00", sourceType: "annual_activity",
    sourceUrl: "https://www.tsinghua.edu.cn/xtw/info/1018/1129.htm",
    effects: { defense: 1.15, morale: 1.15, durationHours: 336 }, image: image("thu_student_festival_season"),
  },
  {
    id: "thu_december_choir", team: "thu", title: "一二·九歌咏比赛",
    body: "院系合唱队集中登台，集体意志进一步凝聚。", effect: "意志提升25%、防守提升10%，持续7天。",
    startISO: "2026-12-09T18:00:00+08:00", sourceType: "annual_activity",
    sourceUrl: "https://iiis.tsinghua.edu.cn/xysh/xshd/yyjlb.htm",
    effects: { morale: 1.25, defense: 1.1, durationHours: 168 }, image: image("thu_december_choir"),
  },
  {
    id: "thu_winter_break", team: "thu", title: "清华寒假",
    body: "本科生寒假开始，校园人口密度显著下降。", effect: "产兵降低35%、补给消耗降低20%、移动提升10%。",
    startISO: "2027-01-18T00:00:00+08:00", endISO: "2027-02-21T23:59:00+08:00", sourceType: "calendar", sourceUrl: thuFall,
    effects: { production: .65, supplyUse: .8, movement: 1.1, durationHours: 840 }, image: image("thu_winter_break"),
  },
  {
    id: "thu_spring_classes", team: "thu", title: "清华春季学期开课",
    body: "全校完成注册并开始春季课程。", effect: "意志提升10%，持续7天。",
    startISO: "2027-02-22T08:00:00+08:00", sourceType: "calendar", sourceUrl: thuSpring,
    effects: { morale: 1.1, durationHours: 168 }, image: image("thu_spring_classes"),
  },
  {
    id: "thu_campus_marathon", team: "thu", title: "清华校园马拉松",
    body: "师生校友沿校园标志建筑完成校园马拉松。", effect: "移动提升30%、意志提升15%、攻击降低5%，持续3天。",
    startISO: "2027-04-10T08:00:00+08:00", sourceType: "annual_activity",
    sourceUrl: "https://www.tsinghua.edu.cn/info/1177/125238.htm",
    effects: { movement: 1.3, morale: 1.15, attack: .95, durationHours: 72 }, image: image("thu_campus_marathon"),
  },
  {
    id: "thu_anniversary", team: "thu", title: "清华大学校庆",
    body: "校庆期间校友返校，历史建筑周边形成新的动员力量。", effect: "校门增援40人、资源增加120、防守提升15%。",
    startISO: "2027-04-24T08:00:00+08:00", endISO: "2027-04-25T23:59:00+08:00", sourceType: "calendar", sourceUrl: thuSpring,
    effects: { spawn: 40, resources: 120, defense: 1.15, durationHours: 168 }, image: image("thu_anniversary"),
  },
  {
    id: "thu_graduation_summer", team: "thu", title: "毕业典礼与夏季学期",
    body: "毕业典礼后，清华园进入夏季学期和暑假运行。", effect: "意志提升20%；教学楼防守提升10%、产兵降低15%，持续至学年末。",
    startISO: "2027-06-26T08:00:00+08:00", endISO: ACADEMIC_YEAR_END_ISO, sourceType: "calendar", sourceUrl: thuSpring,
    effects: { morale: 1.2, defense: 1.1, production: .85, durationHours: 1224 }, image: image("thu_graduation_summer"),
  },

  { id: "shared_mid_autumn", team: "both", title: "中秋停课", body: "两校按校历停课，战线短暂放缓。", effect: "攻击降低10%、补给恢复提升20%，持续24小时。", startISO: "2026-09-25T00:00:00+08:00", sourceType: "calendar", sourceUrl: pkuCalendar, effects: { attack: .9, healing: 1.2, durationHours: 24 }, image: image("shared_mid_autumn") },
  { id: "shared_national_holiday", team: "both", title: "国庆假期", body: "两校进入国庆假期，教学区人口下降。", effect: "产兵降低25%、移动提升15%、教学楼防守降低10%，持续7天。", startISO: "2026-10-01T00:00:00+08:00", endISO: "2026-10-07T23:59:00+08:00", sourceType: "calendar", sourceUrl: pkuCalendar, effects: { production: .75, movement: 1.15, defense: .9, durationHours: 168 }, image: image("shared_national_holiday") },
  { id: "shared_autumn_cold", team: "both", title: "北京秋季降温", body: "冷空气穿过海淀，夜间行动的补给压力上升。", effect: "移动降低8%、补给消耗增加10%，持续3天。", startISO: "2026-10-18T00:00:00+08:00", sourceType: "weather", effects: { movement: .92, supplyUse: 1.1, durationHours: 72 }, image: image("shared_autumn_cold") },
  { id: "shared_new_year", team: "both", title: "元旦", body: "新年到来，长期战线获得一次短暂休整。", effect: "双方资源增加40、意志提升10%，持续24小时。", startISO: "2027-01-01T00:00:00+08:00", sourceType: "calendar", sourceUrl: thuFall, effects: { resources: 40, morale: 1.1, durationHours: 24 }, image: image("shared_new_year") },
  { id: "shared_winter_campus", team: "both", title: "寒假校园", body: "两校大部分本科生进入寒假，校园转入低密度运行。", effect: "产兵降低30%、补给消耗降低15%，持续至2月21日。", startISO: "2027-01-18T00:00:00+08:00", endISO: "2027-02-21T23:59:00+08:00", sourceType: "calendar", sourceUrl: pkuCalendar, effects: { production: .7, supplyUse: .85, durationHours: 840 }, image: image("shared_winter_campus") },
  { id: "shared_spring_festival", team: "both", title: "春节", body: "校园进入春节值守状态，生产短暂停顿。", effect: "产兵暂停24小时，生命、补给和意志恢复。", startISO: "2027-02-06T00:00:00+08:00", sourceType: "calendar", sourceUrl: thuFall, effects: { production: 0, healing: 1.5, morale: 1.15, durationHours: 24 }, image: image("shared_spring_festival") },
  { id: "shared_spring_return", team: "both", title: "春季返校", body: "春季学期开课，两校学生集中返校。", effect: "双方宿舍增援20人，意志提升10%。", startISO: "2027-02-22T08:00:00+08:00", sourceType: "calendar", sourceUrl: pkuCalendar, effects: { spawn: 20, morale: 1.1, durationHours: 168 }, image: image("shared_spring_return") },
  { id: "shared_qingming", team: "both", title: "清明", body: "清明假期到来，战线暂时趋于克制。", effect: "攻击降低15%、意志提升10%，持续24小时。", startISO: "2027-04-05T00:00:00+08:00", sourceType: "calendar", sourceUrl: thuSpring, effects: { attack: .85, morale: 1.1, durationHours: 24 }, image: image("shared_qingming") },
  { id: "shared_labor_day", team: "both", title: "劳动节", body: "劳动节假期改变了校园日常节奏。", effect: "产兵降低20%、资源收入提升10%，持续3天。", startISO: "2027-05-01T00:00:00+08:00", sourceType: "calendar", sourceUrl: pkuCalendar, effects: { production: .8, resources: 30, durationHours: 72 }, image: image("shared_labor_day") },
  { id: "shared_dragon_boat", team: "both", title: "端午", body: "食堂增加节日供应，前线补给得到改善。", effect: "补给消耗降低15%、意志提升8%，持续3天。", startISO: "2027-06-09T00:00:00+08:00", sourceType: "calendar", sourceUrl: thuSpring, effects: { supplyUse: .85, morale: 1.08, durationHours: 72 }, image: image("shared_dragon_boat") },
  { id: "shared_summer_practice", team: "both", title: "暑期社会实践", body: "部分后方学生离校实践，随后携带资源返回。", effect: "产兵降低15%、资源增加80，持续14天。", startISO: "2027-06-28T08:00:00+08:00", sourceType: "annual_activity", sourceUrl: thuSpring, effects: { production: .85, resources: 80, durationHours: 336 }, image: image("shared_summer_practice") },
  { id: "shared_midsummer", team: "both", title: "盛夏校园", body: "海淀进入盛夏，行动重心转向清晨和夜间。", effect: "移动降低10%、补给消耗增加10%，持续至学年末。", startISO: "2027-07-15T00:00:00+08:00", endISO: ACADEMIC_YEAR_END_ISO, sourceType: "weather", effects: { movement: .9, supplyUse: 1.1, durationHours: 768 }, image: image("shared_midsummer") },
];

export type DecisionEffect = {
  attack?: number; movement?: number; morale?: number; defense?: number;
  production?: number; supplyUse?: number; dispatch?: number; resourceIncome?: number;
  healing?: number; riverMovement?: number; populationCap?: number;
};

export type DecisionDefinition = {
  id: string; team: CampaignTeam; branch: string; title: string; description: string;
  days: number; cost: number; requires: string[]; exclusiveWith?: string[];
  effects: DecisionEffect; aiTags: string[];
};

const decision = (
  team: CampaignTeam, branch: string, id: string, title: string, description: string,
  days: number, cost: number, requires: string[], effects: DecisionEffect,
  aiTags: string[], exclusiveWith?: string[],
): DecisionDefinition => ({ team, branch, id, title, description, days, cost, requires, effects, aiTags, exclusiveWith });

export const DECISIONS: DecisionDefinition[] = [
  decision("pku","思想与校园动员","pku_open_governance","校务公开","提高战略资源组织效率。",5,80,[],{resourceIncome:1.08},["resource"]),
  decision("pku","思想与校园动员","pku_inclusive_governance","兼容并包","形成跨院系动员网络。",7,120,["pku_open_governance"],{morale:1.05},["morale"]),
  decision("pku","思想与校园动员","pku_academic_autonomy","学术自治","强化教学楼自治防守。",7,120,["pku_inclusive_governance"],{defense:1.1},["defense"],["pku_may_fourth_mobilization"]),
  decision("pku","思想与校园动员","pku_may_fourth_mobilization","五四动员","提升占领与战场动员。",7,120,["pku_inclusive_governance"],{dispatch:1.1,supplyUse:1.05},["aggression"],["pku_academic_autonomy"]),
  decision("pku","思想与校园动员","pku_yanyuan_consensus","燕园共识","完成思想与校园动员体系。",10,180,["pku_academic_autonomy|pku_may_fourth_mobilization"],{morale:1.1,defense:1.05},["morale","defense"]),
  decision("pku","基础科学","pku_science_foundation","格致基础","基础科学支援战线。",5,80,[],{attack:1.03},["attack"]),
  decision("pku","基础科学","pku_math_physics_union","数理联合","联合数学与物理力量。",7,120,["pku_science_foundation"],{attack:1.05,morale:1.05},["attack","morale"]),
  decision("pku","基础科学","pku_two_bombs_path","两弹路径","强化攻击但增加补给压力。",7,120,["pku_math_physics_union"],{attack:1.1,supplyUse:1.05},["aggression"],["pku_life_path"]),
  decision("pku","基础科学","pku_life_path","生命路径","强化治疗和持续作战。",7,120,["pku_math_physics_union"],{healing:1.25,attack:.97},["healing"],["pku_two_bombs_path"]),
  decision("pku","基础科学","pku_science_community","理科共同体","理工据点获得综合强化。",10,180,["pku_two_bombs_path|pku_life_path"],{attack:1.05,defense:1.1},["science","defense"]),
  decision("pku","燕园防务","pku_gate_network","校门联络","强化校门警戒。",5,80,[],{defense:1.05},["defense"]),
  decision("pku","燕园防务","pku_garden_defense","园区联防","提高持续增援效率。",7,120,["pku_gate_network"],{dispatch:1.1},["reinforce"]),
  decision("pku","燕园防务","pku_mobile_reserve","机动预备","换取更高机动能力。",7,120,["pku_garden_defense"],{movement:1.15,defense:.95},["mobility"],["pku_hold_colleges"]),
  decision("pku","燕园防务","pku_hold_colleges","固守书院","牺牲机动强化防守。",7,120,["pku_garden_defense"],{defense:1.15,movement:.95},["defense"],["pku_mobile_reserve"]),
  decision("pku","燕园防务","pku_free_yanyuan","自由燕园","提高长期人口与核心防守。",10,180,["pku_mobile_reserve|pku_hold_colleges"],{defense:1.1,populationCap:1.05},["capital","defense"]),
  decision("pku","后勤治理","pku_canteen_coordination","食堂统筹","提高食堂产出。",5,80,[],{production:1.1},["production"]),
  decision("pku","后勤治理","pku_dorm_organization","宿舍编组","提高宿舍动员效率。",7,120,["pku_canteen_coordination"],{production:1.08},["production"]),
  decision("pku","后勤治理","pku_market_dispatch","市场调度","提高资源收入。",7,120,["pku_dorm_organization"],{resourceIncome:1.2},["resource"],["pku_ration_system"]),
  decision("pku","后勤治理","pku_ration_system","配给体系","降低补给消耗但牺牲移动。",7,120,["pku_dorm_organization"],{supplyUse:.85,movement:.95},["supply"],["pku_market_dispatch"]),
  decision("pku","后勤治理","pku_total_mobilization","燕园总动员","完成后勤与人口动员。",10,180,["pku_market_dispatch|pku_ration_system"],{production:1.15,populationCap:1.05},["production","population"]),
  decision("pku","校友与城市网络","pku_alumni_liaison","校友联络站","建立长期校友资源网络。",5,90,[],{resourceIncome:1.1},["resource"]),
  decision("pku","校友与城市网络","pku_haidian_routes","海淀交通网","整合校园外围道路与机动力量。",7,125,["pku_alumni_liaison"],{movement:1.08,dispatch:1.05},["mobility","reinforce"]),
  decision("pku","校友与城市网络","pku_medical_volunteers","医疗志愿队","把校友医疗力量纳入战地救护。",7,130,["pku_haidian_routes"],{healing:1.2,defense:1.04},["healing"],["pku_public_opinion_network"]),
  decision("pku","校友与城市网络","pku_public_opinion_network","公共传播网","强化快速动员，但提高补给压力。",7,130,["pku_haidian_routes"],{morale:1.1,dispatch:1.08,supplyUse:1.03},["morale","aggression"],["pku_medical_volunteers"]),
  decision("pku","校友与城市网络","pku_regional_alliance","区域协同体系","形成校内外资源、机动和人口协同。",10,190,["pku_medical_volunteers|pku_public_opinion_network"],{resourceIncome:1.08,movement:1.05,populationCap:1.04},["resource","mobility"]),

  decision("thu","工程体系","thu_engineering_training","工程训练","强化越野行动。",5,80,[],{movement:1.05},["mobility"]),
  decision("thu","工程体系","thu_engineer_cradle","工程师的摇篮","改善工程据点防务与资源。",7,120,["thu_engineering_training"],{defense:1.05,resourceIncome:1.05},["defense","resource"]),
  decision("thu","工程体系","thu_information_automation","信息自动化","提高AI响应和输送。",7,120,["thu_engineer_cradle"],{dispatch:1.1},["ai","reinforce"],["thu_civil_hydraulic"]),
  decision("thu","工程体系","thu_civil_hydraulic","土木水利","改善渡河和建筑防守。",7,120,["thu_engineer_cradle"],{riverMovement:1.5,defense:1.1},["river","defense"],["thu_information_automation"]),
  decision("thu","工程体系","thu_grand_engineering","大工程体系","形成综合工程优势。",10,180,["thu_information_automation|thu_civil_hydraulic"],{attack:1.05,defense:1.05,supplyUse:.95},["engineering"]),
  decision("thu","学堂传统","thu_school_tradition","清华学堂","提升全体意志。",5,80,[],{morale:1.05},["morale"]),
  decision("thu","学堂传统","thu_four_landmarks","四大建筑","强化历史建筑防守。",7,120,["thu_school_tradition"],{defense:1.1},["defense"]),
  decision("thu","学堂传统","thu_academic_order","学术秩序","强化教学楼防守。",7,120,["thu_four_landmarks"],{defense:1.1},["defense"],["thu_auditorium_mobilization"]),
  decision("thu","学堂传统","thu_auditorium_mobilization","礼堂动员","提高战场输送和进攻。",7,120,["thu_four_landmarks"],{dispatch:1.1,supplyUse:1.05},["aggression"],["thu_academic_order"]),
  decision("thu","学堂传统","thu_motto_consensus","自强厚德","完成学堂传统体系。",10,180,["thu_academic_order|thu_auditorium_mobilization"],{morale:1.1,defense:1.05},["morale","defense"]),
  decision("thu","校园防务","thu_gate_alert","校门警戒","强化校门警戒。",5,80,[],{defense:1.05},["defense"]),
  decision("thu","校园防务","thu_zijing_defense","紫荆联防","提高持续增援效率。",7,120,["thu_gate_alert"],{dispatch:1.1},["reinforce"]),
  decision("thu","校园防务","thu_mobile_warfare","机动作战","换取更高机动能力。",7,120,["thu_zijing_defense"],{movement:1.15,defense:.95},["mobility"],["thu_defense_in_depth"]),
  decision("thu","校园防务","thu_defense_in_depth","纵深防御","牺牲机动强化防守。",7,120,["thu_zijing_defense"],{defense:1.15,movement:.95},["defense"],["thu_mobile_warfare"]),
  decision("thu","校园防务","thu_defend_campus","保卫清华园","提高长期人口与核心防守。",10,180,["thu_mobile_warfare|thu_defense_in_depth"],{defense:1.1,populationCap:1.05},["capital","defense"]),
  decision("thu","后勤健康","thu_mass_canteen","万人食堂","提高食堂产出。",5,80,[],{production:1.1},["production"]),
  decision("thu","后勤健康","thu_white_front","白衣前线","提高治疗和溃退恢复。",7,120,["thu_mass_canteen"],{healing:1.15},["healing"]),
  decision("thu","后勤健康","thu_sports_mobilization","体育动员","提高机动与意志。",7,120,["thu_white_front"],{movement:1.15,attack:.97},["mobility"],["thu_precision_ration"]),
  decision("thu","后勤健康","thu_precision_ration","精细配给","降低补给消耗。",7,120,["thu_white_front"],{supplyUse:.85,movement:.95},["supply"],["thu_sports_mobilization"]),
  decision("thu","后勤健康","thu_total_mobilization","清华总动员","完成后勤与人口动员。",10,180,["thu_sports_mobilization|thu_precision_ration"],{production:1.15,populationCap:1.05},["production","population"]),
  decision("thu","系统工程与机动","thu_vehicle_lab","车辆工程试验组","建立校园载具与道路实验能力。",5,90,[],{movement:1.05,resourceIncome:1.04},["engineering","mobility"]),
  decision("thu","系统工程与机动","thu_road_survey","全路网测绘","提高道路机动和增援规划效率。",7,125,["thu_vehicle_lab"],{movement:1.08,dispatch:1.06},["mobility","ai"]),
  decision("thu","系统工程与机动","thu_smart_logistics","智能后勤","用自动调度降低补给消耗。",7,130,["thu_road_survey"],{supplyUse:.88,production:1.05},["supply","production"],["thu_hardened_convoys"]),
  decision("thu","系统工程与机动","thu_hardened_convoys","强化车队","强化机动纵队的进攻与防护。",7,130,["thu_road_survey"],{attack:1.07,defense:1.06,supplyUse:1.03},["aggression","defense"],["thu_smart_logistics"]),
  decision("thu","系统工程与机动","thu_system_command","系统总指挥","将工程、AI与机动体系合并为统一指挥网。",10,190,["thu_smart_logistics|thu_hardened_convoys"],{movement:1.05,dispatch:1.08,defense:1.04},["engineering","ai"]),
];

export const DECISION_BRANCHES = [
  "思想与校园动员", "基础科学", "燕园防务", "后勤治理",
  "校友与城市网络", "工程体系", "学堂传统", "校园防务", "后勤健康", "系统工程与机动",
] as const;

export const registerCampaignDecision = (definition: DecisionDefinition) => {
  if (DECISIONS.some((item) => item.id === definition.id))
    throw new Error(`Decision id already registered: ${definition.id}`);
  DECISIONS.push(definition);
  return () => {
    const index = DECISIONS.findIndex((item) => item.id === definition.id);
    if (index >= 0) DECISIONS.splice(index, 1);
  };
};

if (typeof window !== "undefined") {
  Object.assign(window as Window & { QingbeiDecisionAPI?: unknown }, {
    QingbeiDecisionAPI: {
      register: registerCampaignDecision,
      list: () => DECISIONS.slice(),
    },
  });
}
