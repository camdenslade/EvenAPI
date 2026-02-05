/* eslint-disable no-console */
// Restore demo account data from a snapshot JSON file.
// Deletes all existing demo data, then inserts from the snapshot.
//
// Usage:
//   POSTGRES_HOST=... POSTGRES_USER=... POSTGRES_PASSWORD=... POSTGRES_DB=... \
//     node scripts/restore-demo-accounts.js <snapshot-file>
//
// Example:
//   node scripts/restore-demo-accounts.js scripts/demo-snapshot-2026-02-05T12-00-00.json

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

// Tables in delete order (children before parents)
const DELETE_ORDER = [
  { table: "messages", where: `"threadId" IN (SELECT id FROM threads WHERE "matchId" IN (SELECT id FROM matches WHERE "userAUid" = ANY($1) OR "userBUid" = ANY($1)))`, params: (uids) => [uids, uids] },
  { table: "threads", where: `"matchId" IN (SELECT id FROM matches WHERE "userAUid" = ANY($1) OR "userBUid" = ANY($1))`, params: (uids) => [uids, uids] },
  { table: "message_requests", where: `"senderUid" = ANY($1) OR "recipientUid" = ANY($1)`, params: (uids) => [uids, uids] },
  { table: "likes", where: `"swiperUid" = ANY($1) OR "targetUid" = ANY($1)`, params: (uids) => [uids, uids] },
  { table: "matches", where: `"userAUid" = ANY($1) OR "userBUid" = ANY($1)`, params: (uids) => [uids, uids] },
  { table: "reviews", where: `"reviewerUid" = ANY($1) OR "targetUid" = ANY($1)`, params: (uids) => [uids, uids] },
  { table: "review_strikes", where: `"userId" = ANY($1)`, params: (uids) => [uids] },
  { table: "review_emergency", where: `"reviewerId" = ANY($1) OR "targetId" = ANY($1)`, params: (uids) => [uids, uids] },
  { table: "review_week_windows", where: `"userId" = ANY($1)`, params: (uids) => [uids] },
  { table: "blocks", where: `"blockerUid" = ANY($1) OR "blockedUid" = ANY($1)`, params: (uids) => [uids, uids] },
  { table: "token_ledger", where: `"userId" = ANY($1)`, params: (uids) => [uids] },
  { table: "purchases", where: `"userId" = ANY($1)`, params: (uids) => [uids] },
  { table: "email_verifications", where: `"userUid" = ANY($1)`, params: (uids) => [uids] },
  { table: "verified_school_emails", where: `"lastVerifiedByUid" = ANY($1)`, params: (uids) => [uids] },
  { table: "profile_photos", where: `"userId" = ANY($1)`, params: (uids) => [uids] },
  { table: "profiles", where: `"userUid" = ANY($1)`, params: (uids) => [uids] },
];

// Tables in insert order (parents before children)
const INSERT_ORDER = [
  "safety_identities",
  "users",
  "profiles",
  "profile_photos",
  "likes",
  "matches",
  "threads",
  "messages",
  "message_requests",
  "reviews",
  "review_strikes",
  "review_emergency",
  "review_week_windows",
  "blocks",
  "token_ledger",
  "purchases",
  "email_verifications",
  "verified_school_emails",
  "safety_exclusions",
];

async function insertRows(client, table, rows) {
  if (!rows || rows.length === 0) return 0;

  let inserted = 0;
  for (const row of rows) {
    const columns = Object.keys(row);
    const values = columns.map((c) => row[c]);
    const placeholders = columns.map((_, i) => `$${i + 1}`);
    const quotedCols = columns.map((c) => `"${c}"`).join(", ");

    try {
      await client.query(
        `INSERT INTO ${table} (${quotedCols}) VALUES (${placeholders.join(", ")}) ON CONFLICT DO NOTHING`,
        values
      );
      inserted++;
    } catch (err) {
      console.warn(`  Warning: failed to insert row into ${table} (id=${row.id}): ${err.message}`);
    }
  }
  return inserted;
}

async function main() {
  const snapshotPath = process.argv[2];
  if (!snapshotPath) {
    console.error("Usage: node scripts/restore-demo-accounts.js <snapshot-file>");
    console.error("Example: node scripts/restore-demo-accounts.js scripts/demo-snapshot-2026-02-05T12-00-00.json");
    process.exit(1);
  }

  const resolved = path.resolve(snapshotPath);
  if (!fs.existsSync(resolved)) {
    console.error(`Snapshot file not found: ${resolved}`);
    process.exit(1);
  }

  const snapshot = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  console.log(`Loaded snapshot from ${snapshot._meta?.createdAt || "unknown date"}`);

  const client = new Client({
    host: process.env.POSTGRES_HOST || "localhost",
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER || "postgres",
    password: process.env.POSTGRES_PASSWORD || "devpassword",
    database: process.env.POSTGRES_DB || "evenapp",
  });

  await client.connect();
  console.log("Connected to PostgreSQL\n");

  // --- Phase 1: Delete existing demo data ---
  console.log("Phase 1: Deleting existing demo data...");

  for (const { table, where, params } of DELETE_ORDER) {
    try {
      const res = await client.query(`DELETE FROM ${table} WHERE ${where}`, params(DEMO_UIDS));
      if (res.rowCount > 0) console.log(`  ${table}: deleted ${res.rowCount} rows`);
    } catch (err) {
      console.warn(`  Warning: could not delete from ${table}: ${err.message}`);
    }
  }

  // Clear safety identity FK before deleting users and safety_identities
  try {
    await client.query(`UPDATE users SET "safetyIdentityId" = NULL WHERE uid = ANY($1)`, [DEMO_UIDS]);
  } catch (err) {
    // ignore if users don't exist yet
  }

  // Delete safety exclusions (needs safety identity IDs from snapshot)
  const safetyIds = (snapshot.safety_identities || []).map((s) => s.id);
  if (safetyIds.length) {
    try {
      await client.query(
        `DELETE FROM safety_exclusions WHERE "sourceSafetyIdentityId" = ANY($1) OR "targetSafetyIdentityId" = ANY($1)`,
        [safetyIds, safetyIds]
      );
    } catch (err) {
      // ignore
    }
  }

  // Delete users and safety identities
  try {
    await client.query(`DELETE FROM users WHERE uid = ANY($1)`, [DEMO_UIDS]);
  } catch (err) {
    console.warn(`  Warning: could not delete users: ${err.message}`);
  }
  if (safetyIds.length) {
    try {
      await client.query(`DELETE FROM safety_identities WHERE id = ANY($1)`, [safetyIds]);
    } catch (err) {
      // ignore
    }
  }

  console.log("\nPhase 2: Inserting snapshot data...");

  // --- Phase 2: Insert from snapshot ---
  for (const table of INSERT_ORDER) {
    const rows = snapshot[table];
    if (!rows || rows.length === 0) continue;
    const count = await insertRows(client, table, rows);
    console.log(`  ${table}: inserted ${count}/${rows.length} rows`);
  }

  await client.end();
  console.log("\nRestore complete!");
}

main().catch((err) => {
  console.error("Restore failed:", err);
  process.exit(1);
});
