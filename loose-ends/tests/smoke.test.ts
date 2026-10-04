import { expect, test } from 'claude-code/testing'
import { world } from './world.ts'

test('/pendientes is registered and opens the pane', async ($, on) => {
  const w = world(on)
  let opened = ''
  on('ui.open', ($: any, e: any) => { opened = e.id; return { value: { isPlaced: true } } })
  await w.start($)
  const registered = w.commands.find(c => c.name === 'pendientes')
  expect(registered).toMatchObject({ immediate: true })
  expect(String(registered.description).trim().length).toBeGreaterThan(0)
  await $.command.run({ command: 'pendientes', args: '' })
  expect(opened).toBe('loose-ends')
})
