'use strict';

const db = require('../db');
const {
  getPlant,
  getGrowthInfo,
  formatSlot,
  progressBar,
  rarityLabel,
  getCooldownMs,
  getEffectiveWatersNeeded,
  parseSlot,
  STAGE_EMOJIS,
  STAGE_NAMES,
} = require('../helpers');

// ─── !garden [slot] ──────────────────────────────────────────────────────────
// No arg: show all garden slots with progress bars
// With slot number: show detailed info about that slot

function cmdGarden(client, channel, userstate, args) {
  const username = userstate.username;
  const slotCount = db.getGardenSlotCount();

  if (args && args[0] !== undefined) {
    const parsed = parseSlot(args[0], slotCount);
    if (!parsed.ok) {
      return client.say(channel, `@${username} ❌ Invalid slot. Use a whole number between 1 and ${slotCount}.`);
    }
    const slotNum = parsed.slot;
    const slot = db.getSlot(slotNum);
    if (!slot || !slot.plant_id) {
      return client.say(channel, `@${username} 🪨 Slot ${slotNum} is empty — plant a seed here!`);
    }
    const info = getGrowthInfo(slot);
    if (!info) {
      return client.say(channel, `@${username} ❓ Slot ${slotNum} has an unknown plant.`);
    }
    const { plant, stage, isBloom, watersDone } = info;
    const needed = isBloom ? 0 : getEffectiveWatersNeeded(slotNum, info.watersNeeded);
    const stageEmoji = STAGE_EMOJIS[Math.min(stage, 3)];
    const stageName  = STAGE_NAMES[Math.min(stage, 3)];
    const plantedBy = slot.planted_by ? `planted by ${slot.planted_by}` : 'planted by ?';

    if (isBloom) {
      return client.say(channel,
        `🌺 Slot ${slotNum}: ${plant.emoji} ${plant.name} (${rarityLabel(plant.rarity)}) — ${stageEmoji} ${stageName}! Ready to harvest for ${plant.harvestPetals}🌸 — ${plantedBy}`
      );
    }

    const bar = progressBar(watersDone, needed);
    return client.say(channel,
      `🌿 Slot ${slotNum}: ${plant.emoji} ${plant.name} (${rarityLabel(plant.rarity)}) — ${stageEmoji} ${stageName} [${bar}] ${watersDone}/${needed}💧 — Harvest reward: ${plant.harvestPetals}🌸 — ${plantedBy}`
    );
  }

  const slots = db.getAllSlots();
  const header = `🌿 The Garden (${slotCount} slots):`;
  const lines = slots.map(s => formatSlot(s));
  client.say(channel, header + ' ' + lines.join(' '));
}

// ─── !water [slot] ────────────────────────────────────────────────────────────
// Waters a plant. Auto-picks slot with lowest percentage progress if no slot given.

function cmdWater(client, channel, userstate, args) {
  const username = userstate.username;
  const cooldownMs = getCooldownMs();
  const lastWatered = db.getLastWatered(username);
  const elapsed = Date.now() - lastWatered;

  if (cooldownMs > 0 && elapsed < cooldownMs) {
    const remaining = Math.ceil((cooldownMs - elapsed) / 1000);
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    return client.say(channel,
      `@${username} 💧 Your watering can is refilling! Ready in ${mins}m ${secs}s. ☁️`
    );
  }

  const slots = db.getAllSlots();
  const slotCount = db.getGardenSlotCount();

  // Filter to occupied, non-bloomed slots
  const waterable = slots.filter(s => {
    if (!s.plant_id) return false;
    const info = getGrowthInfo(s);
    return info && !info.isBloom;
  });

  if (!waterable.length) {
    return client.say(channel,
      `@${username} 🌿 No plants need watering right now! Try harvesting bloomed ones 🌺`
    );
  }

  let targetSlot;

  if (args[0]) {
    const slotNum = parseInt(args[0], 10);
    if (isNaN(slotNum) || slotNum < 1 || slotNum > slotCount) {
      return client.say(channel, `@${username} ❌ Invalid slot. Use a number between 1 and ${slotCount}.`);
    }
    targetSlot = db.getSlot(slotNum);
    if (!targetSlot || !targetSlot.plant_id) {
      return client.say(channel, `@${username} 🪨 Slot ${slotNum} is empty!`);
    }
    const info = getGrowthInfo(targetSlot);
    if (info.isBloom) {
      return client.say(channel, `@${username} 🌺 Slot ${slotNum} is already blooming! Use !harvest ${slotNum}`);
    }
  } else {
    // Auto-pick: slot with lowest water progress percentage
    let lowestPct = Infinity;
    for (const s of waterable) {
      const info = getGrowthInfo(s);
      const needed = getEffectiveWatersNeeded(s.slot, info.watersNeeded);
      const pct = needed > 0 ? info.watersDone / needed : 1;
      if (pct < lowestPct) {
        lowestPct = pct;
        targetSlot = s;
      }
    }
  }

  // Check for Growth Tonic effect
  const tonic = db.getActiveEffect(username, 'growth_tonic', targetSlot.slot);
  const waterAmount = tonic ? 3 : 1;
  if (tonic) {
    db.consumeEffect(tonic.id);
  }

  // Apply waters
  db.waterSlot(targetSlot.slot, waterAmount);
  db.recordWater(username);

  // Re-fetch to check stage advancement
  let updatedSlot = db.getSlot(targetSlot.slot);
  let info = getGrowthInfo(updatedSlot);
  const needed = getEffectiveWatersNeeded(targetSlot.slot, info.watersNeeded);

  let advanceMsg = '';
  while (!info.isBloom && updatedSlot.waters_done >= needed) {
    db.advanceStage(targetSlot.slot);
    updatedSlot = db.getSlot(targetSlot.slot);
    info = getGrowthInfo(updatedSlot);
    if (info.isBloom) {
      advanceMsg = ` 🌺 ${info.plant.name} is BLOOMING! Use !harvest ${targetSlot.slot} to collect it!`;
    } else {
      advanceMsg = ` ✨ It grew to ${['Seed','Sprout','Budding','Blooming'][info.stage]}!`;
    }
  }

  const tonicMsg = waterAmount > 1 ? ` (Growth Tonic: x${waterAmount}💧)` : '';
  client.say(channel,
    `@${username} 💧 Watered slot ${targetSlot.slot}!${tonicMsg}${advanceMsg} ${formatSlot(updatedSlot)}`
  );
}

// ─── !petals ──────────────────────────────────────────────────────────────────

function cmdPetals(client, channel, userstate) {
  const viewer = db.getViewer(userstate.username);
  client.say(channel, `@${userstate.username} 🌸 You have ${viewer.petals} petals.`);
}

// ─── !gardeners ──────────────────────────────────────────────────────────────

function cmdGardeners(client, channel) {
  const leaders = db.getWaterLeaderboard(3);
  if (!leaders.length) {
    return client.say(channel, '🌿 No gardeners yet! Use !water to start tending the garden.');
  }
  const medals = ['🥇', '🥈', '🥉'];
  const entries = leaders.map((l, i) => `${medals[i]} ${l.username} (${l.waters_given}💧)`);
  client.say(channel, `🌸 Top Gardeners: ${entries.join(' | ')}`);
}

module.exports = { cmdGarden, cmdWater, cmdPetals, cmdGardeners };
