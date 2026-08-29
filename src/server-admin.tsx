import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  SERVER_ADMIN_CHANNEL,
  type ServerAdminMessage,
  type ServerBattleSummary,
} from "./game/server-admin-protocol";
import { readServerSaves, upsertServerSave } from "./game/server-storage";
import { readSaves } from "./game/storage";
import type { ServerRecord, Snapshot } from "./game/types";
import "./server-admin.css";

const serverIdFromUrl = () => new URLSearchParams(location.search).get("id");

function ServerAdmin() {
  const [serverId, setServerId] = useState(serverIdFromUrl());
  const [servers, setServers] = useState(readServerSaves());
  const [server, setServer] = useState<ServerRecord | null>(() =>
    readServerSaves().find((item) => item.id === serverIdFromUrl()) ?? null,
  );
  const [playerSaves] = useState<Snapshot[]>(readSaves());
  const [summary, setSummary] = useState<ServerBattleSummary | null>(null);
  const [command, setCommand] = useState("");
  const [consoleLines, setConsoleLines] = useState<string[]>([
    "服务器控制台已就绪。输入 help 查看指令。",
  ]);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    const channel = new BroadcastChannel(SERVER_ADMIN_CHANNEL);
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<ServerAdminMessage>) => {
      const message = event.data;
      if (message.serverId !== serverId) return;
      if (message.type === "state") {
        setSummary(message.summary);
        const latest = readServerSaves();
        setServers(latest);
        setServer(latest.find((item) => item.id === serverId) ?? null);
      }
      if (message.type === "command-result")
        setConsoleLines((lines) => [
          ...lines,
          `${message.ok ? ">" : "!"} ${message.output}`,
        ].slice(-200));
    };
    if (serverId) channel.postMessage({ type: "request-state", serverId });
    const timer = window.setInterval(() => {
      if (serverId)
        channel.postMessage({ type: "request-state", serverId });
    }, 1500);
    return () => {
      clearInterval(timer);
      channel.close();
      channelRef.current = null;
    };
  }, [serverId]);

  const saveConfiguration = () => {
    if (!server) return;
    const next = { ...server, updatedAt: Date.now() };
    setServers(upsertServerSave(next));
    setServer(next);
    setConsoleLines((lines) => [...lines, "> 配置已保存"]);
  };
  const selectMap = (savedAt: number | "current") => {
    if (!server || savedAt === "current") return;
    const map = playerSaves.find((save) => save.savedAt === savedAt);
    if (map) setServer({ ...server, map: structuredClone(map) });
  };
  const sendCommand = () => {
    const text = command.trim();
    if (!text || !serverId) return;
    const requestId = crypto.randomUUID();
    setConsoleLines((lines) => [...lines, `$ ${text}`].slice(-200));
    channelRef.current?.postMessage({
      type: "command",
      serverId,
      requestId,
      command: text,
    } satisfies ServerAdminMessage);
    setCommand("");
  };
  const logs = summary?.logs ?? server?.logs ?? [];
  const outcome = summary?.outcome || "进行中";

  if (!serverId || !server)
    return (
      <main className="server-admin-shell server-picker">
        <h1>选择服务器</h1>
        {servers.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              history.replaceState(null, "", `?id=${item.id}`);
              setServerId(item.id);
              setServer(item);
            }}
          >
            {item.name}
          </button>
        ))}
        {!servers.length && <p>请先在游戏主页面创建服务器。</p>}
      </main>
    );

  return (
    <main className="server-admin-shell">
      <aside className="server-config-sidebar">
        <header>
          <small>服务器控制台</small>
          <h1>{server.name}</h1>
        </header>
        <label>
          <span>服务器名称</span>
          <input
            value={server.name}
            maxLength={24}
            onChange={(event) => setServer({ ...server, name: event.target.value })}
          />
        </label>
        <label>
          <span>最大玩家</span>
          <input
            type="number"
            min={2}
            max={8}
            value={server.maxPlayers}
            onChange={(event) =>
              setServer({ ...server, maxPlayers: Number(event.target.value) })
            }
          />
        </label>
        <label>
          <span>地图存档</span>
          <select defaultValue="current" onChange={(event) => selectMap(Number(event.target.value))}>
            <option value="current">当前：{server.map.name}</option>
            {playerSaves.map((save) => (
              <option key={save.savedAt} value={save.savedAt}>{save.name}</option>
            ))}
          </select>
        </label>
        <label className="server-check">
          <input
            type="checkbox"
            checked={server.allowSameTeam}
            onChange={(event) =>
              setServer({ ...server, allowSameTeam: event.target.checked })
            }
          />
          <span>后续玩家允许同阵营</span>
        </label>
        <label>
          <span>TURN中继地址</span>
          <textarea
            rows={3}
            value={(server.turnServer?.urls ?? []).join("\n")}
            placeholder={"turn:example.com:3478\nturns:example.com:5349"}
            onChange={(event) =>
              setServer({
                ...server,
                turnServer: {
                  urls: event.target.value
                    .split(/[\n,]+/)
                    .map((value) => value.trim())
                    .filter(Boolean),
                  username: server.turnServer?.username ?? "",
                  credential: server.turnServer?.credential ?? "",
                },
              })
            }
          />
        </label>
        <label>
          <span>TURN用户名</span>
          <input
            value={server.turnServer?.username ?? ""}
            onChange={(event) =>
              setServer({
                ...server,
                turnServer: {
                  urls: server.turnServer?.urls ?? [],
                  username: event.target.value,
                  credential: server.turnServer?.credential ?? "",
                },
              })
            }
          />
        </label>
        <label>
          <span>TURN凭据</span>
          <input
            type="password"
            value={server.turnServer?.credential ?? ""}
            onChange={(event) =>
              setServer({
                ...server,
                turnServer: {
                  urls: server.turnServer?.urls ?? [],
                  username: server.turnServer?.username ?? "",
                  credential: event.target.value,
                },
              })
            }
          />
        </label>
        <small>跨网络或开启客户端隔离的Wi‑Fi需要TURN；留空时仅尝试直连。修改后需停止并重新启动服务器。</small>
        <button onClick={saveConfiguration}>保存配置</button>
        <button
          className="server-launch"
          onClick={() =>
            channelRef.current?.postMessage(
              summary?.online
                ? ({ type: "stop", serverId } satisfies ServerAdminMessage)
                : ({ type: "launch", serverId } satisfies ServerAdminMessage),
            )
          }
        >
          {summary?.online ? "停止服务器" : "启动服务器"}
        </button>
        <section className="server-invite-box">
          <h2>房间码</h2>
          <textarea
            readOnly
            value={summary?.inviteCode ?? ""}
            placeholder="启动并选择阵营后自动生成"
          />
          <button
            onClick={() => {
              const requestId = crypto.randomUUID();
              channelRef.current?.postMessage({
                type: "command",
                serverId,
                requestId,
                command: "invite",
              } satisfies ServerAdminMessage);
            }}
          >
            显示或刷新自动房间码
          </button>
          <small>{summary?.connectionStatus ?? "服务器离线"}</small>
        </section>
        <section className="server-player-box">
          <h2>当前玩家</h2>
          {(summary?.players ?? server.players).map((player) => (
            <div key={player.id}>
              <b>{player.nickname}</b>
              <span>{player.team === "pku" ? "北大" : "清华"}</span>
              {player.host && <small>主机</small>}
              {player.local && <small>本机</small>}
            </div>
          ))}
          {!(summary?.players ?? server.players).length && <p>暂无在线玩家</p>}
        </section>
      </aside>
      <section className="server-console-area">
        <header className="server-status-grid">
          <article><span>状态</span><strong>{summary?.online ? "在线" : "离线"}</strong></article>
          <article><span>时间</span><strong>{summary?.clock ?? "--"}</strong></article>
          <article><span>战局</span><strong>{outcome}</strong></article>
          <article><span>兵力</span><strong>{summary ? `${summary.units.pku} / ${summary.units.thu}` : "--"}</strong></article>
          <article><span>据点</span><strong>{summary ? `${summary.sites.pku} / ${summary.sites.thu}` : "--"}</strong></article>
          <article><span>阵亡</span><strong>{summary ? `${summary.deaths.pku} / ${summary.deaths.thu}` : "--"}</strong></article>
        </header>
        <div className="server-console-columns">
          <section className="server-log-view">
            <h2>服务器记录</h2>
            {logs.slice(-120).map((entry) => (
              <p key={entry.id} className={entry.category}>
                <time>{new Date(entry.at).toLocaleTimeString("zh-CN")}</time>
                <b>{entry.category}</b>
                <span>{entry.text}</span>
              </p>
            ))}
            {!logs.length && <p>暂无玩家消息、进入记录或战况记录。</p>}
          </section>
          <section className="server-command-console">
            <h2>API控制台</h2>
            <div className="server-command-output">
              {consoleLines.map((line, index) => <code key={`${index}-${line}`}>{line}</code>)}
            </div>
            <div className="server-command-input">
              <span>$</span>
              <input
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && sendCommand()}
                placeholder="help"
              />
              <button onClick={sendCommand}>执行</button>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("server-root")!).render(
  <StrictMode><ServerAdmin /></StrictMode>,
);
