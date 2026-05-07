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
const BASE_SPRITE    = 64;   // Display size for fully-grown bloom sprite (1:1 with 64×64 native art)

// Per-stage sprite scale multipliers (applied to BASE_SPRITE). Every sprite is
// the same native resolution; scaling by stage gives a clear sense of growth
// without needing different art per size.
//   With 64×64 native sources:
//     stage 0 (seed):    1.00× → 64px (1:1, pixel-perfect)
//     stage 1 (sprout):  0.50× → 32px (clean 1:2 downscale, every other pixel)
//     stage 2 (budding): 0.75× → 48px (non-integer 4:3 downscale, slight pixel
//                                       inconsistency — switch to [0.5, 0.5, 1.0]
//                                       for fully-clean integer scales if desired)
//     stage 3 (bloom):   1.00× → 64px (1:1, pixel-perfect)
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
// Plants whose sprites haven't been authored yet are listed here too — the
// renderer's emoji fallback kicks in for any folder that 404s.
const PLANT_SPRITE_FOLDERS = {
  // Common
  dandelion:      'Dandelion',
  daisy:          'Daisy',
  sunflower:      'Sunflower',
  marigold:       'Marigold',
  tulip:          'Tulip',
  daffodil:       'Daffodil',
  cosmo:          'Cosmo',
  petunia:        'Petunia',
  zinnia:         'Zinnia',
  dahlia:         'Dahlia',
  peony:          'Peony',
  coneflower:     'Coneflower',
  impatiens:      'Impatiens',
  pansy:          'Pansy',
  mum:            'Mum',
  // Uncommon
  rose:           'Rose',
  snapdragon:     'Snapdragon',
  lavender:       'Lavender',
  lily:           'Lily',
  fuchsia:        'Fuchsia',
  sweetpeas:      'SweetPeas',
  hydrangea:      'Hydrangea',
  gardenia:       'Gardenia',
  hyacinth:       'Hyacinth',
  poppy:          'Poppy',
  // Rare
  freesia:        'Freesia',
  orchid:         'Orchid',
  bluepoppy:      'BluePoppy',
  batflower:      'BatFlower',
  chocolatecosmo: 'ChocolateCosmo',
  verbena:        'Verbena',
  bluebells:      'Bluebells',
  honeywort:      'Honeywort',
  vinca:          'Vinca',
  passiflora:     'Passiflora',
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

// Device pixel ratio — high-DPI / scaled displays (and OBS at higher
// canvas resolutions) need the backing buffer to be larger than the CSS
// size so text and edges stay crisp instead of being upscaled blurry.
const DPR = window.devicePixelRatio || 1;

let currentState = null;

// ─── Stage transition animations ─────────────────────────────────────────────
// When a plant advances a stage the overlay plays a short pop+sparkle animation.
// Each entry lives until its duration expires; the animate() loop naturally cleans
// them up via drawTransitionEffect().

const TRANSITION_DURATION = 900;  // ms — total length of the pop + particle effect
const stageTransitions = new Map(); // slot number → { startTime, particles }

const HARVEST_DURATION = 1400;    // ms — shake, rise, and fade-out
const harvestAnimations = new Map(); // slot number → { startTime, slot (snapshot), dirtParticles, trailParticles }

const WATER_DURATION = 1100;     // ms — droplets fall + ripple fades
const waterAnimations = new Map(); // slot number → { startTime, slotNum, particles }

function generateParticles() {
  const colors = ['#ffe478', '#ffffff', '#a4e0a4', '#5fc7ff', '#ffb3d9'];
  const count = 10;
  const particles = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const speed = 28 + Math.random() * 28;
    particles.push({
      vx:    Math.cos(angle) * speed,
      vy:    Math.sin(angle) * speed - 15,
      color: colors[Math.floor(Math.random() * colors.length)],
      size:  1.5 + Math.random() * 1.5,
    });
  }
  return particles;
}

// Spring-pop easing: ramps up to ~1.35× then bounces back to 1.0×.
function popEase(t) {
  const peak = 0.25;
  if (t < peak) return 1 + (t / peak) * 0.35;
  const s = (t - peak) / (1 - peak);
  return 1 + Math.exp(-s * 6) * Math.cos(s * Math.PI * 2.8) * 0.35;
}

// ─── Harvest animations ───────────────────────────────────────────────────────
// When a bloomed plant is harvested the overlay plays a pull-out animation:
// the plant shakes briefly, then rockets upward out of the frame while dirt
// clumps scatter from the base and golden sparkles trail behind it.

function generateHarvestDirtParticles() {
  const colors = ['#5a3d24', '#4a3018', '#7a5033', '#6b4526', '#8a6040'];
  const particles = [];
  for (let i = 0; i < 10; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const spread = (Math.random() * 0.5 + 0.1) * Math.PI; // ~18°–90° arc each side
    const speed = 28 + Math.random() * 32;
    particles.push({
      vx: side * Math.cos(spread) * speed,
      vy: -Math.sin(spread) * speed * 0.6,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: 1.5 + Math.random() * 2.5,
    });
  }
  return particles;
}

function generateHarvestTrailParticles() {
  const colors = ['#ffe478', '#ffd700', '#ffffff', '#ffb3d9', '#ffe0b2', '#a4e0a4'];
  const duration = HARVEST_DURATION / 1000;
  const particles = [];
  for (let i = 0; i < 14; i++) {
    const delay = 0.18 + i * 0.055; // staggered 55 ms apart, starting at 180 ms
    particles.push({
      delay,
      tAtSpawn: delay / duration,   // normalized t when this particle spawns
      ox: (Math.random() - 0.5) * 32,
      vx: (Math.random() - 0.5) * 22,
      vy: -(8 + Math.random() * 18),
      color: colors[Math.floor(Math.random() * colors.length)],
      size: 1 + Math.random() * 2.5,
    });
  }
  return particles;
}

// Returns {dx, dy} canvas offset for the plant at normalized time t (0 → 1).
// Phase 1 (t < 0.15): rapid horizontal shake while barely lifting.
// Phase 2 (t ≥ 0.15): quadratic acceleration upward with a settling wobble.
function harvestLiftOffset(t) {
  if (t < 0.15) {
    const st = t / 0.15;
    return {
      dx: Math.sin(st * Math.PI * 6) * 5 * (1 - st * 0.5),
      dy: -st * 10,
    };
  }
  const rt = (t - 0.15) / 0.85;
  return {
    dx: Math.sin(rt * Math.PI * 2.5) * 3 * Math.exp(-rt * 4),
    dy: -10 - rt * rt * 200, // ~210 px total upward travel
  };
}

function drawHarvestAnimation(ctx, x, y, ha) {
  const elapsed = (performance.now() - ha.startTime) / 1000;
  const duration = HARVEST_DURATION / 1000;
  const t = elapsed / duration;

  if (t >= 1) {
    harvestAnimations.delete(ha.slot.slot);
    return;
  }

  const { dx, dy } = harvestLiftOffset(Math.min(t, 1));
  const cx      = x + TILE_SIZE / 2;
  const dirtTop = y + BED_HEIGHT - BOX_HEIGHT + PLANK_THICK;
  const stageScale = PLANT_SCALE_BY_STAGE[Math.min(ha.slot.stage, 3)];
  const plantBaseY = dirtTop + 4 - BASE_SPRITE * stageScale; // top of bloom sprite at rest

  // Dirt clumps — burst outward from the base in the first 45 % of the animation
  if (elapsed < duration * 0.5) {
    const dirtAlpha = Math.max(0, 1 - t / 0.45);
    for (const p of ha.dirtParticles) {
      const px = cx + p.vx * elapsed;
      const py = dirtTop + p.vy * elapsed + 80 * elapsed * elapsed; // gravity
      ctx.save();
      ctx.globalAlpha = dirtAlpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(px, py, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Golden trail sparkles — staggered particles that spawn at the plant's rising
  // position and drift away, fading over ~400 ms each.
  for (const p of ha.trailParticles) {
    if (elapsed < p.delay) continue;
    const pt = elapsed - p.delay;
    if (pt > 0.55) continue;
    const { dx: sdx, dy: sdy } = harvestLiftOffset(p.tAtSpawn);
    const px = cx + sdx + p.ox + p.vx * pt;
    const py = plantBaseY + sdy + p.vy * pt + 15 * pt * pt; // slight gravity
    const alpha = Math.max(0, 1 - pt / 0.4);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(px, py, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Plant — translated upward, fading out in the final quarter
  ctx.save();
  ctx.translate(dx, dy);
  if (t > 0.75) ctx.globalAlpha = Math.max(0, 1 - (t - 0.75) / 0.25);
  const path   = spritePathFor(ha.slot);
  const sprite = path ? getSprite(path) : null;
  if (sprite && sprite.status === 'ok') {
    drawPlantSprite(ctx, x, y, sprite.img, ha.slot, 1);
  } else {
    drawPlantEmojiFallback(ctx, x, y, ha.slot, 1);
  }
  ctx.restore();
}

// ─── Water animations ─────────────────────────────────────────────────────────
// When a slot is watered, droplets fall from the top of the column and leave
// brief elliptical ripples where they hit the dirt.

function generateWaterDroplets() {
  const fallDist = BED_HEIGHT - BOX_HEIGHT + PLANK_THICK; // px from drop-start to dirtTop
  const particles = [];
  for (let i = 0; i < 9; i++) {
    const speed = 110 + Math.random() * 70; // px / s
    particles.push({
      delay:      i * 0.065 + Math.random() * 0.02,
      ox:         (Math.random() - 0.5) * TILE_SIZE * 0.55,
      speed,
      flightTime: fallDist / speed,
      size:       1.5 + Math.random() * 1.5,
    });
  }
  return particles;
}

function drawWaterAnimation(ctx, x, y, wa) {
  const elapsed = (performance.now() - wa.startTime) / 1000;
  if (elapsed >= WATER_DURATION / 1000) {
    waterAnimations.delete(wa.slotNum);
    return;
  }

  const cx         = x + TILE_SIZE / 2;
  const dropStartY = y + 2;                                   // just inside the top of the tile
  const dirtTop    = y + BED_HEIGHT - BOX_HEIGHT + PLANK_THICK;
  const fallDist   = dirtTop - dropStartY;

  for (const p of wa.particles) {
    const pt = elapsed - p.delay;
    if (pt <= 0) continue;

    if (pt < p.flightTime) {
      // In flight — circle with a short motion-streak above it
      const dropX = cx + p.ox;
      const dropY = dropStartY + (pt / p.flightTime) * fallDist;
      ctx.save();
      ctx.globalAlpha = 0.88;
      ctx.fillStyle = '#5fc7ff';
      ctx.beginPath();
      ctx.arc(dropX, dropY, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(95, 199, 255, 0.4)';
      ctx.lineWidth = p.size * 0.9;
      ctx.beginPath();
      ctx.moveTo(dropX, dropY - p.size * 1.2);
      ctx.lineTo(dropX, dropY - p.size * 4);
      ctx.stroke();
      ctx.restore();
    } else {
      // Landed — flat elliptical ripple that expands and fades
      const st  = pt - p.flightTime;
      const dur = 0.28;
      if (st > dur) continue;
      const sf = st / dur;
      ctx.save();
      ctx.globalAlpha = (1 - sf) * 0.6;
      ctx.strokeStyle = '#5fc7ff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx + p.ox, dirtTop - 1, sf * 7, sf * 2.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function resizeCanvasFor(slotCount) {
  const logicalW = Math.max(
    PADDING_X * 2 + slotCount * TILE_SIZE + Math.max(0, slotCount - 1) * TILE_GAP,
    200
  );
  const logicalH = PADDING_Y * 2 + BED_HEIGHT + INFO_GAP + INFO_HEIGHT;

  // Backing buffer is DPR-scaled; CSS size stays at logical px so layout
  // doesn't change. setTransform applies the DPR scale exactly once so every
  // draw call below can keep using logical coordinates.
  canvas.width  = logicalW * DPR;
  canvas.height = logicalH * DPR;
  canvas.style.width  = logicalW + 'px';
  canvas.style.height = logicalH + 'px';

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.imageSmoothingEnabled = false;
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}`);

  ws.onmessage = ev => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'state') {
        // Detect stage advances before swapping state
        if (currentState) {
          for (const newSlot of msg.data.slots) {
            const prev = currentState.slots.find(s => s.slot === newSlot.slot);
            // Stage advance → pop + sparkle
            if (prev && !prev.empty && !newSlot.empty && newSlot.stage > prev.stage) {
              stageTransitions.set(newSlot.slot, {
                startTime: performance.now(),
                particles: generateParticles(),
              });
            }
            // Harvest → pull-out animation (snapshot the bloom before state updates)
            if (prev && !prev.empty && newSlot.empty) {
              harvestAnimations.set(newSlot.slot, {
                startTime:      performance.now(),
                slot:           { ...prev },
                dirtParticles:  generateHarvestDirtParticles(),
                trailParticles: generateHarvestTrailParticles(),
              });
            }
            // Watering → droplets fall onto the slot
            if (prev && !prev.empty && !newSlot.empty &&
                newSlot.stage === prev.stage &&
                newSlot.watersDone > prev.watersDone) {
              waterAnimations.set(newSlot.slot, {
                startTime: performance.now(),
                slotNum:   newSlot.slot,
                particles: generateWaterDroplets(),
              });
            }
          }
        }
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
  // Clear in logical coords — canvas.width is DPR-scaled, the active transform
  // already multiplies by DPR, so divide back to logical pixels.
  ctx.clearRect(0, 0, canvas.width / DPR, canvas.height / DPR);

  const { slots } = currentState;
  if (!slots.length) return;

  const bedX = PADDING_X;
  const bedY = PADDING_Y;
  const bedW = slots.length * TILE_SIZE + Math.max(0, slots.length - 1) * TILE_GAP;
  const bedH = BED_HEIGHT;

  // 1. Wooden raised garden box at the bottom of the bed (sky above is left transparent)
  drawGardenBox(ctx, bedX, bedY, bedW, bedH);

  // 2. Subtle bloom highlights inside the bed for harvest-ready slots.
  //    During a harvest animation the highlight fades out with the plant.
  for (let i = 0; i < slots.length; i++) {
    const slotX = bedX + i * (TILE_SIZE + TILE_GAP);
    const ha = harvestAnimations.get(slots[i].slot);
    if (slots[i].isBloom) {
      drawBloomHighlight(ctx, slotX, bedY, TILE_SIZE, bedH);
    } else if (ha) {
      const ht = Math.min((performance.now() - ha.startTime) / HARVEST_DURATION, 1);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - ht);
      drawBloomHighlight(ctx, slotX, bedY, TILE_SIZE, bedH);
      ctx.restore();
    }
  }

  // 3. Water dots in the dirt + plant sprites for each occupied slot.
  //    Harvest animation overrides normal rendering for the departing slot.
  for (let i = 0; i < slots.length; i++) {
    const slotX = bedX + i * (TILE_SIZE + TILE_GAP);
    if (harvestAnimations.has(slots[i].slot)) {
      drawHarvestAnimation(ctx, slotX, bedY, harvestAnimations.get(slots[i].slot));
    } else if (!slots[i].empty) {
      drawWaterProgress(ctx, slotX, bedY, slots[i]);
      drawPlant(ctx, slotX, bedY, slots[i]);
    }
    const wa = waterAnimations.get(slots[i].slot);
    if (wa) drawWaterAnimation(ctx, slotX, bedY, wa);
  }

  // 4. Info strip below the bed: slot # / plant name / stage per column
  const infoY = bedY + bedH + INFO_GAP;
  drawInfoStrip(ctx, bedX, infoY, bedW, INFO_HEIGHT);
  for (let i = 0; i < slots.length; i++) {
    const slotX = bedX + i * (TILE_SIZE + TILE_GAP);
    const ha    = harvestAnimations.get(slots[i].slot);
    drawSlotInfo(ctx, slotX, infoY, ha ? ha.slot : slots[i]);
    if (i < slots.length - 1) {
      drawColumnDivider(ctx, slotX + TILE_SIZE, infoY, INFO_HEIGHT);
    }
  }
}

// Continuous animation loop — drives the wind sway. requestAnimationFrame
// pauses automatically when the OBS Browser Source isn't visible.
// The try/catch prevents a one-off render error from killing the loop.
function animate() {
  try {
    render();
  } catch (err) {
    console.error('Garden overlay render error:', err);
  }
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

  // Line 1 — slot number (with ✨ indicator if fertilized)
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  const slotLabel = slot.fertilized ? `Slot ${slot.slot} ✨` : `Slot ${slot.slot}`;
  ctx.fillText(slotLabel, cx, y + 5);

  // Line 2 — plant name (or "empty")
  const name = slot.empty ? 'empty' : (slot.name || 'unknown');
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = slot.empty ? 'rgba(255, 255, 255, 0.5)' : '#fff';
  ctx.fillText(name, cx, y + 21);

  // Line 3 — stage (only when planted; bloom is gold). Empty + fertilized
  // shows a subtle "fertilized" hint instead so streamers / viewers see why
  // the slot is special.
  if (!slot.empty) {
    const stage = STAGE_NAMES[Math.min(slot.stage, 3)];
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.fillStyle = slot.isBloom ? '#ffe478' : 'rgba(255, 255, 255, 0.7)';
    ctx.fillText(stage, cx, y + 38);
  } else if (slot.fertilized) {
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.fillStyle = '#a4e0a4';
    ctx.fillText('Fertilized', cx, y + 38);
  }
}

function drawPlant(ctx, x, y, slot) {
  const tr = stageTransitions.get(slot.slot);
  let transitionScale = 1;
  if (tr) {
    const t = (performance.now() - tr.startTime) / TRANSITION_DURATION;
    if (t < 1) {
      transitionScale = popEase(t);
    } else {
      stageTransitions.delete(slot.slot);
    }
  }

  // save/restore isolates ALL canvas state changes (transform, globalAlpha,
  // fillStyle, font, etc.) so nothing leaks into subsequent slot renders.
  ctx.save();
  try {
    const path = spritePathFor(slot);
    const sprite = path ? getSprite(path) : null;
    if (sprite && sprite.status === 'ok') {
      drawPlantSprite(ctx, x, y, sprite.img, slot, transitionScale);
    } else {
      drawPlantEmojiFallback(ctx, x, y, slot, transitionScale);
    }

    if (tr) {
      drawTransitionEffect(ctx, x, y, slot, tr);
    }
  } finally {
    ctx.restore();
  }
}

function drawTransitionEffect(ctx, x, y, slot, tr) {
  const elapsed = (performance.now() - tr.startTime) / 1000;
  const duration = TRANSITION_DURATION / 1000;

  // Plant visual center — used as the particle/flash origin
  const cx = x + TILE_SIZE / 2;
  const dirtTop = y + BED_HEIGHT - BOX_HEIGHT + PLANK_THICK;
  const stageScale = PLANT_SCALE_BY_STAGE[Math.min(slot.stage, 3)];
  const drawSize = BASE_SPRITE * stageScale;
  const cy = dirtTop + 4 - drawSize * 0.6;

  // Flash ring: expands quickly and fades out in the first ~30% of the animation
  const flashT = Math.min(elapsed / (duration * 0.3), 1);
  if (flashT < 1) {
    const ringRadius = flashT * 28;
    const ringAlpha  = (1 - flashT) * 0.7;
    ctx.save();
    ctx.globalAlpha = ringAlpha;
    ctx.strokeStyle = '#ffe478';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Sparkle particles: fly out then fade
  const fadeCutoff = duration * 0.75;
  ctx.save();
  for (const p of tr.particles) {
    const px = cx + p.vx * elapsed;
    const py = cy + p.vy * elapsed + 40 * elapsed * elapsed; // gravity
    const alpha = Math.max(0, 1 - elapsed / fadeCutoff);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(px, py, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// How hard each stage sways. Seeds don't sway (they're in the ground); blooms
// sway the most because they're top-heavy with petals.
const SWAY_INTENSITY_BY_STAGE = [0, 0.020, 0.025, 0.035];

// Per-stage vertical offset (px). Positive values push the sprite DOWN toward /
// into the dirt. The shared seed sprite sits below the dirt line so it looks
// buried in the soil; growing plants stay rooted at the dirt surface.
const Y_OFFSET_BY_STAGE = [30, 0, 0, 0];

function drawPlantSprite(ctx, x, y, img, slot, transitionScale = 1) {
  const stageScale = PLANT_SCALE_BY_STAGE[Math.min(slot.stage, 3)];
  const drawSize = Math.round(BASE_SPRITE * stageScale * transitionScale);

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

function drawPlantEmojiFallback(ctx, x, y, slot, transitionScale = 1) {
  const emoji = slot.isBloom
    ? slot.emoji
    : STAGE_EMOJIS[Math.min(slot.stage, STAGE_EMOJIS.length - 1)];

  const scaleByStage = [0.45, 0.6, 0.75, 1.0];
  const scale = scaleByStage[Math.min(slot.stage, 3)];
  const fontSize = Math.floor(TILE_SIZE * 0.55 * scale * transitionScale);

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
