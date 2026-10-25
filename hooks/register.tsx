import type { Register } from 'claude-code'

// Balatro's score box, drawn as one Raster: a blue "chips" box and a red "mult"
// box with a pixel flame rising out of each as the number climbs, and each new
// number slamming in oversized, tilted and jittering before it settles. Chips are
// the output tokens of the turn; mult starts at 1 and gains 1 per tool call, each
// landing as its own hit, like a card scoring. The engine's own spinner line
// stays underneath, unchanged.

const BOX_W = 26
const GAP = 5
const COLUMNS = BOX_W * 2 + GAP
const ROWS = 10
const H = ROWS * 2
const BOX_TOP = 13
const FLAME_H = BOX_TOP
const FRAME_MS = 50
const HIT_MS = 380
const POP_MS = 260
const DEFAULT = 0x01000000

type Rgb = [number, number, number]
type Flame = { seed: number; ramp: Rgb[] }
type Pop = { text: string; at: number; kick: number; seed: number }
type Scene = { chips: Pop; mult: Pop; chipsHeat: number; multHeat: number }

const BLUE: Flame = { seed: 3.1, ramp: [[20, 100, 250], [30, 170, 255], [90, 230, 255], [200, 255, 255]] }
const RED: Flame = { seed: 17.7, ramp: [[225, 40, 55], [255, 110, 45], [255, 180, 60], [255, 240, 150]] }
const BOX_BLUE = 0x1e8cff
const BOX_BLUE_DARK = 0x1259b8
const BOX_RED = 0xf0433f
const BOX_RED_DARK = 0xa82a2a
const DIGIT = 0xffffff
const DIGIT_SHADOW = 0x2a3550

// A 3x5 pixel font: digits, the thousands comma and the times sign.
const GLYPHS: Record<string, string[]> = {
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

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const frac = (v: number) => v - Math.floor(v)
const hash = (x: number, y: number) => frac(Math.sin(x * 127.1 + y * 311.7) * 43758.5453)

const noise = (x: number, y: number) => {
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
const field = (x: number, y: number, t: number, seed: number) =>
  0.65 * noise(x * 0.32 + seed, y * 0.42 + t * 3.2) + 0.35 * noise(x * 0.8 + seed * 2, y * 0.9 + t * 5.5)

const ramp = (stops: Rgb[], v: number): number => {
  const pos = clamp(v) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(pos))
  const t = pos - i
  const [r, g, b] = [0, 1, 2].map(c => Math.round(lerp(stops[i]![c]!, stops[i + 1]![c]!, t)))

  return (r! << 16) | (g! << 8) | b!
}

const group = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

const glyphWidth = (ch: string) => GLYPHS[ch]?.[0]?.length ?? 3

const paintFlame = (px: Int32Array, x0: number, kind: Flame, intensity: number, t: number) => {
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

const paintBox = (px: Int32Array, x0: number, fill: number, dark: number) => {
  for (let y = BOX_TOP; y < H; y++) {
    for (let x = 0; x < BOX_W; x++) {
      const isEdgeRow = y === BOX_TOP || y === H - 1
      const isCorner = isEdgeRow && (x === 0 || x === BOX_W - 1)
      if (!isCorner) {
        px[y * COLUMNS + x0 + x] = y >= H - 2 ? dark : fill
      }
    }
  }
}

// Draws `text` right-aligned at `right`, scaled, tilted and jittered about its centre.
const paintText = (px: Int32Array, text: string, right: number, midY: number, pop: Pop, now: number, color: number) => {
  const p = clamp((now - pop.at) / POP_MS)
  const settle = 1 - (1 - p) * (1 - p) * (1 - p)
  const scale = 1 + pop.kick * (1 - settle)
  const shake = 1 - settle
  const angle = (hash(pop.seed, 1) - 0.5) * 0.4 * shake
  const width = [...text].reduce((w, ch) => w + glyphWidth(ch) + 1, -1)
  // Anchored at its right edge, so it grows leftward and stays on the raster.
  const cx = right - (width * scale) / 2
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
        const gy = midY - (scale - 1) * 3 + jy + dy

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

// One whole frame as Raster cells, two pixels a cell.
const paint = (scene: Scene, now: number): string => {
  const px = new Int32Array(COLUMNS * H).fill(-1)
  const t = now / 1000
  const redX = BOX_W + GAP
  const midY = BOX_TOP + (H - 2 - BOX_TOP) / 2

  paintFlame(px, 0, BLUE, scene.chipsHeat, t)
  paintFlame(px, redX, RED, scene.multHeat, t + 7)
  paintBox(px, 0, BOX_BLUE, BOX_BLUE_DARK)
  paintBox(px, redX, BOX_RED, BOX_RED_DARK)
  paintText(px, '×', BOX_W + GAP / 2 + 1.5, midY, { text: '×', at: 0, kick: 0, seed: 0 }, now, BOX_RED)
  paintText(px, scene.chips.text, BOX_W - 3, midY, scene.chips, now, DIGIT)
  paintText(px, scene.mult.text, redX + BOX_W - 3, midY, scene.mult, now, DIGIT)

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

export const register: Register = on => {
  let doneTokens = 0
  let stepChars = 0
  let tools = 0
  let chips = 0
  let mult = 1
  let lastChipsHit = 0
  let lastMultHit = 0
  let scene: Scene = fresh()
  let site: string | null = null
  let stopFrames: (() => void) | null = null

  function fresh(): Scene {
    return {
      chips: { text: '0', at: 0, kick: 0, seed: 1 },
      mult: { text: '1', at: 0, kick: 0, seed: 2 },
      chipsHeat: 0,
      multHeat: 0
    }
  }

  // The finished steps' real output tokens plus an estimate of the step streaming now.
  const tokens = () => doneTokens + Math.round(stepChars / 4)

  // A bigger jump hits harder, as a big mult does in Balatro.
  const hit = (from: number, to: number, now: number, seed: number): Pop => ({
    text: group(to),
    at: now,
    kick: 0.4 + Math.min(0.6, Math.log10(1 + Math.abs(to - from)) / 3),
    seed
  })

  // The numbers land in hits, not a smooth count, at most one per box every HIT_MS.
  const advance = (now: number) => {
    const nextChips = tokens()
    if (nextChips !== chips && now - lastChipsHit >= HIT_MS) {
      scene = { ...scene, chips: hit(chips, nextChips, now, now % 997) }
      chips = nextChips
      lastChipsHit = now
    }

    // Tool calls that land together still score one at a time.
    if (1 + tools > mult && now - lastMultHit >= HIT_MS) {
      mult += 1
      scene = { ...scene, mult: { ...hit(mult - 1, mult, now, (now % 991) + 0.5), kick: 0.9 } }
      lastMultHit = now
    }

    scene = {
      ...scene,
      chipsHeat: lerp(scene.chipsHeat, clamp((Math.log10(1 + chips) - 1.2) / 2), 0.15),
      multHeat: lerp(scene.multHeat, clamp(Math.log10(mult) / 1.2), 0.1)
    }
  }

  on('turn.start', ($, e, next) => {
    doneTokens = 0
    stepChars = 0
    tools = 0
    chips = 0
    mult = 1
    lastChipsHit = 0
    lastMultHit = 0
    scene = fresh()

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId) {
      return yield* next(e)
    }

    stepChars = 0
    const stream = next(e)

    for (;;) {
      const item = await stream.next()
      if (item.done) {
        return item.value
      }

      const chunk = item.value
      if (chunk.kind === 'text' || chunk.kind === 'thinking') {
        stepChars += chunk.text.length
      } else if (chunk.kind === 'input') {
        stepChars += chunk.json.length
      } else if (chunk.kind === 'stop' && chunk.usage) {
        doneTokens += chunk.usage.output_tokens
        stepChars = 0
      }

      yield chunk
    }
  })

  on('tool.call', ($, e, next) => {
    if (!e.agentId) {
      tools += 1
    }

    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    stopFrames?.()
    stopFrames = null
    site = null

    return next(e)
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal') {
      return next(e)
    }

    site = e.requestId

    if (stopFrames === null) {
      const timer = $.clock.every(FRAME_MS, async () => {
        const at = await $.clock.now()
        advance(at)

        if (site !== null) {
          await $.ui.blit({ requestId: site, key: 'score', cells: paint(scene, at) })
        }
      })
      stopFrames = () => timer.cancel()
    }

    const engine = await next(e)
    const { Box, Raster } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Raster key="score" columns={COLUMNS} rows={ROWS} cells={paint(scene, await $.clock.now())} />
        {engine}
      </Box>
    )
  })
}
