'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const db = require('../db');
const { getGrowthInfo, getWatersNeededWithUpgrade } = require('../helpers');

// Builds the JSON state payload sent to overlay clients.
// Shape stays stable across Option 1 (emoji renderer) and Option 2 (sprite renderer)
// — only the client-side render function will change.
function buildState() {
  const slotCount = db.getGardenSlotCount();
  const rows = db.getAllSlots();
  return {
    slotCount,
    slots: rows.map(s => {
      if (!s.plant_id) {
        return { slot: s.slot, empty: true };
      }
      const info = getGrowthInfo(s);
      if (!info) {
        return { slot: s.slot, empty: true, unknown: true };
      }
      const watersNeeded = info.isBloom ? 0 : getWatersNeededWithUpgrade(info.watersNeeded);
      return {
        slot: s.slot,
        empty: false,
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

function start(port = 8080) {
  const app = express();
  app.use(express.static(path.join(__dirname, 'public')));
  // Expose the sprite assets stored alongside plants.json so the overlay can load them.
  app.use('/sprites', express.static(path.join(__dirname, '..', 'data', 'Sprites')));
  app.get('/state', (req, res) => res.json(buildState()));

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
