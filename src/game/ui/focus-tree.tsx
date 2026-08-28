import { useEffect, useRef, type ReactNode } from "react";
import { DECISIONS, type DecisionDefinition } from "../../campaign-content";
import type { CampaignState, Team } from "../types";

const branchMark = (branch: string) =>
  ({
    思想与校园动员: "思",
    基础科学: "理",
    燕园防务: "防",
    后勤治理: "勤",
    工程体系: "工",
    学堂传统: "学",
    校园防务: "卫",
    后勤健康: "健",
  })[branch] ?? branch.slice(0, 1);

type FocusTreeProps = {
  team: Team;
  campaign: CampaignState;
  resources: number;
  zoom: number;
  setZoom: (updater: (value: number) => number) => void;
  renderNode: (item: DecisionDefinition) => ReactNode;
  onCancelDecision: () => void;
  onClose: () => void;
};

export function FocusTree({
  team,
  campaign,
  resources,
  zoom,
  setZoom,
  renderNode,
  onCancelDecision,
  onClose,
}: FocusTreeProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollLeft = Math.max(
      0,
      (viewport.scrollWidth - viewport.clientWidth) / 2,
    );
  }, []);

  const active = campaign.decisions.active[team];
  return (
    <div className={`focus-tree-screen ${team}`}>
      <header className="focus-tree-topbar">
        <div className="focus-tree-school-mark">
          <span>{team === "pku" ? "北" : "清"}</span>
          <div>
            <h2>{team === "pku" ? "北京大学" : "清华大学"}战略决策</h2>
            <small>国策树 · 同时只能推进一个决策</small>
          </div>
        </div>
        <div className="focus-tree-resources">
          <span>战略资源</span>
          <strong>{Math.floor(resources)}</strong>
          {active ? (
            <span>
              进行中：
              {DECISIONS.find((item) => item.id === active.id)?.title ??
                "未知决策"}
            </span>
          ) : (
            <span>当前无进行中决策</span>
          )}
        </div>
        <div className="focus-tree-tools">
          <button
            aria-label="缩小决策树"
            onClick={() => setZoom((value) => Math.max(0.65, value - 0.1))}
          >
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            aria-label="放大决策树"
            onClick={() => setZoom((value) => Math.min(1.35, value + 0.1))}
          >
            +
          </button>
          <button className="focus-tree-close" onClick={onClose}>
            关闭
          </button>
        </div>
      </header>
      <div
        ref={viewportRef}
        className="focus-tree-viewport"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          const viewport = event.currentTarget;
          viewport.setPointerCapture(event.pointerId);
          dragRef.current = {
            x: event.clientX,
            y: event.clientY,
            left: viewport.scrollLeft,
            top: viewport.scrollTop,
          };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId))
            return;
          event.currentTarget.scrollLeft = drag.left - (event.clientX - drag.x);
          event.currentTarget.scrollTop = drag.top - (event.clientY - drag.y);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          dragRef.current = null;
        }}
        onPointerCancel={() => (dragRef.current = null)}
      >
        <div
          className="focus-tree-canvas"
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: "top center",
            width: `${100 / zoom}%`,
          }}
        >
          {[
            ...new Set(
              DECISIONS.filter((item) => item.team === team).map(
                (item) => item.branch,
              ),
            ),
          ].map((branch) => {
            const items = DECISIONS.filter(
              (item) => item.team === team && item.branch === branch,
            );
            return (
              <section className="focus-lane" key={branch}>
                <header>
                  <span>{branchMark(branch)}</span>
                  <h3>{branch}</h3>
                </header>
                <div className="focus-chain">
                  {items[0] && renderNode(items[0])}
                  <i className="focus-line vertical" />
                  {items[1] && renderNode(items[1])}
                  <div className="focus-fork-lines" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </div>
                  <div className="focus-fork-nodes">
                    {items[2] && renderNode(items[2])}
                    {items[3] && renderNode(items[3])}
                  </div>
                  <div className="focus-merge-lines" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </div>
                  {items[4] && renderNode(items[4])}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      <footer className="focus-tree-footer">
        <span>拖动画布查看路线 · 金色可选 · 绿色完成 · 红色互斥</span>
        {active && <button onClick={onCancelDecision}>取消当前决策（返还50%资源）</button>}
      </footer>
    </div>
  );
}
