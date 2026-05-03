'use strict';

// Clears every garden slot and resets the slot count to the default of 3.
// Use this to undo `npm run seed-test`. Run with: npm run reset-garden
//
// Does NOT touch viewers, petals, upgrades, or active effects.

const db = require('../db');

console.log('🧹 Clearing garden...');

const slots = db.getAllSlots();
let cleared = 0;
for (const s of slots) {
  if (s.plant_id) {
    db.clearSlot(s.slot);
    cleared++;
  }
}

db.setGardenSlotCount(3);

console.log(`✅ Cleared ${cleared} planted slot${cleared === 1 ? '' : 's'} and reset garden size to 3.`);
process.exit(0);
