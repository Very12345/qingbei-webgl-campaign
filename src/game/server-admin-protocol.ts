import type { ServerLogEntry, ServerPlayer, Team } from "./types";

export const SERVER_ADMIN_CHANNEL = "qingbei-server-admin-v1";

export type ServerBattleSummary = {
  online: boolean;
  clock: string;
  players: ServerPlayer[];
  units: Record<Team, number>;
  sites: Record<Team, number>;
  deaths: Record<Team, number>;
  resources: Record<Team, number>;
  outcome?: string;
  logs: ServerLogEntry[];
  inviteCode?: string;
  connectionStatus?: string;
};

export type ServerAdminMessage =
  | { type: "request-state"; serverId: string }
  | { type: "launch"; serverId: string }
  | { type: "stop"; serverId: string }
  | { type: "command"; serverId: string; requestId: string; command: string }
  | { type: "state"; serverId: string; summary: ServerBattleSummary }
  | {
      type: "command-result";
      serverId: string;
      requestId: string;
      ok: boolean;
      output: string;
    };
