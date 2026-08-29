import type { Team } from "./types";

const SIGNALING_BASE_URL = (
  import.meta.env.VITE_SIGNALING_BASE_URL || "https://ntfy.sh"
).replace(/\/$/, "");

export type AutomaticSignalMessage =
  | {
      kind: "join";
      senderId: string;
      clientId: string;
      nickname: string;
      sentAt: number;
    }
  | {
      kind: "offer";
      senderId: string;
      clientId: string;
      invite: unknown;
      sentAt: number;
    }
  | {
      kind: "answer";
      senderId: string;
      clientId: string;
      sdp: RTCSessionDescriptionInit;
      team: Team;
      sentAt: number;
    }
  | {
      kind: "accepted";
      senderId: string;
      clientId: string;
      sentAt: number;
    };

export const normalizeRoomCode = (value: string) =>
  value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);

export const createRoomCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
    bytes = crypto.getRandomValues(new Uint8Array(10));
  let raw = "";
  for (const byte of bytes) raw += alphabet[byte % alphabet.length];
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
};

const topicFor = (roomCode: string) =>
  `qingbei-${normalizeRoomCode(roomCode).toLowerCase()}`;

export const publishAutomaticSignal = async (
  roomCode: string,
  message: AutomaticSignalMessage,
) => {
  const response = await fetch(`${SIGNALING_BASE_URL}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: topicFor(roomCode),
      message: JSON.stringify(message),
    }),
  });
  if (!response.ok) throw new Error(`信令服务不可用（${response.status}）`);
};

export const subscribeAutomaticSignals = (
  roomCode: string,
  listener: (message: AutomaticSignalMessage) => void,
) => {
  const source = new EventSource(
    `${SIGNALING_BASE_URL}/${topicFor(roomCode)}/sse`,
  );
  source.onmessage = (event) => {
    try {
      const envelope = JSON.parse(event.data) as {
          event?: string;
          message?: string;
        },
        payload = envelope.message
          ? (JSON.parse(envelope.message) as AutomaticSignalMessage)
          : null;
      if (payload?.kind) listener(payload);
    } catch {
      // Ignore unrelated or malformed public-topic messages.
    }
  };
  return source;
};
