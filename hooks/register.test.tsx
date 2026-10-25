import { expect, test } from 'claude-code/testing'

// The test runner has timers; the mod's type surface does not declare them.
declare function setTimeout(fn: () => void, ms: number): unknown

const SPINNER = {
  plugin: 'balatro-flame',
  component: 'Spinner',
  requestId: 'main',
  props: { word: 'Catapulting', message: null, suffix: '…', mode: 'thinking' },
} as const

test('the terminal spinner draws the score raster above the engine line', async ($, on) => {
  let now = 1000
  let frames = 0
  on('clock.now', () => ({ value: (now += 50) }))
  // Each period dispatch lets the mod paint one frame and blit it.
  on('clock.every', () => ({ value: undefined }))
  on('ui.blit', (_, e) => {
    frames += 1
    expect(e.requestId).toBe('main')

    return { value: {} }
  })

  // This hook stands for the engine's own spinner line.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>Catapulting… (8s · ↓ 602 tokens)</Text>
  })

  const ui = await $.ui.mount({ ...SPINNER, surface: 'terminal' })

  const score = await ui.find({ type: 'Raster' })
  expect(score).toBeTruthy()

  const line = await ui.find({ type: 'Text', text: /602 tokens/ })
  expect(line?.text).toBe('Catapulting… (8s · ↓ 602 tokens)')

  await new Promise<void>(resolve => setTimeout(resolve, 300))
  expect(frames).toBeGreaterThan(0)
  await ui.unmount()
})

test('other surfaces keep the engine spinner alone', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({ ...SPINNER, surface: 'desktop' })

  expect(await ui.find({ type: 'Raster' })).toBeFalsy()
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})
