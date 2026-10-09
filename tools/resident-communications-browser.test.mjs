import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.ATLAS_PLAYWRIGHT || "playwright");
const source = await fs.readFile(
  new URL(
    "../docs/portfolio-operations-dashboard/features/resident-communications.js",
    import.meta.url,
  ),
  "utf8",
);
const alerts = await fs.readFile(
  new URL(
    "../docs/portfolio-operations-dashboard/features/resident-communication-alerts.js",
    import.meta.url,
  ),
  "utf8",
);
const css = await fs.readFile(
  new URL(
    "../docs/portfolio-operations-dashboard/features/resident-communications.css",
    import.meta.url,
  ),
  "utf8",
);
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="dashboard"></div><div id="app"></div><script>
window.state={rows:[],error:false,block:'sms_opted_out',calls:[],hold:false};
window.ATLAS_CENTRAL={getSession:()=>({user:{id:'synthetic-user'},access_token:'synthetic-session',expires_at:Math.floor(Date.now()/1000)+3600}),getConfig:()=>({accessApiBaseUrl:location.origin})};
window.AtlasFeatures={load:async()=>{}};
window.setTab=()=>{};window.atlasCsSetModule=()=>{};
</script><script src="/alerts.js"></script><script src="/workspace.js"></script><script>document.getElementById('app').innerHTML=AtlasResidentCommunications.render();document.getElementById('dashboard').innerHTML=AtlasCommunicationAlerts.render();</script></body></html>`;
const server = createServer((req, res) => {
  res.setHeader(
    "Content-Type",
    req.url === "/"
      ? "text/html"
      : req.url === "/style.css"
        ? "text/css"
        : "text/javascript",
  );
  res.end(
    req.url === "/"
      ? html
      : req.url === "/style.css"
        ? css
        : req.url === "/alerts.js"
          ? alerts
          : source,
  );
});
let browser;
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let rows = [],
    block = "sms_opted_out",
    fail = false,
    hold = false,
    releaseQueue;
  const conversation = {
    id: 4,
    link_id: "synthetic-link",
    community_id: "synthetic-community",
    resident_id: "synthetic-resident",
    lease_id: "synthetic-lease",
    channel: "sms",
    status: "open",
    unread_count: 2,
  };
  const calls = [];
  await page.route("**/api/atlas/chatwoot/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    calls.push({
      path: url.pathname,
      headers: req.headers(),
      body: req.postData(),
    });
    if (url.pathname.endsWith("/events"))
      return route.fulfill({
        contentType: "text/event-stream",
        body:
          "data: " +
          JSON.stringify([
            { conversation_link_id: "synthetic-link", kind: "delivery_failed" },
          ]) +
          "\n\n",
      });
    const scopedRows = rows;
    if (hold && url.pathname.endsWith("/conversations")) {
      hold = false;
      await new Promise((resolve) => (releaseQueue = resolve));
    }
    if (fail)
      return route.fulfill({ status: 401, json: { error: "session_expired" } });
    if (url.pathname.endsWith("/conversations"))
      return route.fulfill({ json: { ok: true, conversations: scopedRows } });
    if (url.pathname.endsWith("/messages"))
      return route.fulfill({
        json: {
          ok: true,
          messages: [
            {
              id: 8,
              content: "<img src=x onerror=alert(1)>",
              status: "delivered",
              private: false,
              message_type: "incoming",
            },
          ],
        },
      });
    if (url.pathname.endsWith("/conversation-links/synthetic-link"))
      return route.fulfill({ json: { conversation } });
    return route.fulfill({
      json: {
        ok: true,
        conversation,
        resident: {
          display_name: "Synthetic resident",
          lease_context: "Synthetic current lease",
        },
        consent: "revoked",
        send_block_reason: block,
      },
    });
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByText("No conversations match these filters.").waitFor();
  await page
    .getByRole("button", { name: "Delivery failed", exact: true })
    .waitFor();
  assert.equal(await page.locator("[data-rc-count]").innerText(), "1");
  rows = [conversation];
  await page.getByRole("button", { name: "Apply filters" }).click();
  await page.locator("[data-conversation]").waitFor();
  await page.locator("[data-conversation]").focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("heading", { name: "Synthetic resident", exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "rc-conversation-heading",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Send sms", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page.locator(".rc-history img").count(),
    0,
    "Message HTML remains plain text",
  );
  await page.getByText("This resident has opted out of SMS.").waitFor();
  await page.locator("#rc-compose textarea").fill("Synthetic internal note");
  await page.getByRole("button", { name: "Save private note" }).click();
  await page.getByText("Private note saved.").waitFor();
  const note = calls.find((c) => c.path.endsWith("/private-notes"));
  assert.ok(note.headers["idempotency-key"]);
  assert.deepEqual(JSON.parse(note.body), {
    content: "Synthetic internal note",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Mobile layout fits viewport",
  );
  await page.getByRole("button", { name: "Apply filters" }).focus();
  await page.keyboard.press("Enter");
  await page.getByText("1 conversations loaded.").waitFor();
  fail = true;
  await page.getByRole("button", { name: "Apply filters" }).click();
  await page.getByText("Your session expired. Sign in again.").waitFor();
  fail = false;
  hold = true;
  await page.getByRole("button", { name: "Apply filters" }).click();
  await page.getByText("Loading queue…").waitFor();
  for (let n = 0; n < 50 && !releaseQueue; n++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(releaseQueue);
  rows = [];
  await page.evaluate(() =>
    window.dispatchEvent(new Event("atlas-central-auth-change")),
  );
  releaseQueue();
  await page.waitForTimeout(150);
  assert.equal(
    await page.locator("[data-conversation]").count(),
    0,
    "An old in-flight queue cannot reappear after auth changes",
  );
  assert.ok(
    calls.every((c) => !JSON.stringify(c.headers).includes("api_access_token")),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS desktop/mobile layout, empty/loading/error/expired session, keyboard selection and heading focus, plain-text history, consent disabled composer, private-note idempotency, scoped streamed badge, stale auth-response rejection",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
