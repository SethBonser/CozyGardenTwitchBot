'use strict';

const db = require('../db');
const { fuzzyMatchShopItem, getPlant } = require('../helpers');

// ─── Shop item definitions ────────────────────────────────────────────────────

const SHOP_CATALOG = {
  copper_can: {
    id: 'copper_can',
    name: 'Copper Can',
    emoji: '🪣',
    cost: 400,
    type: 'upgrade',
    description: 'Stream upgrade: Reduces !water cooldown to 8 minutes',
    detail: 'Cooldown: 10min → 8min',
  },
  silver_can: {
    id: 'silver_can',
    name: 'Silver Can',
    emoji: '🪣✨',
    cost: 800,
    type: 'upgrade',
    description: 'Stream upgrade: Reduces !water cooldown to 6 minutes',
    detail: 'Cooldown: → 6min (stacks over Copper Can)',
  },
  compost_bin: {
    id: 'compost_bin',
    name: 'Compost Bin',
    emoji: '🪣🌿',
    cost: 600,
    type: 'upgrade',
    description: 'Stream upgrade: All plants need 20% fewer waters per stage',
    detail: '-20% waters needed for all plants',
  },
  rain_cloud: {
    id: 'rain_cloud',
    name: 'Rain Cloud',
    emoji: '🌧️',
    cost: 200,
    type: 'consumable',
    description: 'Consumable: Instantly waters ALL occupied garden slots once',
    detail: 'Waters every plant in the garden',
  },
  growth_tonic: {
    id: 'growth_tonic',
    name: 'Growth Tonic',
    emoji: '🧪',
    cost: 150,
    type: 'consumable',
    description: 'Consumable: Your next !water on a chosen slot counts as 3 waters',
    detail: 'Use !buy growth tonic <slot> to activate on a specific slot',
  },
};

// ─── !shop ────────────────────────────────────────────────────────────────────

function cmdShop(client, channel, userstate) {
  const upgrades = Object.values(SHOP_CATALOG).filter(i => i.type === 'upgrade');
  const consumables = Object.values(SHOP_CATALOG).filter(i => i.type === 'consumable');

  const upgradeList = upgrades.map(i => {
    const owned = db.isUpgradePurchased(i.id);
    return `${i.emoji} ${i.name} ${i.cost}🌸${owned ? ' ✅' : ''}: ${i.detail}`;
  }).join(' | ');

  const consumableList = consumables.map(i =>
    `${i.emoji} ${i.name} ${i.cost}🌸: ${i.detail}`
  ).join(' | ');

  client.say(channel,
    `🛒 Cozy Garden Shop — Upgrades (stream-wide): ${upgradeList} || Consumables (per-viewer): ${consumableList} || Use !buy <name> to purchase!`
  );
}

// ─── !buy <name> [slot] ───────────────────────────────────────────────────────

function cmdBuy(client, channel, userstate, args) {
  const username = userstate.username;

  if (!args.length) {
    return client.say(channel, `@${username} ❓ Usage: !buy <item name> — e.g. !buy copper can or !buy growth tonic 2`);
  }

  // Last arg might be a slot number for growth tonic — must be a strict positive integer
  let itemArgs = [...args];
  let slotNum = null;
  const lastArg = args[args.length - 1];
  if (args.length > 1 && /^\d+$/.test(String(lastArg))) {
    slotNum = parseInt(lastArg, 10);
    itemArgs = args.slice(0, -1);
  }

  const query = itemArgs.join(' ');
  const match = fuzzyMatchShopItem(query);

  if (!match) {
    return client.say(channel,
      `@${username} ❌ Couldn't find that item. Use !shop to see what's available.`
    );
  }

  const item = SHOP_CATALOG[match.id];
  if (!item) {
    return client.say(channel, `@${username} ❌ Item not found in catalog.`);
  }

  const viewer = db.getViewer(username);

  // ── Upgrades ──────────────────────────────────────────────────────────────

  if (item.type === 'upgrade') {
    if (db.isUpgradePurchased(item.id)) {
      return client.say(channel,
        `@${username} ✅ ${item.emoji} ${item.name} is already purchased! The whole garden benefits.`
      );
    }

    // Copper Can prereq for Silver Can
    if (item.id === 'silver_can' && !db.isUpgradePurchased('copper_can')) {
      return client.say(channel,
        `@${username} 🪣 You need the Copper Can first before upgrading to the Silver Can!`
      );
    }

    if (viewer.petals < item.cost) {
      return client.say(channel,
        `@${username} 💸 Not enough petals! ${item.name} costs ${item.cost}🌸 but you only have ${viewer.petals}🌸.`
      );
    }

    db.deductPetals(username, item.cost);
    db.purchaseUpgrade(item.id, username);

    const updatedViewer = db.getViewer(username);
    client.say(channel,
      `@${username} ${item.emoji} Purchased ${item.name} for the whole garden! ${item.description}. You have ${updatedViewer.petals}🌸 left. 🎉`
    );
    return;
  }

  // ── Consumables ───────────────────────────────────────────────────────────

  if (item.type === 'consumable') {
    if (viewer.petals < item.cost) {
      return client.say(channel,
        `@${username} 💸 Not enough petals! ${item.name} costs ${item.cost}🌸 but you only have ${viewer.petals}🌸.`
      );
    }

    // Rain Cloud: waters all occupied slots
    if (item.id === 'rain_cloud') {
      const slots = db.getAllSlots();
      const occupied = slots.filter(s => s.plant_id);
      if (!occupied.length) {
        return client.say(channel,
          `@${username} 🌧️ The garden is empty — save your Rain Cloud for when there are plants to water!`
        );
      }

      db.deductPetals(username, item.cost);

      let watered = 0;
      for (const s of occupied) {
        const { getGrowthInfo } = require('../helpers');
        const info = getGrowthInfo(s);
        if (info && !info.isBloom) {
          db.waterSlot(s.slot, 1);
          db.recordWater(username);
          // Check for stage advancement
          let updatedSlot = db.getSlot(s.slot);
          let updInfo = getGrowthInfo(updatedSlot);
          const { getWatersNeededWithUpgrade } = require('../helpers');
          const needed = getWatersNeededWithUpgrade(updInfo.watersNeeded);
          while (!updInfo.isBloom && updatedSlot.waters_done >= needed) {
            db.advanceStage(s.slot);
            updatedSlot = db.getSlot(s.slot);
            updInfo = getGrowthInfo(updatedSlot);
          }
          watered++;
        }
      }

      const updatedViewer = db.getViewer(username);
      client.say(channel,
        `@${username} 🌧️ Rain Cloud soaks the whole garden — watered ${watered} plant${watered !== 1 ? 's' : ''}! You have ${updatedViewer.petals}🌸 left.`
      );
      return;
    }

    // Growth Tonic: 3x water on next !water for a slot
    if (item.id === 'growth_tonic') {
      const slotCount = db.getGardenSlotCount();

      if (!slotNum || slotNum < 1 || slotNum > slotCount) {
        return client.say(channel,
          `@${username} 🧪 Specify a slot for your Growth Tonic! e.g. !buy growth tonic 2 (slots 1-${slotCount})`
        );
      }

      const slotRow = db.getSlot(slotNum);
      if (!slotRow || !slotRow.plant_id) {
        return client.say(channel,
          `@${username} 🪨 Slot ${slotNum} is empty! Plant something first.`
        );
      }

      const { getGrowthInfo } = require('../helpers');
      const info = getGrowthInfo(slotRow);
      if (info && info.isBloom) {
        return client.say(channel,
          `@${username} 🌺 Slot ${slotNum} is already blooming! Harvest it first.`
        );
      }

      // Check if they already have a tonic on this slot
      const existing = db.getActiveEffect(username, 'growth_tonic', slotNum);
      if (existing) {
        return client.say(channel,
          `@${username} 🧪 You already have a Growth Tonic on slot ${slotNum}! Use !water ${slotNum} to activate it.`
        );
      }

      db.deductPetals(username, item.cost);
      db.addEffect(username, 'growth_tonic', slotNum, 1);

      const updatedViewer = db.getViewer(username);
      client.say(channel,
        `@${username} 🧪 Growth Tonic applied to slot ${slotNum}! Your next !water ${slotNum} will count as 3 waters 💧💧💧 You have ${updatedViewer.petals}🌸 left.`
      );
      return;
    }
  }

  client.say(channel, `@${username} ❌ Something went wrong processing that purchase.`);
}

module.exports = { cmdShop, cmdBuy };
