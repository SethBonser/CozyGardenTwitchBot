'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const db = require('../db');
const { getPlant, getGrowthInfo, getEffectiveWatersNeeded } = require('../helpers');
const { SHOP_CATALOG } = require('../commands/shop');

// Builds the JSON state payload sent to overlay clients.
// Shape stays stable across Option 1 (emoji renderer) and Option 2 (sprite renderer)
// — only the client-side render function will change.
function buildState() {
  const slotCount = db.getGardenSlotCount();
  const rows = db.getAllSlots();
  return {
    slotCount,
    slots: rows.map(s => {
      const fertilized = db.hasSlotBuff(s.slot, 'fertilizer');
      if (!s.plant_id) {
        return { slot: s.slot, empty: true, fertilized };
      }
      const info = getGrowthInfo(s);
      if (!info) {
        return { slot: s.slot, empty: true, unknown: true, fertilized };
      }
      const watersNeeded = info.isBloom ? 0 : getEffectiveWatersNeeded(s.slot, info.watersNeeded);
      return {
        slot: s.slot,
        empty: false,
        fertilized,
        plant_id: info.plant.id,
        name: info.plant.name,
        emoji: info.plant.emoji,
        rarity: info.plant.rarity,
        stage: info.stage,
        isBloom: info.isBloom,
        watersDone: info.watersDone,
        watersNeeded,
      };
    }),
  };
}

function start(port = 8080, options = {}) {
  const { getShopData, handleAction } = options;

  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));
  // Expose the sprite assets stored alongside plants.json so the overlay can load them.
  app.use('/sprites', express.static(path.join(__dirname, '..', 'data', 'Sprites')));
  app.get('/state', (req, res) => res.json(buildState()));
  app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

  // ── Dashboard API ──────────────────────────────────────────────────────────

  // Viewer profile: petals, held seed, water count, harvest count
  app.get('/api/viewer/:username', (req, res) => {
    const username = req.params.username.toLowerCase().trim();
    if (!username) return res.status(400).json({ error: 'Username required' });
    const viewer = db.getViewer(username);
    const plant = viewer.held_seed ? getPlant(viewer.held_seed) : null;
    res.json({
      username,
      petals:        viewer.petals,
      waters_given:  viewer.waters_given,
      harvest_count: db.getHarvestCount(username),
      held_seed:     viewer.held_seed || null,
      seed_name:     plant ? plant.name  : null,
      seed_emoji:    plant ? plant.emoji : null,
      seed_rarity:   plant ? plant.rarity : null,
      has_started:   db.hasClaimedStarter(username),
    });
  });

  // Harvest history for a viewer
  app.get('/api/viewer/:username/history', (req, res) => {
    const username = req.params.username.toLowerCase().trim();
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
    res.json(db.getHarvestHistory(username, limit));
  });

  // Current garden state (alias for /state, named for the dashboard)
  app.get('/api/garden', (_req, res) => res.json(buildState()));

  // Shop catalog with per-item availability computed server-side
  app.get('/api/shop', (_req, res) => {
    const shopData = getShopData ? getShopData() : { useChannelRewards: false, costs: {} };
    const { useChannelRewards, costs } = shopData;

    const NEEDS_SLOT = { fertilize: 'required', growth_tonic: 'required', water: 'optional', harvest: 'optional' };

    const items = Object.values(SHOP_CATALOG).map(item => {
      const isChannelReward = useChannelRewards && item.type === 'action' && !item.petalsOnly;
      const cost = (item.type === 'action' || item.type === 'consumable')
        ? (costs[item.actionId || item.id] !== undefined ? costs[item.actionId || item.id] : (item.cost || 0))
        : (item.cost || 0);
      const owned = item.type === 'upgrade' ? db.isUpgradePurchased(item.id) : false;
      const prereqMet = item.id !== 'silver_can' || db.isUpgradePurchased('copper_can');
      return {
        id:             item.id,
        name:           item.name,
        emoji:          item.emoji,
        cmd:            item.cmd,
        type:           item.type,
        category:       item.category,
        cost,
        description:    item.description,
        detail:         item.detail || null,
        petalsOnly:     item.petalsOnly || false,
        isChannelReward,
        owned,
        prereqMet,
        needsSlot:      NEEDS_SLOT[item.id] || false,
        canBuy:         !isChannelReward && !owned && prereqMet,
      };
    });
    res.json({ useChannelRewards, items });
  });

  // Process a buy/action from the dashboard
  app.post('/api/action', (req, res) => {
    if (!handleAction) return res.status(503).json({ ok: false, messages: ['Action handler not configured.'] });
    const { username, action, slot } = req.body || {};
    if (!username || !action) return res.status(400).json({ ok: false, messages: ['Missing username or action.'] });
    const result = handleAction(String(username).toLowerCase().trim(), String(action), slot != null ? String(slot) : '');
    res.json(result);
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  function broadcast() {
    const payload = JSON.stringify({ type: 'state', data: buildState() });
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(payload);
    }
  }

  wss.on('connection', ws => {
    // Send the initial state on connect
    ws.send(JSON.stringify({ type: 'state', data: buildState() }));
  });

  // Subscribe to db mutations and push updates to all connected overlay clients
  db.events.on('change', broadcast);

  server.listen(port, () => {
    console.log(`🖼  Overlay server: http://localhost:${port}/  (add as a Browser Source in OBS)`);
  });

  return { broadcast, buildState };
}

module.exports = { start, buildState };
