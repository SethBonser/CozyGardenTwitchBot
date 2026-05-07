# 🌿 CozyGardenBot

A cozy Twitch chatbot with a shared, expanding virtual garden. Viewers redeem channel point rewards to receive seeds, water plants, harvest blooms, and grow the garden together. Harvested petals can be spent in an in-stream shop on upgrades and consumables.

---

## ✨ Features

- **Shared garden** — every viewer plants in the same plot, so the garden is a community effort
- **Two play modes** — toggle between **Channel Rewards** (Twitch points trigger actions, free for the redeemer) and **Petals-only** (chat commands cost in-bot currency, no channel points needed) via a single env var
- **Channel point integration** — getting seeds, watering, and harvesting can all be redeemed via Twitch channel point rewards
- **Channel-wide harvest payouts** — when anyone harvests a flower, every recently-active chatter shares the petal reward
- **35 real-world plants across 3 rarities** — common, uncommon, and rare flora with different watering profiles and petal payouts
- **Botanical fun facts** — every plant comes with a real-world (or in-universe) trivia tidbit revealed when its seed is unwrapped
- **Live OBS overlay** — a transparent browser-source overlay renders the garden in real time, complete with a wooden raised garden box, custom 64×64 pixel-art sprites, stage-based scaling, wind-sway animation, and a pop + sparkle animation whenever a plant advances a stage
- **Viewer dashboard** — a web app viewers can open in their browser to see their petal balance, held seed, harvest history, a live garden view, and a graphical shop — optionally exposed publicly via localtunnel
- **Petals economy** — harvest plants to earn 🌸 petals, then spend them in the shop
- **Stream-wide upgrade & per-viewer consumables** — Compost Bin permanently improves the garden; Rain Cloud and Growth Tonic give one-shot boosts
- **Persistent state** — SQLite database keeps the garden alive across restarts
- **Leaderboards** — top gardeners are tracked by total waters given
- **Bot-friendly** — exclude other chat bots from rewards via `IGNORED_USERS`

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
| `USE_CHANNEL_REWARDS` | optional | `true` (default) to trigger actions via Twitch channel point rewards; `false` to use petal-cost chat commands instead |
| `GET_SEED_REWARD_ID` | ✅¹ | Reward UUID for the random-seed redemption |
| `RARE_SEED_REWARD_ID` | ✅¹ | Reward UUID for the guaranteed-rare-seed redemption |
| `WATER_REWARD_ID` | ✅¹ | Reward UUID for the water-a-plant redemption |
| `HARVEST_REWARD_ID` | ✅¹ | Reward UUID for the harvest-a-plant redemption |
| `EXPAND_PLOT_REWARD_ID` | ✅¹ | Reward UUID for expanding the garden by one slot |
| `STARTER_PETALS` | optional² | Petals granted on `!startgarden` (default `100`) |
| `SEED_COST` | optional² | `!buyseed` price — random distribution 60/30/10 (default `30`) |
| `UNCOMMON_SEED_COST` | optional² | `!buyuncommon` price — 75% uncommon / 25% rare, never common (default `100`) |
| `RARE_SEED_COST` | optional² | `!buyrare` price — guaranteed rare (default `200`) |
| `WATER_COST` | optional² | `!water` / `!buywater` price (default `5`) |
| `EXPAND_COST_BASE` | optional² | Base for the quadratic expand cost — actual cost = base × currentSize² (default `100`, so 3→4 = 900, 4→5 = 1600, 9→10 = 8100) |
| `FERTILIZE_COST` | optional³ | `!buyfertilize <slot>` price (default `300`) — applies to an empty slot and halves the water requirement at every stage for the next plant there. Always petal-priced regardless of mode. |
| `MAX_GARDEN_SLOTS` | optional | Hard cap on garden size (default `10`) |
| `OVERLAY_PORT` | optional | Port for the OBS overlay server (default `8080`) |
| `ACTIVE_VIEWER_WINDOW_MIN` | optional | How recently someone must have chatted to share in a harvest payout, in minutes (default `30`) |
| `IGNORED_USERS` | optional | Comma-separated list of usernames (other bots) to exclude from activity tracking and harvest rewards. The CozyGardenBot's own account is always ignored. |
| `RAIN_COST` | optional | Cost of `!buyrain` (Rain Cloud consumable, default `200`) |
| `TONIC_COST` | optional | Cost of `!buytonic <slot>` (Growth Tonic consumable, default `150`) |
| `WATER_COOLDOWN_ENABLED` | optional | `true` (default) to enforce a per-viewer watering cooldown in petals-only mode; `false` to disable entirely (useful for testing) |
| `WATER_COOLDOWN_MINUTES` | optional | Base cooldown between waters in petals-only mode, in minutes (default `10`) |
| `COPPER_CAN_COOLDOWN_MINUTES` | optional | Cooldown once the Copper Can upgrade is purchased (default `8`) |
| `SILVER_CAN_COOLDOWN_MINUTES` | optional | Cooldown once the Silver Can upgrade is purchased (default `6`) |
| `DASHBOARD_TUNNEL` | optional | `false` (default) — dashboard is local-only; `true` — expose it publicly via localtunnel (requires `npm install localtunnel`). URL is printed to the console and announced in chat. |

¹ Only used when `USE_CHANNEL_REWARDS=true`. Reward IDs can be left blank initially — the bot will print the UUID to the console the first time someone redeems an unrecognized reward.<br>
² Only used when `USE_CHANNEL_REWARDS=false`.<br>
³ Petals-only feature — works in both modes since players accumulate petals via harvest payouts.

### Play modes

Set `USE_CHANNEL_REWARDS` in `.env` to switch the entire bot's flow with one variable — no code changes needed. The same game mechanics run either way.

| Mode | When to use | How players get seeds | How they water/harvest/expand |
|---|---|---|---|
| **Channel Rewards** (`true`, default) | You're a Twitch Affiliate/Partner and want viewers to spend channel points | Redeem the **Get a Seed** / **Rare Seed** rewards | Redeem **Water Plant** / **Harvest Plant** / **Expand Garden** rewards |
| **Petals-only** (`false`) | You're not an Affiliate yet, or you'd rather use a self-contained currency | New viewers run `!startgarden` to claim `STARTER_PETALS` 🌸, then `!buyseed` (`SEED_COST`🌸) | Chat commands `!water`, `!harvest`, `!expand` (each with their own petal cost; `!harvest` is free since it's the payout, `!expand` cost scales quadratically with garden size) |

Both modes share the same `!plant`, `!seed`, `!discard`, `!garden`, `!petals`, `!gardeners`, `!shop`, and `!buy` commands. Switching modes is non-destructive — you can flip it any time, and existing player petals/held seeds carry over.

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
| **Get a Seed** | 100 | ✅ **Require Viewer to Enter Text** |
| **Rare Seed** | 500 | ✅ **Require Viewer to Enter Text** |
| **Water Plant** | 50 | ✅ **Require Viewer to Enter Text** (slot number, e.g. `3`, or leave blank to auto-water) |
| **Harvest Plant** | 100 | ✅ **Require Viewer to Enter Text** (optional slot number — useful when multiple plants are blooming) |
| **Expand Garden** | 1000 | ✅ **Require Viewer to Enter Text** + ✅ Skip Reward Requests Queue (optional) |

> 🔒 **Why every reward needs text input enabled:** the bot detects redemptions through chat messages. A redemption only produces a chat message if the reward requires viewer text — channel-point-only redemptions bypass IRC entirely. For rewards that don't *use* the text (Get Seed, Rare Seed, Expand Garden), put a friendly **User Input Prompt** like `Type anything to confirm 🌱` so viewers know what to do.

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

| Step | Channel-Rewards mode | Petals-only mode |
|---|---|---|
| 1. **Earn currency** | Spend Twitch channel points | Run `!startgarden` once to claim `STARTER_PETALS`🌸; harvest plants to earn more |
| 2. **Get a seed** | Redeem *Get a Seed* (or *Rare Seed*) | `!buyseed` (or `!buyrare`) — costs petals |
| 3. **Plant it** | `!plant` (auto-picks empty slot) or `!plant <slot>` | same |
| 4. **Water it** | Redeem *Water Plant*, optionally with a slot number | `!water [slot]` — costs petals |
| 5. **Watch it grow** | Seed 🌱 → Sprout 🌿 → Budding 🌸 → Blooming 🌺 | same |
| 6. **Harvest** | Redeem *Harvest Plant* — every active chatter shares the petals | `!harvest [slot]` — every active chatter still shares the petals |
| 7. **Spend** | `!shop` and `!buy` for upgrades, consumables, or more actions | same |

### Plants

| Rarity | Plants | Petal Reward |
|---|---|---|
| ⚪ Common (15) | 🌾 Dandelion, 🌼 Daisy, 🌻 Sunflower, 🏵️ Marigold, 🌷 Tulip, 💛 Daffodil, 🌸 Cosmo, 💜 Petunia, 🌺 Zinnia, 🏵️ Dahlia, 🌸 Peony, 🌼 Coneflower, 🌺 Impatiens, 💜 Pansy, 🏵️ Mum | 100 🌸 |
| 🟢 Uncommon (10) | 🌹 Rose, 🌷 Snapdragon, 💜 Lavender, 🪷 Lily, 💗 Fuchsia, 💐 Sweet Peas, 💙 Hydrangea, 💮 Gardenia, 🪻 Hyacinth, 🥀 Poppy | 250 🌸 |
| 🌟 Rare (10) | 💐 Freesia, 🪻 Orchid, 🥀 Blue Poppy, 🦇 Bat Flower, 🍫 Chocolate Cosmo, 💜 Verbena, 🔵 Bluebells, 🍯 Honeywort, 🟣 Vinca, 🟪 Passiflora | 600 🌸 |

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
| `!buy <item> [slot]` | Purchase a shop item by name — or use a shorthand: `!buyseed` `!buyrare` `!buyuncommon` `!buywater` `!buyharvest` `!buyexpand` `!buyfertilize <slot>` `!buyrain` `!buytonic <slot>` `!buycompost` |
| `!ghelp` | Quick reference for all commands and rewards (auto-adapts to current mode) |

**Petals-only mode adds these chat commands** (when `USE_CHANNEL_REWARDS=false`):

| Command | Cost | Description |
|---|---|---|
| `!startgarden` | free | Initialize as a gardener and claim `STARTER_PETALS` 🌸 (one-time per player) |
| `!water [slot]` | `WATER_COST` 🌸 | Water a plant (auto-picks lowest-progress slot if no number given) |
| `!harvest [slot]` | free | Harvest a bloomed plant (auto-picks first bloomed if no number given) |
| `!expand` | quadratic 🌸 | Expand the garden by one slot — cost scales as `EXPAND_COST_BASE × currentSize²` |

> 🌱 **Seeds are bought through the shop** — use `!buyseed` (`SEED_COST` 🌸), `!buyuncommon` (`UNCOMMON_SEED_COST` 🌸), or `!buyrare` (`RARE_SEED_COST` 🌸). There are no standalone seed commands.

> 🔒 **In channel-rewards mode**, `!water`, `!harvest`, `!expand`, and `!buyseed` / `!buyrare` just print a friendly redirect to use the matching channel point reward instead.
>
> 🌱 **In petals-only mode, every command is gated behind `!startgarden`** — viewers who haven't started yet get a friendly nudge to type `!startgarden` instead. The exceptions are `!startgarden` itself, `!ghelp`, `!garden`, `!gardeners`, and `!shop` (so newcomers can browse before deciding to start). Channel-rewards mode has no such gate since there's no `!startgarden` flow.

---

## 🎁 Channel Point Rewards

> Only relevant when `USE_CHANNEL_REWARDS=true`. In petals-only mode, the same actions are run via `!water [slot]`, `!harvest [slot]`, `!expand`, or via shorthand buy commands like `!buyseed`, `!buyrare` (seeds are shop-only).

| Reward | Behavior |
|---|---|
| **Get a Seed** | Rolls a random seed (60/30/10 common/uncommon/rare) and shares a fun fact about the plant. You can only hold one seed at a time — plant or discard it before redeeming again. |
| **Rare Seed** | Always rolls a rare seed (with its fun fact). Same one-seed-at-a-time rule. |
| **Water Plant** | Waters a plant. If the user types a slot number when redeeming (e.g. `3`), waters that slot; otherwise auto-picks the slot with the lowest water progress. |
| **Harvest Plant** | Harvests a bloomed plant. If the user types a slot number when redeeming, harvests that slot; otherwise auto-picks the first bloomed slot. **Petals go to the redeemer *and* every other viewer who has chatted recently** — the harvest is a shared community reward. (In petals-only mode, only viewers who have started the game via `!startgarden`/seed-redemption are included; in channel-rewards mode there is no such gate.) |
| **Expand Garden** | Adds one slot to the shared garden, up to `MAX_GARDEN_SLOTS`. |

---

## 🛒 Shop

The `!shop` command is the unified browse-and-buy interface. It lists four sections (sent as two chat messages):

### 🌱 Seeds

Seed purchases. In channel-rewards mode, Get a Seed and Rare Seed redirect to the matching channel point reward; Uncommon Seed is always petal-priced.

| Item | In Channel-Rewards mode | In Petals mode |
|---|---|---|
| 🎁 Get a Seed | `!buyseed` → "use the *Get a Seed* channel reward instead" | `!buyseed` charges `SEED_COST` 🌸 — random rarity (60/30/10) |
| 🍀 Uncommon Seed | `!buyuncommon` charges `UNCOMMON_SEED_COST` 🌸 (petals-only — no channel reward equivalent) | Same — `!buyuncommon` charges `UNCOMMON_SEED_COST` 🌸. **75% uncommon / 25% rare** — never common |
| 🌟 Rare Seed | redirect | `!buyrare` charges `RARE_SEED_COST` 🌸 — guaranteed rare |

### 🌿 Garden Actions

These are the same actions available via channel rewards / standalone commands. Their behavior depends on the current mode:

| Item | In Channel-Rewards mode | In Petals mode |
|---|---|---|
| 💧 Water Plant | redirect | `!buywater [slot]` charges `WATER_COST` 🌸 (or `!water [slot]` directly) |
| 🌺 Harvest | redirect | `!buyharvest [slot]` is free (it's the payout) (or `!harvest [slot]` directly) |
| 🌿 Expand Garden | redirect | `!buyexpand` charges the current quadratic cost (`EXPAND_COST_BASE × currentSize²` 🌸) |
| 🌱 Fertilize | `!buyfertilize <slot>` charges `FERTILIZE_COST` 🌸 (petals-only feature, no channel reward) | Same — `!buyfertilize <slot>` charges `FERTILIZE_COST` 🌸. Slot must be empty; the **next** plant there grows with HALF the waters needed at every stage. |

The full-name form `!buy <name> [slot]` still works too — e.g. `!buy seed`, `!buy water 3`, `!buy growth tonic 2`.

### 🪣 Watering Tools (stream-wide upgrades, one-time purchases)

| Item | Cost | Effect |
|---|---|---|
| 🪣🌿 Compost Bin | 600 🌸 | All plants need 20% fewer waters per stage |
| 🪣 Copper Can | 400 🌸 | Reduces the watering cooldown from `WATER_COOLDOWN_MINUTES` to `COPPER_CAN_COOLDOWN_MINUTES` (default 10 min → 8 min). Only applies in petals-only mode when `WATER_COOLDOWN_ENABLED=true`. |
| 🪣✨ Silver Can | 800 🌸 | Reduces the cooldown further to `SILVER_CAN_COOLDOWN_MINUTES` (default 6 min). Requires Copper Can. Same conditions apply. |

### 🧪 Boosts (per-viewer consumables, single-use)

| Item | Cost | Effect |
|---|---|---|
| 🌧️ Rain Cloud | 200 🌸 | Instantly waters every occupied slot once |
| 🧪 Growth Tonic | 150 🌸 | Your next water on a chosen slot counts as 3 waters. Use `!buytonic <slot>` to apply it |

---

## 🖼 OBS Overlay

The bot runs a small HTTP + WebSocket server alongside chat that renders the garden as a transparent overlay you can drop straight into OBS.

### Setting it up in OBS

1. Start the bot (`npm start`) — you should see `🖼  Overlay server: http://localhost:8080/` in the console
2. In OBS, add a new **Browser Source** to your scene
3. Configure it:
   - **URL**: `http://localhost:8080/`
   - **Width**: `1000` (will auto-fit the actual garden width)
   - **Height**: `140`
   - ✅ **Shutdown source when not visible** (optional but recommended)
   - ✅ **Refresh browser when scene becomes active** (optional)
4. Position the source wherever you'd like — most streamers place it along the bottom edge or in a corner
5. The overlay updates instantly when anyone plants, waters, harvests, or expands the garden

### What it shows

The overlay renders one continuous **wooden raised garden box** with all the plants growing inside it. Above the box is fully transparent so the garden feels open against your stream. Each plant column shows:

- A pixel-art **plant sprite** that scales up through stages — sprout (50%) → budding (75%) → bloom (100%) — so growth is always visually obvious even with same-sized source art
- A **stage transition animation** that plays the moment a plant advances: the sprite springs up to ~1.35× scale then bounces back, a gold ring expands and fades from the plant center, and 10 colored sparkle particles burst outward and fall under gravity. The whole effect lasts 900 ms. The duration is controlled by `TRANSITION_DURATION` at the top of `overlay/public/overlay.js`
- A subtle **wind sway** animation, anchored at the base of each plant. Seeds stay still (they're underground); blooms sway the most
- **Water-progress dots** in the dirt strip showing how close the plant is to advancing
- A warm **golden wash** above any bloomed plant to spotlight that it's harvest-ready

Below the box, a unified **info strip** shows three rows per slot:
1. `Slot N` (shown as `Slot N ✨` when fertilized)
2. Plant name (or *empty* in faded text)
3. Stage label — `Seed` / `Sprout` / `Budding` / `Bloom` (gold for blooms); empty fertilized slots show `Fertilized` in green instead

### Previewing without OBS

Open `http://localhost:8080/` in any browser — a checkered preview backdrop appears so you can see the overlay clearly. OBS itself ignores that backdrop and renders the page transparent.

### Pixel-art sprites

Sprites live alongside `plants.json` in `data/Sprites/` and are served at `/sprites/` by the overlay server. The expected layout:

```
data/Sprites/
├── seed_sprite.png                       ← shared seed (stage 0), used for every plant
├── <PlantFolder>/                        ← PascalCase folder per plant
│   ├── <plant_id>_sprout_sprite.png      ← stage 1
│   ├── <plant_id>_budding_sprite.png     ← stage 2
│   └── <plant_id>_bloom_sprite.png       ← stage 3
```

For example: `data/Sprites/Daisy/daisy_bloom_sprite.png`, `data/Sprites/PhoenixLily/phoenixlily_budding_sprite.png`.

The mapping from `plant_id` (lowercase, from [data/plants.json](data/plants.json)) to folder name (PascalCase) lives in `PLANT_SPRITE_FOLDERS` in [overlay/public/overlay.js](overlay/public/overlay.js) — if you add a new plant, add an entry there too.

**Authoring tips:**
- **Native resolution: 64×64px.** Sprites are drawn at 64×64 for blooms (perfect 1:1, pixel-perfect)
- All four stages use the **same 64×64 frame size** — the overlay handles size differences by scaling: sprout renders at 32×32 (clean 0.5×), budding at 48×48 (0.75× — slight pixel inconsistency since it's non-integer), bloom at 64×64 (1:1). You don't need to scale your art per stage, just make each frame visually appropriate
- Use **transparent backgrounds** — the wooden box and dirt are already drawn by the overlay; each sprite should just be the plant itself
- Anchor the plant to the **bottom of its frame** so it appears to grow out of the dirt
- The **shared seed sprite** (`seed_sprite.png`) is automatically pushed below the dirt line so it looks buried
- Any sprites still loading or missing **gracefully fall back to emoji rendering** — the overlay never breaks if you only have a few sprites done

---

## 📊 Viewer Dashboard

The bot includes a graphical web dashboard that viewers can open in their browser to interact with the garden without typing chat commands.

### What the dashboard shows

- **Stats** — current petal balance, held seed (with rarity badge), total harvests, and total waters given
- **Garden view** — live slot-by-slot view of the garden synced via WebSocket (same feed as the OBS overlay)
- **Shop** — graphical shop organized by category; viewers can buy seeds, consumables, and upgrades directly from the browser; slot-targeting items (Fertilize, Growth Tonic) show an inline slot picker
- **Harvest history** — a table of every plant the viewer personally harvested, with emoji, rarity, petal payout, and timestamp

All purchases made via the dashboard are processed by the bot and posted to Twitch chat exactly like a chat command, so the stream still sees the activity.

Authentication is honor-system: viewers type their Twitch username once and it's saved in their browser's local storage. There's no login gate — this is a cozy game, not a bank.

### Local access (default)

The dashboard is served by the same server as the OBS overlay. With the bot running:

```
http://localhost:8080/dashboard
```

This is only accessible on the streamer's machine. Viewers need the public tunnel to reach it.

### Public access via localtunnel

Set `DASHBOARD_TUNNEL=true` in `.env` (and install localtunnel if needed):

```bash
npm install localtunnel
```

```env
DASHBOARD_TUNNEL=true
```

On startup the bot will:
1. Open a localtunnel to your local port
2. Print the public URL to the console
3. Post it in chat: `🌸 Garden Dashboard is live! Open https://xxxx.loca.lt/dashboard …`

The URL changes every time the bot restarts (localtunnel assigns a random subdomain), so consider re-posting it after each stream start.

> ⚠️ localtunnel routes traffic through a third-party relay server. The dashboard contains only game state (no passwords, no payment info), so this is acceptable for a cozy streaming bot — but don't enable it if you'd rather keep all traffic local.

---

## 📁 Project Structure

```
cozy/
├── index.js              # Entry point — IRC client, message router, mode switch,
│                         # perform* action functions, reward + command dispatch
├── db.js                 # SQLite layer + change EventEmitter for live overlay updates
├── helpers.js            # Plant lookups, growth math, progress bars, slot parsing,
│                         # fuzzy shop-item matcher
├── package.json
├── .env.example
├── .gitignore
├── commands/
│   ├── garden.js         # !garden, !petals, !gardeners
│   ├── seeds.js          # !seed, !plant, !discard
│   ├── harvest.js        # cmdHarvest helper (legacy — harvest now runs via reward / !buy)
│   └── shop.js           # !shop, !buy, shop catalog (uses shopContext from index.js)
├── overlay/
│   ├── server.js         # HTTP + WebSocket server, broadcasts garden state on db change,
│   │                     # serves dashboard API (/api/viewer, /api/garden, /api/shop, /api/action)
│   └── public/
│       ├── index.html    # OBS Browser Source page (transparent body, canvas)
│       ├── overlay.js    # Canvas renderer — wooden box, sprites, sway, info strip
│       └── dashboard.html # Viewer-facing web dashboard — stats, shop GUI, harvest history
├── scripts/
│   ├── seed-test-garden.js  # Populate the garden with one plant at every stage for overlay testing
│   └── reset-garden.js      # Clear all slots and reset the garden to default size
└── data/
    ├── plants.json       # 35 plant definitions (rarity, watersPerStage, harvestPetals, fact)
    └── Sprites/          # Pixel-art assets (seed + per-plant folders)
```

### Data model (SQLite)

| Table | Purpose |
|---|---|
| `garden` | One row per slot — `plant_id`, `stage`, `waters_done`, `planted_by` |
| `viewers` | Per-user state — `petals` (currency for petals-mode actions, harvest payouts, and shop purchases), `held_seed`, `waters_given`, `last_watered`, `starter_claimed` (flips to 1 on first `!startgarden`, first seed redemption, or first harvest — gates both starter-petal claiming and harvest-payout eligibility) |
| `upgrades` | Stream-wide one-time purchases |
| `active_effects` | Pending per-viewer consumables (e.g. Growth Tonic on a slot) |
| `slot_buffs` | Slot-bound persistent buffs (e.g. fertilizer) — auto-cleared when the slot is harvested/discarded |
| `config` | Garden-wide settings, including current `garden_slots` count |
| `harvest_log` | One row per harvest — `username`, `plant_id`, `plant_name`, `plant_emoji`, `rarity`, `petals`, `slot`, `harvested_at` (ms timestamp). Powers the viewer dashboard's harvest history tab. |

---

## 🛠️ Development Notes

- The bot detects redemptions via the IRC `message` event by reading the `custom-reward-id` tag — every reward you want the bot to handle therefore needs **Require Viewer to Enter Text** enabled in the Twitch dashboard
- A **dedup cache** keyed off Twitch's per-message ID prevents the same redemption from triggering twice (rare but possible during network blips)
- Unknown reward IDs are logged to the console with instructions for adding them to `.env`
- Stage advancement is automatic: as soon as `waters_done >= watersNeeded` for the current stage, the plant advances; bloomed plants stop accepting water
- The Growth Tonic effect is consumed on the next water of the targeted slot, including via the *Water Plant* reward
- All channel reward responses are also visible in chat, so spectators can follow the action
- On startup the bot **announces itself in chat** with the full command + reward summary, so viewers always have the info handy
- **Connection diagnostics** — the bot logs IRC lifecycle events (`connecting`, `logon`, `connected`, `disconnected`, `notice`) and prints a verbose error message with common causes if connection fails
- **Debug toggles** in `.env`: set `DEBUG_TMI=true` to log raw IRC traffic, or `DEBUG_REWARDS=true` to log every chat message's reward-tag presence/absence

### Architecture: one set of action functions, four entry points

To keep the two play modes from forking the codebase, every game-state-changing action lives in a single perform function (`performGetSeed`, `performWater`, `performHarvest`, `performExpand`, `performRainCloud`, `performGrowthTonic`) that returns a result object describing what messages to post. Four different dispatchers call into them with the same arguments:

```
Channel reward redemption ─┐
                           │
!water / !harvest / !etc.  ├──► perform* action functions
                           │
!buyseed / !buywater       ┤
                           │
Dashboard POST /api/action ─┘
```

Adding a new entry point (Bits, sub-only, command alias, etc.) means writing a new dispatcher and reusing the same perform function. Changing how watering works means editing one place. The `shopContext` object (in `index.js`) is the small bundle of mode flag + costs + perform functions + `runPetalCostAction` helper that gets injected into `cmdShop` and `cmdBuy`. The dashboard's `handleDashboardAction` in `index.js` uses the same perform functions and posts results back to Twitch chat so the stream stays in sync.

### Robustness & input validation

The bot is built to be hard to break with weird user input:

- **Strict slot parsing** — slot numbers must be whole positive integers within the current garden size. Inputs like `1.5`, `1abc`, `0`, `-1`, or `999` are rejected with a friendly message rather than silently misinterpreted. Applies to `!plant`, `!garden <slot>`, `!buy <item> <slot>`, and the *Water/Harvest* reward text inputs.
- **Auto-pick fallbacks** — `!plant` with no slot picks the first empty plot; the *Water* reward with no text auto-targets the slot with the lowest water progress; the *Harvest* reward with no text auto-targets the first bloomed slot.
- **Stale held-seed recovery** — if a viewer is holding a seed whose plant has been removed from `plants.json`, `!seed`, `!plant`, and the *Get/Rare Seed* rewards detect it and gently auto-discard so the viewer isn't stuck.
- **Held-seed guard** — viewers can only hold one valid seed at a time; redeeming *Get/Rare Seed* while already holding one is blocked with a reminder to plant or discard.
- **Slot state checks** — empty, already-bloomed, and unknown-plant slots are caught and explained on every command (water, harvest, plant, growth tonic).
- **Petals safety** — `deductPetals` refuses to drop a viewer below zero, and `!buy` checks affordability before any state changes.

### Test scripts

Two helper scripts for overlay/visual testing without waiting for live redemptions. **Stop the bot before running them** (SQLite locks the DB while the bot is alive).

| Command | What it does |
|---|---|
| `npm run seed-test` | Sets the garden to 5 slots — slots 1-4 plant one example at every growth stage (Daisy seed, Sunflower sprout, Lavender budding, Bluebells bloom — all using shipped sprites), and slot 5 is left empty but fertilized. Lets you verify sprite rendering, stage scaling, the bloom highlight, and the fertilizer indicator side-by-side. |
| `npm run reset-garden` | Clears every planted slot and resets the slot count to the default of 3. Doesn't touch viewers, petals, upgrades, or active effects. |
| `node scripts/reset-database.js --yes` | ⚠️ **Destructive.** Wipes the entire database — every viewer, every petal balance, every planted slot, every upgrade, every consumable. Garden size reverts to 3. Requires `--yes` so it can't run by accident. Plants.json and sprite assets are untouched. *(On bash/cmd you can also use `npm run reset-database -- --yes`, but PowerShell sometimes strips the `--` separator — calling node directly sidesteps the issue.)* |

After running any of these, start the bot (`npm start`) and refresh your overlay/Browser Source.

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

If you want sprites for the new plant:
1. Create a folder `data/Sprites/<PascalCaseName>/` matching the plant — e.g. `data/Sprites/Rosemary/`
2. Drop in three sprites: `<plant_id>_sprout_sprite.png`, `<plant_id>_budding_sprite.png`, `<plant_id>_bloom_sprite.png` (64×64 native, transparent background)
3. Add the lowercase id → PascalCase mapping to `PLANT_SPRITE_FOLDERS` in [overlay/public/overlay.js](overlay/public/overlay.js)

No restart-time migration needed — the JSON is read on startup, and sprites are lazy-loaded the first time they're needed.

---

## 🩹 Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `📨 NOTICE [msg_login_unsuccessful] Login authentication failed` | Bad/expired `OAUTH_TOKEN`, or token is for the wrong account | Re-generate via [twitchtokengenerator.com](https://twitchtokengenerator.com/) signed in to the bot account in incognito mode. Make sure it's prefixed with `oauth:` |
| `Improperly formatted auth` | Missing `oauth:` prefix on `OAUTH_TOKEN` | Add `oauth:` to the start of the value |
| Bot connects but does nothing on redemption | Reward doesn't have *Require Viewer to Enter Text* enabled | Enable it on every garden reward in the Twitch dashboard |
| Reward triggered twice | Either two bot processes are running, or a transient Twitch resend | Check Task Manager for stray `node.exe`. The bot now dedups by message ID, so persistent doubles are usually a process-duplication issue |
| Overlay won't load in OBS | Wrong URL or port mismatch | Confirm `npm start` log shows `🖼  Overlay server: http://localhost:8080/`, then add that exact URL as a Browser Source |
| Overlay loads but plants are emoji, not sprites | Sprite path mismatch (folder name, file name, or PLANT_SPRITE_FOLDERS map) | Check the browser dev console (F12 in OBS Browser Source debug, or right-click → Inspect on a regular browser preview) for 404s on `/sprites/...` |

For more detail, run with `DEBUG_REWARDS=true` (see [Configuration](#-configuration)) to log every chat message's reward-tag presence — that immediately reveals whether redemptions are reaching the bot.

---

## 📜 License

MIT

---

🌙 *Happy gardening!* 🌿
