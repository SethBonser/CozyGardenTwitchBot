'use strict';

const db = require('../db');
const { fuzzyMatchShopItem, getPlant } = require('../helpers');

// ─── Shop item definitions ────────────────────────────────────────────────────
// Action items reuse the perform functions injected by index.js via `ctx`.
// In channel-rewards mode, !buy <action> simply redirects to the matching
// channel point reward instead of charging petals.

// Shop is split into four clear categories for easier browsing.
const CATEGORIES = [
  { id: 'seeds',   label: '🌱 Seeds' },
  { id: 'garden',  label: '🌿 Garden Actions' },
  { id: 'tools',   label: '🪣 Watering Tools' },
  { id: 'boosts',  label: '🧪 Boosts' },
];

const SHOP_CATALOG = {
  // ── 🌱 Seeds (action, cost from ctx.costs at runtime) ───────────────────────
  seed: {
    id: 'seed', name: 'Get a Seed', emoji: '🎁',
    type: 'action', category: 'seeds', actionId: 'seed', rewardName: 'Get a Seed',
    description: 'Receive a random seed (60% common / 30% uncommon / 10% rare)',
  },
  uncommon_seed: {
    id: 'uncommon_seed', name: 'Uncommon Seed', emoji: '🍀',
    type: 'action', category: 'seeds', actionId: 'uncommon_seed', rewardName: 'Uncommon Seed',
    petalsOnly: true,  // Petals-only — there is no channel reward equivalent
    description: 'Receive an uncommon seed (75% uncommon / 25% rare — never common)',
  },
  rare_seed: {
    id: 'rare_seed', name: 'Rare Seed', emoji: '🌟',
    type: 'action', category: 'seeds', actionId: 'rare_seed', rewardName: 'Rare Seed',
    description: 'Receive a guaranteed rare seed',
  },

  // ── 🌿 Garden actions (action, cost from ctx.costs at runtime) ─────────────
  water: {
    id: 'water', name: 'Water Plant', emoji: '💧',
    type: 'action', category: 'garden', actionId: 'water', rewardName: 'Water Plant',
    description: 'Water a plant (auto-picks lowest progress; pass a slot number to target)',
  },
  harvest: {
    id: 'harvest', name: 'Harvest', emoji: '🌺',
    type: 'action', category: 'garden', actionId: 'harvest', rewardName: 'Harvest Plant',
    description: 'Harvest a bloomed plant (free — it\'s the payout)',
  },
  expand: {
    id: 'expand', name: 'Expand Garden', emoji: '🌿',
    type: 'action', category: 'garden', actionId: 'expand', rewardName: 'Expand Garden',
    description: 'Add one slot to the shared garden',
  },
  fertilize: {
    id: 'fertilize', name: 'Fertilize', emoji: '🌱',
    type: 'action', category: 'garden', actionId: 'fertilize', rewardName: 'Fertilize',
    petalsOnly: true,  // Petals only — no channel reward equivalent
    description: 'Apply fertilizer to an empty slot — the next plant there grows with HALF the waters needed at every stage. Use !buyfertilize <slot>',
  },

  // ── 🪣 Watering Tools (one-time stream-wide upgrades) ──────────────────────
  compost_bin: {
    id: 'compost_bin', name: 'Compost Bin', emoji: '🪣🌿',
    cost: 600, type: 'upgrade', category: 'tools',
    description: 'Stream upgrade: All plants need 20% fewer waters per stage',
    detail: '-20% waters needed for all plants',
  },
  copper_can: {
    id: 'copper_can', name: 'Copper Can', emoji: '🪣',
    cost: 400, type: 'upgrade', category: 'tools',
    description: '(Vestigial) Stream upgrade — used to reduce a watering cooldown that no longer exists',
    detail: 'vestigial — safe to ignore',
  },
  silver_can: {
    id: 'silver_can', name: 'Silver Can', emoji: '🪣✨',
    cost: 800, type: 'upgrade', category: 'tools',
    description: '(Vestigial) Stream upgrade — see Copper Can. Requires Copper Can.',
    detail: 'vestigial — safe to ignore',
  },

  // ── 🧪 Boosts (per-viewer single-use consumables) ──────────────────────────
  rain_cloud: {
    id: 'rain_cloud', name: 'Rain Cloud', emoji: '🌧️',
    cost: 200, type: 'consumable', category: 'boosts',
    description: 'Consumable: Instantly waters ALL occupied garden slots once',
    detail: 'Waters every plant in the garden',
  },
  growth_tonic: {
    id: 'growth_tonic', name: 'Growth Tonic', emoji: '🧪',
    cost: 150, type: 'consumable', category: 'boosts',
    description: 'Consumable: Your next !water on a chosen slot counts as 3 waters',
    detail: 'Use !buytonic <slot> to activate on a specific slot',
  },
};

// ─── !shop ────────────────────────────────────────────────────────────────────

function cmdShop(client, channel, userstate, ctx = {}) {
  const useChannelRewards = !!ctx.useChannelRewards;
  const costs = ctx.costs || {};

  // Format a single shop entry into "<emoji> <name> <price>" depending on type
  function formatItem(i) {
    if (i.type === 'action') {
      // petalsOnly actions show their petal price even in channel-rewards mode
      if (useChannelRewards && !i.petalsOnly) return `${i.emoji} ${i.name} (channel reward)`;
      const cost = costs[i.actionId];
      const priceLabel = cost && cost > 0 ? `${cost}🌸` : 'free';
      return `${i.emoji} ${i.name} ${priceLabel}`;
    }
    if (i.type === 'upgrade') {
      const owned = db.isUpgradePurchased(i.id);
      return `${i.emoji} ${i.name} ${i.cost}🌸${owned ? ' ✅' : ''}`;
    }
    // consumable
    return `${i.emoji} ${i.name} ${i.cost}🌸`;
  }

  // Build "<label>: item | item | item" for one category
  function renderCategory(catId) {
    const cat = CATEGORIES.find(c => c.id === catId);
    const items = Object.values(SHOP_CATALOG).filter(i => i.category === catId);
    return `${cat.label}: ${items.map(formatItem).join(' | ')}`;
  }

  // Two messages — first covers seeds + garden actions, second covers tools + boosts.
  // Each message stays well under Twitch's 500-char limit and the four labelled
  // sections give viewers clear visual separation.
  client.say(channel,
    `🛒 Cozy Garden Shop — ${renderCategory('seeds')} || ${renderCategory('garden')}`
  );
  client.say(channel,
    `🛒 ${renderCategory('tools')} || ${renderCategory('boosts')} || Use !buyseed !buyrare !buywater !buyharvest !buyrain !buytonic [slot] !buyfertilize [slot] !buyexpand etc, or !buy <name> [slot]`
  );
}

// ─── !buy <name> [slot] ───────────────────────────────────────────────────────

function cmdBuy(client, channel, userstate, args, ctx = {}) {
  const username = userstate.username;

  if (!args.length) {
    return client.say(channel, `@${username} ❓ Usage: !buyseed | !buyrare | !buywater 2 | !buytonic 2 | !buyfertilize 2 — or !buy <name> [slot]. See !shop for all items.`);
  }

  // Last arg might be a slot number (for growth tonic, water, harvest) — must
  // be a strict positive integer
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

  // ── Action items (Get Seed / Rare Seed / Water / Harvest / Expand) ─────────
  // In channel-rewards mode, redirect users to the matching channel reward.
  // In petals mode, charge the configured cost and run the perform function.

  if (item.type === 'action') {
    // Some actions (e.g. fertilize) are petals-only by design — no channel reward
    // equivalent exists, so they always charge petals regardless of mode.
    if (ctx.useChannelRewards && !item.petalsOnly) {
      return client.say(channel,
        `@${username} 🌿 The "${item.rewardName}" action is a channel point reward — redeem it from the rewards menu instead!`
      );
    }
    const performFn = ctx.performAction && ctx.performAction[item.actionId];
    if (typeof performFn !== 'function') {
      return client.say(channel, `@${username} ❌ This action isn't wired up — check the bot's setup.`);
    }
    const cost = (ctx.costs && ctx.costs[item.actionId]) || 0;
    const message = slotNum != null ? String(slotNum) : '';

    if (typeof ctx.runPetalCostAction === 'function') {
      return ctx.runPetalCostAction(channel, username, item.name.toLowerCase(), cost, () => performFn(username, message));
    }

    // Fallback inline runner if no helper passed
    if (cost > 0) {
      const v = db.getViewer(username);
      if (v.petals < cost) {
        return client.say(channel, `@${username} 💸 Need ${cost}🌸 for ${item.name} (you have ${v.petals}🌸).`);
      }
    }
    const result = performFn(username, message);
    for (const m of result.messages) client.say(channel, m);
    if (result.ok && cost > 0) {
      db.deductPetals(username, cost);
      const remaining = db.getViewer(username).petals;
      client.say(channel, `@${username} 💸 -${cost}🌸 (balance: ${remaining}🌸)`);
    }
    return;
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
          const { getEffectiveWatersNeeded } = require('../helpers');
          const needed = getEffectiveWatersNeeded(s.slot, updInfo.watersNeeded);
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
          `@${username} 🧪 Specify a slot for your Growth Tonic! e.g. !buytonic 2 (slots 1-${slotCount})`
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
