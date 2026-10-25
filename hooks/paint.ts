// The score's pixels, shared by the hooks module (terminal Raster, VS Code SVG)
// and the desktop surface module: the flames, the boxes, the pixel font and the
// hit of a new number, painted into a COLUMNS x H grid of colours.

export const BOX_W = 26
export const GAP = 5
export const COLUMNS = BOX_W * 2 + GAP
export const ROWS = 10
export const H = ROWS * 2
export const BOX_TOP = 13
export const FLAME_H = BOX_TOP
export const FRAME_MS = 33
export const HIT_MS = 380
// Kept under HIT_MS, so each hit settles before the next one lands.
export const POP_MS = 360
// How long each part of a hit lasts: the flame's burst, the box's shake, its
// white flash and the embers thrown up from it.
export const BURST_MS = 650
export const SHAKE_MS = 240
export const FLASH_MS = 130
export const EMBER_MS = 750
export const EMBERS = 9
export const DEFAULT = 0x01000000
export const SVG_PX = 8
export const LOOP_FRAMES = 14
export const LOOP_STEP = 0.06
export const POP_STEP = 0.04
export const REDRAW_TICKS = 30
export const LINGER_MS = 6000

export type Rgb = [number, number, number]
export type Flame = { seed: number; ramp: Rgb[] }
export type Pop = { text: string; at: number; kick: number; seed: number }
export type Scene = { chips: Pop; mult: Pop; chipsHeat: number; multHeat: number }

export const BLUE: Flame = { seed: 3.1, ramp: [[20, 100, 250], [30, 170, 255], [90, 230, 255], [200, 255, 255]] }
export const RED: Flame = { seed: 17.7, ramp: [[225, 40, 55], [255, 110, 45], [255, 180, 60], [255, 240, 150]] }
export const BOX_BLUE = 0x1e8cff
export const BOX_BLUE_DARK = 0x1259b8
export const BOX_RED = 0xf0433f
export const BOX_RED_DARK = 0xa82a2a
export const DIGIT = 0xffffff
export const DIGIT_SHADOW = 0x2a3550

// A 3x5 pixel font: digits, the thousands comma and the times sign.
export const GLYPHS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  ',': ['00', '00', '00', '01', '10'],
  '×': ['101', '010', '101']
}

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const frac = (v: number) => v - Math.floor(v)
export const hash = (x: number, y: number) => frac(Math.sin(x * 127.1 + y * 311.7) * 43758.5453)

export const noise = (x: number, y: number) => {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = frac(x)
  const fy = frac(y)
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)

  return lerp(
    lerp(hash(ix, iy), hash(ix + 1, iy), sx),
    lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), sx),
    sy
  )
}

// Two octaves, the field scrolling upward so the tongues rise and break off.
export const field = (x: number, y: number, t: number, seed: number) =>
  0.65 * noise(x * 0.32 + seed, y * 0.42 + t * 3.2) + 0.35 * noise(x * 0.8 + seed * 2, y * 0.9 + t * 5.5)

export const ramp = (stops: Rgb[], v: number): number => {
  const pos = clamp(v) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(pos))
  const t = pos - i
  const [r, g, b] = [0, 1, 2].map(c => Math.round(lerp(stops[i]![c]!, stops[i + 1]![c]!, t)))

  return (r! << 16) | (g! << 8) | b!
}

export const group = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

export const glyphWidth = (ch: string) => GLYPHS[ch]?.[0]?.length ?? 3

export const paintFlame = (px: Int32Array, x0: number, kind: Flame, intensity: number, t: number) => {
  if (intensity < 0.03) {
    return
  }

  const reach = FLAME_H * (0.1 + 1.6 * intensity)
  for (let x = 0; x < BOX_W; x++) {
    const side = Math.abs(x - (BOX_W - 1) / 2) / (BOX_W / 2)
    for (let y = 0; y < FLAME_H; y++) {
      const fromBase = FLAME_H - 1 - y
      const n = field(x, y, t, kind.seed)
      const heat = 1 - fromBase / reach - side * side * (0.95 - 0.45 * intensity) + (n - 0.5) * 1.3
      if (heat >= 0.36 + 0.3 * (1 - intensity)) {
        px[y * COLUMNS + x0 + x] = ramp(kind.ramp, fromBase / FLAME_H + (0.6 - heat) * 0.35)
      }
    }
  }
}

export const paintBox = (px: Int32Array, x0: number, fill: number, dark: number, dx = 0, dy = 0) => {
  for (let y = BOX_TOP; y < H; y++) {
    for (let x = 0; x < BOX_W; x++) {
      const isEdgeRow = y === BOX_TOP || y === H - 1
      const isCorner = isEdgeRow && (x === 0 || x === BOX_W - 1)
      const tx = x0 + x + dx
      const ty = y + dy
      if (!isCorner && tx >= 0 && tx < COLUMNS && ty >= 0 && ty < H) {
        px[ty * COLUMNS + tx] = y >= H - 2 ? dark : fill
      }
    }
  }
}

// `c` blended toward white by `amount` (0..1).
export const toWhite = (c: number, amount: number): number => {
  const channel = (shift: number) => Math.round(lerp((c >> shift) & 0xff, 255, amount)) << shift
  return channel(16) | channel(8) | channel(0)
}

// What a hit `since` milliseconds ago adds right now: the flame's extra heat,
// the box's offset, its flash toward white. All of them fade to nothing.
export const hitEffects = (pop: Pop, since: number) => {
  const fade = (ms: number) => (since >= 0 && since < ms ? 1 - since / ms : 0)
  const shake = fade(SHAKE_MS)
  const step = Math.floor(since / 35)

  return {
    burst: fade(BURST_MS) ** 2 * (0.25 + 0.3 * pop.kick),
    dx: Math.round((hash(pop.seed + step, 5) - 0.5) * 5 * shake),
    dy: Math.round((hash(pop.seed + step, 6) - 0.5) * 2 * shake),
    flash: 0.75 * fade(FLASH_MS)
  }
}

// Embers thrown up from the top of a box by a hit, falling back as they fade.
export const paintEmbers = (px: Int32Array, x0: number, kind: Flame, pop: Pop, since: number) => {
  if (since < 0 || since >= EMBER_MS) {
    return
  }

  const life = since / EMBER_MS
  for (let i = 0; i < EMBERS; i++) {
    const startX = x0 + 2 + hash(pop.seed, 20 + i) * (BOX_W - 4)
    const vx = (hash(pop.seed, 40 + i) - 0.5) * 0.03
    const vy = -(0.025 + hash(pop.seed, 60 + i) * 0.035)
    const x = Math.round(startX + vx * since)
    const y = Math.round(BOX_TOP - 1 + vy * since + 0.00002 * since * since)
    if (x >= 0 && x < COLUMNS && y >= 0 && y < BOX_TOP && hash(pop.seed, 80 + i) > life * 0.6) {
      px[y * COLUMNS + x] = ramp(kind.ramp, 1 - life * 0.7)
    }
  }
}

// A hit's spring at `since` ms: 1 at the slam, swinging below 0 and back as it
// dies out; 0 once settled.
export const spring = (since: number): number => {
  if (since < 0 || since >= POP_MS) {
    return 0
  }

  const p = since / POP_MS
  const wave = Math.cos(p * Math.PI * 2.5)

  return (1 - p) * (1 - p) * wave
}

// Draws `text` right-aligned at `right`, scaled, tilted and jittered about its
// centre, and kept between the columns `lo` and `hi` however big the hit.
export const paintText = (
  px: Int32Array,
  text: string,
  right: number,
  midY: number,
  pop: Pop,
  now: number,
  color: number,
  lo = 0,
  hi = COLUMNS
) => {
  const since = now - pop.at
  const p = clamp(since / POP_MS)
  const width = [...text].reduce((w, ch) => w + glyphWidth(ch) + 1, -1)
  const room = Math.max(1, (hi - lo - 1) / width)
  const swing = spring(since)
  // Shrinking a 3x5 glyph breaks it, so the swing below rest is a dip instead.
  const scale = Math.min(room, 1 + pop.kick * Math.max(0, swing))
  const dip = Math.max(0, -swing) * 4
  const shake = (1 - p) * (1 - p)
  // The tilt swings from side to side as it settles, like a card landing.
  const angle = (hash(pop.seed, 1) < 0.5 ? -0.22 : 0.22) * shake * Math.cos(p * Math.PI * 3)
  // Anchored at its right edge, so it grows leftward, but pushed back inside.
  const half = (width * scale) / 2
  const cx = clamp(right - half, lo + half, hi - half)
  const cos = Math.cos(-angle)
  const sin = Math.sin(-angle)

  const plot = (dx: number, dy: number, c: number) => {
    let left = -width / 2
    ;[...text].forEach((ch, i) => {
      const rows = GLYPHS[ch]
      const gw = glyphWidth(ch)
      if (rows) {
        const jx = (hash(pop.seed, i * 2 + 3) - 0.5) * 2.5 * shake
        const jy = (hash(pop.seed, i * 2 + 4) - 0.5) * 2.5 * shake
        const top = -rows.length / 2
        const span = Math.ceil(Math.max(gw, rows.length) * scale) + 3
        const gx = cx + (left + gw / 2) * scale + jx + dx
        // Grow upward, into the flame, so the raster's bottom edge never cuts it.
        const gy = midY - (scale - 1) * 3 + dip + jy + dy

        for (let y = Math.floor(gy - span); y <= gy + span; y++) {
          for (let x = Math.floor(gx - span); x <= gx + span; x++) {
            if (x < 0 || x >= COLUMNS || y < 0 || y >= H) {
              continue
            }

            // Inverse mapping: rotate the destination back and unscale it into the glyph.
            const rx = x + 0.5 - gx
            const ry = y + 0.5 - gy
            const ux = (rx * cos - ry * sin) / scale + gw / 2
            const uy = (rx * sin + ry * cos) / scale - top
            const col = Math.floor(ux)
            const row = Math.floor(uy)
            if (rows[row]?.[col] === '1') {
              px[y * COLUMNS + x] = c
            }
          }
        }
      }
      left += gw + 1
    })
  }

  plot(0, 1, DIGIT_SHADOW)
  plot(0, 0, color)
}

// One whole frame as pixels, each a colour or -1 where nothing is drawn.
export const paintScene = (scene: Scene, now: number): Int32Array => {
  const px = new Int32Array(COLUMNS * H).fill(-1)
  const t = now / 1000
  const redX = BOX_W + GAP
  const midY = BOX_TOP + (H - 2 - BOX_TOP) / 2
  const chipsSince = now - scene.chips.at
  const multSince = now - scene.mult.at
  const chips = hitEffects(scene.chips, chipsSince)
  const mult = hitEffects(scene.mult, multSince)

  paintFlame(px, 0, BLUE, clamp(scene.chipsHeat + chips.burst), t)
  paintFlame(px, redX, RED, clamp(scene.multHeat + mult.burst), t + 7)
  paintEmbers(px, 0, BLUE, scene.chips, chipsSince)
  paintEmbers(px, redX, RED, scene.mult, multSince)
  paintBox(px, 0, toWhite(BOX_BLUE, chips.flash), toWhite(BOX_BLUE_DARK, chips.flash / 2), chips.dx, chips.dy)
  paintBox(px, redX, toWhite(BOX_RED, mult.flash), toWhite(BOX_RED_DARK, mult.flash / 2), mult.dx, mult.dy)
  paintText(px, '×', BOX_W + GAP / 2 + 1.5, midY, { text: '×', at: 0, kick: 0, seed: 0 }, now, BOX_RED)
  paintText(px, scene.chips.text, BOX_W - 3 + chips.dx, midY + chips.dy, scene.chips, now, DIGIT, 0, BOX_W + 2)
  paintText(px, scene.mult.text, redX + BOX_W - 3 + mult.dx, midY + mult.dy, scene.mult, now, DIGIT, redX - 2)

  return px
}

// One whole frame as Raster cells, two pixels a cell.
export const paint = (scene: Scene, now: number): string => {
  const px = paintScene(scene, now)

  const words = new Uint32Array(COLUMNS * ROWS * 3)
  for (let row = 0; row < ROWS; row++) {
    for (let x = 0; x < COLUMNS; x++) {
      const top = px[row * 2 * COLUMNS + x]!
      const bottom = px[(row * 2 + 1) * COLUMNS + x]!
      let glyph = 0x20
      let fg = DEFAULT
      let bg = DEFAULT

      if (top >= 0 && bottom >= 0) {
        glyph = 0x2580
        fg = top
        bg = bottom
      } else if (top >= 0) {
        glyph = 0x2580
        fg = top
      } else if (bottom >= 0) {
        glyph = 0x2584
        fg = bottom
      }

      words.set([glyph, fg, bg], (row * COLUMNS + x) * 3)
    }
  }

  return (new Uint8Array(words.buffer) as Uint8Array & { toBase64: () => string }).toBase64()
}

export const hex = (c: number) => '#' + c.toString(16).padStart(6, '0')

// Pixels as SVG paths: one path per colour, each row's runs of it as one rectangle.
// Colours are rounded to 16 steps a channel so a flame frame needs few paths.
export const toPaths = (px: Int32Array): string => {
  const runs = new Map<number, string>()

  for (let y = 0; y < H; y++) {
    let x = 0
    while (x < COLUMNS) {
      const c = px[y * COLUMNS + x]!
      if (c < 0) {
        x += 1
        continue
      }

      const key = c & 0xf0f0f0
      let end = x + 1
      while (end < COLUMNS && px[y * COLUMNS + end]! >= 0 && (px[y * COLUMNS + end]! & 0xf0f0f0) === key) {
        end += 1
      }

      runs.set(key, (runs.get(key) ?? '') + `M${x} ${y}h${end - x}v1h-${end - x}z`)
      x = end
    }
  }

  return [...runs].map(([c, d]) => `<path fill="${hex(c | 0x080808)}" d="${d}"/>`).join('')
}

// The whole scene as an animated SVG document, starting from `now`.
export const svgScene = (scene: Scene, now: number): string => {
  const redX = BOX_W + GAP
  const midY = BOX_TOP + (H - 2 - BOX_TOP) / 2
  const loopDur = LOOP_FRAMES * LOOP_STEP
  const parts: string[] = []

  // Flames: frames shown one after another, forever.
  for (let k = 0; k < LOOP_FRAMES; k++) {
    const px = new Int32Array(COLUMNS * H).fill(-1)
    const t = now / 1000 + k * LOOP_STEP
    paintFlame(px, 0, BLUE, scene.chipsHeat, t)
    paintFlame(px, redX, RED, scene.multHeat, t + 7)
    const values = Array.from({ length: LOOP_FRAMES }, (_, i) => (i === k ? 'visible' : 'hidden')).join(';')
    parts.push(
      `<g visibility="hidden"><animate attributeName="visibility" values="${values}" calcMode="discrete" dur="${loopDur}s" repeatCount="indefinite"/>${toPaths(px)}</g>`
    )
  }

  const boxes = new Int32Array(COLUMNS * H).fill(-1)
  paintBox(boxes, 0, BOX_BLUE, BOX_BLUE_DARK)
  paintBox(boxes, redX, BOX_RED, BOX_RED_DARK)
  paintText(boxes, '×', BOX_W + GAP / 2 + 1.5, midY, { text: '×', at: 0, kick: 0, seed: 0 }, now, BOX_RED)
  parts.push(toPaths(boxes))

  // Numbers: the hit in progress played once, its last frame (settled) kept.
  const left = Math.max(scene.chips.at, scene.mult.at) + POP_MS - now
  const popFrames = Math.max(0, Math.ceil(left / (POP_STEP * 1000)))
  for (let k = 0; k <= popFrames; k++) {
    const px = new Int32Array(COLUMNS * H).fill(-1)
    const at = k === popFrames ? now + POP_MS * 2 : now + k * POP_STEP * 1000
    paintText(px, scene.chips.text, BOX_W - 3, midY, scene.chips, at, DIGIT, 0, BOX_W + 2)
    paintText(px, scene.mult.text, redX + BOX_W - 3, midY, scene.mult, at, DIGIT, redX - 2)
    const timing = k === popFrames ? `begin="${k * POP_STEP}s" fill="freeze"` : `begin="${k * POP_STEP}s" dur="${POP_STEP}s"`
    parts.push(`<g visibility="hidden"><set attributeName="visibility" to="visible" ${timing}/>${toPaths(px)}</g>`)
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${COLUMNS} ${H}" ` +
    `width="${COLUMNS * SVG_PX}" height="${H * SVG_PX}" shape-rendering="crispEdges">${parts.join('')}</svg>`
  )
}
