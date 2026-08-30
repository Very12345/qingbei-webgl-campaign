import type { Team } from "./types";

type RelayWireMessage =
  | { type: "peer_join"; peerId: string; team: Team }
  | { type: "peer_leave"; peerId: string }
  | { type: "ready"; peerId: string }
  | { type: "relay"; peerId: string; data: string }
  | { type: "server_command"; message: string }
  | { type: "error"; message: string };

export class RelayDataChannel {
  readyState: RTCDataChannelState = "connecting";
  bufferedAmount = 0;
  onopen: ((event: Event) => unknown) | null = null;
  onclose: ((event: Event) => unknown) | null = null;
  onmessage: ((event: MessageEvent<string>) => unknown) | null = null;

  constructor(
    readonly peerId: string,
    private readonly sendFrame: (peerId: string, data: string) => void,
    private readonly closePeer: (peerId: string) => void,
  ) {}

  open() {
    if (this.readyState !== "connecting") return;
    this.readyState = "open";
    queueMicrotask(() => this.onopen?.(new Event("open")));
  }

  send(data: string) {
    if (this.readyState !== "open") throw new Error("Relay channel is not open");
    this.sendFrame(this.peerId, data);
  }

  receive(data: string) {
    if (this.readyState !== "open") return;
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  close() {
    if (this.readyState === "closed") return;
    this.readyState = "closing";
    this.closePeer(this.peerId);
    this.finishClose();
  }

  finishClose() {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.onclose?.(new Event("close"));
  }
}

export type NetworkChannel = RTCDataChannel | RelayDataChannel;

export class LocalRelayHub {
  private socket: WebSocket | null = null;
  private channels = new Map<string, RelayDataChannel>();

  constructor(
    private readonly role: "host" | "guest",
    private readonly roomCode: string,
    private readonly team: Team | null,
    private readonly onChannel: (channel: RelayDataChannel, team?: Team) => void,
    private readonly onStatus: (status: string) => void,
    private readonly onServerCommand?: (
      command: string,
    ) => string | Promise<string>,
  ) {}

  connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:",
      params = new URLSearchParams({ role: this.role, room: this.roomCode });
    if (this.team) params.set("team", this.team);
    this.socket = new WebSocket(`${protocol}//${location.host}/ws?${params}`);
    this.socket.onopen = () => this.onStatus("本地TCP中继已连接");
    this.socket.onerror = () => this.onStatus("无法连接本地服务器WebSocket");
    this.socket.onclose = () => {
      this.channels.forEach((channel) => channel.finishClose());
      this.channels.clear();
      this.onStatus("本地服务器连接已关闭");
    };
    this.socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as RelayWireMessage;
        if (message.type === "error") {
          this.onStatus(message.message);
          return;
        }
        if (
          message.type === "server_command" &&
          this.role === "host" &&
          this.onServerCommand
        ) {
          void Promise.resolve(this.onServerCommand(message.message))
            .then((result) =>
              this.socket?.send(
                JSON.stringify({
                  type: "server_command_result",
                  message: result,
                }),
              ),
            )
            .catch((error) =>
              this.socket?.send(
                JSON.stringify({
                  type: "server_command_result",
                  message:
                    error instanceof Error ? error.message : "命令执行失败",
                }),
              ),
            );
          return;
        }
        if (message.type === "peer_join" && this.role === "host") {
          const channel = this.createChannel(message.peerId);
          this.onChannel(channel, message.team);
          channel.open();
          return;
        }
        if (message.type === "ready" && this.role === "guest") {
          const channel = this.createChannel(message.peerId);
          this.onChannel(channel);
          channel.open();
          return;
        }
        if (message.type === "peer_leave") {
          this.channels.get(message.peerId)?.finishClose();
          this.channels.delete(message.peerId);
          return;
        }
        if (message.type === "relay")
          this.channels.get(message.peerId)?.receive(message.data);
      } catch {
        this.onStatus("本地服务器返回了无效数据");
      }
    };
  }

  close() {
    this.socket?.close();
    this.socket = null;
  }

  private createChannel(peerId: string) {
    const existing = this.channels.get(peerId);
    if (existing) return existing;
    const channel = new RelayDataChannel(
      peerId,
      (targetId, data) =>
        this.socket?.send(
          JSON.stringify({ type: "relay", peerId: targetId, data }),
        ),
      (targetId) =>
        this.socket?.send(
          JSON.stringify({ type: "close_peer", peerId: targetId }),
        ),
    );
    this.channels.set(peerId, channel);
    return channel;
  }
}

export const localRoomStatus = async (roomCode = "") => {
  const query = roomCode ? `?code=${encodeURIComponent(roomCode)}` : "";
  const response = await fetch(`/api/room${query}`);
  if (!response.ok)
    throw new Error(
      roomCode ? "本地服务器中没有这个房间" : "这台服务器尚未启动战局",
    );
  return (await response.json()) as {
    online: boolean;
    roomCode: string;
    counts: Record<Team, number>;
    players: number;
  };
};
