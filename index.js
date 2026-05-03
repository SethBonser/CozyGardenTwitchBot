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
const ACTIVE_VIEWER_WINDOW_MS = parseInt(process.env.ACTIVE_VIEWER_WINDOW_MIN || '30', 10) * 60 * 1000;

// Usernames to ignore for activity tracking and reward eligibility — typically
// other chat bots (Nightbot, StreamElements, etc.) so they don't get petals.
// Configured via the IGNORED_USERS env var as a comma-separated list.
const IGNORED_USERS = new Set(
  (process.env.IGNORED_USERS || '')
    .split(',')
    .map(u => u.trim().toLowerCase())
    .filter(Boolean)
);
// Always ignore our own bot account
IGNORED_USERS.add(BOT_USERNAME.toLowerCase());

function isIgnored(username) {
  if (!username) return true;
  return IGNORED_USERS.has(String(username).toLowerCase());
}

// Track every chatter we've seen recently so harvest rewards can be shared
// across the active community. username (lowercase) → last-seen timestamp.
const activeViewers = new Map();
function recordActivity(username) {
  if (!username) return;
  if (isIgnored(username)) return;
  activeViewers.set(String(username).toLowerCase(), Date.now());
}
function getActiveViewers() {
  const cutoff = Date.now() - ACTIVE_VIEWER_WINDOW_MS;
  const list = [];
  for (const [user, ts] of activeViewers) {
    if (ts >= cutoff) list.push(user);
    else activeViewers.delete(user);
  }
  return list;
}

const channel = `#${CHANNEL_NAME}`;

// ─── TMI client ───────────────────────────────────────────────────────────────

const DEBUG_TMI = process.env.DEBUG_TMI === 'true';

const client = new tmi.Client({
  options: { debug: DEBUG_TMI },
  identity: {
    username: BOT_USERNAME,
    password: OAUTH_TOKEN,
  },
  channels: [CHANNEL_NAME],
});

// Optional: log every incoming chat message's reward tag (or note its absence)
// so you can see whether redemptions are reaching IRC at all. Toggle with
// DEBUG_REWARDS=true in your .env.
if (process.env.DEBUG_REWARDS === 'true') {
  client.on('message', (chan, userstate, message, self) => {
    if (self) return;
    const rid = userstate['custom-reward-id'];
    if (rid) {
      console.log(`🐛 [DEBUG] Chat message had custom-reward-id=${rid} from ${userstate.username}`);
    } else if (message && !message.startsWith('!')) {
      console.log(`🐛 [DEBUG] Chat message from ${userstate.username}: "${message}" (no reward tag)`);
    }
  });
}

// ─── Message router ───────────────────────────────────────────────────────────

client.on('message', (chan, userstate, message, self) => {
  if (self) return;

  // Anyone who chats counts as "currently watching" for the next harvest payout
  recordActivity(userstate.username);

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

// Cache of recently-handled chat-message IDs to suppress accidental duplicates
const handledMessageIds = new Set();
function rememberMessageId(id) {
  if (!id) return;
  handledMessageIds.add(id);
  // Keep the set bounded — drop the oldest after a minute
  setTimeout(() => handledMessageIds.delete(id), 60_000);
}

client.on('message', (chan, userstate, message, self) => {
  if (self) return;

  const rewardId = userstate['custom-reward-id'];
  if (!rewardId) return;

  const messageId = userstate.id;
  if (messageId && handledMessageIds.has(messageId)) {
    console.log(`⏭  Ignoring duplicate redemption (message id ${messageId})`);
    return;
  }
  rememberMessageId(messageId);

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

    // Channel-wide reward: every recently-active chatter (the harvester
    // included) gets the full petal payout. The harvester is added explicitly
    // in case they haven't chatted within the activity window. Ignored
    // users (configured bots) are filtered out as a final safety check.
    const recipients = getActiveViewers().filter(u => !isIgnored(u));
    if (!isIgnored(username) && !recipients.includes(username.toLowerCase())) {
      recipients.push(username.toLowerCase());
    }
    const credited = db.addPetalsToMany(recipients, petals);
    db.clearSlot(targetSlotNum);

    const viewer = db.getViewer(username);
    const others = Math.max(0, credited - 1);
    const sharedNote = others > 0
      ? ` Shared with ${others} other gardener${others === 1 ? '' : 's'} (everyone gets +${petals}🌸).`
      : '';
    client.say(chan,
      `@${username} 🌺 Harvested a ${plant.emoji} ${plant.name} (${rarityLabel(plant.rarity)})! +${petals}🌸 to you (total: ${viewer.petals}🌸).${sharedNote} Slot ${targetSlotNum} is empty and ready for a new seed!`
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

// Surface IRC-level connection lifecycle for easier debugging
client.on('connecting', (addr, port) => console.log(`🔌 Connecting to ${addr}:${port}...`));
client.on('logon', () => console.log('🔑 Auth handshake sent.'));
client.on('connected', (addr, port) => console.log(`✅ IRC connected at ${addr}:${port}`));
client.on('disconnected', reason => console.warn(`⚠️  Disconnected: ${reason}`));
client.on('notice', (chan, msgid, message) => console.log(`📨 NOTICE [${msgid}] ${message}`));

client.connect().then(() => {
  console.log(`🌿 CozyGardenBot connected to ${channel}`);
  console.log(`   Commands: !garden !seed !plant !discard !petals !gardeners !shop !buy !gardenhelp`);
  console.log(`   Ignored users (no petals/activity): ${[...IGNORED_USERS].join(', ') || '(none)'}`);

  // Announce in chat with the command + reward summary
  client.say(channel,
    "🌿 CozyGardenBot is awake! Commands: !garden [slot] | !seed | !plant [slot] | !discard | !petals | !gardeners | !shop | !buy <item> | !gardenhelp — Channel Rewards: Get Seed | Water Plant | Harvest Plant | Expand Garden 🌸"
  ).catch(err => console.warn('   (Could not post welcome message:', err && err.message, ')'));
  console.log(`   Channel Rewards: GET_SEED="${GET_SEED_REWARD_ID||'(not set)'}" RARE="${RARE_SEED_REWARD_ID||'(not set)'}" WATER="${WATER_REWARD_ID||'(not set)'}" HARVEST="${HARVEST_REWARD_ID||'(not set)'}" EXPAND="${EXPAND_PLOT_REWARD_ID||'(not set)'}"`);
  const unsetRewards = [GET_SEED_REWARD_ID, RARE_SEED_REWARD_ID, WATER_REWARD_ID, HARVEST_REWARD_ID, EXPAND_PLOT_REWARD_ID].some(id => !id);
  if (unsetRewards) {
    console.log(`   💡 Redeem a channel point reward and the bot will print its ID so you can add it to .env`);
  }
}).catch(err => {
  console.error('❌  Failed to connect to Twitch IRC.');
  console.error('    Reason:', err && err.message ? err.message : err);
  console.error('');
  console.error('    Most common causes:');
  console.error('    • OAUTH_TOKEN missing the "oauth:" prefix (it must look like oauth:abc123...)');
  console.error('    • OAUTH_TOKEN was generated for the wrong account (must be the BOT account)');
  console.error('    • OAUTH_TOKEN has expired — regenerate at https://twitchtokengenerator.com');
  console.error('    • BOT_USERNAME doesn\'t match the account the token was issued for');
  console.error('    • CHANNEL_NAME has a typo or includes a "#" (it shouldn\'t)');
  console.error('');
  console.error('    See README → "Twitch setup walkthrough" for a step-by-step guide.');
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🌙 CozyGardenBot going to sleep... goodnight! 🌿');
  client.disconnect();
  process.exit(0);
});
