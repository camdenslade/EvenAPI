/* eslint-disable no-console */
// Snapshot demo account data from PostgreSQL.
// Exports all demo-related rows to a timestamped JSON file.
//
// Usage:
//   POSTGRES_HOST=... POSTGRES_USER=... POSTGRES_PASSWORD=... POSTGRES_DB=... \
//     node scripts/snapshot-demo-accounts.js
//
// Or with .env already loaded by your environment.

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const DEMO_UIDS = [
  "demo-reviewer-uid-appstore",
  "demo-scenario-01",
  "demo-scenario-02",
  "demo-scenario-03",
  "demo-scenario-04",
  "demo-scenario-05",
  "demo-scenario-06",
  "demo-scenario-07",
];

async function main() {
  const client = new Client({
    host: process.env.POSTGRES_HOST || "localhost",
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER || "postgres",
    password: process.env.POSTGRES_PASSWORD || "devpassword",
    database: process.env.POSTGRES_DB || "evenapp",
  });

  await client.connect();
  console.log("Connected to PostgreSQL");

  const snapshot = { _meta: { createdAt: new Date().toISOString(), demoUids: DEMO_UIDS } };

  // Helper: query rows and log count
  async function snap(label, query, params = []) {
    const res = await client.query(query, params);
    snapshot[label] = res.rows;
    console.log(`  ${label}: ${res.rows.length} rows`);
    return res.rows;
  }

  // --- 1. Users ---
  const users = await snap(
    "users",
    `SELECT * FROM users WHERE uid = ANY($1)`,
    [DEMO_UIDS]
  );

  // --- 2. Safety identities (linked from users) ---
  const safetyIds = users.map((u) => u.safetyIdentityId).filter(Boolean);
  if (safetyIds.length) {
    await snap("safety_identities", `SELECT * FROM safety_identities WHERE id = ANY($1)`, [safetyIds]);
    await snap("safety_exclusions", `SELECT * FROM safety_exclusions WHERE "sourceSafetyIdentityId" = ANY($1) OR "targetSafetyIdentityId" = ANY($1)`, [safetyIds, safetyIds]);
  } else {
    snapshot.safety_identities = [];
    snapshot.safety_exclusions = [];
  }

  // --- 3. Profiles ---
  await snap("profiles", `SELECT * FROM profiles WHERE "userUid" = ANY($1)`, [DEMO_UIDS]);

  // --- 4. Profile photos ---
  await snap("profile_photos", `SELECT * FROM profile_photos WHERE "userId" = ANY($1)`, [DEMO_UIDS]);

  // --- 5. Likes ---
  await snap("likes", `SELECT * FROM likes WHERE "swiperUid" = ANY($1) OR "targetUid" = ANY($1)`, [DEMO_UIDS, DEMO_UIDS]);

  // --- 6. Matches ---
  const matches = await snap("matches", `SELECT * FROM matches WHERE "userAUid" = ANY($1) OR "userBUid" = ANY($1)`, [DEMO_UIDS, DEMO_UIDS]);

  // --- 7. Threads (from matches) ---
  const matchIds = matches.map((m) => m.id);
  if (matchIds.length) {
    const threads = await snap("threads", `SELECT * FROM threads WHERE "matchId" = ANY($1)`, [matchIds]);
    // --- 8. Messages (from threads) ---
    const threadIds = threads.map((t) => t.id);
    if (threadIds.length) {
      await snap("messages", `SELECT * FROM messages WHERE "threadId" = ANY($1)`, [threadIds]);
    } else {
      snapshot.messages = [];
    }
  } else {
    snapshot.threads = [];
    snapshot.messages = [];
  }

  // --- 9. Message requests ---
  await snap("message_requests", `SELECT * FROM message_requests WHERE "senderUid" = ANY($1) OR "recipientUid" = ANY($1)`, [DEMO_UIDS, DEMO_UIDS]);

  // --- 10. Reviews ---
  await snap("reviews", `SELECT * FROM reviews WHERE "reviewerUid" = ANY($1) OR "targetUid" = ANY($1)`, [DEMO_UIDS, DEMO_UIDS]);

  // --- 11. Review strikes ---
  await snap("review_strikes", `SELECT * FROM review_strikes WHERE "userId" = ANY($1)`, [DEMO_UIDS]);

  // --- 12. Review emergency ---
  await snap("review_emergency", `SELECT * FROM review_emergency WHERE "reviewerId" = ANY($1) OR "targetId" = ANY($1)`, [DEMO_UIDS, DEMO_UIDS]);

  // --- 13. Review week windows ---
  await snap("review_week_windows", `SELECT * FROM review_week_windows WHERE "userId" = ANY($1)`, [DEMO_UIDS]);

  // --- 14. Blocks ---
  await snap("blocks", `SELECT * FROM blocks WHERE "blockerUid" = ANY($1) OR "blockedUid" = ANY($1)`, [DEMO_UIDS, DEMO_UIDS]);

  // --- 15. Token ledger ---
  await snap("token_ledger", `SELECT * FROM token_ledger WHERE "userId" = ANY($1)`, [DEMO_UIDS]);

  // --- 16. Purchases ---
  await snap("purchases", `SELECT * FROM purchases WHERE "userId" = ANY($1)`, [DEMO_UIDS]);

  // --- 17. Email verifications ---
  await snap("email_verifications", `SELECT * FROM email_verifications WHERE "userUid" = ANY($1)`, [DEMO_UIDS]);

  // --- 18. Verified school emails ---
  await snap("verified_school_emails", `SELECT * FROM verified_school_emails WHERE "lastVerifiedByUid" = ANY($1)`, [DEMO_UIDS]);

  await client.end();

  // Write snapshot file
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `demo-snapshot-${timestamp}.json`;
  const filepath = path.join(__dirname, filename);
  fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2));

  console.log(`\nSnapshot saved: ${filepath}`);
  console.log(`Total tables: ${Object.keys(snapshot).length - 1}`); // exclude _meta
}

main().catch((err) => {
  console.error("Snapshot failed:", err);
  process.exit(1);
});
