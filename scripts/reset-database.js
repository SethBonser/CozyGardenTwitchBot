'use strict';

// Wipes every row from every game table and resets the garden slot count to
// the default of 3 — essentially a full "start over" without deleting the
// SQLite file itself (keeps the file/permissions/WAL setup intact).
//
// DESTRUCTIVE — this clears every viewer, every petal balance, every planted
// slot, every upgrade, every consumable, and the full harvest log. It does
// NOT touch plants.json or sprite assets.
//
// Run with: npm run reset-database -- --yes
//
// Stop the bot first (it locks the SQLite file while running).

const REQUIRES_FLAG = '--yes';

if (!process.argv.includes(REQUIRES_FLAG)) {
  console.log('');
  console.log('⚠️  Database reset is destructive and will erase ALL viewers,');
  console.log('    petal balances, planted slots, upgrades, and consumables.');
  console.log('');
  console.log('    To actually run it, pass --yes (any of these work):');
  console.log('');
  console.log('        node scripts/reset-database.js --yes      ← most reliable');
  console.log('        npm run reset-database -- --yes           ← bash/cmd');
  console.log('        npm run reset-database --% -- --yes       ← PowerShell');
  console.log('');
  console.log('    (Make sure the bot is stopped first — SQLite locks the DB while it runs.)');
  console.log('');
  process.exit(1);
}

const db = require('../db').db;

console.log('🧨 Resetting CozyGardenBot database...');

const tx = db.transaction(() => {
  // Wipe game state tables
  db.prepare('DELETE FROM garden').run();
  db.prepare('DELETE FROM viewers').run();
  db.prepare('DELETE FROM upgrades').run();
  db.prepare('DELETE FROM active_effects').run();
  db.prepare('DELETE FROM slot_buffs').run();
  db.prepare('DELETE FROM harvest_log').run();

  // Reset garden slot count to the default
  db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES ('garden_slots', '3')`).run();
});

tx();

// Reclaim disk space since SQLite leaves deleted-row pages around otherwise
db.prepare('VACUUM').run();

console.log('✅ Database fully reset:');
console.log('   • garden:         all slots cleared');
console.log('   • viewers:        all profiles, petals, and starter-claimed flags wiped');
console.log('   • upgrades:       all stream-wide purchases reverted');
console.log('   • active_effects: all per-viewer consumables removed');
console.log('   • slot_buffs:     all slot-bound buffs (fertilizer, etc.) removed');
console.log('   • harvest_log:    all harvest history cleared');
console.log('   • garden size:    reset to default 3 slots');
console.log('');
console.log('   Plants.json and sprite assets were NOT touched.');
console.log('   Start the bot again with `npm start` for a fresh garden!');

process.exit(0);
