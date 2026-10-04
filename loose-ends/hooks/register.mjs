export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pendientes', description: 'Abre el cuaderno: plan, cabos sueltos y hecho', immediate: true })
    return next(e)
  })

  on('command.run', { command: 'pendientes' }, async () => ({ text: 'loose-ends cargado' }))
}
