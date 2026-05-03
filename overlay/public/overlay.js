'use strict';

// ─── Configuration ───────────────────────────────────────────────────────────
// Pin these values now so when we move to Option 2 (sprite atlas), the layout
// is already at the resolution your sprite art will be authored at.

const TILE_SIZE      = 80;   // Each plant occupies an 80px-wide column
const TILE_GAP       = 0;    // Slots sit flush — the box is one continuous unit
const PADDING_X      = 16;
const PADDING_Y      = 12;
const BED_HEIGHT     = 96;   // Total bed area height (open sky above + wooden box at bottom)
const BOX_HEIGHT     = 36;   // Height of the wooden raised garden box at the bottom
const PLANK_THICK    = 5;    // Wood plank thickness
const INFO_HEIGHT    = 56;   // Height of the info strip below the bed
const INFO_GAP       = 8;    // Space between box and info strip
const BASE_SPRITE    = 64;   // Display size for fully-grown bloom sprite (2× of 32×32 native)

// Per-stage sprite scale multipliers (applied to BASE_SPRITE). Even though every
// sprite is the same 32×32 native resolution, scaling by stage gives a clear
// sense of the plant growing taller as it matures.
//   stage 0 (seed):    full size, but Y-offset buries it in the dirt
//   stage 1 (sprout):  50% — small sapling
//   stage 2 (budding): 75% — getting there
//   stage 3 (bloom):   100% — full grown
const PLANT_SCALE_BY_STAGE = [1.0, 0.5, 0.75, 1.0];

// Stage emojis used when a sprite isn't available (fallback rendering).
const STAGE_EMOJIS = ['🌱', '🌿', '🌸', '🌺'];

// Short stage labels shown in the top-right badge of each tile.
const STAGE_NAMES = ['Seed', 'Sprout', 'Budding', 'Bloom'];

// Sprite stage names — stage index → filename fragment.
// Stage 0 (seed) uses the single shared `seed_sprite.png`; stages 1–3 use the
// plant-specific files under their PascalCase folder.
const STAGE_SPRITE_NAMES = ['seed', 'sprout', 'budding', 'bloom'];

// Maps a plant's `id` (lowercase) to its sprite folder (PascalCase) under
// `/sprites/`. Folder names match the actual on-disk layout in data/Sprites.
const PLANT_SPRITE_FOLDERS = {
  bluebell:      'Bluebell',
  bonsai:        'Bonsai',
  cactus:        'Cactus',
  cherryblossom: 'CherryBlossom',
  clover:        'Clover',
  crystalrose:   'CrystalRose',
  daisy:         'Daisy',
  dandelion:     'Dandelion',
  fern:          'Fern',
  frostflower:   'FrostFlower',
  galaxyrose:    'GalaxyRose',
  hyacinth:      'Hyacinth',
  lavender:      'Lavender',
  lotus:         'Lotus',
  maple:         'Maple',
  moonflower:    'Moonflower',
  mushroom:      'Mushroom',
  phoenixlily:   'PhoenixLily',
  poppy:         'Poppy',
  pumpkin:       'Pumpkin',
  sunflower:     'Sunflower',
  tulip:         'Tulip',
};

// ─── Sprite cache ────────────────────────────────────────────────────────────
// Lazy-loads sprite images and re-renders when each one finishes loading.
// Missing sprites silently fall back to emoji rendering so the overlay never
// breaks if an asset is absent or still loading.

const spriteCache = new Map();

function getSprite(path) {
  let entry = spriteCache.get(path);
  if (entry) return entry;
  entry = { img: new Image(), status: 'loading' };
  entry.img.onload = () => { entry.status = 'ok'; render(); };
  entry.img.onerror = () => { entry.status = 'error'; };
  entry.img.src = path;
  spriteCache.set(path, entry);
  return entry;
}

function spritePathFor(slot) {
  if (slot.stage === 0) return 'sprites/seed_sprite.png';
  const folder = PLANT_SPRITE_FOLDERS[slot.plant_id];
  if (!folder) return null; // unknown plant — caller will fall back to emoji
  const stage = STAGE_SPRITE_NAMES[Math.min(slot.stage, 3)];
  return `sprites/${folder}/${slot.plant_id}_${stage}_sprite.png`;
}

// ─── Canvas + WebSocket bootstrap ────────────────────────────────────────────

const canvas = document.getElementById('garden');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

let currentState = null;

function resizeCanvasFor(slotCount) {
  const w = PADDING_X * 2 + slotCount * TILE_SIZE + Math.max(0, slotCount - 1) * TILE_GAP;
  const h = PADDING_Y * 2 + BED_HEIGHT + INFO_GAP + INFO_HEIGHT;
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
  if (!slots.length) return;

  const bedX = PADDING_X;
  const bedY = PADDING_Y;
  const bedW = slots.length * TILE_SIZE + Math.max(0, slots.length - 1) * TILE_GAP;
  const bedH = BED_HEIGHT;

  // 1. Wooden raised garden box at the bottom of the bed (sky above is left transparent)
  drawGardenBox(ctx, bedX, bedY, bedW, bedH);

  // 2. Subtle bloom highlights inside the bed for harvest-ready slots
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].isBloom) {
      const slotX = bedX + i * (TILE_SIZE + TILE_GAP);
      drawBloomHighlight(ctx, slotX, bedY, TILE_SIZE, bedH);
    }
  }

  // 3. Water dots in the dirt + plant sprites for each occupied slot
  for (let i = 0; i < slots.length; i++) {
    const slotX = bedX + i * (TILE_SIZE + TILE_GAP);
    if (!slots[i].empty) {
      drawWaterProgress(ctx, slotX, bedY, slots[i]);
      drawPlant(ctx, slotX, bedY, slots[i]);
    }
  }

  // 4. Info strip below the bed: slot # / plant name / stage per column
  const infoY = bedY + bedH + INFO_GAP;
  drawInfoStrip(ctx, bedX, infoY, bedW, INFO_HEIGHT);
  for (let i = 0; i < slots.length; i++) {
    const slotX = bedX + i * (TILE_SIZE + TILE_GAP);
    drawSlotInfo(ctx, slotX, infoY, slots[i]);
    // Vertical divider between columns (skip last)
    if (i < slots.length - 1) {
      drawColumnDivider(ctx, slotX + TILE_SIZE, infoY, INFO_HEIGHT);
    }
  }
}

// Continuous animation loop — drives the wind sway. requestAnimationFrame
// pauses automatically when the OBS Browser Source isn't visible.
function animate() {
  render();
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// ─── Wooden raised garden box ────────────────────────────────────────────────

function drawGardenBox(ctx, x, y, w, h) {
  // Box geometry: sits at the bottom of the bed area; sky above is transparent
  const boxTop      = y + h - BOX_HEIGHT;
  const dirtTop     = boxTop + PLANK_THICK;
  const dirtBottom  = y + h - PLANK_THICK;
  const innerLeft   = x + PLANK_THICK;
  const innerRight  = x + w - PLANK_THICK;
  const dirtH       = dirtBottom - dirtTop;
  const dirtW       = innerRight - innerLeft;

  // Dirt fill inside the box
  ctx.fillStyle = '#5a3d24';
  ctx.fillRect(innerLeft, dirtTop, dirtW, dirtH);

  // Speckle texture across the dirt
  ctx.fillStyle = '#4a3018';
  const speckleCount = Math.floor(dirtW / 5);
  for (let i = 0; i < speckleCount; i++) {
    const sx = innerLeft + ((i * 11) % dirtW);
    const sy = dirtTop + ((i * 5) % dirtH);
    ctx.fillRect(sx, sy, 2, 2);
  }

  // Wood palette
  const wood       = '#8b5a2b';
  const woodLight  = '#a87547';
  const woodShadow = '#5a3618';

  // Top plank — full width, with highlight + shadow lines to suggest a bevel
  ctx.fillStyle = wood;       ctx.fillRect(x, boxTop, w, PLANK_THICK);
  ctx.fillStyle = woodLight;  ctx.fillRect(x, boxTop, w, 1);
  ctx.fillStyle = woodShadow; ctx.fillRect(x, boxTop + PLANK_THICK - 1, w, 1);

  // Bottom plank
  ctx.fillStyle = wood;       ctx.fillRect(x, dirtBottom, w, PLANK_THICK);
  ctx.fillStyle = woodLight;  ctx.fillRect(x, dirtBottom, w, 1);
  ctx.fillStyle = woodShadow; ctx.fillRect(x, dirtBottom + PLANK_THICK - 1, w, 1);

  // Left side plank
  ctx.fillStyle = wood;       ctx.fillRect(x, dirtTop, PLANK_THICK, dirtH);
  ctx.fillStyle = woodLight;  ctx.fillRect(x, dirtTop, 1, dirtH);
  ctx.fillStyle = woodShadow; ctx.fillRect(x + PLANK_THICK - 1, dirtTop, 1, dirtH);

  // Right side plank
  ctx.fillStyle = wood;       ctx.fillRect(innerRight, dirtTop, PLANK_THICK, dirtH);
  ctx.fillStyle = woodLight;  ctx.fillRect(innerRight, dirtTop, 1, dirtH);
  ctx.fillStyle = woodShadow; ctx.fillRect(innerRight + PLANK_THICK - 1, dirtTop, 1, dirtH);

  // Plank seams every column to suggest individual boards
  ctx.fillStyle = woodShadow;
  for (let sx = x + TILE_SIZE; sx < x + w; sx += TILE_SIZE) {
    ctx.fillRect(sx - 1, boxTop, 1, PLANK_THICK);
    ctx.fillRect(sx - 1, dirtBottom, 1, PLANK_THICK);
  }
}

function drawBloomHighlight(ctx, x, y, w, h) {
  // Warm vertical wash in the open space above the box to spotlight harvest-ready plants
  ctx.save();
  const skyH = h - BOX_HEIGHT;
  const grad = ctx.createLinearGradient(0, y, 0, y + skyH);
  grad.addColorStop(0, 'rgba(255, 228, 120, 0.22)');
  grad.addColorStop(1, 'rgba(255, 228, 120, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(x + 4, y, w - 8, skyH);
  ctx.restore();
}

// ─── Info strip below the bed ────────────────────────────────────────────────

function drawInfoStrip(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  roundRect(ctx, x, y, w, h, 6);
  ctx.fill();
}

function drawColumnDivider(ctx, x, y, h) {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + 6);
  ctx.lineTo(x, y + h - 6);
  ctx.stroke();
}

function drawSlotInfo(ctx, x, y, slot) {
  const cx = x + TILE_SIZE / 2;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // Line 1 — slot number
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.fillText(`Slot ${slot.slot}`, cx, y + 5);

  // Line 2 — plant name (or "empty")
  const name = slot.empty ? 'empty' : (slot.name || 'unknown');
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = slot.empty ? 'rgba(255, 255, 255, 0.5)' : '#fff';
  ctx.fillText(name, cx, y + 21);

  // Line 3 — stage (only when planted; bloom is gold)
  if (!slot.empty) {
    const stage = STAGE_NAMES[Math.min(slot.stage, 3)];
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.fillStyle = slot.isBloom ? '#ffe478' : 'rgba(255, 255, 255, 0.7)';
    ctx.fillText(stage, cx, y + 38);
  }
}

function drawPlant(ctx, x, y, slot) {
  const path = spritePathFor(slot);
  const sprite = path ? getSprite(path) : null;
  if (sprite && sprite.status === 'ok') {
    drawPlantSprite(ctx, x, y, sprite.img, slot);
  } else {
    drawPlantEmojiFallback(ctx, x, y, slot);
  }
}

// How hard each stage sways. Seeds don't sway (they're in the ground); blooms
// sway the most because they're top-heavy with petals.
const SWAY_INTENSITY_BY_STAGE = [0, 0.020, 0.025, 0.035];

// Per-stage vertical offset (px). Positive values push the sprite DOWN toward /
// into the dirt. The shared seed sprite sits below the dirt line so it looks
// buried in the soil; growing plants stay rooted at the dirt surface.
const Y_OFFSET_BY_STAGE = [30, 0, 0, 0];

function drawPlantSprite(ctx, x, y, img, slot) {
  // Scale the sprite by stage so saplings are always visibly smaller than
  // budding/bloom even though every sprite shares the same 32×32 native size.
  // BASE_SPRITE (64) is the bloom display size — exact 2× of the 32×32 source.
  // Sprout = 0.5× (32, perfectly 1× of native) and Budding = 0.75× (48).
  const stageScale = PLANT_SCALE_BY_STAGE[Math.min(slot.stage, 3)];
  const drawSize = Math.round(BASE_SPRITE * stageScale);

  // Center horizontally in the column
  const drawX = x + Math.round((TILE_SIZE - drawSize) / 2);

  // Anchor at the dirt surface inside the wooden box
  const dirtTop = y + BED_HEIGHT - BOX_HEIGHT + PLANK_THICK;
  const stageOffset = Y_OFFSET_BY_STAGE[Math.min(slot.stage, 3)];
  const drawY = dirtTop + 4 - drawSize + stageOffset;

  // Wind sway — horizontal shear anchored at the bottom-center of the sprite.
  // Per-slot phase offset desyncs neighbors so the garden doesn't sway in unison.
  const intensity = SWAY_INTENSITY_BY_STAGE[Math.min(slot.stage, 3)];
  if (intensity > 0) {
    const t = performance.now() / 1000;
    const phase = slot.slot * 0.7 + (slot.plant_id ? slot.plant_id.charCodeAt(0) * 0.13 : 0);
    const shear = Math.sin(t * 1.6 + phase) * intensity;

    const anchorX = drawX + drawSize / 2;
    const anchorY = drawY + drawSize;

    ctx.save();
    ctx.translate(anchorX, anchorY);
    ctx.transform(1, 0, shear, 1, 0, 0);
    ctx.translate(-anchorX, -anchorY);
    ctx.drawImage(img, drawX, drawY, drawSize, drawSize);
    ctx.restore();
  } else {
    ctx.drawImage(img, drawX, drawY, drawSize, drawSize);
  }
}

function drawPlantEmojiFallback(ctx, x, y, slot) {
  // Used while sprites are still loading or if a file is missing. Same logic
  // the overlay shipped with originally.
  const emoji = slot.isBloom
    ? slot.emoji
    : STAGE_EMOJIS[Math.min(slot.stage, STAGE_EMOJIS.length - 1)];

  const scaleByStage = [0.45, 0.6, 0.75, 1.0];
  const scale = scaleByStage[Math.min(slot.stage, 3)];
  const fontSize = Math.floor(TILE_SIZE * 0.55 * scale);

  ctx.font = `${fontSize}px 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  const cx = x + TILE_SIZE / 2;
  const dirtTop = y + BED_HEIGHT - BOX_HEIGHT + PLANK_THICK;
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
  // Centered vertically inside the dirt strip of the wooden box
  const dirtTop    = y + BED_HEIGHT - BOX_HEIGHT + PLANK_THICK;
  const dirtBottom = y + BED_HEIGHT - PLANK_THICK;
  const dy = Math.floor((dirtTop + dirtBottom) / 2);

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
