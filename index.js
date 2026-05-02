'use strict';

require('dotenv').config();
const tmi = require('tmi.js');
const db = require('./db');
const { rollSeed, getPlant, getGrowthInfo, formatSlot, getWatersNeededWithUpgrade, rarityLabel, extractSlot } = require('./helpers');
const overlayServer = require('./overlay/server');

// Commands
const { cmdGarden, cmdPetals, cmdGardeners } = require('./commands/garden');
const { cmdSeed, cmdPlant, cmdDiscard } = require('./commands/seeds');
const { cmdShop, cmdBuy } = require('./commands/shop');

// ─── Validate environment ─────────────────────────────────────────────────────

const BOT_USERNAME   = process.env.BOT_USERNAME;
const OAUTH_TOKEN    = process.env.OAUTH_TOKEN;
const CHANNEL_NAME   = process.env.CHANNEL_NAME;

if (!BOT_USERNAME || !OAUTH_TOKEN || !CHANNEL_NAME) {
  console.error('❌  Missing required env vars: BOT_USERNAME, OAUTH_TOKEN, CHANNEL_NAME');
  console.error('    Copy .env.example to .env and fill in your credentials.');
  process.exit(1);
}

const GET_SEED_REWARD_ID    = process.env.GET_SEED_REWARD_ID    || '';
const RARE_SEED_REWARD_ID   = process.env.RARE_SEED_REWARD_ID   || '';
const EXPAND_PLOT_REWARD_ID = process.env.EXPAND_PLOT_REWARD_ID || '';
const WATER_REWARD_ID       = process.env.WATER_REWARD_ID       || '';
const HARVEST_REWARD_ID     = process.env.HARVEST_REWARD_ID     || '';
const MAX_SLOTS    = parseInt(process.env.MAX_GARDEN_SLOTS || '10', 10);
const OVERLAY_PORT = parseInt(process.env.OVERLAY_PORT || '8080', 10);

const channel = `#${CHANNEL_NAME}`;

// ─── TMI client ───────────────────────────────────────────────────────────────

const client = new tmi.Client({
  options: { debug: false },
  identity: {
    username: BOT_USERNAME,
    password: OAUTH_TOKEN,
  },
  channels: [CHANNEL_NAME],
});

// ─── Message router ───────────────────────────────────────────────────────────

client.on('message', (chan, userstate, message, self) => {
  if (self) return;
  if (!message.startsWith('!')) return;

  const parts = message.trim().split(/\s+/);
  const cmd   = parts[0].toLowerCase();
  const args  = parts.slice(1);

  switch (cmd) {
    case '!garden':
      cmdGarden(client, chan, userstate, args);
      break;

    case '!water':
      client.say(chan, `@${userstate.username} 💧 Watering is done via channel point rewards!`);
      break;

    case '!petals':
      cmdPetals(client, chan, userstate);
      break;

    case '!gardeners':
      cmdGardeners(client, chan);
      break;

    case '!seed':
      cmdSeed(client, chan, userstate);
      break;

    case '!plant':
      cmdPlant(client, chan, userstate, args);
      break;

    case '!discard':
      cmdDiscard(client, chan, userstate);
      break;

    case '!harvest':
      client.say(chan, `@${userstate.username} 🌺 Harvesting is done via channel point rewards!`);
      break;

    case '!shop':
      cmdShop(client, chan, userstate);
      break;

    case '!buy':
      cmdBuy(client, chan, userstate, args);
      break;

    case '!gardenhelp':
      client.say(chan,
        '🌿 Garden Commands: !garden [slot] | !seed | !plant [slot] | !discard | !petals | !gardeners | !shop | !buy <item> — Channel Rewards: Get Seed | Water Plant | Harvest Plant | Expand Garden'
      );
      break;

    default:
      break;
  }
});

// ─── Channel Point Reward handler ────────────────────────────────────────────
// tmi.js fires 'redeem' for channel point redemptions on the PubSub/EventSub path.
// If you use the IRC message-based approach, redemptions appear as messages with
// custom-reward-id in userstate. We handle both.

client.on('message', (chan, userstate, message, self) => {
  if (self) return;

  const rewardId = userstate['custom-reward-id'];
  if (!rewardId) return;

  const username = userstate.username;

  // Print unknown reward IDs so the streamer can configure .env
  const knownRewards = [GET_SEED_REWARD_ID, RARE_SEED_REWARD_ID, EXPAND_PLOT_REWARD_ID, WATER_REWARD_ID, HARVEST_REWARD_ID];
  if (!knownRewards.includes(rewardId)) {
    const unconfigured = knownRewards.some(id => id === '');
    if (unconfigured) {
      console.log(`📢  Channel point reward redeemed by ${username}. Reward ID: ${rewardId}`);
      console.log(`    Add to .env as GET_SEED_REWARD_ID, RARE_SEED_REWARD_ID, EXPAND_PLOT_REWARD_ID, WATER_REWARD_ID, or HARVEST_REWARD_ID`);
    }
    return;
  }

  handleReward(chan, username, rewardId, message);
});

// Also handle the tmi 'redemption' event if available (some forks support it)
client.on('redeem', (chan, username, rewardType, tags, message) => {
  const rewardId = tags['msg-id'] || rewardType;
  if (!rewardId) return;

  if (![GET_SEED_REWARD_ID, RARE_SEED_REWARD_ID, EXPAND_PLOT_REWARD_ID, WATER_REWARD_ID, HARVEST_REWARD_ID].includes(rewardId)) {
    console.log(`📢  Redemption from ${username}: ${rewardId} — add to .env if this is a garden reward.`);
    return;
  }

  handleReward(chan, username, rewardId, message);
});

// Returns true if the viewer's held seed is valid (and they're blocked from getting another).
// If the held seed is stale (plant removed from JSON), clears it and returns false so the reward proceeds.
function blockIfHoldingValidSeed(chan, username, viewer) {
  if (!viewer.held_seed) return false;
  const existing = getPlant(viewer.held_seed);
  if (!existing) {
    db.setHeldSeed(username, null);
    client.say(chan, `@${username} 🍃 (Your old seed was no longer available — released.)`);
    return false;
  }
  client.say(chan,
    `@${username} 🌱 You already have a ${existing.emoji} ${existing.name}! Use !plant or !discard it first.`
  );
  return true;
}

function handleReward(chan, username, rewardId, message) {
  // Get a random seed
  if (rewardId === GET_SEED_REWARD_ID) {
    const viewer = db.getViewer(username);
    if (blockIfHoldingValidSeed(chan, username, viewer)) return;
    const seed = rollSeed();
    db.setHeldSeed(username, seed.id);
    client.say(chan,
      `@${username} 🎁 You received a ${seed.emoji} ${seed.name} seed (${seed.rarity})! Use !plant <slot> to plant it. 🌿`
    );
    if (seed.fact) client.say(chan, `📖 Fun fact: ${seed.fact}`);
    return;
  }

  // Get a guaranteed rare seed
  if (rewardId === RARE_SEED_REWARD_ID) {
    const viewer = db.getViewer(username);
    if (blockIfHoldingValidSeed(chan, username, viewer)) return;
    const seed = rollSeed('rare');
    db.setHeldSeed(username, seed.id);
    client.say(chan,
      `@${username} 🌟 You received a RARE ${seed.emoji} ${seed.name} seed! So lucky! Use !plant <slot> to plant it. ✨`
    );
    if (seed.fact) client.say(chan, `📖 Fun fact: ${seed.fact}`);
    return;
  }

  // Water a plant
  if (rewardId === WATER_REWARD_ID) {
    const slots = db.getAllSlots();
    const slotCount = db.getGardenSlotCount();
    const waterable = slots.filter(s => {
      if (!s.plant_id) return false;
      const info = getGrowthInfo(s);
      return info && !info.isBloom;
    });

    if (!waterable.length) {
      client.say(chan, `@${username} 🌿 No plants need watering right now! Try harvesting bloomed ones 🌺`);
      return;
    }

    let targetSlot;

    // Parse an optional slot number from the redemption message
    const hasText = message && message.trim().length > 0;
    const parsed = extractSlot(message, slotCount);
    if (hasText && !parsed.ok) {
      client.say(chan, `@${username} ❌ Invalid slot in your message. Use a whole number between 1 and ${slotCount}, or leave blank to auto-pick.`);
      return;
    }
    if (parsed.ok) {
      const slotNum = parsed.slot;
      const requested = db.getSlot(slotNum);
      if (!requested || !requested.plant_id) {
        client.say(chan, `@${username} 🪨 Slot ${slotNum} is empty!`);
        return;
      }
      const reqInfo = getGrowthInfo(requested);
      if (reqInfo.isBloom) {
        client.say(chan, `@${username} 🌺 Slot ${slotNum} is already blooming! Redeem the Harvest reward to collect it.`);
        return;
      }
      targetSlot = requested;
    } else {
      let lowestPct = Infinity;
      for (const s of waterable) {
        const info = getGrowthInfo(s);
        const needed = getWatersNeededWithUpgrade(info.watersNeeded);
        const pct = needed > 0 ? info.watersDone / needed : 1;
        if (pct < lowestPct) {
          lowestPct = pct;
          targetSlot = s;
        }
      }
    }

    const tonic = db.getActiveEffect(username, 'growth_tonic', targetSlot.slot);
    const waterAmount = tonic ? 3 : 1;
    if (tonic) db.consumeEffect(tonic.id);

    db.waterSlot(targetSlot.slot, waterAmount);
    db.recordWater(username);

    let updatedSlot = db.getSlot(targetSlot.slot);
    let info = getGrowthInfo(updatedSlot);
    const needed = getWatersNeededWithUpgrade(info.watersNeeded);

    let advanceMsg = '';
    while (!info.isBloom && updatedSlot.waters_done >= needed) {
      db.advanceStage(targetSlot.slot);
      updatedSlot = db.getSlot(targetSlot.slot);
      info = getGrowthInfo(updatedSlot);
      if (info.isBloom) {
        advanceMsg = ` 🌺 ${info.plant.name} is BLOOMING! Redeem the Harvest reward to collect it!`;
      } else {
        advanceMsg = ` ✨ It grew to ${['Seed', 'Sprout', 'Budding', 'Blooming'][info.stage]}!`;
      }
    }

    const tonicMsg = waterAmount > 1 ? ` (Growth Tonic: x${waterAmount}💧)` : '';
    client.say(chan, `@${username} 💧 Watered slot ${targetSlot.slot}!${tonicMsg}${advanceMsg} [${formatSlot(updatedSlot)}]`);
    return;
  }

  // Harvest a bloomed plant
  if (rewardId === HARVEST_REWARD_ID) {
    const slotCount = db.getGardenSlotCount();
    const slots = db.getAllSlots();

    let targetSlotNum;

    // Optional slot from redemption text — pick a specific bloomed plant
    const hasText = message && message.trim().length > 0;
    const parsed = extractSlot(message, slotCount);
    if (hasText && !parsed.ok) {
      client.say(chan, `@${username} ❌ Invalid slot in your message. Use a whole number between 1 and ${slotCount}, or leave blank to auto-pick.`);
      return;
    }
    if (parsed.ok) {
      const requested = db.getSlot(parsed.slot);
      if (!requested || !requested.plant_id) {
        client.say(chan, `@${username} 🪨 Slot ${parsed.slot} is empty — nothing to harvest!`);
        return;
      }
      const reqInfo = getGrowthInfo(requested);
      if (!reqInfo) {
        client.say(chan, `@${username} ❓ Slot ${parsed.slot} has an unknown plant. Please ask a mod to clear it.`);
        return;
      }
      if (!reqInfo.isBloom) {
        client.say(chan, `@${username} 🌿 Slot ${parsed.slot} isn't blooming yet! Keep watering 💧`);
        return;
      }
      targetSlotNum = parsed.slot;
    } else {
      const bloomed = slots.find(s => {
        if (!s.plant_id) return false;
        const info = getGrowthInfo(s);
        return info && info.isBloom;
      });
      if (!bloomed) {
        client.say(chan, `@${username} 🌸 No bloomed plants ready to harvest! Keep watering 💧`);
        return;
      }
      targetSlotNum = bloomed.slot;
    }

    const slotRow = db.getSlot(targetSlotNum);
    const info = getGrowthInfo(slotRow);
    const { plant } = info;
    const petals = plant.harvestPetals;

    db.addPetals(username, petals);
    db.clearSlot(targetSlotNum);

    const viewer = db.getViewer(username);
    client.say(chan,
      `@${username} 🌺 You harvested a ${plant.emoji} ${plant.name} (${rarityLabel(plant.rarity)})! +${petals}🌸 petals. Total: ${viewer.petals}🌸 — Slot ${targetSlotNum} is now empty and ready for a new seed!`
    );
    return;
  }

  // Expand garden plot
  if (rewardId === EXPAND_PLOT_REWARD_ID) {
    const current = db.getGardenSlotCount();
    if (current >= MAX_SLOTS) {
      client.say(chan,
        `@${username} 🌿 The garden is already at maximum size (${MAX_SLOTS} slots)! Your channel points have been refunded.`
      );
      return;
    }
    const newCount = current + 1;
    db.setGardenSlotCount(newCount);
    client.say(chan,
      `@${username} 🌱 The garden expanded! We now have ${newCount} plot${newCount !== 1 ? 's' : ''}! 🎉`
    );
    return;
  }
}

// ─── Connect ──────────────────────────────────────────────────────────────────

overlayServer.start(OVERLAY_PORT);

client.connect().then(() => {
  console.log(`🌿 CozyGardenBot connected to ${channel}`);
  console.log(`   Commands: !garden !seed !plant !discard !petals !gardeners !shop !buy !gardenhelp`);
  console.log(`   Channel Rewards: GET_SEED="${GET_SEED_REWARD_ID||'(not set)'}" RARE="${RARE_SEED_REWARD_ID||'(not set)'}" WATER="${WATER_REWARD_ID||'(not set)'}" HARVEST="${HARVEST_REWARD_ID||'(not set)'}" EXPAND="${EXPAND_PLOT_REWARD_ID||'(not set)'}"`);
  const unsetRewards = [GET_SEED_REWARD_ID, RARE_SEED_REWARD_ID, WATER_REWARD_ID, HARVEST_REWARD_ID, EXPAND_PLOT_REWARD_ID].some(id => !id);
  if (unsetRewards) {
    console.log(`   💡 Redeem a channel point reward and the bot will print its ID so you can add it to .env`);
  }
}).catch(err => {
  console.error('❌  Failed to connect:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🌙 CozyGardenBot going to sleep... goodnight! 🌿');
  client.disconnect();
  process.exit(0);
});
