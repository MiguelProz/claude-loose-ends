import { expect, test } from 'claude-code/testing'

test('/pendientes is registered and answers', async ($, on) => {
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  const answer = await $.command.run({ command: 'pendientes', args: '' })
  expect(answer.text).toBe('loose-ends cargado')
})
