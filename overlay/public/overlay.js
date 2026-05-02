'use strict';

// ─── Configuration ───────────────────────────────────────────────────────────
// Pin these values now so when we move to Option 2 (sprite atlas), the layout
// is already at the resolution your sprite art will be authored at.

const TILE_SIZE      = 80;   // Each garden slot is an 80×80 tile
const TILE_GAP       = 8;
const PADDING_X      = 16;
const PADDING_Y      = 12;
const STROKE_WIDTH   = 3;

// Stage emojis used when a plant hasn't bloomed yet — matches the chat formatter.
const STAGE_EMOJIS = ['🌱', '🌿', '🌸', '🌺'];

// ─── Canvas + WebSocket bootstrap ────────────────────────────────────────────

const canvas = document.getElementById('garden');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

let currentState = null;

function resizeCanvasFor(slotCount) {
  const w = PADDING_X * 2 + slotCount * TILE_SIZE + (slotCount - 1) * TILE_GAP;
  const h = PADDING_Y * 2 + TILE_SIZE + 24; // +24 for the title strip below the tile
  canvas.width = Math.max(w, 200);
  canvas.height = h;
  ctx.imageSmoothingEnabled = false;
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}`);

  ws.onmessage = ev => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'state') {
        currentState = msg.data;
        resizeCanvasFor(currentState.slotCount);
        render();
      }
    } catch (err) {
      console.error('Bad overlay message', err);
    }
  };

  ws.onclose = () => {
    // Auto-reconnect — OBS sources stay open for hours/days
    setTimeout(connect, 1500);
  };

  ws.onerror = () => ws.close();
}

connect();

// ─── Render pipeline ─────────────────────────────────────────────────────────
// renderSlot() is the single point of customization. Option 2 (sprite atlas)
// will replace the emoji-drawing logic with drawImage() calls keyed on plant_id
// + stage. Everything else (layout, animation timing, state plumbing) stays.

function render() {
  if (!currentState) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const { slots } = currentState;
  for (let i = 0; i < slots.length; i++) {
    const x = PADDING_X + i * (TILE_SIZE + TILE_GAP);
    const y = PADDING_Y;
    renderSlot(ctx, x, y, slots[i]);
  }
}

function renderSlot(ctx, x, y, slot) {
  // Background tile — sky on top, dirt on the bottom third
  drawTileBackground(ctx, x, y, slot);

  // Plant emoji centered in the tile, scaled by stage
  if (!slot.empty) {
    drawPlantEmoji(ctx, x, y, slot);
    drawWaterProgress(ctx, x, y, slot);
  }

  // Slot number in the top-left corner
  drawSlotLabel(ctx, x, y, slot.slot);
}

// ─── Tile pieces ─────────────────────────────────────────────────────────────

function drawTileBackground(ctx, x, y, slot) {
  const size = TILE_SIZE;
  const dirtHeight = Math.floor(size * 0.32);

  // Sky / pot
  ctx.fillStyle = slot.empty ? 'rgba(40, 44, 52, 0.55)' : 'rgba(120, 170, 220, 0.55)';
  roundRect(ctx, x, y, size, size, 8);
  ctx.fill();

  // Dirt strip
  ctx.fillStyle = '#5a3d24';
  ctx.beginPath();
  ctx.rect(x, y + size - dirtHeight, size, dirtHeight);
  ctx.fill();

  // Dirt speckle (pseudo pixel-art texture)
  ctx.fillStyle = '#4a3018';
  for (let i = 0; i < 8; i++) {
    const sx = x + ((i * 11 + slot.slot * 7) % size);
    const sy = y + size - dirtHeight + ((i * 5) % dirtHeight);
    ctx.fillRect(sx, sy, 2, 2);
  }

  // Bloom glow
  if (slot.isBloom) {
    ctx.save();
    ctx.shadowColor = '#fff3a8';
    ctx.shadowBlur = 16;
    ctx.strokeStyle = '#ffe478';
    ctx.lineWidth = STROKE_WIDTH;
    roundRect(ctx, x + 1, y + 1, size - 2, size - 2, 8);
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = STROKE_WIDTH;
    roundRect(ctx, x + 1, y + 1, size - 2, size - 2, 8);
    ctx.stroke();
  }
}

function drawPlantEmoji(ctx, x, y, slot) {
  // Stages 0-2 use the universal stage emoji so the silhouette grows organically.
  // Stage 3 (bloom) shows the actual plant emoji. Option 2 will replace this with
  // a 4-frame sprite per plant.
  const emoji = slot.isBloom
    ? slot.emoji
    : STAGE_EMOJIS[Math.min(slot.stage, STAGE_EMOJIS.length - 1)];

  // Scale grows with stage to give a sense of growth
  const scaleByStage = [0.45, 0.6, 0.75, 1.0];
  const scale = scaleByStage[Math.min(slot.stage, 3)];
  const fontSize = Math.floor(TILE_SIZE * 0.55 * scale);

  ctx.font = `${fontSize}px 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Anchor the emoji so it appears to "grow out of" the dirt
  const cx = x + TILE_SIZE / 2;
  const dirtTop = y + TILE_SIZE - Math.floor(TILE_SIZE * 0.32);
  const baselineY = dirtTop + 4;

  ctx.fillText(emoji, cx, baselineY);
}

function drawWaterProgress(ctx, x, y, slot) {
  if (slot.isBloom) return;
  const total = slot.watersNeeded || 1;
  const done = slot.watersDone || 0;

  const dotRadius = 2.5;
  const gap = 5;
  const totalWidth = total * (dotRadius * 2 + gap) - gap;
  const startX = x + (TILE_SIZE - totalWidth) / 2 + dotRadius;
  const dy = y + 8;

  for (let i = 0; i < total; i++) {
    ctx.beginPath();
    ctx.arc(startX + i * (dotRadius * 2 + gap), dy, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = i < done ? '#5fc7ff' : 'rgba(255, 255, 255, 0.35)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawSlotLabel(ctx, x, y, slotNum) {
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // Pill background for legibility
  const label = String(slotNum);
  const pad = 4;
  const w = ctx.measureText(label).width + pad * 2;
  const h = 14;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  roundRect(ctx, x + 4, y + 4, w, h, 4);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.fillText(label, x + 4 + pad, y + 5);
}

// ─── Geometry helper ─────────────────────────────────────────────────────────

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
