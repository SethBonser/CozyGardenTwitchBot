'use strict';

const plants = require('./data/plants.json');

// ─── Plant lookup ──────────────────────────────────────────────────────────────

const plantMap = Object.fromEntries(plants.map(p => [p.id, p]));

function getPlant(id) {
  return plantMap[id] || null;
}

// Weighted random seed selection
// Weights: common 60%, uncommon 30%, rare 10%
const RARITY_WEIGHTS = { common: 60, uncommon: 30, rare: 10 };

function rollSeed(forcedRarity = null) {
  let pool;
  if (forcedRarity) {
    pool = plants.filter(p => p.rarity === forcedRarity);
  } else {
    const roll = Math.random() * 100;
    let rarity;
    if (roll < 60) rarity = 'common';
    else if (roll < 90) rarity = 'uncommon';
    else rarity = 'rare';
    pool = plants.filter(p => p.rarity === rarity);
  }
  if (!pool.length) return plants[0];
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── Growth stage helpers ──────────────────────────────────────────────────────

const STAGE_EMOJIS = ['🌱', '🌿', '🌸', '🌺'];
const STAGE_NAMES  = ['Seed', 'Sprout', 'Budding', 'Blooming'];

// Returns { stage, watersNeeded, watersDone, isBloom }
function getGrowthInfo(slotRow) {
  if (!slotRow || !slotRow.plant_id) return null;
  const plant = getPlant(slotRow.plant_id);
  if (!plant) return null;
  const stage = slotRow.stage || 0;
  const isBloom = stage >= 3;
  const watersNeeded = isBloom ? 0 : plant.watersPerStage[stage];
  return {
    plant,
    stage,
    isBloom,
    watersNeeded,
    watersDone: slotRow.waters_done || 0,
  };
}

// ─── Progress bar ──────────────────────────────────────────────────────────────

function progressBar(done, needed, width = 8) {
  if (needed === 0) return '█'.repeat(width);
  const filled = Math.min(Math.round((done / needed) * width), width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// ─── Slot display ──────────────────────────────────────────────────────────────

function formatSlot(slotRow) {
  if (!slotRow || !slotRow.plant_id) {
    return `[${slotRow.slot}] 🪨 Empty`;
  }
  const info = getGrowthInfo(slotRow);
  if (!info) return `[${slotRow.slot}] ❓ Unknown plant`;

  const { plant, stage, isBloom, watersNeeded, watersDone } = info;
  const stageEmoji = STAGE_EMOJIS[Math.min(stage, 3)];
  const stageName  = STAGE_NAMES[Math.min(stage, 3)];

  if (isBloom) {
    return `[${slotRow.slot}] ${plant.emoji} ${plant.name} — ${stageEmoji} ${stageName}! Ready to harvest 🌺`;
  }

  const bar = progressBar(watersDone, watersNeeded);
  return `[${slotRow.slot}] ${plant.emoji} ${plant.name} (${plant.rarity}) — ${stageEmoji} ${stageName} [${bar}] ${watersDone}/${watersNeeded}💧`;
}

// ─── Rarity display ───────────────────────────────────────────────────────────

const RARITY_EMOJI = { common: '⚪', uncommon: '🟢', rare: '🌟' };

function rarityLabel(rarity) {
  return `${RARITY_EMOJI[rarity] || ''} ${rarity}`;
}

// ─── Fuzzy name matching ──────────────────────────────────────────────────────

const SHOP_ITEMS = [
  { id: 'copper_can',    name: 'Copper Can',    aliases: ['copper', 'coppercan'] },
  { id: 'silver_can',   name: 'Silver Can',    aliases: ['silver', 'silvercan'] },
  { id: 'compost_bin',  name: 'Compost Bin',   aliases: ['compost', 'compostbin'] },
  { id: 'rain_cloud',   name: 'Rain Cloud',    aliases: ['rain', 'raincloud', 'cloud'] },
  { id: 'growth_tonic', name: 'Growth Tonic',  aliases: ['tonic', 'growthtonic', 'growth'] },
];

function fuzzyMatchShopItem(input) {
  const norm = input.toLowerCase().replace(/\s+/g, '');
  for (const item of SHOP_ITEMS) {
    if (
      item.id === norm ||
      item.name.toLowerCase().replace(/\s+/g, '') === norm ||
      item.aliases.includes(norm)
    ) {
      return item;
    }
  }
  // Partial match fallback
  for (const item of SHOP_ITEMS) {
    if (item.name.toLowerCase().includes(norm) || item.id.includes(norm)) {
      return item;
    }
  }
  return null;
}

// ─── Input parsing ────────────────────────────────────────────────────────────

// Strictly parses a slot argument: requires a positive integer with no extra characters.
// Returns { ok: true, slot: number } or { ok: false, reason: 'not-a-number' | 'out-of-range' }
function parseSlot(input, slotCount) {
  if (input === null || input === undefined) return { ok: false, reason: 'not-a-number' };
  const str = String(input).trim();
  if (!/^\d+$/.test(str)) return { ok: false, reason: 'not-a-number' };
  const n = parseInt(str, 10);
  if (n < 1 || n > slotCount) return { ok: false, reason: 'out-of-range' };
  return { ok: true, slot: n };
}

// Extracts the first positive integer from free-form text (used for reward-redemption messages).
// Returns the same shape as parseSlot.
function extractSlot(text, slotCount) {
  if (!text) return { ok: false, reason: 'not-a-number' };
  const match = String(text).match(/\d+/);
  if (!match) return { ok: false, reason: 'not-a-number' };
  return parseSlot(match[0], slotCount);
}

// ─── Cooldown helpers ─────────────────────────────────────────────────────────

function getCooldownMs() {
  const minutes = parseInt(process.env.WATER_COOLDOWN_MINUTES || '10', 10);
  // Check upgrade reductions
  const { isUpgradePurchased } = require('./db');
  if (isUpgradePurchased('silver_can')) return 6 * 60 * 1000;
  if (isUpgradePurchased('copper_can')) return 8 * 60 * 1000;
  return minutes * 60 * 1000;
}

function getWatersNeededWithUpgrade(baseWaters) {
  const { isUpgradePurchased } = require('./db');
  if (isUpgradePurchased('compost_bin')) {
    return Math.max(1, Math.ceil(baseWaters * 0.8));
  }
  return baseWaters;
}

module.exports = {
  getPlant,
  rollSeed,
  getGrowthInfo,
  progressBar,
  formatSlot,
  rarityLabel,
  fuzzyMatchShopItem,
  SHOP_ITEMS,
  getCooldownMs,
  getWatersNeededWithUpgrade,
  parseSlot,
  extractSlot,
  STAGE_EMOJIS,
  STAGE_NAMES,
  RARITY_WEIGHTS,
};
