'use strict';

const db = require('../db');
const { getPlant, rarityLabel, parseSlot } = require('../helpers');

// If the viewer holds a seed that's no longer in plants.json, auto-discard so they aren't stuck.
function clearStaleSeed(client, channel, viewer) {
  if (!viewer.held_seed) return false;
  if (getPlant(viewer.held_seed)) return false;
  db.setHeldSeed(viewer.username, null);
  client.say(channel,
    `@${viewer.username} 🍃 Your held seed ("${viewer.held_seed}") is no longer available and has been released. Redeem "Get a Seed" again!`
  );
  return true;
}

// ─── !seed ────────────────────────────────────────────────────────────────────
// Shows the viewer's currently held seed

function cmdSeed(client, channel, userstate) {
  const viewer = db.getViewer(userstate.username);
  if (!viewer.held_seed) {
    return client.say(channel,
      `@${userstate.username} 🌱 You don't have a seed! Redeem the "Get a Seed" channel point reward to get one.`
    );
  }
  if (clearStaleSeed(client, channel, viewer)) return;
  const plant = getPlant(viewer.held_seed);
  client.say(channel,
    `@${userstate.username} 🌱 You're holding a ${plant.emoji} ${plant.name} seed (${rarityLabel(plant.rarity)}). Use !plant <slot> to plant it, or !discard to release it.`
  );
  if (plant.fact) {
    client.say(channel, `📖 Fun fact: ${plant.fact}`);
  }
}

// ─── !plant [slot] ────────────────────────────────────────────────────────────
// Plants the held seed into a specified (or first available) slot

function cmdPlant(client, channel, userstate, args) {
  const username = userstate.username;
  const viewer = db.getViewer(username);

  if (!viewer.held_seed) {
    return client.say(channel,
      `@${username} 🌱 You don't have a seed to plant! Redeem "Get a Seed" to receive one.`
    );
  }

  if (clearStaleSeed(client, channel, viewer)) return;

  const plant = getPlant(viewer.held_seed);
  const slotCount = db.getGardenSlotCount();

  let targetSlotNum;

  if (args[0] !== undefined) {
    const parsed = parseSlot(args[0], slotCount);
    if (!parsed.ok) {
      return client.say(channel,
        `@${username} ❌ Invalid slot. Use a whole number between 1 and ${slotCount}.`
      );
    }
    targetSlotNum = parsed.slot;
    const existing = db.getSlot(targetSlotNum);
    if (existing && existing.plant_id) {
      return client.say(channel,
        `@${username} 🌿 Slot ${targetSlotNum} already has a plant! Harvest or choose an empty slot.`
      );
    }
  } else {
    // Auto-find first empty slot
    const slots = db.getAllSlots();
    const empty = slots.find(s => !s.plant_id);
    if (!empty) {
      return client.say(channel,
        `@${username} 🌿 The garden is full! Harvest a bloomed plant first to free up a slot.`
      );
    }
    targetSlotNum = empty.slot;
  }

  db.plantInSlot(targetSlotNum, viewer.held_seed, username);
  db.setHeldSeed(username, null);

  client.say(channel,
    `@${username} 🌱 Planted ${plant ? plant.emoji + ' ' + plant.name : viewer.held_seed} in slot ${targetSlotNum}! Water it to help it grow 💧`
  );
}

// ─── !discard ─────────────────────────────────────────────────────────────────
// Releases the held seed without planting it

function cmdDiscard(client, channel, userstate) {
  const username = userstate.username;
  const viewer = db.getViewer(username);

  if (!viewer.held_seed) {
    return client.say(channel, `@${username} 🌱 You don't have a seed to discard.`);
  }

  const plant = getPlant(viewer.held_seed);
  db.setHeldSeed(username, null);

  client.say(channel,
    `@${username} 🍃 You gently released your ${plant ? plant.emoji + ' ' + plant.name : 'seed'} back to the breeze...`
  );
}

module.exports = { cmdSeed, cmdPlant, cmdDiscard };
