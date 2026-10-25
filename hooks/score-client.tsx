import type { ClientModule } from 'claude-code'

import { COLUMNS, FRAME_MS, H, ROWS, hex, paintScene } from './paint'
import type { Pop } from './paint'

// The desktop score: the same pixels the terminal's Raster shows, drawn as rows
// of coloured boxes on the desktop's own frame clock. The hooks module hands it
// the numbers and the flames' heat; a new number starts its hit here, so a redraw
// of the band never restarts the instance and nothing flickers.

export type ScoreProps = {
  chips: string
  mult: string
  chipsKick: number
  multKick: number
  chipsHeat: number
  multHeat: number
}

type ScoreState = { t: number; chips: Pop; mult: Pop }

const SETTLED = -1e9
const PIXEL_ROW = `${100 / H}%`

type Run = { width: number; color?: string }

// One row of pixels as runs of one colour (none where nothing is drawn).
const rowRuns = (px: Int32Array, y: number): Run[] => {
  const runs: Run[] = []

  for (let x = 0; x < COLUMNS; x++) {
    const c = px[y * COLUMNS + x]!
    const color = c >= 0 ? hex(c) : undefined
    const last = runs[runs.length - 1]
    if (last && last.color === color) {
      last.width += 1
    } else {
      runs.push({ width: 1, color })
    }
  }

  return runs
}

const Score: ClientModule<ScoreProps, ScoreState> = (props, surface) => {
  const { Box } = surface.elements

  if (surface.state === undefined) {
    surface.setState({
      t: 0,
      chips: { text: props.chips, at: SETTLED, kick: 0, seed: 1 },
      mult: { text: props.mult, at: SETTLED, kick: 0, seed: 2 }
    })
    surface.every(FRAME_MS, () => {
      const state = surface.state
      if (state) {
        surface.setState({ ...state, t: state.t + FRAME_MS })
      }
    })

    return <Box height={ROWS} width={COLUMNS} />
  }

  // A number that changed lands as a hit, timed on this instance's own clock.
  let state = surface.state
  if (props.chips !== state.chips.text || props.mult !== state.mult.text) {
    state = {
      ...state,
      chips: props.chips === state.chips.text ? state.chips : { text: props.chips, at: state.t, kick: props.chipsKick, seed: state.t % 997 },
      mult: props.mult === state.mult.text ? state.mult : { text: props.mult, at: state.t, kick: props.multKick, seed: (state.t % 991) + 0.5 }
    }
    surface.setState(state)
  }

  const px = paintScene({ chips: state.chips, mult: state.mult, chipsHeat: props.chipsHeat, multHeat: props.multHeat }, state.t)

  // Boxes, not text: a box sits on the cell grid exactly, where a block
  // character leaves gaps and drifts with the font. Each pixel row is half a
  // cell row tall.
  return (
    <Box flexDirection="column" width={COLUMNS} height={ROWS}>
      {Array.from({ length: H }, (_, y) => (
        <Box flexDirection="row" width={COLUMNS} height={PIXEL_ROW}>
          {rowRuns(px, y).map(run => (
            <Box width={run.width} height="100%" backgroundColor={run.color} />
          ))}
        </Box>
      ))}
    </Box>
  )
}

export default Score
