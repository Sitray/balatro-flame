import type { EngineInterface, Register } from 'claude-code'
import { COLUMNS, FRAME_MS, H, HIT_MS, LINGER_MS, REDRAW_TICKS, ROWS, SVG_PX, clamp, group, lerp, paint, svgScene } from './paint'
import type { Pop, Scene } from './paint'
import type { ScoreProps } from './score-client'


// Balatro's score box: a blue "chips" box and a red "mult" box with a pixel flame
// rising out of each as the number climbs, and each new number slamming in
// oversized, tilted and jittering before it settles. Chips are the output tokens
// of the turn; mult starts at 1 and gains 1 per tool call, each landing as its own
// hit, like a card scoring. The engine's own spinner line stays underneath,
// unchanged.
//
// The terminal draws it as one Raster above the spinner, repainted every frame.
// The other surfaces have no Raster, so the same pixels become an animated SVG: a
// looping set of flame frames, and the number's hit played once and held on its
// last frame. The desktop app shows its spinner row only now and then, so there
// the score sits in the band above the prompt, for the whole turn and LINGER_MS
// after it; VS Code has no such band and keeps it above the spinner.

// Session state, kept at the top of the module so the frame clock below can be
// started from any hook; a reload starts it over.
let doneTokens = 0
let stepChars = 0
let tools = 0
let chips = 0
let mult = 1
let lastChipsHit = 0
let lastMultHit = 0
let scene: Scene = fresh()
let site: string | null = null
let isTerminal = true
let isRunning = false
let endedAt = 0
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
  kick: 0.6 + Math.min(0.6, Math.log10(1 + Math.abs(to - from)) / 3),
  seed
})

// The numbers land in hits, not a smooth count, at most one per box every HIT_MS.
// Says whether either number was hit.
const advance = (now: number): boolean => {
  let isHit = false
  const nextChips = tokens()
  if (nextChips !== chips && now - lastChipsHit >= HIT_MS) {
    scene = { ...scene, chips: hit(chips, nextChips, now, now % 997) }
    chips = nextChips
    lastChipsHit = now
    isHit = true
  }

  // Tool calls that land together still score one at a time.
  if (1 + tools > mult && now - lastMultHit >= HIT_MS) {
    mult += 1
    scene = { ...scene, mult: { ...hit(mult - 1, mult, now, (now % 991) + 0.5), kick: 1.1 } }
    lastMultHit = now
    isHit = true
  }

  scene = {
    ...scene,
    chipsHeat: lerp(scene.chipsHeat, clamp((Math.log10(1 + chips) - 1.2) / 2), 0.15),
    multHeat: lerp(scene.multHeat, clamp(Math.log10(mult) / 1.2), 0.1)
  }

  return isHit
}

// One frame clock per turn, kept LINGER_MS past its end so the desktop band
// can show the final score before it goes.
function startFrames($: EngineInterface) {
  stopFrames?.()
  let ticks = 0
  const timer = $.clock.every(FRAME_MS, async () => {
    const at = await $.clock.now()
    const isHit = advance(at)
    ticks += 1

    if (!isRunning && at - endedAt > LINGER_MS) {
      stopFrames?.()
      stopFrames = null
      $.ui.invalidate('ui.render')
      return
    }

    if (isTerminal && site !== null) {
      await $.ui.blit({ requestId: site, key: 'score', cells: paint(scene, at) })
    } else if (!isTerminal && (isHit || ticks % REDRAW_TICKS === 0)) {
      // An SVG animates itself; draw a new one for a hit, and now and then
      // so the flames follow the score.
      $.ui.invalidate('ui.render')
    }
  })
  stopFrames = () => timer.cancel()
}

export const register: Register = on => {
  on('turn.start', ($, e, next) => {
    doneTokens = 0
    stepChars = 0
    tools = 0
    chips = 0
    mult = 1
    lastChipsHit = 0
    lastMultHit = 0
    scene = fresh()
    isRunning = true
    startFrames($)
    $.ui.invalidate('ui.render')

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

  on('turn.complete', async ($, e, next) => {
    isRunning = false
    endedAt = await $.clock.now()
    site = null

    return next(e)
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    // The desktop app draws the score in the band above the prompt instead.
    if (e.surface === 'desktop' || e.surface === 'mobile') {
      return next(e)
    }

    site = e.requestId
    isTerminal = e.surface === 'terminal'
    if (stopFrames === null) {
      startFrames($)
    }

    const engine = await next(e)
    const now = await $.clock.now()

    if (e.surface === 'terminal') {
      const { Box, Raster } = $.ui.resolve(e)

      return (
        <Box flexDirection="column">
          <Raster key="score" columns={COLUMNS} rows={ROWS} cells={paint(scene, now)} />
          {engine}
        </Box>
      )
    }

    const { Box, Svg } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Svg
          source={svgScene(scene, now)}
          alt={`${scene.chips.text} tokens × ${scene.mult.text}`}
          width={COLUMNS * SVG_PX}
          height={H * SVG_PX}
          isInteractive
        />
        {engine}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.hasSurvey) {
      return next(e)
    }

    const now = await $.clock.now()
    const isShown = e.props.isWorking || isRunning || (endedAt > 0 && now - endedAt <= LINGER_MS)
    if (!isShown) {
      return next(e)
    }

    isTerminal = false
    if (stopFrames === null) {
      startFrames($)
    }

    // The surface module animates the score itself, so this redraw only hands
    // it the numbers: the instance under this key is kept, never remounted.
    const { Client } = $.ui.resolve(e)
    const props: ScoreProps = {
      chips: scene.chips.text,
      mult: scene.mult.text,
      chipsKick: scene.chips.kick,
      multKick: scene.mult.kick,
      chipsHeat: scene.chipsHeat,
      multHeat: scene.multHeat
    }

    return <Client key="score" module="./score-client.tsx" props={props} width={COLUMNS} height={ROWS} />
  })
}
