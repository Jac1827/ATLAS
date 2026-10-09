const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { migrationHistoryFixture } = require("./migration-history-fixture.cjs");
(async () => {
  const { db } = await migrationHistoryFixture({ includeLater: true });
  try {
    const [u, admin, inactive, a, b, contact, link] = Array.from(
      { length: 7 },
      randomUUID,
    );
    for (const [id, role, status] of [
      [u, "viewer", "active"],
      [admin, "admin", "active"],
      [inactive, "regional", "disabled"],
    ]) {
      await db.query(
        "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
        [id, `${id}@risere.com`],
      );
      await db.query(
        "insert into atlas_user_profiles(user_id,email,display_name,role,status,allowed_community_ids) values($1,$2,$3,$4,$5,$6)",
        [id, `${id}@risere.com`, "Synthetic", role, status, [a]],
      );
    }
    for (const [id, name, market, region] of [
      [a, "Synthetic A", "east", "north"],
      [b, "Synthetic B", "west", "south"],
    ])
      await db.query(
        "insert into atlas_communities(community_id,canonical_name,display_name,market,regional_grouping) values($1,$2,$2,$3,$4)",
        [id, name, market, region],
      );
    const auth = async (id) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        id,
      ]);
      await db.exec("set role authenticated");
    };
    const access = async (cid) =>
      (await db.query("select atlas_communication_access($1) ok", [cid]))
        .rows[0].ok;
    await auth(u);
    assert.equal(await access(a), true);
    assert.equal(await access(b), false);
    await db.exec("reset role");
    await db.query(
      "update atlas_user_profiles set allowed_market_values='{west}' where user_id=$1",
      [u],
    );
    await auth(u);
    assert.equal(await access(a), false);
    await db.exec("reset role");
    await db.query(
      "update atlas_user_profiles set allowed_market_values='{}',allowed_region_values='{south}' where user_id=$1",
      [u],
    );
    await auth(u);
    assert.equal(await access(a), false);
    await db.exec("reset role");
    await db.query(
      "update atlas_user_profiles set allowed_region_values='{}',locked_page_keys='{resident_communications}' where user_id=$1",
      [u],
    );
    await auth(u);
    assert.equal(await access(a), false);
    await auth(inactive);
    assert.equal(await access(a), false);
    await auth(admin);
    assert.equal(
      await access(b),
      false,
      "Explicit community restrictions apply to Admin too",
    );
    await db.exec("reset role");
    await db.query(
      "update atlas_user_profiles set allowed_community_ids='{}' where user_id=$1",
      [admin],
    );
    await auth(admin);
    assert.equal(
      await access(b),
      true,
      "Preserves unrestricted broad Admin scope",
    );
    await db.exec("reset role");
    await db.query(
      "update atlas_user_profiles set allowed_market_values='{east}' where user_id=$1",
      [admin],
    );
    await auth(admin);
    assert.equal(
      await access(b),
      false,
      "Admin market restriction still applies",
    );
    await db.exec("reset role");
    await db.query(
      "update atlas_user_profiles set locked_page_keys='{}' where user_id=$1",
      [u],
    );
    await db.query(
      "insert into atlas_chatwoot_inbox_routes(community_id,channel,account_id,inbox_id,sending_number,first_response_minutes,follow_up_minutes) values($1,'sms',1,2,'+12025550100',5,10)",
      [a],
    );
    await db.query(
      "insert into atlas_chatwoot_contact_links(link_id,community_id,resident_id,account_id,contact_id,identity_key,state) values($1,$2,'synthetic-person',1,3,'synthetic-identity','linked')",
      [contact, a],
    );
    await db.query(
      "insert into atlas_chatwoot_conversation_links(link_id,community_id,resident_id,lease_id,contact_link_id,account_id,conversation_id,inbox_id,channel,state) values($1,$2,'synthetic-person','synthetic-lease',$3,1,4,2,'sms','linked')",
      [link, a, contact],
    );
    await assert.rejects(
      () =>
        db.query(
          "insert into atlas_chatwoot_conversation_links(community_id,resident_id,lease_id,contact_link_id,account_id,conversation_id,inbox_id,channel) values($1,'forged-person','forged-lease',$2,1,8,2,'sms')",
          [b, contact],
        ),
      /foreign key/,
    );
    const apply = async (key, status, stamp, opts = {}) =>
      db.query(
        "select atlas_communication_apply_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) accepted",
        [
          key,
          "message_created",
          link,
          stamp,
          "open",
          null,
          2,
          false,
          status === "failed",
          opts.incoming || false,
          opts.outgoing || false,
          opts.stop || false,
          opts.message || 10,
          status,
        ],
      );
    const past = new Date(Date.now() - 20 * 60000).toISOString();
    assert.equal(
      (await apply("event-1", "sent", past, { incoming: true })).rows[0]
        .accepted,
      true,
    );
    assert.equal(
      (await apply("event-1", "sent", past, { incoming: true })).rows[0]
        .accepted,
      false,
    );
    await db.query("select atlas_communication_refresh_alerts()");
    let alerts = (
      await db.query(
        "select kind from atlas_resident_communication_alerts where active",
      )
    ).rows.map((r) => r.kind);
    assert.ok(alerts.includes("first_response_overdue"));
    assert.ok(alerts.includes("unread"));
    assert.ok(alerts.includes("unassigned"));
    await apply("event-2", "failed", new Date().toISOString(), {
      outgoing: true,
    });
    await apply("event-3", "delivered", new Date().toISOString(), {
      message: 11,
    });
    assert.equal(
      (
        await db.query(
          "select delivery_failed from atlas_chatwoot_conversation_links",
        )
      ).rows[0].delivery_failed,
      true,
      "Unrelated delivered message cannot clear failure",
    );
    await apply("event-4", "delivered", new Date().toISOString());
    assert.equal(
      (
        await db.query(
          "select delivery_failed from atlas_chatwoot_conversation_links",
        )
      ).rows[0].delivery_failed,
      false,
    );
    await apply("event-5", "sent", past, { stop: true, incoming: true });
    assert.equal(
      (await db.query("select sms_opted_out from atlas_chatwoot_contact_links"))
        .rows[0].sms_opted_out,
      true,
      "Older STOP revokes even when no consent row exists",
    );
    const claim = async () =>
      db.query(
        "select atlas_communication_claim_operation('unique-request',$1,$2,'message') ok",
        [a, u],
      );
    assert.equal((await claim()).rows[0].ok, true);
    assert.equal((await claim()).rows[0].ok, false);
    await auth(u);
    assert.equal(
      (
        await db.query(
          "select count(*)::integer n from atlas_chatwoot_conversation_links",
        )
      ).rows[0].n,
      1,
    );
    for (const table of [
      "atlas_chatwoot_inbox_routes",
      "atlas_chatwoot_webhook_receipts",
      "atlas_chatwoot_operations",
      "atlas_chatwoot_delivery_states",
    ])
      await assert.rejects(
        () => db.query(`select * from ${table}`),
        /permission denied/,
      );
    for (const table of [
      "atlas_chatwoot_conversation_links",
      "atlas_resident_message_consent",
      "atlas_resident_communication_alerts",
    ])
      await assert.rejects(
        () => db.query(`delete from ${table}`),
        /permission denied/,
      );
    await assert.rejects(
      () => db.query("select atlas_communication_refresh_alerts()"),
      /permission denied/,
    );
    await assert.rejects(
      () => db.query("select * from atlas_resident_communication_identity"),
      /permission denied/,
    );
    await db.exec("reset role");
    await db.query(
      "update atlas_user_profiles set status='disabled' where user_id=$1",
      [u],
    );
    await auth(u);
    assert.equal(
      (
        await db.query(
          "select count(*)::integer n from atlas_resident_communication_alerts",
        )
      ).rows[0].n,
      0,
    );
    await db.exec("reset role;set role service_role");
    await db.query("select atlas_communication_refresh_alerts()");
    await db.query("select atlas_communication_record_opt_out($1)", [link]);
    await db.exec("reset role");
    const columns = (
      await db.query(
        "select column_name from information_schema.columns where table_name like 'atlas_chatwoot%' or table_name in ('atlas_resident_communication_alerts','atlas_resident_communication_audit','atlas_resident_message_consent')",
      )
    ).rows.map((r) => r.column_name);
    for (const bad of [
      "body",
      "content",
      "message_body",
      "payload",
      "attachments",
      "token",
    ])
      assert.ok(!columns.includes(bad));
    assert.equal(
      (
        await db.query(
          "select count(*)::integer n from atlas_resident_communication_identity",
        )
      ).rows[0].n,
      0,
      "Unverified canonical source fails closed",
    );
    console.log(
      "PASS full migration replay; role/community/market/region/page RLS; inactive users; foreign-key identity isolation; atomic duplicate receipts; per-message delivery failures; overdue alerts; STOP without consent; idempotency; denied browser writes and credential/config reads; body-free schema",
    );
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error.message, error.where || error.detail || "");
  process.exitCode = 1;
});
