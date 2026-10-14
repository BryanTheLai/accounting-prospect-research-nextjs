import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { test } from "node:test";
import { countLiveSendsToday } from "../lib/overview.ts";

test("overview sent-today metric excludes dry-run simulations", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE campaign_sends (
      send_id INTEGER PRIMARY KEY,
      status TEXT NOT NULL,
      response_msg TEXT,
      sent_at TEXT NOT NULL
    )`);
    const now = db.prepare("SELECT datetime('now', 'localtime') AS value").get().value;
    const add = db.prepare("INSERT INTO campaign_sends (status, response_msg, sent_at) VALUES (?, ?, ?)");
    add.run("SENT", "250 accepted", now);
    add.run("SENT", "[DRY-RUN SAFETY SHIELD] simulated", now);
    add.run("BOUNCED", "550 invalid", now);
    assert.equal(countLiveSendsToday(db), 1);
  } finally {
    db.close();
  }
});

test("local send timestamps at both day boundaries are counted without a second timezone conversion", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE campaign_sends(status TEXT,response_msg TEXT,sent_at TEXT)");
    const today = db.prepare("SELECT date('now','localtime') day").get().day;
    const add = db.prepare("INSERT INTO campaign_sends VALUES ('SENT','accepted',?)");
    add.run(`${today} 00:00:01`);
    add.run(`${today} 23:59:59`);
    assert.equal(countLiveSendsToday(db), 2);
  } finally { db.close(); }
});
