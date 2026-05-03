'use strict';

// Populates the garden with 4 plots, each at a different stage, for overlay testing.
// Run with: npm run seed-test
//
// Resets all four slots — anything currently planted there is overwritten.
// To restore a clean garden, run: npm run reset-garden

const db = require('../db');

const TEST_PLANTS = [
  { slot: 1, plantId: 'daisy',       stage: 0, label: 'Seed (Daisy)' },
  { slot: 2, plantId: 'tulip',       stage: 1, label: 'Sprout (Tulip)' },
  { slot: 3, plantId: 'lavender',    stage: 2, label: 'Budding (Lavender)' },
  { slot: 4, plantId: 'crystalrose', stage: 3, label: 'Bloom (Crystal Rose)' },
];

console.log('🌱 Seeding test garden...');

// Make sure we have at least 4 slots
db.setGardenSlotCount(4);

for (const t of TEST_PLANTS) {
  // Plant resets stage to 0 and waters_done to 0
  db.plantInSlot(t.slot, t.plantId, 'test-runner');
  // Bump to the desired stage by advancing the appropriate number of times
  for (let i = 0; i < t.stage; i++) {
    db.advanceStage(t.slot);
  }
  console.log(`  Slot ${t.slot}: ${t.label}`);
}

console.log('✅ Done. Run `npm start` and refresh your overlay to see all four stages.');
process.exit(0);
