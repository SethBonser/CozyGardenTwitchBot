'use strict';

require('dotenv').config();
const tmi = require('tmi.js');
const db = require('./db');
const { rollSeed, getPlant, getGrowthInfo, formatSlot, getEffectiveWatersNeeded, rarityLabel, extractSlot } = require('./helpers');
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

// ─── Currency mode switch ─────────────────────────────────────────────────────
// USE_CHANNEL_REWARDS=true (default) — players redeem Twitch channel point
// rewards to get seeds, water, harvest, and expand the garden. Free actions.
// USE_CHANNEL_REWARDS=false — same actions are run as chat commands and cost
// petals instead of channel points. Players init themselves via !startgarden
// to receive STARTER_PETALS, then spend petals to play.
const USE_CHANNEL_REWARDS = String(process.env.USE_CHANNEL_REWARDS ?? 'true').toLowerCase() !== 'false';

// Petal costs used when USE_CHANNEL_REWARDS=false (ignored otherwise)
const STARTER_PETALS  = parseInt(process.env.STARTER_PETALS  || '100', 10);

// Commands a viewer can run BEFORE typing !startgarden in petals-only mode.
// Anything not in this set is gated behind starter-petal claiming.
const COMMANDS_OPEN_BEFORE_START = new Set([
  '!startgarden',
  '!ghelp',
  '!garden',         // read-only view of the shared garden
  '!gardeners',      // public leaderboard
  '!shop',           // browse prices (helps people decide whether to start)
]);
const SEED_COST          = parseInt(process.env.SEED_COST          || '30',  10);
const UNCOMMON_SEED_COST = parseInt(process.env.UNCOMMON_SEED_COST || '100', 10);
const RARE_SEED_COST     = parseInt(process.env.RARE_SEED_COST     || '200', 10);
const WATER_COST      = parseInt(process.env.WATER_COST      || '5',   10);
const FERTILIZE_COST  = parseInt(process.env.FERTILIZE_COST  || '300', 10);

// Expand uses a quadratic curve: cost = EXPAND_COST_BASE × currentSize²
// so each subsequent expansion is meaningfully more expensive than the last.
// Default base 100 yields: 3→4 = 900, 4→5 = 1600, 5→6 = 2500, 9→10 = 8100.
const EXPAND_COST_BASE = parseInt(process.env.EXPAND_COST_BASE || '100', 10);
const RAIN_COST        = parseInt(process.env.RAIN_COST        || '200', 10);
const TONIC_COST       = parseInt(process.env.TONIC_COST       || '150', 10);
function getExpandCost() {
  const current = db.getGardenSlotCount();
  return EXPAND_COST_BASE * current * current;
}

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

  // In petals-only mode, every command except the join/help/public-view
  // commands requires the user to have started their garden first. Channel-
  // rewards mode has no equivalent gate (there is no !startgarden), so we skip this.
  if (!USE_CHANNEL_REWARDS && !COMMANDS_OPEN_BEFORE_START.has(cmd) && !db.hasClaimedStarter(userstate.username)) {
    client.say(chan,
      `@${userstate.username} 🌱 You haven't started your garden yet! Type !startgarden to claim ${STARTER_PETALS}🌸 starter petals and begin.`
    );
    return;
  }

  switch (cmd) {
    case '!garden':
      cmdGarden(client, chan, userstate, args);
      break;

    case '!water':
      if (USE_CHANNEL_REWARDS) {
        client.say(chan, `@${userstate.username} 💧 Watering is done via channel point rewards!`);
      } else {
        runPetalCostAction(chan, userstate.username, 'water', WATER_COST,
          () => performWater(userstate.username, args.join(' ')));
      }
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
      if (USE_CHANNEL_REWARDS) {
        client.say(chan, `@${userstate.username} 🌺 Harvesting is done via channel point rewards!`);
      } else {
        // Harvesting itself doesn't cost petals — the action pays them out
        runPetalCostAction(chan, userstate.username, 'harvest', 0,
          () => performHarvest(userstate.username, args.join(' ')));
      }
      break;

    case '!expand':
      if (USE_CHANNEL_REWARDS) {
        client.say(chan, `@${userstate.username} 🌿 Use the "Expand Garden" channel point reward!`);
      } else {
        runPetalCostAction(chan, userstate.username, 'expand the garden', getExpandCost(),
          () => performExpand(userstate.username));
      }
      break;

    case '!startgarden':
      cmdStartGarden(client, chan, userstate);
      break;

    case '!shop':
      cmdShop(client, chan, userstate, buildShopContext());
      break;

    case '!buy':
      cmdBuy(client, chan, userstate, args, buildShopContext());
      break;

    // ── Single-word buy shortcuts ─────────────────────────────────────────────
    // Each one prepends the item name to args so slot numbers still work:
    //   !buyfertilize 2  →  cmdBuy(... ['fertilize', '2'] ...)
    case '!buyseed':
      cmdBuy(client, chan, userstate, ['seed', ...args], buildShopContext());
      break;
    case '!buyuncommon':
      cmdBuy(client, chan, userstate, ['uncommon', 'seed', ...args], buildShopContext());
      break;
    case '!buyrare':
      cmdBuy(client, chan, userstate, ['rare', 'seed', ...args], buildShopContext());
      break;
    case '!buywater':
      cmdBuy(client, chan, userstate, ['water', ...args], buildShopContext());
      break;
    case '!buyharvest':
      cmdBuy(client, chan, userstate, ['harvest', ...args], buildShopContext());
      break;
    case '!buyexpand':
      cmdBuy(client, chan, userstate, ['expand', ...args], buildShopContext());
      break;
    case '!buyfertilize':
      cmdBuy(client, chan, userstate, ['fertilize', ...args], buildShopContext());
      break;
    case '!buyrain':
      cmdBuy(client, chan, userstate, ['rain', 'cloud', ...args], buildShopContext());
      break;
    case '!buytonic':
      cmdBuy(client, chan, userstate, ['growth', 'tonic', ...args], buildShopContext());
      break;
    case '!buycompost':
      cmdBuy(client, chan, userstate, ['compost', 'bin', ...args], buildShopContext());
      break;
    case '!buycopper':
      cmdBuy(client, chan, userstate, ['copper', 'can', ...args], buildShopContext());
      break;
    case '!buysilver':
      cmdBuy(client, chan, userstate, ['silver', 'can', ...args], buildShopContext());
      break;

    case '!ghelp':
      client.say(chan, gardenHelpMessage());
      break;

    default:
      break;
  }
});

// ─── Help text + !startgarden handler (mode-aware) ───────────────────────────

function gardenHelpMessage() {
  if (USE_CHANNEL_REWARDS) {
    return '🌿 Commands: <!garden [slot]> <!seed> <!plant [slot]> <!discard> <!water [slot]> <!harvest [slot]> <!petals> <!gardeners> <!shop> <!buyseed> <!buyuncommon> <!buyrare> <!buyfertilize [slot]> <!buyrain> <!buytonic [slot]> <!buycompost> <!buyexpand> — Channel Rewards: Get Seed | Water Plant | Harvest Plant | Expand Garden';
  }
  return `🌿 Commands: <!startgarden (${STARTER_PETALS}🌸)> <!buyseed (${SEED_COST}🌸)> <!buyuncommon (${UNCOMMON_SEED_COST}🌸)> <!buyrare (${RARE_SEED_COST}🌸)> <!water [slot] (${WATER_COST}🌸)> <!buyfertilize [slot]> <!buyrain> <!buytonic [slot]> <!plant [slot]> <!harvest [slot]> <!buyexpand> <!garden [slot]> <!seed> <!petals> <!gardeners> <!shop>`;
}

function cmdStartGarden(client, chan, userstate) {
  const username = userstate.username;
  const viewer = db.getViewer(username);
  if (USE_CHANNEL_REWARDS) {
    client.say(chan, `@${username} 🌿 Welcome! Channel rewards are enabled — redeem the "Get a Seed" reward to start. Your petal balance: ${viewer.petals}🌸`);
    return;
  }
  // One-shot — viewers can only claim starter petals once per account, even
  // if they've spent everything they had. Earn more by harvesting (or being
  // active in chat when someone else harvests — payouts are channel-wide).
  if (db.hasClaimedStarter(username)) {
    client.say(chan,
      `@${username} 🌸 You've already claimed your starter petals! Balance: ${viewer.petals}🌸. Earn more by harvesting flowers — payouts are shared with everyone in chat.`
    );
    return;
  }
  db.addPetals(username, STARTER_PETALS);
  db.markStarterClaimed(username);
  client.say(chan,
    `@${username} 🌱 Welcome to the garden! Here are ${STARTER_PETALS}🌸 to get you started. Try !getseed to grow your first plant.`
  );
}

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

  // Channel reward path is only active in channel-rewards mode
  if (!USE_CHANNEL_REWARDS) return;

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

// ─── Game actions ────────────────────────────────────────────────────────────
// Each performXxx() encapsulates the logic for one action and returns
//   { ok: bool, messages: string[] }
// Both the channel-reward path and the petals-mode chat-command path call
// these so the behavior stays identical regardless of how the action was
// triggered. Messages are not posted by the action — the caller posts them.

// Returns { stale: bool, blocked: bool, blockMessage?: string }
// If held seed is stale (plant removed from JSON), clears it silently and
// signals the caller to post a friendly note that the action proceeds.
function checkHeldSeed(username) {
  const viewer = db.getViewer(username);
  if (!viewer.held_seed) return { stale: false, blocked: false };
  const existing = getPlant(viewer.held_seed);
  if (!existing) {
    db.setHeldSeed(username, null);
    return { stale: true, blocked: false };
  }
  return {
    stale: false,
    blocked: true,
    blockMessage: `@${username} 🌱 You already have a ${existing.emoji} ${existing.name}! Use !plant or !discard it first.`,
  };
}

// Tier options:
//   'basic'    → 60% common / 30% uncommon / 10% rare (default)
//   'uncommon' → 75% uncommon / 25% rare (no commons)
//   'rare'     → 100% rare
// Legacy `{ rare: true }` kept working for backward compatibility.
function performGetSeed(username, options = {}) {
  const tier = options.tier || (options.rare ? 'rare' : 'basic');

  const seedCheck = checkHeldSeed(username);
  if (seedCheck.blocked) return { ok: false, messages: [seedCheck.blockMessage] };

  const messages = [];
  if (seedCheck.stale) messages.push(`@${username} 🍃 (Your old seed was no longer available — released.)`);

  let rarityArg;
  if (tier === 'rare')          rarityArg = 'rare';
  else if (tier === 'uncommon') rarityArg = { uncommon: 0.75, rare: 0.25 };
  else                          rarityArg = null; // basic

  const seed = rollSeed(rarityArg);
  db.setHeldSeed(username, seed.id);
  // Receiving a seed counts as having started the game — flips the eligibility
  // flag so the user can share in future harvest payouts.
  db.markStarterClaimed(username);

  if (tier === 'rare') {
    messages.push(`@${username} 🌟 You received a RARE ${seed.emoji} ${seed.name} seed! So lucky! Use !plant <slot> to plant it. ✨`);
  } else if (tier === 'uncommon') {
    if (seed.rarity === 'rare') {
      messages.push(`@${username} ✨ Lucky roll! Your uncommon seed bag yielded a RARE ${seed.emoji} ${seed.name}! Use !plant <slot> to plant it. 🌟`);
    } else {
      messages.push(`@${username} 🍀 You received an uncommon ${seed.emoji} ${seed.name} seed! Use !plant <slot> to plant it. 🌿`);
    }
  } else {
    messages.push(`@${username} 🎁 You received a ${seed.emoji} ${seed.name} seed (${seed.rarity})! Use !plant <slot> to plant it. 🌿`);
  }

  if (seed.fact) messages.push(`📖 Fun fact: ${seed.fact}`);
  return { ok: true, messages, seed };
}

function performWater(username, message) {
  const slots = db.getAllSlots();
  const slotCount = db.getGardenSlotCount();
  const waterable = slots.filter(s => {
    if (!s.plant_id) return false;
    const info = getGrowthInfo(s);
    return info && !info.isBloom;
  });

  if (!waterable.length) {
    return { ok: false, messages: [`@${username} 🌿 No plants need watering right now! Try harvesting bloomed ones 🌺`] };
  }

  let targetSlot;
  const hasText = message && message.trim().length > 0;
  const parsed = extractSlot(message, slotCount);
  if (hasText && !parsed.ok) {
    return { ok: false, messages: [`@${username} ❌ Invalid slot. Use a whole number between 1 and ${slotCount}, or leave blank to auto-pick.`] };
  }
  if (parsed.ok) {
    const requested = db.getSlot(parsed.slot);
    if (!requested || !requested.plant_id) {
      return { ok: false, messages: [`@${username} 🪨 Slot ${parsed.slot} is empty!`] };
    }
    const reqInfo = getGrowthInfo(requested);
    if (reqInfo.isBloom) {
      return { ok: false, messages: [`@${username} 🌺 Slot ${parsed.slot} is already blooming! Harvest it instead.`] };
    }
    targetSlot = requested;
  } else {
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

  const tonic = db.getActiveEffect(username, 'growth_tonic', targetSlot.slot);
  const waterAmount = tonic ? 3 : 1;
  if (tonic) db.consumeEffect(tonic.id);

  db.waterSlot(targetSlot.slot, waterAmount);
  db.recordWater(username);

  let updatedSlot = db.getSlot(targetSlot.slot);
  let info = getGrowthInfo(updatedSlot);
  const needed = getEffectiveWatersNeeded(targetSlot.slot, info.watersNeeded);

  let advanceMsg = '';
  while (!info.isBloom && updatedSlot.waters_done >= needed) {
    db.advanceStage(targetSlot.slot);
    updatedSlot = db.getSlot(targetSlot.slot);
    info = getGrowthInfo(updatedSlot);
    if (info.isBloom) {
      advanceMsg = ` 🌺 ${info.plant.name} is BLOOMING! Time to harvest!`;
    } else {
      advanceMsg = ` ✨ It grew to ${['Seed', 'Sprout', 'Budding', 'Blooming'][info.stage]}!`;
    }
  }

  const tonicMsg = waterAmount > 1 ? ` (Growth Tonic: x${waterAmount}💧)` : '';
  return {
    ok: true,
    messages: [`@${username} 💧 Watered slot ${targetSlot.slot}!${tonicMsg}${advanceMsg} ${formatSlot(updatedSlot)}`],
  };
}

function performHarvest(username, message) {
  const slotCount = db.getGardenSlotCount();
  const slots = db.getAllSlots();

  let targetSlotNum;
  const hasText = message && message.trim().length > 0;
  const parsed = extractSlot(message, slotCount);
  if (hasText && !parsed.ok) {
    return { ok: false, messages: [`@${username} ❌ Invalid slot. Use a whole number between 1 and ${slotCount}, or leave blank to auto-pick.`] };
  }
  if (parsed.ok) {
    const requested = db.getSlot(parsed.slot);
    if (!requested || !requested.plant_id) {
      return { ok: false, messages: [`@${username} 🪨 Slot ${parsed.slot} is empty — nothing to harvest!`] };
    }
    const reqInfo = getGrowthInfo(requested);
    if (!reqInfo) {
      return { ok: false, messages: [`@${username} ❓ Slot ${parsed.slot} has an unknown plant. Please ask a mod to clear it.`] };
    }
    if (!reqInfo.isBloom) {
      return { ok: false, messages: [`@${username} 🌿 Slot ${parsed.slot} isn't blooming yet! Keep watering 💧`] };
    }
    targetSlotNum = parsed.slot;
  } else {
    const bloomed = slots.find(s => {
      if (!s.plant_id) return false;
      const info = getGrowthInfo(s);
      return info && info.isBloom;
    });
    if (!bloomed) {
      return { ok: false, messages: [`@${username} 🌸 No bloomed plants ready to harvest! Keep watering 💧`] };
    }
    targetSlotNum = bloomed.slot;
  }

  const slotRow = db.getSlot(targetSlotNum);
  const info = getGrowthInfo(slotRow);
  const { plant } = info;
  const petals = plant.harvestPetals;

  // The act of harvesting counts as participating, so make sure the harvester
  // is flagged as having started.
  if (!isIgnored(username)) db.markStarterClaimed(username);

  // Record the harvest in the log (tracks who ran !harvest and what they grew)
  db.logHarvest(username, plant, petals, targetSlotNum);

  // Channel-wide reward: every recently-active chatter shares the petals.
  // In petals-only mode, only viewers who have started the game (claimed
  // starter petals or otherwise engaged) are eligible — lurkers without an
  // account don't drain the pool. In channel-rewards mode there is no !startgarden
  // gate, so the filter doesn't apply. Ignored users (bots) are always out.
  let recipients = getActiveViewers().filter(u => !isIgnored(u));
  if (!USE_CHANNEL_REWARDS) {
    recipients = recipients.filter(u => db.hasClaimedStarter(u));
  }
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

  const messages = [
    `@${username} 🌺 Harvested a ${plant.emoji} ${plant.name} (${rarityLabel(plant.rarity)})! +${petals}🌸 to you (total: ${viewer.petals}🌸).${sharedNote} Slot ${targetSlotNum} is empty and ready for a new seed!`,
  ];

  // Notify every other recipient individually with their new balance
  for (const recipient of recipients) {
    if (recipient === username.toLowerCase()) continue;
    const v = db.getViewer(recipient);
    messages.push(`@${recipient} 🌸 +${petals} petals from the harvest! Balance: ${v.petals} petals`);
  }

  return { ok: true, messages };
}

function performExpand(username) {
  const current = db.getGardenSlotCount();
  if (current >= MAX_SLOTS) {
    return { ok: false, messages: [`@${username} 🌿 The garden is already at maximum size (${MAX_SLOTS} slots)!`] };
  }
  const newCount = current + 1;
  db.setGardenSlotCount(newCount);
  return {
    ok: true,
    messages: [`@${username} 🌱 The garden expanded! We now have ${newCount} plot${newCount !== 1 ? 's' : ''}! 🎉`],
  };
}

function performFertilize(username, message) {
  const slotCount = db.getGardenSlotCount();

  // Slot is required and must be a strict positive integer in range
  const parsed = extractSlot(message, slotCount);
  if (!parsed.ok) {
    return {
      ok: false,
      messages: [`@${username} 🌱 Pick a slot to fertilize (1-${slotCount}). Try: !buyfertilize <slot>`],
    };
  }
  const slot = parsed.slot;
  const slotRow = db.getSlot(slot);

  // Must be empty — fertilizer is for the NEXT plant, not the current one
  if (slotRow && slotRow.plant_id) {
    return {
      ok: false,
      messages: [`@${username} 🌿 Slot ${slot} already has a plant! Fertilizer can only be applied to empty plots so it benefits the next planting.`],
    };
  }

  // Re-applying on an already-fertilized empty slot is a no-op (waste of petals)
  if (db.hasSlotBuff(slot, 'fertilizer')) {
    return {
      ok: false,
      messages: [`@${username} ✨ Slot ${slot} is already fertilized — wait for someone to plant there first!`],
    };
  }

  db.addSlotBuff(slot, 'fertilizer', username);
  return {
    ok: true,
    messages: [`@${username} 🌱 Fertilizer applied to slot ${slot}! The next plant there will need HALF the waters at every stage. ✨`],
  };
}

function performRainCloud(username) {
  const slots = db.getAllSlots();
  const occupied = slots.filter(s => s.plant_id);
  if (!occupied.length) {
    return { ok: false, messages: [`@${username} 🌧️ The garden is empty — save your Rain Cloud for when there are plants!`] };
  }
  let watered = 0;
  for (const s of occupied) {
    const info = getGrowthInfo(s);
    if (info && !info.isBloom) {
      db.waterSlot(s.slot, 1);
      db.recordWater(username);
      let updSlot = db.getSlot(s.slot);
      let updInfo = getGrowthInfo(updSlot);
      const needed = getEffectiveWatersNeeded(s.slot, updInfo.watersNeeded);
      while (!updInfo.isBloom && updSlot.waters_done >= needed) {
        db.advanceStage(s.slot);
        updSlot = db.getSlot(s.slot);
        updInfo = getGrowthInfo(updSlot);
      }
      watered++;
    }
  }
  return {
    ok: true,
    messages: [`@${username} 🌧️ Rain Cloud soaks the whole garden — watered ${watered} plant${watered !== 1 ? 's' : ''}! 🌿`],
  };
}

function performGrowthTonic(username, slotArg) {
  const slotCount = db.getGardenSlotCount();
  const slotNum = slotArg ? parseInt(String(slotArg), 10) : NaN;
  if (!slotArg || isNaN(slotNum) || slotNum < 1 || slotNum > slotCount) {
    return { ok: false, messages: [`@${username} 🧪 Specify a slot for your Growth Tonic! e.g. !buytonic 2 (slots 1-${slotCount})`] };
  }
  const slotRow = db.getSlot(slotNum);
  if (!slotRow || !slotRow.plant_id) {
    return { ok: false, messages: [`@${username} 🪨 Slot ${slotNum} is empty! Plant something first.`] };
  }
  const info = getGrowthInfo(slotRow);
  if (info && info.isBloom) {
    return { ok: false, messages: [`@${username} 🌺 Slot ${slotNum} is already blooming! Harvest it first.`] };
  }
  if (db.getActiveEffect(username, 'growth_tonic', slotNum)) {
    return { ok: false, messages: [`@${username} 🧪 You already have a Growth Tonic on slot ${slotNum}! Use !water ${slotNum} to activate it.`] };
  }
  db.addEffect(username, 'growth_tonic', slotNum, 1);
  return {
    ok: true,
    messages: [`@${username} 🧪 Growth Tonic applied to slot ${slotNum}! Your next !water ${slotNum} will count as 3 waters 💧💧💧`],
  };
}

// ─── Chat command helper for petals mode ─────────────────────────────────────
// Charges petals up front (if action succeeds), runs the action, posts messages.
// On failure (validation or affordability) no petals are deducted.

function runPetalCostAction(chan, username, label, cost, actionFn) {
  if (cost > 0) {
    const viewer = db.getViewer(username);
    if (viewer.petals < cost) {
      client.say(chan, `@${username} 💸 Need ${cost}🌸 to ${label} (you have ${viewer.petals}🌸). Earn more by harvesting a flower (or being in chat when someone else does).`);
      return;
    }
  }
  const result = actionFn();
  for (const m of result.messages) client.say(chan, m);
  if (result.ok && cost > 0) {
    db.deductPetals(username, cost);
    const remaining = db.getViewer(username).petals;
    client.say(chan, `@${username} 💸 -${cost}🌸 (balance: ${remaining}🌸)`);
  }
}

// Context handed to cmdShop/cmdBuy so the shop can render the right prices,
// dispatch action items via the same perform functions used elsewhere, and
// charge petals consistently. Built per-call so dynamic costs (like expand,
// which scales quadratically with garden size) are always fresh.
function buildShopContext() {
  return {
    useChannelRewards: USE_CHANNEL_REWARDS,
    costs: {
      seed:          SEED_COST,
      uncommon_seed: UNCOMMON_SEED_COST,
      rare_seed:     RARE_SEED_COST,
      water:         WATER_COST,
      harvest:       0,                 // harvest is the payout, no cost
      expand:        getExpandCost(),   // dynamic — depends on current garden size
      fertilize:     FERTILIZE_COST,
      rain_cloud:    RAIN_COST,
      growth_tonic:  TONIC_COST,
    },
    performAction: {
      seed:          (username, msg) => performGetSeed(username),
      uncommon_seed: (username, msg) => performGetSeed(username, { tier: 'uncommon' }),
      rare_seed:     (username, msg) => performGetSeed(username, { tier: 'rare' }),
      water:         (username, msg) => performWater(username, msg),
      harvest:       (username, msg) => performHarvest(username, msg),
      expand:        (username, msg) => performExpand(username),
      fertilize:     (username, msg) => performFertilize(username, msg),
      rain_cloud:    (username)      => performRainCloud(username),
      growth_tonic:  (username, msg) => performGrowthTonic(username, msg),
    },
    runPetalCostAction,
  };
}

// ─── Dashboard action handler ─────────────────────────────────────────────────
// Called by the HTTP API when a viewer clicks a buy button in the dashboard.
// Mirrors the chat command logic but returns { ok, messages } as JSON instead
// of posting directly. Still posts results to Twitch chat for channel visibility.

function handleDashboardAction(username, actionId, slotArg) {
  const lower = username.toLowerCase();

  // Petals-only mode gate (same rule as chat commands)
  if (!USE_CHANNEL_REWARDS && !db.hasClaimedStarter(lower)) {
    return { ok: false, messages: [`You haven't started your garden yet! Type !startgarden in chat first.`] };
  }

  const ctx = buildShopContext();
  const { SHOP_CATALOG } = require('./commands/shop');
  const item = SHOP_CATALOG[actionId];
  if (!item) return { ok: false, messages: [`Unknown item "${actionId}".`] };

  // ── Action items (seed, water, harvest, expand, fertilize, rain_cloud, growth_tonic) ──
  if (item.type === 'action' || item.type === 'consumable') {
    // Channel reward items can't be bought with petals in rewards mode (except petalsOnly items)
    if (ctx.useChannelRewards && item.type === 'action' && !item.petalsOnly) {
      return { ok: false, messages: [`"${item.name}" is a channel point reward — redeem it from the Twitch rewards menu!`] };
    }

    const performFn = ctx.performAction[actionId];
    if (!performFn) return { ok: false, messages: [`This item can't be purchased right now.`] };

    const cost = ctx.costs[actionId] !== undefined ? ctx.costs[actionId] : (item.cost || 0);
    if (cost > 0) {
      const viewer = db.getViewer(lower);
      if (viewer.petals < cost) {
        return { ok: false, messages: [`Need ${cost}🌸 petals (you have ${viewer.petals}🌸).`] };
      }
    }

    const result = performFn(lower, slotArg || '');
    if (result.ok) {
      if (cost > 0) {
        db.deductPetals(lower, cost);
        const bal = db.getViewer(lower).petals;
        result.messages.push(`@${lower} 💸 -${cost}🌸 via dashboard (balance: ${bal}🌸)`);
      }
      for (const m of result.messages) client.say(channel, m).catch(() => {});
    }
    return { ok: result.ok, messages: result.messages };
  }

  // ── Upgrades ──────────────────────────────────────────────────────────────
  if (item.type === 'upgrade') {
    if (db.isUpgradePurchased(item.id)) {
      return { ok: false, messages: [`${item.emoji} ${item.name} is already purchased — the whole garden benefits!`] };
    }
    if (item.id === 'silver_can' && !db.isUpgradePurchased('copper_can')) {
      return { ok: false, messages: [`You need the Copper Can before upgrading to the Silver Can!`] };
    }
    const viewer = db.getViewer(lower);
    if (viewer.petals < item.cost) {
      return { ok: false, messages: [`Need ${item.cost}🌸 petals (you have ${viewer.petals}🌸).`] };
    }
    db.deductPetals(lower, item.cost);
    db.purchaseUpgrade(item.id, lower);
    const bal = db.getViewer(lower).petals;
    const msg = `@${lower} ${item.emoji} Purchased ${item.name} via the dashboard! ${item.description}. Balance: ${bal}🌸 🎉`;
    client.say(channel, msg).catch(() => {});
    return { ok: true, messages: [msg] };
  }

  return { ok: false, messages: [`Something went wrong — unknown item type.`] };
}

function handleReward(chan, username, rewardId, message) {
  let result;
  if (rewardId === GET_SEED_REWARD_ID)         result = performGetSeed(username);
  else if (rewardId === RARE_SEED_REWARD_ID)   result = performGetSeed(username, { rare: true });
  else if (rewardId === WATER_REWARD_ID)       result = performWater(username, message);
  else if (rewardId === HARVEST_REWARD_ID)     result = performHarvest(username, message);
  else if (rewardId === EXPAND_PLOT_REWARD_ID) result = performExpand(username);
  if (!result) return;
  for (const m of result.messages) client.say(chan, m);
}

// ─── Connect ──────────────────────────────────────────────────────────────────

overlayServer.start(OVERLAY_PORT, {
  getShopData: () => ({
    useChannelRewards: USE_CHANNEL_REWARDS,
    costs: {
      seed:          SEED_COST,
      uncommon_seed: UNCOMMON_SEED_COST,
      rare_seed:     RARE_SEED_COST,
      water:         WATER_COST,
      harvest:       0,
      expand:        getExpandCost(),
      fertilize:     FERTILIZE_COST,
      rain_cloud:    RAIN_COST,
      growth_tonic:  TONIC_COST,
    },
  }),
  handleAction: handleDashboardAction,
});

// Surface IRC-level connection lifecycle for easier debugging
client.on('connecting', (addr, port) => console.log(`🔌 Connecting to ${addr}:${port}...`));
client.on('logon', () => console.log('🔑 Auth handshake sent.'));
client.on('connected', (addr, port) => console.log(`✅ IRC connected at ${addr}:${port}`));
client.on('disconnected', reason => console.warn(`⚠️  Disconnected: ${reason}`));
client.on('notice', (chan, msgid, message) => console.log(`📨 NOTICE [${msgid}] ${message}`));

client.connect().then(() => {
  console.log(`🌿 CozyGardenBot connected to ${channel}`);
  console.log(`   Mode: ${USE_CHANNEL_REWARDS ? 'CHANNEL REWARDS (Twitch points trigger actions)' : 'PETALS-ONLY (chat commands cost petals)'}`);
  console.log(`   Ignored users (no petals/activity): ${[...IGNORED_USERS].join(', ') || '(none)'}`);

  if (USE_CHANNEL_REWARDS) {
    console.log(`   Channel Rewards: GET_SEED="${GET_SEED_REWARD_ID||'(not set)'}" RARE="${RARE_SEED_REWARD_ID||'(not set)'}" WATER="${WATER_REWARD_ID||'(not set)'}" HARVEST="${HARVEST_REWARD_ID||'(not set)'}" EXPAND="${EXPAND_PLOT_REWARD_ID||'(not set)'}"`);
    const unsetRewards = [GET_SEED_REWARD_ID, RARE_SEED_REWARD_ID, WATER_REWARD_ID, HARVEST_REWARD_ID, EXPAND_PLOT_REWARD_ID].some(id => !id);
    if (unsetRewards) {
      console.log(`   💡 Redeem a channel point reward and the bot will print its ID so you can add it to .env`);
    }
  } else {
    console.log(`   Petal costs: seed=${SEED_COST} rare=${RARE_SEED_COST} water=${WATER_COST} expand=${getExpandCost()} (base=${EXPAND_COST_BASE}, quadratic) | starter=${STARTER_PETALS}`);
  }

  // Announce in chat with the command + reward summary, mode-aware
  const welcome = USE_CHANNEL_REWARDS
    ? "🌿 CozyGardenBot is awake! Commands: !garden [slot] | !seed | !plant [slot] | !discard | !petals | !gardeners | !shop | !buyseed !buyrare !buyrain !buytonic [slot] | !ghelp — Channel Rewards: Get Seed | Water Plant | Harvest Plant | Expand Garden 🌸"
    : `🌿 CozyGardenBot is awake! New here? Type !startgarden to claim ${STARTER_PETALS}🌸 starter petals. Spend them: !buyseed (${SEED_COST}🌸) → !plant → !water [slot] (${WATER_COST}🌸) → !harvest. Type !ghelp for the full list. 🌸`;
  client.say(channel, welcome)
    .catch(err => console.warn('   (Could not post welcome message:', err && err.message, ')'));

  // Optional public dashboard tunnel — set DASHBOARD_TUNNEL=true in .env to enable.
  // Uses cloudflared (Cloudflare Tunnel) for a reliable public URL with no account needed.
  // Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
  if (process.env.DASHBOARD_TUNNEL === 'true') {
    const { spawn } = require('child_process');
    const cf = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${OVERLAY_PORT}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let urlAnnounced = false;
    const handleCfOutput = (data) => {
      if (urlAnnounced) return;
      const match = data.toString().match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match) {
        urlAnnounced = true;
        const dashUrl = `${match[0]}/dashboard`;
        console.log(`🌐 Public dashboard: ${dashUrl}`);
        client.say(channel, `🌸 Garden Dashboard is live! Open ${dashUrl} to see your petals, seed & shop. 🌿`)
          .catch(() => {});
      }
    };
    cf.stdout.on('data', handleCfOutput);
    cf.stderr.on('data', handleCfOutput);

    cf.on('error', err => {
      if (err.code === 'ENOENT') {
        console.warn('⚠️  cloudflared not found — DASHBOARD_TUNNEL requires the cloudflared CLI.');
        console.warn('   Download: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
      } else {
        console.warn('⚠️  cloudflared error:', err.message);
      }
      console.warn(`   Local dashboard still available at http://localhost:${OVERLAY_PORT}/dashboard`);
    });

    cf.on('close', () => {
      if (urlAnnounced) console.log('🔌 Cloudflare tunnel closed. Restart the bot to get a new URL.');
    });

    // Kill the cloudflared child when the bot process exits
    process.on('exit', () => { try { cf.kill(); } catch {} });
  } else {
    console.log(`🖥  Local dashboard: http://localhost:${OVERLAY_PORT}/dashboard`);
    console.log('   Set DASHBOARD_TUNNEL=true in .env to expose it publicly via cloudflared.');
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
