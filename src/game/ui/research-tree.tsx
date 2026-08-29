import { RESEARCH_DEFINITIONS, type ResearchId } from "../research";
import type { CampaignState, Team } from "../types";

export function ResearchTree({
  team,
  campaign,
  resources,
  onStart,
  onClose,
}: {
  team: Team;
  campaign: CampaignState;
  resources: number;
  onStart: (id: ResearchId) => void;
  onClose: () => void;
}) {
  const active = campaign.research.active[team];
  return (
    <div className={`focus-tree-screen research-tree-screen ${team}`}>
      <header className="focus-tree-topbar">
        <div className="focus-tree-school-mark">
          <span>研</span>
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
      <main className="research-tree-canvas">
        {(Object.keys(RESEARCH_DEFINITIONS) as ResearchId[]).map((id) => {
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
            <article className={`research-node ${id} ${completed ? "completed" : ""}`} key={id}>
              <div className={`research-vehicle-icon ${id}`} aria-hidden="true" />
              <h3>{definition.title}</h3>
              <p>{definition.description}</p>
              <dl>
                <div><dt>研发</dt><dd>{definition.cost}资源 / {definition.hours}小时</dd></div>
                <div><dt>配置</dt><dd>{definition.deploymentCost}资源</dd></div>
                <div><dt>冷却</dt><dd>{definition.cooldownHours}小时</dd></div>
              </dl>
              <div className="research-progress"><i style={{ width: `${progress * 100}%` }} /></div>
              <button
                disabled={completed || !!active || resources < definition.cost}
                onClick={() => onStart(id)}
              >
                {completed ? "已完成" : researching ? "研发中" : "开始研发"}
              </button>
            </article>
          );
        })}
      </main>
    </div>
  );
}
