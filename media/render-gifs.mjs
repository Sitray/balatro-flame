// Renders the README's GIFs from the mod's own painter, replaying a turn the way
// hooks/register.tsx scores it. Run from the repository root with Node 23.6 or
// later (it imports the TypeScript painter directly): node media/render-gifs.mjs
import { writeFileSync } from 'node:fs'
import { COLUMNS, FRAME_MS, H, HIT_MS, clamp, group, lerp, paintScene } from '../hooks/paint.ts'

const CELL = 8
const MARGIN = 2
const BACKGROUND = 0x1e1e1e

// A turn: `tokens(ms)` output tokens so far, a tool call at each of `tools` (ms).
const replay = ({ ms, tokens, tools, startChips = 0, startMult = 1 }) => {
  let chips = startChips
  let mult = startMult
  let lastChipsHit = -HIT_MS
  let lastMultHit = -HIT_MS
  let scene = {
    chips: { text: group(chips), at: -1e9, kick: 0, seed: 1 },
    mult: { text: String(mult), at: -1e9, kick: 0, seed: 2 },
    chipsHeat: clamp((Math.log10(1 + chips) - 1.2) / 2),
    multHeat: clamp(Math.log10(mult) / 1.2)
  }
  const frames = []

  for (let now = 0; now < ms; now += FRAME_MS) {
    const next = startChips + Math.round(tokens(now))
    if (next !== chips && now - lastChipsHit >= HIT_MS) {
      const kick = 0.6 + Math.min(0.6, Math.log10(1 + Math.abs(next - chips)) / 3)
      scene = { ...scene, chips: { text: group(next), at: now, kick, seed: now % 997 } }
      chips = next
      lastChipsHit = now
    }

    const called = startMult + tools.filter(at => at <= now).length
    if (called > mult && now - lastMultHit >= HIT_MS) {
      mult += 1
      scene = { ...scene, mult: { text: group(mult), at: now, kick: 1.1, seed: (now % 991) + 0.5 } }
      lastMultHit = now
    }

    scene = {
      ...scene,
      chipsHeat: lerp(scene.chipsHeat, clamp((Math.log10(1 + chips) - 1.2) / 2), 0.15),
      multHeat: lerp(scene.multHeat, clamp(Math.log10(mult) / 1.2), 0.1)
    }
    frames.push(paintScene(scene, now))
  }

  return frames
}

// GIF's LZW: variable-width codes packed least significant bit first.
const lzw = (minSize, data) => {
  const clear = 1 << minSize
  let size = minSize + 1
  let next = clear + 2
  let dict = new Map()
  const out = []
  let acc = 0
  let bits = 0
  const emit = code => {
    acc |= code << bits
    bits += size
    while (bits >= 8) {
      out.push(acc & 0xff)
      acc >>>= 8
      bits -= 8
    }
  }

  emit(clear)
  let prefix = data[0]
  for (let i = 1; i < data.length; i++) {
    const key = prefix * 4096 + data[i]
    const known = dict.get(key)
    if (known !== undefined) {
      prefix = known
      continue
    }

    emit(prefix)
    if (next < 4096) {
      dict.set(key, next++)
      if (next > 1 << size && size < 12) {
        size += 1
      }
    } else {
      emit(clear)
      dict = new Map()
      size = minSize + 1
      next = clear + 2
    }
    prefix = data[i]
  }
  emit(prefix)
  emit(clear + 1)
  if (bits > 0) {
    out.push(acc & 0xff)
  }

  return out
}

const u16 = n => [n & 0xff, n >> 8]

const encode = (frames, delayCs) => {
  const width = (COLUMNS + MARGIN * 2) * CELL
  const height = (H + MARGIN * 2) * CELL
  const bytes = [...Buffer.from('GIF89a'), ...u16(width), ...u16(height), 0, 0, 0]
  // Loop forever.
  bytes.push(0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0)

  for (const px of frames) {
    // Each frame has its own palette; flames interpolate colours, so merge
    // near ones until it fits in 256.
    let mask = 0xffffff
    let colors
    for (;;) {
      colors = new Map([[BACKGROUND & mask, 0]])
      for (const c of px) {
        const key = (c < 0 ? BACKGROUND : c) & mask
        if (!colors.has(key)) {
          colors.set(key, colors.size)
        }
      }
      if (colors.size <= 256) {
        break
      }
      mask = (mask << 1) & 0xfefefe & mask
    }

    const tableBits = Math.max(1, Math.ceil(Math.log2(colors.size)))
    const indices = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) {
      const gy = Math.floor(y / CELL) - MARGIN
      for (let x = 0; x < width; x++) {
        const gx = Math.floor(x / CELL) - MARGIN
        const c = gx >= 0 && gx < COLUMNS && gy >= 0 && gy < H ? px[gy * COLUMNS + gx] : -1
        indices[y * width + x] = colors.get((c < 0 ? BACKGROUND : c) & mask)
      }
    }

    bytes.push(0x21, 0xf9, 4, 0x04, ...u16(delayCs), 0, 0)
    bytes.push(0x2c, 0, 0, 0, 0, ...u16(width), ...u16(height), 0x80 | (tableBits - 1))
    const table = new Array(3 << tableBits).fill(0)
    for (const [c, i] of colors) {
      table.splice(i * 3, 3, (c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff)
    }
    bytes.push(...table)

    const minSize = Math.max(2, tableBits)
    const data = lzw(minSize, indices)
    bytes.push(minSize)
    for (let i = 0; i < data.length; i += 255) {
      const block = data.slice(i, i + 255)
      bytes.push(block.length, ...block)
    }
    bytes.push(0)
  }
  bytes.push(0x3b)

  return Buffer.from(bytes)
}

const delay = Math.round(FRAME_MS / 10)

// A turn from nothing: tokens streaming in, a few tool calls, two landing together.
const turn = replay({
  ms: 7000,
  tokens: ms => (ms < 300 ? 0 : Math.min(2400, (ms - 300) * 0.42 + 90 * Math.sin(ms / 400))),
  tools: [1100, 1900, 2600, 2650, 3700, 4600]
})
writeFileSync('media/turn.gif', encode(turn, delay))

// A long turn already burning: big chips, high mult, the flames at full height.
const big = replay({
  ms: 5000,
  tokens: ms => ms * 7.5,
  tools: [400, 1000, 1500, 1550, 2300, 3000, 3600],
  startChips: 14200,
  startMult: 8
})
writeFileSync('media/big-score.gif', encode(big, delay))
