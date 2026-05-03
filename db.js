'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const EventEmitter = require('events');

const DB_PATH = path.join(__dirname, 'cozygardenbot.db');
const db = new Database(DB_PATH);

// Emits 'change' after any mutation that affects garden visuals.
// The overlay server subscribes to this to push updates to OBS.
const events = new EventEmitter();
function notify() { events.emit('change'); }

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ───────────────────────────────────────────────────────────────────

db.exec(`
  -- Garden slots (stream-wide, not per-viewer)
  CREATE TABLE IF NOT EXISTS garden (
    slot        INTEGER PRIMARY KEY,
    plant_id    TEXT,
    planted_by  TEXT,
    stage       INTEGER DEFAULT 0,
    waters_done INTEGER DEFAULT 0,
    planted_at  INTEGER
  );

  -- Viewer profiles: petals balance, seed held, water cooldown tracking
  CREATE TABLE IF NOT EXISTS viewers (
    username      TEXT PRIMARY KEY,
    petals        INTEGER DEFAULT 0,
    held_seed     TEXT,
    last_watered  INTEGER DEFAULT 0,
    waters_given  INTEGER DEFAULT 0
  );

  -- Stream-wide upgrades
  CREATE TABLE IF NOT EXISTS upgrades (
    id          TEXT PRIMARY KEY,
    purchased   INTEGER DEFAULT 0,
    purchased_by TEXT
  );

  -- Per-viewer consumable effects (Growth Tonic active on slot, Rain Cloud used)
  CREATE TABLE IF NOT EXISTS active_effects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT,
    effect      TEXT,
    slot        INTEGER,
    uses_left   INTEGER DEFAULT 1,
    created_at  INTEGER
  );

  -- Garden plot size (stream-wide, starts at 3)
  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Insert default config if not present
const initConfig = db.prepare(`INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)`);
initConfig.run('garden_slots', '3');

// ─── Viewer helpers ────────────────────────────────────────────────────────────

function ensureViewer(username) {
  db.prepare(`INSERT OR IGNORE INTO viewers (username) VALUES (?)`).run(username);
}

function getViewer(username) {
  ensureViewer(username);
  return db.prepare(`SELECT * FROM viewers WHERE username = ?`).get(username);
}

function addPetals(username, amount) {
  ensureViewer(username);
  db.prepare(`UPDATE viewers SET petals = petals + ? WHERE username = ?`).run(amount, username);
}

// Award the same amount of petals to a list of viewers in a single transaction.
// Returns the count of viewers credited (skips empty/duplicate usernames).
function addPetalsToMany(usernames, amount) {
  const seen = new Set();
  const cleaned = [];
  for (const u of usernames || []) {
    if (!u) continue;
    const lower = String(u).toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    cleaned.push(lower);
  }
  if (!cleaned.length || amount <= 0) return 0;

  const insertViewer = db.prepare(`INSERT OR IGNORE INTO viewers (username) VALUES (?)`);
  const updatePetals = db.prepare(`UPDATE viewers SET petals = petals + ? WHERE username = ?`);
  const tx = db.transaction(list => {
    for (const u of list) {
      insertViewer.run(u);
      updatePetals.run(amount, u);
    }
  });
  tx(cleaned);
  return cleaned.length;
}

function deductPetals(username, amount) {
  ensureViewer(username);
  const viewer = getViewer(username);
  if (viewer.petals < amount) return false;
  db.prepare(`UPDATE viewers SET petals = petals - ? WHERE username = ?`).run(amount, username);
  return true;
}

function setHeldSeed(username, seedId) {
  ensureViewer(username);
  db.prepare(`UPDATE viewers SET held_seed = ? WHERE username = ?`).run(seedId, username);
}

function recordWater(username) {
  ensureViewer(username);
  db.prepare(`
    UPDATE viewers SET last_watered = ?, waters_given = waters_given + 1 WHERE username = ?
  `).run(Date.now(), username);
}

function getLastWatered(username) {
  ensureViewer(username);
  return db.prepare(`SELECT last_watered FROM viewers WHERE username = ?`).get(username).last_watered;
}

function getWaterLeaderboard(limit = 3) {
  return db.prepare(`
    SELECT username, waters_given FROM viewers ORDER BY waters_given DESC LIMIT ?
  `).all(limit);
}

// ─── Garden helpers ────────────────────────────────────────────────────────────

function getGardenSlotCount() {
  const row = db.prepare(`SELECT value FROM config WHERE key = 'garden_slots'`).get();
  return parseInt(row ? row.value : '3', 10);
}

function setGardenSlotCount(n) {
  db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES ('garden_slots', ?)`).run(String(n));
  notify();
}

function getSlot(slot) {
  return db.prepare(`SELECT * FROM garden WHERE slot = ?`).get(slot);
}

function getAllSlots() {
  const count = getGardenSlotCount();
  const rows = db.prepare(`SELECT * FROM garden WHERE slot <= ?`).all(count);
  // Fill missing slots with empty objects
  const map = {};
  for (const row of rows) map[row.slot] = row;
  const result = [];
  for (let i = 1; i <= count; i++) {
    result.push(map[i] || { slot: i, plant_id: null });
  }
  return result;
}

function plantInSlot(slot, plantId, username) {
  db.prepare(`
    INSERT OR REPLACE INTO garden (slot, plant_id, planted_by, stage, waters_done, planted_at)
    VALUES (?, ?, ?, 0, 0, ?)
  `).run(slot, plantId, username, Date.now());
  notify();
}

function waterSlot(slot, amount = 1) {
  db.prepare(`UPDATE garden SET waters_done = waters_done + ? WHERE slot = ?`).run(amount, slot);
  notify();
}

function advanceStage(slot) {
  db.prepare(`UPDATE garden SET stage = stage + 1, waters_done = 0 WHERE slot = ?`).run(slot);
  notify();
}

function clearSlot(slot) {
  db.prepare(`DELETE FROM garden WHERE slot = ?`).run(slot);
  notify();
}

// ─── Upgrades helpers ──────────────────────────────────────────────────────────

function getUpgrade(id) {
  return db.prepare(`SELECT * FROM upgrades WHERE id = ?`).get(id);
}

function purchaseUpgrade(id, username) {
  db.prepare(`
    INSERT OR REPLACE INTO upgrades (id, purchased, purchased_by) VALUES (?, 1, ?)
  `).run(id, username);
  // Compost Bin reduces water-per-stage requirements, so refresh the overlay.
  notify();
}

function isUpgradePurchased(id) {
  const row = getUpgrade(id);
  return row ? row.purchased === 1 : false;
}

// ─── Active effects ────────────────────────────────────────────────────────────

function addEffect(username, effect, slot, usesLeft) {
  db.prepare(`
    INSERT INTO active_effects (username, effect, slot, uses_left, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(username, effect, slot, usesLeft, Date.now());
}

function getActiveEffect(username, effect, slot = null) {
  if (slot !== null) {
    return db.prepare(`
      SELECT * FROM active_effects WHERE username = ? AND effect = ? AND slot = ? AND uses_left > 0
    `).get(username, effect, slot);
  }
  return db.prepare(`
    SELECT * FROM active_effects WHERE username = ? AND effect = ? AND uses_left > 0
  `).get(username, effect);
}

function consumeEffect(id) {
  db.prepare(`UPDATE active_effects SET uses_left = uses_left - 1 WHERE id = ?`).run(id);
  db.prepare(`DELETE FROM active_effects WHERE uses_left <= 0`).run();
}

module.exports = {
  db,
  events,
  ensureViewer,
  getViewer,
  addPetals,
  addPetalsToMany,
  deductPetals,
  setHeldSeed,
  recordWater,
  getLastWatered,
  getWaterLeaderboard,
  getGardenSlotCount,
  setGardenSlotCount,
  getSlot,
  getAllSlots,
  plantInSlot,
  waterSlot,
  advanceStage,
  clearSlot,
  getUpgrade,
  purchaseUpgrade,
  isUpgradePurchased,
  addEffect,
  getActiveEffect,
  consumeEffect,
};
