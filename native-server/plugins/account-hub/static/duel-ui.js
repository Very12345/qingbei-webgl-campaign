/* Server-specific 1v1 presentation. The shared client and kernel stay unchanged. */
(() => {
  const difficultyNames = { casual: "休闲", standard: "标准", hard: "困难" };
  const teamNames = { pku: "北京大学", thu: "清华大学" };

  function participantCards(state, profile, ownTeam, now = Date.now()) {
    const participants = state?.participants || [];
    const self = participants.find((p) => p.self) || {
      id: profile?.id || "指挥官",
      nickname: profile?.id || "指挥官",
      team: ownTeam,
      self: true,
      status: "joining",
      level: profile?.levels?.[ownTeam] || 1,
      cosmetic: profile?.selectedCosmetics?.[ownTeam] || "",
    };
    const opponent = participants.find((p) => !p.self) || {
      id: state?.mode === "ai" ? "computer" : "waiting",
      nickname:
        state?.mode === "ai"
          ? (difficultyNames[state.difficulty] || "标准") + " AI"
          : "等待对手",
      team: ownTeam === "pku" ? "thu" : "pku",
      status: state?.mode === "ai" ? "ai" : "joining",
      isAI: state?.mode === "ai",
    };
    return [self, opponent].map((p) => {
      let presence =
        p.status === "ai"
          ? "电脑对手"
          : p.status === "online"
            ? "已连接"
            : "正在入场";
      if (p.status === "disconnected")
        presence =
          "重连中 · " +
          Math.max(0, Math.ceil(((p.deadline || now) - now) / 1000)) +
          "秒";
      if (state?.completed)
        presence = state.winner
          ? state.winner === p.team
            ? "本局胜方"
            : "本局结束"
          : "战局中断";
      return { ...p, nickname: p.nickname || p.id, presence };
    });
  }

  // Observe the native relay target; never invent peer IDs or send client-supplied identities.
  function createChatModel({ onChange = () => {} } = {}) {
    const messages = new Map();
    let socket = null,
      target = null,
      closed = false;
    let lastSent = -Infinity;
    function observeOutgoing(raw, transport) {
      if (typeof raw !== "string") return raw;
      try {
        const wire = JSON.parse(raw);
        if (
          wire.type !== "relay" ||
          typeof wire.peerId !== "string" ||
          typeof wire.data !== "string"
        )
          return raw;
        const payload = JSON.parse(wire.data);
        if (
          [
            "hello",
            "ping",
            "client_commands",
            "client_action",
            "chat_send",
          ].includes(payload.type)
        ) {
          socket = transport;
          target = wire.peerId;
        }
        // The native team's channel is not part of this 1v1 plugin's UI.
        if (payload.type === "chat_send") {
          payload.channel = "all";
          wire.data = JSON.stringify(payload);
          return JSON.stringify(wire);
        }
      } catch {
        /* Non-application transport messages pass through. */
      }
      return raw;
    }
    function receive(raw) {
      try {
        const wire = JSON.parse(raw);
        if (wire.type !== "relay") return;
        const payload = JSON.parse(wire.data);
        const batch =
          payload.type === "chat_history"
            ? payload.messages
            : payload.type === "chat_message"
              ? [payload.message]
              : [];
        if (!Array.isArray(batch)) return;
        let changed = false;
        for (const message of batch) {
          if (
            !message ||
            message.channel !== "all" ||
            typeof message.id !== "string" ||
            typeof message.text !== "string"
          )
            continue;
          if (messages.has(message.id)) continue;
          messages.set(message.id, {
            id: message.id,
            text: Array.from(message.text).slice(0, 200).join(""),
            senderName:
              typeof message.senderName === "string"
                ? message.senderName.slice(0, 60)
                : "指挥官",
            senderTeam: message.senderTeam === "thu" ? "thu" : "pku",
          });
          changed = true;
        }
        while (messages.size > 100)
          messages.delete(messages.keys().next().value);
        if (changed) onChange([...messages.values()]);
      } catch {
        /* Simulation packets and malformed data do not affect chat. */
      }
    }
    function send(text, now = Date.now()) {
      const trimmed = Array.from(String(text).trim()).slice(0, 200).join("");
      if (!trimmed) return { ok: false, error: "请先输入消息。" };
      if (closed || !socket || socket.readyState !== 1 || !target)
        return { ok: false, error: "连接尚未就绪，消息未发送。" };
      if (now - lastSent < 2100)
        return { ok: false, error: "发送太快，请稍候。" };
      try {
        socket.send(
          JSON.stringify({
            type: "relay",
            peerId: target,
            data: JSON.stringify({
              type: "chat_send",
              channel: "all",
              text: trimmed,
            }),
          }),
        );
        lastSent = now;
        return { ok: true };
      } catch {
        return { ok: false, error: "连接已中断，消息未发送。" };
      }
    }
    return {
      observeOutgoing,
      receive,
      send,
      close() {
        closed = true;
      },
      messages,
    };
  }

  function mount({ root, team, profile, pluginBase, notify = () => {} }) {
    const get = (id) => root.querySelector("#" + id);
    let matchState = profile.activeMatch,
      connected = false,
      visible = false,
      isOpen = false,
      completed = false,
      lastCount = 0;
    let stateReceivedAt = Date.now();
    const log = get("duel-chat-log"),
      form = get("duel-chat-form"),
      input = get("duel-chat-input");
    const model = createChatModel({
      onChange(messages) {
        const pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 45;
        log.replaceChildren();
        if (!messages.length)
          log.append(
            Object.assign(document.createElement("p"), {
              className: "duel-chat-empty",
              textContent: "向对手打个招呼。",
            }),
          );
        for (const message of messages) {
          const row = document.createElement("p");
          row.className = "duel-message " + message.senderTeam;
          const name = document.createElement("b"),
            text = document.createElement("span");
          name.textContent = message.senderName + "：";
          text.textContent = message.text;
          row.append(name, text);
          log.append(row);
        }
        if (pinned || !isOpen) log.scrollTop = log.scrollHeight;
        if (!isOpen && messages.length > lastCount) {
          get("duel-chat-unread").hidden = false;
          get("duel-chat-toggle").setAttribute(
            "aria-label",
            "全局聊天，有新消息",
          );
        }
        lastCount = messages.length;
      },
    });
    function toggle(open) {
      isOpen = open;
      get("duel-chat-panel").hidden = !open;
      get("duel-chat-toggle").setAttribute("aria-expanded", String(open));
      if (open) {
        get("duel-chat-unread").hidden = true;
        get("duel-chat-toggle").setAttribute("aria-label", "全局聊天");
        log.scrollTop = log.scrollHeight;
        input.focus();
      }
    }
    function paint() {
      const time =
        (matchState?.serverTime || stateReceivedAt) +
        (Date.now() - stateReceivedAt);
      const cards = participantCards(matchState, profile, team, time);
      cards.forEach((p, index) => {
        const slot = index === 0 ? "self" : "opponent",
          card = get("duel-" + slot);
        card.dataset.team = p.team;
        card.dataset.status = p.status;
        get("duel-" + slot + "-name").textContent = p.nickname;
        get("duel-" + slot + "-team").textContent =
          (index === 0 ? "你 · " : "对手 · ") +
          teamNames[p.team] +
          (p.level ? " · Lv." + p.level : "");
        get("duel-" + slot + "-status").textContent = p.presence;
        const avatar = get("duel-" + slot + "-avatar"),
          img = avatar.querySelector("img"),
          seal = avatar.querySelector("span");
        seal.textContent = p.isAI ? "AI" : p.team === "thu" ? "清" : "北";
        const cosmetic =
          /^(pku|thu)-(bronze|gold|service-[1-9][0-9]{1,4})$/.test(
            p.cosmetic || "",
          )
            ? p.cosmetic
            : "";
        if (cosmetic) {
          const source = pluginBase + "/assets/" + cosmetic + ".svg";
          if (img.getAttribute("src") !== source) img.src = source;
          img.hidden = false;
          seal.hidden = true;
        } else {
          img.hidden = true;
          seal.hidden = false;
        }
      });
      get("duel-chat-send").disabled = !connected || completed;
      input.disabled = completed;
      input.placeholder = completed
        ? "战局已结束"
        : matchState?.mode === "ai"
          ? "全局消息（AI 不会回复）"
          : "发送给对手…";
      root.hidden = !visible;
    }
    get("duel-chat-toggle").onclick = () => toggle(!isOpen);
    get("duel-chat-close").onclick = () => toggle(false);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (completed || !connected)
        return notify("连接尚未就绪，消息未发送。", true);
      const result = model.send(input.value);
      if (result.ok) input.value = "";
      else notify(result.error, true);
    });
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isOpen) {
        event.preventDefault();
        toggle(false);
      }
      event.stopPropagation();
    });
    input.addEventListener("keydown", (event) => {
      if (event.isComposing && event.key === "Enter") event.preventDefault();
    });
    const timer = setInterval(paint, 1000);
    paint();
    return {
      outgoing: (raw, socket) => model.observeOutgoing(raw, socket),
      incoming: (raw) => model.receive(raw),
      state(value) {
        matchState = value;
        stateReceivedAt = Date.now();
        paint();
      },
      connected(value) {
        connected = value;
        paint();
      },
      show() {
        if (!visible) {
          // Join the client's stacking context so its full-screen research,
          // decision and settings layers naturally cover this battle-only HUD.
          // This is a plugin DOM adapter; the shared client source stays intact.
          const shell = document.querySelector(".game-shell");
          if (shell && root.parentElement !== shell) shell.append(root);
          visible = true;
          document.body.classList.add("plugin-duel-active");
          paint();
        }
      },
      finish() {
        completed = true;
        model.close();
        clearInterval(timer);
        paint();
      },
    };
  }
  globalThis.QingbeiDuel = { participantCards, createChatModel, mount };
})();
