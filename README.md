# 🌿 CozyGardenBot

A cozy Twitch chatbot with a shared, expanding virtual garden. Viewers redeem channel point rewards to receive seeds, water plants, harvest blooms, and grow the garden together. Harvested petals can be spent in an in-stream shop on upgrades and consumables.

---

## ✨ Features

- **Shared garden** — every viewer plants in the same plot, so the garden is a community effort
- **Channel point integration** — getting seeds, watering, and harvesting are all redeemed via Twitch channel point rewards
- **22 plants across 3 rarities** — common, uncommon, and rare flora with different bloom times and petal payouts
- **Botanical fun facts** — every plant comes with a real-world (or in-universe) trivia tidbit revealed when its seed is unwrapped
- **Petals economy** — harvest plants to earn 🌸 petals, then spend them in the shop
- **Stream-wide upgrades** — Copper Can, Silver Can, and Compost Bin permanently improve the garden
- **Per-viewer consumables** — Rain Cloud and Growth Tonic for one-shot boosts
- **Persistent state** — SQLite database keeps the garden alive across restarts
- **Leaderboards** — top gardeners are tracked by total waters given

---

## 📦 Installation

### Requirements
- Node.js **18+**
- A Twitch account for the bot (can be your own or a dedicated bot account)
- Channel point rewards set up on your Twitch channel (Affiliate or Partner)

### Setup

```bash
git clone <this-repo>
cd cozy
npm install
cp .env.example .env
```

Edit `.env` and fill in your credentials (see [Configuration](#-configuration)).

### Run

```bash
npm start
```

Or with auto-restart on file changes:

```bash
npm run dev
```

---

## ⚙️ Configuration

All config lives in `.env`:

| Variable | Required | Description |
|---|---|---|
| `BOT_USERNAME` | ✅ | Twitch login of the bot account |
| `OAUTH_TOKEN` | ✅ | OAuth token for the bot (must include `chat:read` and `chat:edit` scopes), formatted as `oauth:xxxxxx` |
| `CHANNEL_NAME` | ✅ | Channel to join, without the `#` |
| `GET_SEED_REWARD_ID` | ✅* | Reward UUID for the random-seed redemption |
| `RARE_SEED_REWARD_ID` | ✅* | Reward UUID for the guaranteed-rare-seed redemption |
| `WATER_REWARD_ID` | ✅* | Reward UUID for the water-a-plant redemption |
| `HARVEST_REWARD_ID` | ✅* | Reward UUID for the harvest-a-plant redemption |
| `EXPAND_PLOT_REWARD_ID` | ✅* | Reward UUID for expanding the garden by one slot |
| `MAX_GARDEN_SLOTS` | optional | Hard cap on garden size (default `10`) |

\* Reward IDs can be left blank initially. The bot will print the reward UUID to the console the first time someone redeems an unrecognized reward — paste those into `.env` and restart.

### Getting your environment variables

Below is a step-by-step guide to obtaining each value.

#### `BOT_USERNAME`

The Twitch login name of the account that will speak in chat. You can use your own Twitch account, but most streamers create a separate bot account.

1. Go to [twitch.tv/signup](https://www.twitch.tv/signup) and create a new account (or sign in to an existing one)
2. Use that account's **login name** (lowercase, what appears after `twitch.tv/` in the URL of its channel) — not the display name

```env
BOT_USERNAME=mybotaccount
```

#### `OAUTH_TOKEN`

A token that lets the bot authenticate with Twitch chat. Required scopes: **`chat:read`** and **`chat:edit`**.

**Easiest method — Twitch Token Generator:**

1. Open an incognito/private browser window (so you can sign in as the *bot* account, not your main account)
2. Sign in to [twitch.tv](https://www.twitch.tv/) as the bot account
3. Visit [twitchtokengenerator.com](https://twitchtokengenerator.com/)
4. Choose **"Bot Chat Token"**
5. Authorize the app — copy the **Access Token** it gives you
6. Paste it into `.env`, prefixed with `oauth:`

```env
OAUTH_TOKEN=oauth:abcdef1234567890abcdef1234567890
```

> ⚠️ Treat this like a password — anyone with it can post in chat as your bot. Never commit `.env` to git.

**Alternative — official Twitch CLI:** if you already have the [Twitch CLI](https://dev.twitch.tv/docs/cli/) set up, run `twitch token -u -s "chat:read chat:edit"` and prefix the result with `oauth:`.

#### `CHANNEL_NAME`

The login name of the Twitch channel the bot should join — usually **your own** streaming account.

1. Open your channel page (`twitch.tv/yourname`)
2. Take the part after `twitch.tv/` (lowercase)

```env
CHANNEL_NAME=yourname
```

> No `#` prefix — the bot adds that internally.

#### Channel point reward IDs

You need to be a Twitch **Affiliate** or **Partner** for custom channel point rewards to be available. To create them:

1. Open your channel's **Creator Dashboard** → **Viewer Rewards** → **Channel Points** → **Manage Rewards & Challenges**
2. Click **Manage Rewards** → **Add New Custom Reward**
3. Create the five rewards below — costs are suggestions, tune them for your stream:

| Reward | Suggested Cost | Recommended Settings |
|---|---|---|
| **Get a Seed** | 100 | — |
| **Rare Seed** | 500 | — |
| **Water Plant** | 50 | ✅ **Require Viewer to Enter Text** (so users can type a slot number) |
| **Harvest Plant** | 100 | ✅ **Require Viewer to Enter Text** (optional slot number — useful when multiple plants are blooming) |
| **Expand Garden** | 1000 | ✅ Skip Reward Requests Queue (optional, for instant resolution) |

4. **Get the reward UUIDs:**
   - Start the bot with the IDs blank: `npm start`
   - Redeem each reward once on stream (or via your own channel)
   - The bot prints the reward UUID to the console for any unrecognized redemption — copy each one into the corresponding `.env` variable
   - Restart the bot once all five are filled in

```env
GET_SEED_REWARD_ID=12345678-abcd-1234-abcd-1234567890ab
RARE_SEED_REWARD_ID=...
WATER_REWARD_ID=...
HARVEST_REWARD_ID=...
EXPAND_PLOT_REWARD_ID=...
```

> 💡 If you don't see UUIDs printed when you redeem, double-check that the bot has joined your channel (look for the `🌿 CozyGardenBot connected to #yourchannel` log line) and that the reward was redeemed in chat (channel-point-only rewards without a chat message won't trigger the IRC handler — make sure each reward shows up in chat when redeemed).

#### `MAX_GARDEN_SLOTS` *(optional)*

Hard cap on how large the garden can grow via the Expand Garden reward. Default is `10`.

```env
MAX_GARDEN_SLOTS=12
```

---

## 🎮 How to Play

### The growth loop

1. **Get a seed** — redeem the *Get a Seed* (or *Rare Seed*) channel reward
2. **Plant it** — `!plant` (auto-picks empty slot) or `!plant <slot>`
3. **Water it** — redeem the *Water Plant* reward, optionally typing a slot number
4. **Watch it grow** — Seed 🌱 → Sprout 🌿 → Budding 🌸 → Blooming 🌺
5. **Harvest** — redeem the *Harvest Plant* reward to collect petals 🌸
6. **Spend** — visit the `!shop` to buy upgrades and consumables

### Plants

| Rarity | Plants | Petal Reward |
|---|---|---|
| ⚪ Common | 🌼 Daisy, 🌻 Sunflower, 🍀 Clover, 🌷 Tulip, 🌾 Dandelion, 🥀 Poppy, 🌵 Cactus, 🍁 Maple Sapling, 🍃 Fern | 100 🌸 |
| 🟢 Uncommon | 💜 Lavender, 🍄 Mushroom, 🔵 Bluebell, 🪻 Hyacinth, 🌸 Cherry Blossom, 🎃 Pumpkin Vine, 🪴 Bonsai | 250 🌸 |
| 🌟 Rare | 🪷 Lotus, 🌙 Moonflower, 🌹 Crystal Rose, 🔥 Phoenix Lily, ❄️ Frostflower, ✨ Galaxy Rose | 600 🌸 |

Each plant has its own watering profile — rare plants take more waters per stage but pay out far more petals.

---

## 💬 Chat Commands

| Command | Description |
|---|---|
| `!garden` | Show all garden slots with progress bars |
| `!garden <slot>` | Show detailed info about a specific slot (plant, rarity, stage, water progress, harvest reward, planter) |
| `!seed` | Show the seed you're currently holding (with a fun fact about that plant) |
| `!plant [slot]` | Plant your held seed (auto-picks empty slot if no number given) |
| `!discard` | Release your held seed without planting |
| `!petals` | Show your petal balance |
| `!gardeners` | Top 3 gardeners by total waters given |
| `!shop` | List shop items and prices |
| `!buy <item> [slot]` | Purchase a shop item (slot required for Growth Tonic) |
| `!gardenhelp` | Quick reference for all commands and rewards |

> 🔒 **Watering and harvesting are channel point rewards, not chat commands.** Typing `!water` or `!harvest` will redirect you to use the rewards.

---

## 🎁 Channel Point Rewards

| Reward | Behavior |
|---|---|
| **Get a Seed** | Rolls a random seed (60/30/10 common/uncommon/rare) and shares a fun fact about the plant. You can only hold one seed at a time — plant or discard it before redeeming again. |
| **Rare Seed** | Always rolls a rare seed (with its fun fact). Same one-seed-at-a-time rule. |
| **Water Plant** | Waters a plant. If the user types a slot number when redeeming (e.g. `3`), waters that slot; otherwise auto-picks the slot with the lowest water progress. |
| **Harvest Plant** | Harvests a bloomed plant. If the user types a slot number when redeeming, harvests that slot; otherwise auto-picks the first bloomed slot. Petals go to the redeemer. |
| **Expand Garden** | Adds one slot to the shared garden, up to `MAX_GARDEN_SLOTS`. |

---

## 🛒 Shop

### Stream-wide upgrades (one-time purchases, benefit everyone)

| Item | Cost | Effect |
|---|---|---|
| 🪣 Copper Can | 400 🌸 | (legacy cooldown perk — kept for compatibility) |
| 🪣✨ Silver Can | 800 🌸 | (legacy cooldown perk — requires Copper Can) |
| 🪣🌿 Compost Bin | 600 🌸 | All plants need 20% fewer waters per stage |

### Per-viewer consumables (single-use)

| Item | Cost | Effect |
|---|---|---|
| 🌧️ Rain Cloud | 200 🌸 | Instantly waters every occupied slot once |
| 🧪 Growth Tonic | 150 🌸 | Your next water on a chosen slot counts as 3 waters. Use `!buy growth tonic <slot>` to apply it |

---

## 📁 Project Structure

```
cozy/
├── index.js              # Entry point, IRC client, message router, reward handler
├── db.js                 # SQLite layer (better-sqlite3) for garden, viewers, upgrades, effects
├── helpers.js            # Plant lookups, growth math, progress bars, fuzzy matching
├── package.json
├── .env.example
├── commands/
│   ├── garden.js         # !garden, !petals, !gardeners (and legacy cmdWater)
│   ├── seeds.js          # !seed, !plant, !discard
│   ├── harvest.js        # legacy cmdHarvest (now invoked via reward)
│   └── shop.js           # !shop, !buy, shop catalog
└── data/
    └── plants.json       # 22 plant definitions (rarity, watersPerStage, harvestPetals)
```

### Data model (SQLite)

| Table | Purpose |
|---|---|
| `garden` | One row per slot — `plant_id`, `stage`, `waters_done`, `planted_by` |
| `viewers` | Per-user state — `petals`, `held_seed`, `waters_given`, `last_watered` |
| `upgrades` | Stream-wide one-time purchases |
| `active_effects` | Pending consumables (e.g. Growth Tonic on a slot) |
| `config` | Garden-wide settings, including current `garden_slots` count |

---

## 🛠️ Development Notes

- The bot listens on both `message` (IRC reward redemptions, with `custom-reward-id` in tags) and `redeem` (some tmi.js forks) for maximum compatibility
- Unknown reward IDs are logged to the console with instructions for adding them to `.env`
- Stage advancement is automatic: as soon as `waters_done >= watersNeeded` for the current stage, the plant advances; bloomed plants stop accepting water
- The Growth Tonic effect is consumed on the next water of the targeted slot, including via the *Water Plant* reward
- All channel reward responses are also visible in chat, so spectators can follow the action

### Robustness & input validation

The bot is built to be hard to break with weird user input:

- **Strict slot parsing** — slot numbers must be whole positive integers within the current garden size. Inputs like `1.5`, `1abc`, `0`, `-1`, or `999` are rejected with a friendly message rather than silently misinterpreted. Applies to `!plant`, `!garden <slot>`, `!buy <item> <slot>`, and the *Water/Harvest* reward text inputs.
- **Auto-pick fallbacks** — `!plant` with no slot picks the first empty plot; the *Water* reward with no text auto-targets the slot with the lowest water progress; the *Harvest* reward with no text auto-targets the first bloomed slot.
- **Stale held-seed recovery** — if a viewer is holding a seed whose plant has been removed from `plants.json`, `!seed`, `!plant`, and the *Get/Rare Seed* rewards detect it and gently auto-discard so the viewer isn't stuck.
- **Held-seed guard** — viewers can only hold one valid seed at a time; redeeming *Get/Rare Seed* while already holding one is blocked with a reminder to plant or discard.
- **Slot state checks** — empty, already-bloomed, and unknown-plant slots are caught and explained on every command (water, harvest, plant, growth tonic).
- **Petals safety** — `deductPetals` refuses to drop a viewer below zero, and `!buy` checks affordability before any state changes.

### Adding a new plant

Add an entry to `data/plants.json`:

```json
{
  "id": "rosemary",
  "name": "Rosemary",
  "emoji": "🌿",
  "rarity": "uncommon",
  "watersPerStage": [3, 3, 4],
  "harvestPetals": 250,
  "fact": "Rosemary has been used as a symbol of remembrance for over 2,000 years."
}
```

- `watersPerStage` is `[Seed→Sprout, Sprout→Budding, Budding→Blooming]`
- `harvestPetals` should match the rarity tier (common 100, uncommon 250, rare 600) for balance
- `fact` is shown in chat whenever the seed is unwrapped or inspected — keep it short and chat-friendly

No restart-time migration needed — the JSON is read on startup.

---

## 📜 License

MIT

---

🌙 *Happy gardening!* 🌿
