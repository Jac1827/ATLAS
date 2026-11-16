(function (root) {
  "use strict";
  let communities = [],
    rows = [],
    selected = null,
    detail = null,
    messages = [],
    busy = false,
    requestGeneration = 0,
    queueGeneration = 0,
    sendKey = null;
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const api = (...args) => root.AtlasCommunicationAlerts.request(...args);
  function render() {
    queueMicrotask(() => void mount());
    return `<section id="rc-workspace" aria-label="Resident Communications"><h2>Resident Communications</h2><p role="status">Loading your authorized queue…</p></section>`;
  }
  function shell() {
    return `<h2 tabindex="-1" id="rc-title">Resident Communications</h2><p>Shared resident email and SMS queue</p><div id="rc-status" role="status" aria-live="polite"></div><form id="rc-filters" class="rc-filters"><label>Community<select name="community"><option value="">All authorized communities</option></select></label><label>Resident ID<input name="resident" autocomplete="off" placeholder="Canonical resident identifier"></label><label>Channel<select name="channel"><option value="">All channels</option><option>email</option><option>sms</option></select></label><label>Status<select name="status"><option value="">All statuses</option><option>open</option><option>pending</option><option>resolved</option><option>snoozed</option></select></label><label>Assignee ID<input name="assignee" inputmode="numeric"></label><label>Attention<select name="attention"><option value="">All conversations</option><option value="unread">Unread</option><option value="alerts">Requires attention</option><option value="urgent">Urgent</option><option value="failed">Failed delivery</option></select></label><button type="submit" class="cs-btn">Apply filters</button><button type="button" id="rc-export" class="cs-btn">Export community metadata</button></form><div class="rc-layout"><div id="rc-queue" aria-label="Conversation queue"></div><article id="rc-detail" aria-label="Selected conversation"><p>Select a conversation.</p></article></div><details><summary>Start a conversation</summary><form id="rc-create"><label>Community<select required name="community_id"><option value="">Choose community</option></select></label><label>Canonical resident ID<input required name="resident_id"></label><label>Current lease ID<input required name="lease_id"></label><label>Channel<select name="channel"><option>email</option><option>sms</option></select></label><button class="cs-btn" type="submit">Sync identity and open conversation</button></form></details><details><summary>Reminder settings</summary><form id="rc-policy"><label>Community<select name="community_id" required><option value="">Choose community</option></select></label><label>Channel<select name="channel"><option>email</option><option>sms</option></select></label><label>First response threshold in minutes<input name="first_response_minutes" type="number" min="1" required></label><label>Follow-up threshold in minutes<input name="follow_up_minutes" type="number" min="1" required></label><button type="button" id="rc-policy-load" class="cs-btn">Load settings</button><button type="submit" class="cs-btn">Save reminder thresholds</button><p id="rc-policy-context"></p></form></details>`;
  }
  function status(text, error = false) {
    const el = document.getElementById("rc-status");
    if (el) {
      el.textContent = text;
      el.setAttribute("role", error ? "alert" : "status");
    }
  }
  async function mount() {
    const host = document.getElementById("rc-workspace");
    if (!host || host.dataset.mounted) return;
    host.dataset.mounted = "true";
    host.innerHTML = shell();
    host.querySelector("#rc-filters").addEventListener("submit", (event) => {
      event.preventDefault();
      void load();
    });
    host.querySelector("#rc-queue").addEventListener("click", (event) => {
      const button = event.target.closest("[data-conversation]");
      if (button) void open(Number(button.dataset.conversation));
    });
    host
      .querySelector("#rc-create")
      .addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = event.submitter;
        button.disabled = true;
        try {
          const body = Object.fromEntries(new FormData(event.target));
          await api("/contacts/sync", "POST", body);
          const result = await api("/conversations", "POST", body);
          const policyForm = host.querySelector("#rc-policy");
          policyForm?.addEventListener("submit", async (event) => {
            event.preventDefault();
            const body = Object.fromEntries(new FormData(policyForm));
            body.first_response_minutes = Number(body.first_response_minutes);
            body.follow_up_minutes = Number(body.follow_up_minutes);
            try {
              await api("/policies", "PATCH", body);
              status(
                "Reminder thresholds saved for this community and channel.",
              );
            } catch (error) {
              status(error.message, true);
            }
          });
          host
            .querySelector("#rc-policy-load")
            ?.addEventListener("click", async () => {
              const body = Object.fromEntries(new FormData(policyForm));
              try {
                const { policy } = await api(
                  `/policies?community_id=${encodeURIComponent(body.community_id)}&channel=${body.channel}`,
                );
                policyForm.elements.first_response_minutes.value =
                  policy.first_response_minutes || "";
                policyForm.elements.follow_up_minutes.value =
                  policy.follow_up_minutes || "";
                host.querySelector("#rc-policy-context").textContent =
                  `Timezone: ${policy.timezone || "Unverified"}. SMS quiet hours: 19:00 to ${policy.morning_resume || "Not configured"}. Routing and quiet hours require operator approval.`;
              } catch (error) {
                status(error.message, true);
              }
            });
          await load();
          await open(result.conversation.id);
        } catch (error) {
          status(error.message, true);
        } finally {
          button.disabled = false;
        }
      });
    host.querySelector("#rc-export").addEventListener("click", async () => {
      try {
        const community = host.querySelector("[name=community]").value;
        if (!community)
          throw new Error("Choose a canonical community ID before exporting.");
        const result = await api("/exports", "POST", {
          community_id: community,
        });
        const blob = new Blob([JSON.stringify(result, null, 2)], {
            type: "application/json",
          }),
          url = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = url;
        a.download = "resident-communication-metadata.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        status(
          result.truncated
            ? "Export reached its limit. Narrow the scope."
            : "Community metadata exported.",
        );
      } catch (error) {
        status(error.message, true);
      }
    });
    try {
      const generation = requestGeneration;
      const result = await api("/communities");
      if (generation !== requestGeneration || !host.isConnected) return;
      communities = result.communities || [];
      host
        .querySelectorAll("select[name=community],select[name=community_id]")
        .forEach((select) => {
          select.insertAdjacentHTML(
            "beforeend",
            communities
              .map(
                (c) =>
                  `<option value="${esc(c.community_id)}">${esc(c.display_name)}</option>`,
              )
              .join(""),
          );
        });
    } catch (error) {
      status(error.message, true);
    }
    await load();
    if (selected) await open(selected);
  }
  function paintQueue() {
    const el = document.getElementById("rc-queue");
    if (!el) return;
    const attention = document.querySelector(
        "#rc-filters [name=attention]",
      )?.value,
      alerts = root.AtlasCommunicationAlerts.getAlerts();
    const visible = rows.filter(
      (c) =>
        !attention ||
        (attention === "unread"
          ? c.unread_count > 0
          : attention === "urgent"
            ? c.urgent
            : attention === "failed"
              ? c.delivery_failed
              : alerts.some((a) => a.conversation_link_id === c.link_id)),
    );
    el.innerHTML = visible.length
      ? visible
          .map(
            (c) =>
              `<button class="rc-conversation" type="button" data-conversation="${c.id}" aria-pressed="${selected === c.id}"><strong>${esc(c.channel.toUpperCase())} · Conversation ${c.id}</strong><span>${esc(c.status)} · ${c.unread_count} unread${c.urgent ? " · Urgent" : ""}</span><span>Community ${esc(communities.find((item) => item.community_id === c.community_id)?.display_name || c.community_id)}</span><span>Resident ${esc(c.resident_id)} · Lease ${esc(c.lease_id)}</span><span>Last response: ${esc(c.last_response_at || "None")}</span></button>`,
          )
          .join("")
      : "<p>No conversations match these filters.</p>";
  }
  async function load(announce = true) {
    const generation = ++queueGeneration;
    if (announce) status("Loading queue…");
    try {
      const form = document.getElementById("rc-filters");
      const params = new URLSearchParams(form ? new FormData(form) : []);
      for (const [k, v] of [...params]) if (!v) params.delete(k);
      const result = await api(`/conversations?${params}`);
      if (generation !== queueGeneration) return;
      rows = result.conversations;
      paintQueue();
      if (announce)
        status(
          rows.length === 100
            ? "Showing the first 100 conversations. Narrow the filters."
            : `${rows.length} conversations loaded.`,
        );
    } catch (error) {
      if (generation !== queueGeneration) return;
      rows = [];
      paintQueue();
      status(error.message, true);
    }
  }
  async function open(id) {
    if (selected !== id) sendKey = null;
    selected = id;
    const generation = ++requestGeneration;
    status("Loading conversation…");
    try {
      const [d, m] = await Promise.all([
        api(`/conversations/${id}`),
        api(`/conversations/${id}/messages`),
      ]);
      if (generation !== requestGeneration) return;
      detail = d;
      messages = m.messages;
      paintDetail();
      paintQueue();
      status("Conversation loaded.");
      document.getElementById("rc-conversation-heading")?.focus();
    } catch (error) {
      if (generation !== requestGeneration) return;
      detail = null;
      messages = [];
      const el = document.getElementById("rc-detail");
      if (el) el.textContent = "Conversation unavailable.";
      status(error.message, true);
    }
  }
  function historyMarkup() {
    return (
      messages
        .map(
          (m) =>
            `<li><div>${m.private ? "Private note" : [0, "incoming"].includes(m.message_type) ? "Resident" : "Staff"} · ${esc(m.status || "Delivery state unavailable")}</div><p>${esc(m.content)}</p>${m.has_attachments ? "<p>Attachment access is blocked pending scanning configuration.</p>" : ""}</li>`,
        )
        .join("") || "<li>No messages yet.</li>"
    );
  }
  function paintDetail() {
    const el = document.getElementById("rc-detail");
    if (!el || !detail) return;
    const c = detail.conversation,
      r = detail.resident,
      blocked = detail.write_block_reason || detail.send_block_reason;
    el.innerHTML = `<h3 tabindex="-1" id="rc-conversation-heading">${esc(r?.display_name || "Resident identity requires review")}</h3><p>${esc(r?.lease_context || "Current lease context unavailable")} · ${esc(c.channel.toUpperCase())}</p><p id="rc-consent">Consent: ${esc(detail.consent || "Email channel")} · Last response: ${esc(c.last_response_at || "None")}</p><div class="rc-actions"><button type="button" id="rc-read" class="cs-btn">Mark read</button><button type="button" id="rc-assign" class="cs-btn">Assign to me</button><label>Assign to<select id="rc-assignee"><option value="">Choose an authorized agent</option></select></label><button type="button" id="rc-assign-other" class="cs-btn">Assign</button><button type="button" id="rc-unassign" class="cs-btn">Unassign</button><label>Status<select id="rc-state">${["open", "pending", "resolved"].map((s) => `<option ${s === c.status ? "selected" : ""}>${s}</option>`).join("")}</select></label><button type="button" id="rc-save-state" class="cs-btn">Update status</button></div><button type="button" id="rc-older" class="cs-btn">Load earlier messages</button><ol class="rc-history" aria-label="Conversation history">${historyMarkup()}</ol><form id="rc-compose"><label>Message<textarea name="content" required maxlength="16000" rows="5" aria-describedby="rc-send-rule"></textarea></label><p id="rc-send-rule">${esc(blocked ? root.AtlasCommunicationAlerts.explain(blocked) : "Replies are checked against resident identity and channel policy before sending.")}</p><button type="submit" class="cs-btn" ${blocked ? "disabled" : ""}>Send ${esc(c.channel)}</button><button type="button" id="rc-note" class="cs-btn" ${!r || detail.write_block_reason ? "disabled" : ""}>Save private note</button></form>`;
    if (detail.write_block_reason)
      el.querySelectorAll(".rc-actions button,.rc-actions select").forEach(
        (b) => (b.disabled = true),
      );
    const action = async (path, method, body) => {
      try {
        await api(`/conversations/${c.id}/${path}`, method, body);
        await open(c.id);
        await load();
      } catch (error) {
        status(error.message, true);
      }
    };
    void api(`/agents?community=${encodeURIComponent(c.community_id)}`)
      .then((result) => {
        const select = el.querySelector("#rc-assignee");
        if (select && selected === c.id)
          select.insertAdjacentHTML(
            "beforeend",
            (result.agents || [])
              .map(
                (a) =>
                  `<option value="${esc(a.user_id)}">${esc(a.display_name)}</option>`,
              )
              .join(""),
          );
      })
      .catch((error) => status(error.message, true));
    el.querySelector("#rc-assign-other").onclick = () => {
      const user_id = el.querySelector("#rc-assignee").value;
      if (user_id) void action("assignment", "PATCH", { user_id });
    };
    el.querySelector("#rc-read").onclick = () =>
      void action("read", "POST", {});
    el.querySelector("#rc-assign").onclick = () =>
      void action("assignment", "PATCH", {
        user_id: root.ATLAS_CENTRAL.getSession().user.id,
      });
    el.querySelector("#rc-unassign").onclick = () =>
      void action("assignment", "PATCH", {});
    el.querySelector("#rc-save-state").onclick = () =>
      void action("status", "PATCH", {
        status: el.querySelector("#rc-state").value,
      });
    el.querySelector("#rc-older").onclick = async () => {
      try {
        const generation = requestGeneration;
        const oldest = messages[0]?.id;
        if (!oldest) return;
        const result = await api(
          `/conversations/${c.id}/messages?before=${oldest}`,
        );
        if (generation !== requestGeneration || selected !== c.id) return;
        messages = [...result.messages, ...messages];
        paintDetail();
        status(
          result.messages.length
            ? "Earlier messages loaded."
            : "No earlier messages.",
        );
      } catch (error) {
        status(error.message, true);
      }
    };
    const send = async (note) => {
      if (busy) return;
      const textarea = el.querySelector("textarea");
      if (!textarea.value.trim()) return;
      busy = true;
      el.querySelectorAll("#rc-compose button").forEach(
        (b) => (b.disabled = true),
      );
      sendKey = sendKey || crypto.randomUUID();
      try {
        await api(
          `/conversations/${c.id}/${note ? "private-notes" : "messages"}`,
          "POST",
          { content: textarea.value },
          sendKey,
        );
        sendKey = null;
        await open(c.id);
        status(note ? "Private note saved." : "Message accepted by Chatwoot.");
      } catch (error) {
        status(error.message, true);
      } finally {
        busy = false;
        if (
          detail &&
          selected === c.id &&
          document.getElementById("rc-detail") === el
        )
          el.querySelectorAll("#rc-compose button").forEach(
            (b) =>
              (b.disabled =
                b.id === "rc-note"
                  ? !detail.resident || !!detail.write_block_reason
                  : !!detail.send_block_reason || !!detail.write_block_reason),
          );
      }
    };
    el.querySelector("#rc-compose").onsubmit = (event) => {
      event.preventDefault();
      void send(false);
    };
    el.querySelector("#rc-note").onclick = () => void send(true);
  }
  root.addEventListener("atlas-central-auth-change", () => {
    requestGeneration++;
    queueGeneration++;
    rows = [];
    selected = null;
    detail = null;
    messages = [];
    sendKey = null;
    const el = document.getElementById("rc-detail");
    if (el) el.textContent = "Session changed. Reload your queue.";
    paintQueue();
  });
  async function refreshSelected() {
    if (!selected || busy || !detail || !document.getElementById("rc-detail"))
      return;
    const id = selected,
      generation = requestGeneration;
    try {
      const [result, recent] = await Promise.all([
        api(`/conversations/${id}`),
        api(`/conversations/${id}/messages`),
      ]);
      if (generation !== requestGeneration || selected !== id) return;
      detail = result;
      const blocked = detail.write_block_reason || detail.send_block_reason;
      const rule = document.getElementById("rc-send-rule");
      if (rule)
        rule.textContent = blocked
          ? root.AtlasCommunicationAlerts.explain(blocked)
          : "Replies are checked against resident identity and channel policy before sending.";
      const consent = document.getElementById("rc-consent");
      if (consent)
        consent.textContent = `Consent: ${detail.consent || "Email channel"} · Last response: ${detail.conversation.last_response_at || "None"}`;
      document.querySelectorAll("#rc-compose button").forEach((button) => {
        button.disabled =
          button.id === "rc-note"
            ? !detail.resident || !!detail.write_block_reason
            : !!blocked;
      });
      const merged = new Map(messages.map((message) => [message.id, message]));
      recent.messages.forEach((message) => merged.set(message.id, message));
      messages = [...merged.values()].sort((a, b) => a.id - b.id);
      const history = document.querySelector("#rc-detail .rc-history");
      if (history) history.innerHTML = historyMarkup();
      // Keep the draft and focus intact while refreshing delivery states and history.
    } catch (error) {
      status(error.message, true);
    }
  }
  root.addEventListener("atlas-communication-alerts-change", () => {
    if (document.getElementById("rc-workspace")) {
      void load(false);
      void refreshSelected();
    }
  });
  root.AtlasResidentCommunications = { render, open };
})(window);
