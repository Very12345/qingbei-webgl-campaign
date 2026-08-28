import type { CalendarEffect, CampaignTeam, EventSourceType } from "./campaign-content";

export type TacticalTrigger =
  | { type: "site_threat"; sites: string[]; enemyCount: number }
  | { type: "control_all"; sites: string[] }
  | { type: "resource_low"; site: string; below: number }
  | { type: "disadvantage"; siteDelta: number }
  | { type: "casualties"; total: number }
  | { type: "elapsed"; hours: number }
  | { type: "core_recaptured"; site: string };

export type TacticalEventDefinition = {
  id: string;
  team: CampaignTeam | "both";
  title: string;
  body: string;
  effect: string;
  trigger: TacticalTrigger;
  effects: CalendarEffect;
  sourceType: EventSourceType;
  sourceUrl?: string;
  image: string;
};

const image = (id: string) => `events/tactical/${id}.webp`;
const event = (
  id: string, team: CampaignTeam | "both", title: string, body: string,
  effect: string, trigger: TacticalTrigger, effects: CalendarEffect,
  sourceType: EventSourceType = "historical", sourceUrl?: string,
): TacticalEventDefinition => ({ id, team, title, body, effect, trigger, effects, sourceType, sourceUrl, image: image(id) });

export const TACTICAL_EVENTS: TacticalEventDefinition[] = [
  event("pku_inclusive","pku","兼容并包","经济、政府管理和人文学苑形成跨院系协调。","意志+15%、防守+10%，持续7天。",{type:"control_all",sites:["经济学院","政府管理大楼","李兆基人文学苑"]},{morale:1.15,defense:1.1,durationHours:168}),
  event("pku_may_fourth_bell","pku","五四钟声","百周年纪念讲堂受到实际进攻。","增援25人，攻击和意志提升。",{type:"site_threat",sites:["百周年纪念讲堂"],enemyCount:15},{spawn:25,attack:1.15,morale:1.2,durationHours:168}),
  event("pku_tower_lake_library","pku","一塔湖图","博雅塔与图书馆构成燕园核心防区。","核心防守+25%。",{type:"control_all",sites:["博雅塔","北京大学图书馆"]},{defense:1.25,supplyUse:.8,durationHours:168}),
  event("pku_modern_math","pku","现代数学先河","数学科学学院进入战斗范围。","移动+8%、攻击+10%。",{type:"site_threat",sites:["北京大学数学科学学院（理科一号楼）"],enemyCount:8},{movement:1.08,attack:1.1,durationHours:168}),
  event("pku_first_economics","pku","第一经济学门","经济学院在资源不足时承担调度。","资源+80、补给消耗-15%。",{type:"resource_low",site:"经济学院",below:100},{resources:80,supplyUse:.85,durationHours:168}),
  event("pku_red_catalog","pku","红楼韦编","图书馆进入战时文献保障状态。","补给和意志提升。",{type:"site_threat",sites:["北京大学图书馆"],enemyCount:8},{morale:1.12,supplyUse:.9,durationHours:168}),
  event("pku_nine_pioneers","pku","九位元勋","物理学院的历史被重新讲述。","攻击+15%、意志+20%。",{type:"site_threat",sites:["北京大学物理学院"],enemyCount:10},{attack:1.15,morale:1.2,durationHours:168}),
  event("pku_chemistry_gate","pku","格致科化学门","化学学院启动应急材料保障。","敌方补给受损，己方防守+12%。",{type:"site_threat",sites:["北京大学化学学院A区"],enemyCount:10},{defense:1.12,supplyUse:.9,durationHours:168}),
  event("pku_new_engineering","pku","新工科走廊","工学大楼成为东部机动枢纽。","移动和输送提升15%。",{type:"site_threat",sites:["北京大学工学大楼"],enemyCount:8},{movement:1.15,durationHours:168}),
  event("pku_beam_test","pku","束流调试","加速器楼遭到大规模进攻。","攻击+18%、防守+15%。",{type:"site_threat",sites:["北京大学加速器楼"],enemyCount:20},{attack:1.18,defense:1.15,durationHours:168}),
  event("pku_archive_sealed","pku","文博封存","文博楼开始封存重要资料。","本地防守+30%。",{type:"site_threat",sites:["文博楼"],enemyCount:8},{defense:1.3,durationHours:168}),
  event("pku_tree_of_life","pku","生命之树","生物技术楼转入伤员保障。","治疗+30%、意志+15%。",{type:"site_threat",sites:["生物技术楼"],enemyCount:8},{healing:1.3,morale:1.15,durationHours:168}),
  event("pku_langrun_talk","pku","朗润夜话","北大在落后时于朗润园重新讨论战局。","资源+100、意志+12%。",{type:"disadvantage",siteDelta:4},{resources:100,morale:1.12,durationHours:168}),
  event("pku_nongyuan_supper","pku","农园夜宵","农园餐厅承担夜间前线补给。","生产+25%、补给消耗-15%。",{type:"site_threat",sites:["北大农园餐厅"],enemyCount:6},{production:1.25,supplyUse:.85,durationHours:168}),
  event("pku_changchun_reserve","pku","畅春预备队","外围园区遭遇敌军接近。","增援30人、移动+10%。",{type:"site_threat",sites:["北京大学畅春园","北京大学畅春新园","北京大学蔚秀园"],enemyCount:8},{spawn:30,movement:1.1,durationHours:168}),
  event("pku_freedom_restored","pku","自由计划","元培在失守后重新回到北大控制。","增援20人、攻击和意志提升。",{type:"core_recaptured",site:"元培学院（俄文楼）"},{spawn:20,attack:1.2,morale:1.3,durationHours:168},"war_scenario"),

  event("thu_motto","thu","自强不息，厚德载物","敌军接近清华学堂和二校门。","意志+15%、防守+10%。",{type:"site_threat",sites:["清华学堂","二校门"],enemyCount:8},{morale:1.15,defense:1.1,durationHours:168}),
  event("thu_auditorium_faction","thu","大礼堂派","大礼堂遭到大规模进攻。","增援25人、攻击和意志提升。",{type:"site_threat",sites:["大礼堂"],enemyCount:15},{spawn:25,attack:1.15,morale:1.2,durationHours:168}),
  event("thu_four_buildings","thu","四大建筑","大礼堂、老图书馆、科学馆和体育馆形成联防。","防守+25%、补给消耗-20%。",{type:"control_all",sites:["大礼堂","老图书馆","科学馆","综合体育馆"]},{defense:1.25,supplyUse:.8,durationHours:168}),
  event("thu_science_salvation","thu","科学救国","科学馆进入战斗范围。","移动+8%、攻击+10%。",{type:"site_threat",sites:["科学馆"],enemyCount:8},{movement:1.08,attack:1.1,durationHours:168}),
  event("thu_engineer_cradle_event","thu","工程师的摇篮","主楼在资源不足时承担调度。","资源+80、补给消耗-15%。",{type:"resource_low",site:"主楼",below:100},{resources:80,supplyUse:.85,durationHours:168}),
  event("thu_century_library","thu","百年书香","老图书馆进入战时保障状态。","补给和意志提升。",{type:"site_threat",sites:["老图书馆"],enemyCount:8},{morale:1.12,supplyUse:.9,durationHours:168}),
  event("thu_computer_program_event","thu","电子计算机专业","主楼信息系统参与战场组织。","移动+10%、输送效率提升。",{type:"site_threat",sites:["主楼"],enemyCount:10},{movement:1.1,durationHours:168}),
  event("thu_engineering_physics","thu","工程物理前线","主楼与科学馆承受大规模进攻。","攻击+18%、意志+20%。",{type:"site_threat",sites:["主楼","科学馆"],enemyCount:20},{attack:1.18,morale:1.2,durationHours:168}),
  event("thu_action_speaks","thu","行胜于言","清华学堂成为机动组织中心。","移动+15%、防守+10%。",{type:"site_threat",sites:["清华学堂"],enemyCount:8},{movement:1.15,defense:1.1,durationHours:168}),
  event("thu_architect_plan","thu","梁思成图纸","艺术博物馆方向开始重新规划街垒。","防守+30%。",{type:"site_threat",sites:["艺术博物馆"],enemyCount:8},{defense:1.3,durationHours:168}),
  event("thu_new_auditorium","thu","新清华大幕","新清华学堂转入伤员与士气保障。","治疗+30%、意志+15%。",{type:"site_threat",sites:["新清华学堂"],enemyCount:8},{healing:1.3,morale:1.15,durationHours:168}),
  event("thu_white_coats","thu","白衣前线","校医院进入战斗范围。","治疗+30%、补给消耗-10%。",{type:"site_threat",sites:["校医院"],enemyCount:6},{healing:1.3,supplyUse:.9,durationHours:168}),
  event("thu_sports_first","thu","无体育，不清华","综合体育馆遭到威胁。","移动+20%、意志+12%、攻击-5%。",{type:"site_threat",sites:["综合体育馆"],enemyCount:8},{movement:1.2,morale:1.12,attack:.95,durationHours:168}),
  event("thu_mass_canteen_event","thu","万人大食堂","观畴园承担夜间前线补给。","生产+25%、补给消耗-15%。",{type:"site_threat",sites:["清华观畴园餐厅"],enemyCount:6},{production:1.25,supplyUse:.85,durationHours:168}),
  event("thu_zijing_mobilization","thu","紫荆动员","紫荆宿舍群遭遇敌军接近。","增援30人、移动+10%。",{type:"site_threat",sites:["紫荆1号楼","紫荆2号楼","紫荆3号楼","紫荆6号楼","紫荆9号楼"],enemyCount:8},{spawn:30,movement:1.1,durationHours:168}),
  event("thu_school_resumes","thu","清华学堂复课","清华学堂失守后被重新夺回。","增援20人、攻击和意志提升。",{type:"core_recaptured",site:"清华学堂"},{spawn:20,attack:1.2,morale:1.3,durationHours:168},"war_scenario"),

  event("shared_southwest_union","both","西南联大","双方伤亡达到新的阶段。","双方意志+15%、补给消耗-10%。",{type:"casualties",total:100},{morale:1.15,supplyUse:.9,durationHours:168},"historical"),
  event("shared_haidian_storm","both","海淀暴雨","连续降雨扰乱校园道路。","移动-20%、补给消耗+10%。",{type:"elapsed",hours:600},{movement:.8,supplyUse:1.1,durationHours:72},"weather"),
  event("shared_zhongguancun_detour","both","中关村施工绕行","外围道路进入施工绕行状态。","移动-15%，持续3天。",{type:"elapsed",hours:900},{movement:.85,durationHours:72},"war_scenario"),
  event("shared_midterm","both","期中周","战线被课程和复习节奏打断。","攻击-15%、防守+15%、生产-20%。",{type:"elapsed",hours:1200},{attack:.85,defense:1.15,production:.8,durationHours:168},"annual_activity"),
  event("shared_network_maintenance","both","校园网维护","通讯系统进入维护窗口。","移动和输送节奏下降。",{type:"elapsed",hours:1500},{movement:.9,durationHours:72},"annual_activity"),
  event("catchup_alumni_return","both","校友返校","落后方获得校友和后备力量支援。","落后方增援35人。",{type:"disadvantage",siteDelta:6},{spawn:35,morale:1.1,durationHours:168},"war_scenario"),
  event("catchup_long_supply","both","补给线过长","领先方的远距离补给开始承压。","双方补给消耗上升10%。",{type:"elapsed",hours:2100},{supplyUse:1.1,durationHours:168},"war_scenario"),
  event("shared_break_stalemate","both","打破僵局","长期僵持迫使双方重新组织攻势。","移动和攻击提升10%。",{type:"elapsed",hours:2600},{movement:1.1,attack:1.1,durationHours:168},"war_scenario"),
];
