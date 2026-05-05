'use strict';

// Clears every garden slot, removes any slot-bound buffs (fertilizer, etc.),
// and resets the slot count to the default of 3.
// Use this to undo `npm run seed-test`. Run with: npm run reset-garden
//
// Does NOT touch viewers, petals, upgrades, or active per-viewer effects.

const db = require('../db');

console.log('🧹 Clearing garden...');

const slots = db.getAllSlots();
let cleared = 0;
let buffsCleared = 0;
for (const s of slots) {
  if (s.plant_id) {
    db.clearSlot(s.slot);    // also auto-clears any buffs on the slot
    cleared++;
  } else {
    // Empty slots aren't touched by clearSlot — sweep their buffs explicitly
    const buffs = db.getSlotBuffs(s.slot);
    for (const b of buffs) {
      db.clearSlotBuff(s.slot, b.buff);
      buffsCleared++;
    }
  }
}

db.setGardenSlotCount(3);

const buffNote = buffsCleared > 0 ? ` and ${buffsCleared} slot buff${buffsCleared === 1 ? '' : 's'}` : '';
console.log(`✅ Cleared ${cleared} planted slot${cleared === 1 ? '' : 's'}${buffNote}; reset garden size to 3.`);
process.exit(0);
