import type { ServerRecord } from "./types";

const SERVER_SAVE_KEY = "qingbei-webgl-server-saves-v1";

export function readServerSaves(): ServerRecord[] {
  try {
    return JSON.parse(localStorage.getItem(SERVER_SAVE_KEY) || "[]") as ServerRecord[];
  } catch {
    return [];
  }
}

export function writeServerSaves(records: ServerRecord[]) {
  localStorage.setItem(SERVER_SAVE_KEY, JSON.stringify(records.slice(0, 12)));
}

export function upsertServerSave(record: ServerRecord) {
  const next = [
    record,
    ...readServerSaves().filter((candidate) => candidate.id !== record.id),
  ];
  writeServerSaves(next);
  return next;
}

export function deleteServerSave(id: string) {
  const next = readServerSaves().filter((record) => record.id !== id);
  writeServerSaves(next);
  return next;
}
