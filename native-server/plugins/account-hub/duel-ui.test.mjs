import assert from "node:assert/strict";
import test from "node:test";
import "./static/duel-ui.js";
const { participantCards, createChatModel } = globalThis.QingbeiDuel;
const wire = (payload) =>
  JSON.stringify({
    type: "relay",
    peerId: "kernel-peer",
    data: JSON.stringify(payload),
  });

test("duel names use authoritative participants and identify AI explicitly", () => {
  const cards = participantCards(
    {
      participants: [
        {
          id: "opponent",
          nickname: "Opponent",
          team: "thu",
          status: "disconnected",
          deadline: 42000,
        },
        {
          id: "my-id",
          nickname: "Me",
          team: "pku",
          self: true,
          status: "online",
        },
      ],
    },
    { id: "my-id" },
    "pku",
    2000,
  );
  assert.equal(cards[0].nickname, "Me");
  assert.equal(cards[1].nickname, "Opponent");
  assert.match(cards[1].presence, /40秒/);
  const ai = participantCards(
    { mode: "ai", difficulty: "hard" },
    { id: "my-id" },
    "thu",
  );
  assert.equal(ai[1].nickname, "困难 AI");
  assert.equal(ai[1].team, "pku");
  assert.equal(ai[1].isAI, true);
});

test("chat observes native relay target, uses all channel and waits for server echo", () => {
  const sent = [],
    changes = [],
    socket = { readyState: 1, send: (value) => sent.push(JSON.parse(value)) },
    chat = createChatModel({ onChange: (rows) => changes.push(rows) });
  assert.equal(chat.send("hello", 0).ok, false);
  chat.observeOutgoing(wire({ type: "hello" }), socket);
  assert.equal(chat.send("hello", 0).ok, true);
  assert.equal(sent[0].peerId, "kernel-peer");
  assert.deepEqual(JSON.parse(sent[0].data), {
    type: "chat_send",
    channel: "all",
    text: "hello",
  });
  assert.equal(changes.length, 0);
  chat.receive(
    wire({
      type: "chat_message",
      message: {
        id: "1",
        channel: "all",
        senderName: "Me",
        senderTeam: "pku",
        text: "hello",
      },
    }),
  );
  chat.receive(
    wire({
      type: "chat_history",
      messages: [
        { id: "1", channel: "all", text: "hello" },
        { id: "private", channel: "team", text: "private" },
      ],
    }),
  );
  assert.equal(changes.length, 1);
  assert.equal(chat.messages.size, 1);
  assert.equal(chat.send("too fast", 1000).ok, false);
  chat.close();
  assert.equal(chat.send("after result", 5000).ok, false);
});

test("obsolete native team UI cannot emit a team chat through this plugin", () => {
  const chat = createChatModel(),
    socket = { readyState: 1, send() {} };
  const outgoing = chat.observeOutgoing(
    wire({ type: "chat_send", channel: "team", text: "hello" }),
    socket,
  );
  assert.equal(JSON.parse(JSON.parse(outgoing).data).channel, "all");
  const command = wire({
    type: "client_commands",
    intent: "player",
    revision: 42,
    sites: [],
  });
  assert.equal(chat.observeOutgoing(command, socket), command);
  socket.readyState = 3;
  assert.equal(chat.send("offline").ok, false);
});

test("chat history is bounded and invalid traffic is ignored", () => {
  const chat = createChatModel();
  chat.receive("not-json");
  chat.receive(wire({ type: "state", game: {} }));
  chat.receive(
    wire({
      type: "chat_history",
      messages: Array.from({ length: 130 }, (_, id) => ({
        id: String(id),
        channel: "all",
        text: "x".repeat(250),
      })),
    }),
  );
  assert.equal(chat.messages.size, 100);
  assert.equal(chat.messages.values().next().value.text.length, 200);
});
