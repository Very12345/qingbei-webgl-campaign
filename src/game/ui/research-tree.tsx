import { useState } from "react";
import {
  RESEARCH_DEFINITIONS,
  researchIdsForTeam,
  type ResearchId,
} from "../research";
import type { CampaignState, Team } from "../types";

export function ResearchTree({
  team,
  campaign,
  resources,
  onStart,
  onProduce,
  onClose,
}: {
  team: Team;
  campaign: CampaignState;
  resources: number;
  onStart: (id: ResearchId) => void;
  onProduce: (id: ResearchId) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"research" | "production">("research");
  const active = campaign.research.active[team];
  const production = campaign.research.production[team];
  const branches: ResearchId[][] =
    team === "pku"
      ? [
          ["pku_bike", "pku_slogan_bike", "pku_phone_bike"],
          ["bus", "large_bus"],
        ]
      : [
          ["thu_bike", "thu_purple_bike"],
          ["bus", "large_bus"],
        ];
  const renderResearchNode = (id: ResearchId) => {
    const definition = RESEARCH_DEFINITIONS[id],
      completed = campaign.research.completed[team].includes(id),
      researching = active?.id === id,
      progress = researching
        ? Math.max(
            0,
            Math.min(
              1,
              (campaign.elapsedHours - active.startedAt) /
                (active.completesAt - active.startedAt),
            ),
          )
        : completed
          ? 1
          : 0;
    return (
      <article
        className={`research-node ${id} ${completed ? "completed" : ""}`}
        key={id}
      >
        <div className={`research-vehicle-icon ${id}`} aria-hidden="true" />
        <div className="research-node-copy">
          <h3>{definition.title}</h3>
          <p>{definition.description}</p>
        </div>
        <dl>
          <div><dt>研发</dt><dd>{definition.cost} / {definition.hours}时</dd></div>
          <div><dt>生产</dt><dd>{definition.deploymentCost} / {definition.productionHours}时</dd></div>
        </dl>
        <div className="research-progress"><i style={{ width: `${progress * 100}%` }} /></div>
        <button
          disabled={
            completed ||
            !!active ||
            resources < definition.cost ||
            !definition.requires.every((required) =>
              campaign.research.completed[team].includes(required),
            )
          }
          onClick={() => onStart(id)}
        >
          {completed ? "已完成" : researching ? "研发中" : "研发"}
        </button>
      </article>
    );
  };
  return (
    <div className={`focus-tree-screen research-tree-screen ${team}`}>
      <header className="focus-tree-topbar">
        <div className="focus-tree-school-mark">
          <span className="research-header-emblem" aria-hidden="true">
            <i />
          </span>
          <div>
            <h2>校园装备研发</h2>
            <small>研发完成后，装备会按道路条件和冷却时间配置到据点</small>
          </div>
        </div>
        <div className="focus-tree-resources">
          <span>战略资源</span>
          <strong>{Math.floor(resources)}</strong>
          <span>{active ? `研发中：${RESEARCH_DEFINITIONS[active.id].title}` : "当前无研发"}</span>
        </div>
        <button className="focus-tree-close" onClick={onClose}>关闭</button>
      </header>
      <nav className="research-tabs">
        <button className={tab === "research" ? "active" : ""} onClick={() => setTab("research")}>
          科技研发
        </button>
        <button className={tab === "production" ? "active" : ""} onClick={() => setTab("production")}>
          装备生产
        </button>
      </nav>
      {tab === "research" ? (
        <main className="research-tree-canvas">
          {branches.map((branch) => (
            <section className="research-branch" key={branch[0]}>
              {branch.map((id, index) => (
                <div className="research-branch-step" key={id}>
                  {index > 0 && (
                    <i className="research-branch-line" aria-hidden="true" />
                  )}
                  {renderResearchNode(id)}
                </div>
              ))}
            </section>
          ))}
        </main>
      ) : (
        <main className="research-tree-canvas production-tree-canvas">
          {researchIdsForTeam(team).map((id) => {
            const definition = RESEARCH_DEFINITIONS[id],
              unlocked = campaign.research.completed[team].includes(id),
              producing = production?.researchId === id,
              progress = producing
                ? Math.max(
                    0,
                    Math.min(
                      1,
                      (campaign.elapsedHours - production.startedAt) /
                        (production.completesAt - production.startedAt),
                    ),
                  )
                : 0;
            return (
              <article className={`research-node production-node ${id}`} key={id}>
                <div className={`research-vehicle-icon ${id}`} aria-hidden="true" />
                <h3>{definition.title}</h3>
                <p>库存：{campaign.research.stockpile[team][id]}</p>
                <p>
                  每批消耗 {definition.deploymentCost} 资源，耗时 {definition.productionHours} 小时，
                  产出 {definition.productionQuantity} 件。
                </p>
                <div className="research-progress"><i style={{ width: `${progress * 100}%` }} /></div>
                <button
                  disabled={!unlocked || !!production || resources < definition.deploymentCost}
                  onClick={() => onProduce(id)}
                >
                  {!unlocked ? "尚未研发" : producing ? "生产中" : "加入生产"}
                </button>
              </article>
            );
          })}
        </main>
      )}
    </div>
  );
}
