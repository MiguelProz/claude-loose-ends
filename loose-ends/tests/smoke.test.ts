import { expect, test } from 'claude-code/testing'
import { world } from './world.ts'

test('/pendientes is registered and answers', async ($, on) => {
  const w = world(on)
  await w.start($)
  const answer = await $.command.run({ command: 'pendientes', args: '' })
  expect(answer.text).toBe('loose-ends cargado')
})
