'use strict';

const db = require('../db');
const { getPlant, getGrowthInfo, rarityLabel } = require('../helpers');

// ─── !harvest [slot] ──────────────────────────────────────────────────────────
// Collects a fully bloomed plant and awards petals to the harvester

function cmdHarvest(client, channel, userstate, args) {
  const username = userstate.username;
  const slotCount = db.getGardenSlotCount();

  let targetSlotNum;

  if (args[0]) {
    targetSlotNum = parseInt(args[0], 10);
    if (isNaN(targetSlotNum) || targetSlotNum < 1 || targetSlotNum > slotCount) {
      return client.say(channel,
        `@${username} ❌ Invalid slot. Use a number between 1 and ${slotCount}.`
      );
    }
  } else {
    // Auto-find first bloomed slot
    const slots = db.getAllSlots();
    const bloomed = slots.find(s => {
      if (!s.plant_id) return false;
      const info = getGrowthInfo(s);
      return info && info.isBloom;
    });
    if (!bloomed) {
      return client.say(channel,
        `@${username} 🌸 No bloomed plants ready to harvest! Keep watering 💧`
      );
    }
    targetSlotNum = bloomed.slot;
  }

  const slotRow = db.getSlot(targetSlotNum);
  if (!slotRow || !slotRow.plant_id) {
    return client.say(channel, `@${username} 🪨 Slot ${targetSlotNum} is empty!`);
  }

  const info = getGrowthInfo(slotRow);
  if (!info) {
    return client.say(channel, `@${username} ❓ Something went wrong with that slot.`);
  }
  if (!info.isBloom) {
    return client.say(channel,
      `@${username} 🌿 Slot ${targetSlotNum} isn't blooming yet! Keep watering it 💧`
    );
  }

  const { plant } = info;
  const petals = plant.harvestPetals;

  db.addPetals(username, petals);
  db.clearSlot(targetSlotNum);

  const viewer = db.getViewer(username);

  client.say(channel,
    `@${username} 🌺 You harvested a ${plant.emoji} ${plant.name} (${rarityLabel(plant.rarity)})! +${petals}🌸 petals. Total: ${viewer.petals}🌸 — Slot ${targetSlotNum} is now empty and ready for a new seed!`
  );
}

module.exports = { cmdHarvest };
