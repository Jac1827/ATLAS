(function (root) {
  "use strict";
  let alerts = [],
    total = 0,
    availability = null,
    abort = null,
    generation = 0;
  const labels = {
    unread: "Unread resident message",
    unassigned: "Unassigned conversation",
    first_response_overdue: "First response overdue",
    follow_up_due: "Follow-up due",
    delivery_failed: "Delivery failed",
    urgent: "Urgent conversation",
    consent_conflict: "Consent review required",
  };
  const escape = (value) =>
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
  function session() {
    return root.ATLAS_CENTRAL?.getSession?.();
  }
  function url(path) {
    const config = root.ATLAS_CENTRAL?.getConfig?.();
    let base = config?.accessApiBaseUrl || location.origin;
    if (base.includes("github.io"))
      base =
        "https://rise-performance-platform-site.jacquelyn-heflin.workers.dev";
    return `${base.replace(/\/$/, "")}/api/atlas/chatwoot${path}`;
  }
  async function request(path, method = "GET", body, key, signal) {
    const s = session();
    if (!s?.access_token || s.expires_at * 1000 <= Date.now())
      throw new Error("Your session expired. Sign in again.");
    const response = await fetch(url(path), {
      method,
      headers: {
        Authorization: `Bearer ${s.access_token}`,
        "Content-Type": "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      cache: "no-store",
    });
    if (path === "/events") return response;
    const data = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(explain(data.error)), { code: data.error });
    return data;
  }
  function explain(code) {
    const reasons = {
      communications_read_only:
        "Communications is currently in read-only pilot mode.",
      communications_not_enabled:
        "Resident Communications is awaiting deployment configuration.",
      chatwoot_not_validated: "The Chatwoot deployment has not been validated.",
      outbound_activation_pending:
        "Outbound messaging is awaiting activation and compliance approval.",
      sms_quiet_hours:
        "SMS is blocked during community quiet hours, beginning at 7:00 PM.",
      morning_resume_missing:
        "SMS is blocked until the approved morning resume time is configured.",
      timezone_unverified: "The community timezone has not been verified.",
      sms_opted_out: "This resident has opted out of SMS.",
      sms_consent_required: "Documented SMS consent is required.",
      canonical_identity_unresolved:
        "The canonical resident and current lease connection needs review.",
      route_unverified: "No verified active inbox route is configured.",
      operation_requires_review:
        "This request may have reached Chatwoot. Review its outcome before retrying.",
      recipient_identity_conflict:
        "The recipient does not match the canonical resident endpoint.",
      session_expired: "Your session expired. Sign in again.",
    };
    return (
      reasons[code] ||
      String(code || "Unable to load communications").replace(/_/g, " ")
    );
  }
  function render() {
    return `<section class="card rc-reminders" aria-label="Resident communication reminders"><h3>Resident Communications <span data-rc-count>${total}</span></h3><div data-rc-reminders>${items()}</div></section>`;
  }
  function items() {
    if (availability === false)
      return "<span>Resident Communications is awaiting configuration.</span>";
    return alerts.length
      ? alerts
          .slice(0, 5)
          .map(
            (a) =>
              `<button type="button" class="cs-btn" data-rc-alert="${escape(a.conversation_link_id)}">${escape(labels[a.kind] || a.kind)}</button>`,
          )
          .join(" ")
      : "<span>No resident communications need attention.</span>";
  }
  function paint() {
    document.querySelectorAll("[data-rc-count]").forEach((el) => {
      const value = String(total);
      if (el.textContent !== value) el.textContent = value;
    });
    document.querySelectorAll("[data-rc-reminders]").forEach((el) => {
      const html = items();
      if (el.innerHTML !== html) el.innerHTML = html;
    });
    const tab = document.querySelector('[data-tab="15"] .tab-label');
    if (tab) {
      let badge = tab.querySelector("[data-rc-count]");
      if (!badge) {
        badge = document.createElement("span");
        badge.dataset.rcCount = "";
        badge.setAttribute("aria-label", "Resident communication alerts");
        tab.appendChild(badge);
      }
      if (badge.textContent !== String(total))
        badge.textContent = String(total);
    }
  }
  async function open(linkId) {
    try {
      const data = await request(
        `/conversation-links/${encodeURIComponent(linkId)}`,
      );
      await root.AtlasFeatures.load("centralServices");
      await root.AtlasFeatures.load("residentCommunications");
      root.setTab(15);
      root.atlasCsSetModule("communications");
      root.AtlasResidentCommunications.open(data.conversation.id);
    } catch (error) {
      root.alert(error.message);
    }
  }
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-rc-alert]");
    if (button) void open(button.dataset.rcAlert);
  });
  async function start() {
    abort?.abort();
    const run = ++generation;
    abort = new AbortController();
    alerts = [];
    total = 0;
    availability = null;
    paint();
    if (!session()?.access_token) return;
    while (run === generation && !abort.signal.aborted) {
      try {
        const response = await request(
          "/events",
          "GET",
          undefined,
          undefined,
          abort.signal,
        );
        if (response.status === 503) {
          availability = false;
          paint();
          break;
        }
        if (!response.ok) throw new Error("Session unavailable");
        const reader = response.body.getReader(),
          decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let end;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const chunk = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (chunk.includes("event: expired")) throw new Error("Expired");
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (line && run === generation) {
              const snapshot = JSON.parse(line.slice(6));
              alerts = Array.isArray(snapshot) ? snapshot : snapshot.alerts;
              total = Array.isArray(snapshot)
                ? snapshot.length
                : snapshot.total;
              availability = true;
              paint();
              root.dispatchEvent(
                new CustomEvent("atlas-communication-alerts-change"),
              );
            }
          }
        }
      } catch {
        if (run !== generation) break;
        alerts = [];
        total = 0;
        availability = null;
        paint();
      }
      if (run === generation && !abort.signal.aborted)
        await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  root.addEventListener("atlas-central-auth-change", () => void start());
  // Re-rendered dashboard fragments get the current scoped state, never a persisted cache.
  new MutationObserver(() => paint()).observe(document.body, {
    childList: true,
    subtree: true,
  });
  root.AtlasCommunicationAlerts = {
    request,
    render,
    explain,
    getAlerts: () => alerts.slice(),
    open,
  };
  void start();
})(window);
