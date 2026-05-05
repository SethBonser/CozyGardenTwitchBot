'use strict';

// Populates the garden with 5 plots for overlay testing:
//   Slots 1-4 — one plant at each growth stage (seed, sprout, budding, bloom)
//   Slot 5  — empty + fertilized (verify the ✨/Fertilized indicator)
// All four "growth" plants are picked from species that already have shipped
// sprite art so you can verify rendering end-to-end. Spans common→rare for
// visual variety.
//
// Run with: npm run seed-test
//
// Overwrites whatever was in slots 1-5 and clears any pre-existing buffs there.
// To restore a clean garden, run: npm run reset-garden

const db = require('../db');

const TEST_PLANTS = [
  { slot: 1, plantId: 'daisy',     stage: 0, label: 'Seed (Daisy — common)' },
  { slot: 2, plantId: 'sunflower', stage: 1, label: 'Sprout (Sunflower — common)' },
  { slot: 3, plantId: 'lavender',  stage: 2, label: 'Budding (Lavender — uncommon)' },
  { slot: 4, plantId: 'bluebells', stage: 3, label: 'Bloom (Bluebells — rare)' },
];

console.log('🌱 Seeding test garden...');

// Need 5 slots: 4 growth stages + 1 fertilized-empty
db.setGardenSlotCount(5);

for (const t of TEST_PLANTS) {
  // plantInSlot resets stage to 0 and waters_done to 0; clear any leftover
  // slot-buffs first so each test run starts clean
  db.clearSlotBuff(t.slot, 'fertilizer');
  db.plantInSlot(t.slot, t.plantId, 'test-runner');
  for (let i = 0; i < t.stage; i++) {
    db.advanceStage(t.slot);
  }
  console.log(`  Slot ${t.slot}: ${t.label}`);
}

// Slot 5 — empty + fertilized so you can verify the fertilizer overlay indicator
db.clearSlot(5);
db.addSlotBuff(5, 'fertilizer', 'test-runner');
console.log('  Slot 5: Empty + Fertilized ✨ (verify the green "Fertilized" tag)');

console.log('✅ Done. Run `npm start` and refresh your overlay to see all stages + the fertilized slot.');
process.exit(0);
