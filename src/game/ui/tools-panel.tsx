import type { BattlefieldToolMode } from "../engine/contracts";
import type { Stance } from "../types";

export function ToolsPanel({
  activeTool,
  onTool,
  onMobilize,
  onClose,
}: {
  activeTool: BattlefieldToolMode;
  onTool: (mode: BattlefieldToolMode) => void;
  onMobilize: (stance: Stance) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop tools-backdrop" onClick={onClose}>
      <section className="tools-panel" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2>战场工具</h2>
            <small>工具只改变指挥结构，不改变战斗数值</small>
          </div>
          <button onClick={onClose}>关闭</button>
        </header>
        <article>
          <div className="tool-symbol multi-route" aria-hidden="true"><i /></div>
          <div>
            <h3>多目标兵线</h3>
            <p>启用后，拖动经过多个据点可建立连续路线；默认状态只连接起点和松开位置。</p>
          </div>
          <button
            className={activeTool === "multi-route" ? "active" : ""}
            onClick={() => onTool(activeTool === "multi-route" ? null : "multi-route")}
          >
            {activeTool === "multi-route" ? "退出工具" : "启用工具"}
          </button>
        </article>
        <article>
          <div className="tool-symbol simplify" aria-hidden="true"><i /></div>
          <div>
            <h3>简化兵线</h3>
            <p>进入工具模式后，按住左键划过链式兵线，将A→…→B压缩为A→B。</p>
          </div>
          <button
            className={activeTool === "simplify-lines" ? "active" : ""}
            onClick={() => onTool(activeTool === "simplify-lines" ? null : "simplify-lines")}
          >
            {activeTool === "simplify-lines" ? "退出工具" : "启用工具"}
          </button>
        </article>
        <article className="mobilization-tool">
          <div className="tool-symbol mobilize" aria-hidden="true"><i /></div>
          <div>
            <h3>总动员</h3>
            <p>一次性修改当前阵营全部据点姿态。</p>
          </div>
          <div className="mobilization-actions">
            {(["defend", "guard", "standby"] as Stance[]).map((stance) => (
              <button key={stance} onClick={() => onMobilize(stance)}>
                <span className={`mode-icon ${stance}`} aria-hidden="true" />
                {stance === "defend" ? "防守" : stance === "guard" ? "守卫" : "待命"}
              </button>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
