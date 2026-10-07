import { describe, expect, test } from 'claude-code/testing'
import { idlePhrase, localClock, renderBand } from '../lib/screens.mjs'
import { ROOT, world } from './world.ts'

const fake = new Proxy({}, { get: (_, type) => (props: any) => ({ type, props }) }) as any
const flat = (node: any): any[] => [node, ...([] as any[]).concat(node?.props?.children ?? []).flatMap(c => (typeof c === 'object' ? flat(c) : []))]
const texts = (node: any) => flat(node).filter(n => n?.type === 'Text').map(n => String(n.props.children))
const counts = (over = {}) => ({ candidates: 0, live: 0, high: 0, medium: 0, low: 0, ...over })
// day 20730 is 2026-10-04 (even: the first variant); 20731 the next day
const band = (over = {}) => ({ lang: 'es', mood: 'idle', counts: counts(), urgent: null, next: null, justClosed: null, recap: null, fileError: null, sync: null, working: false, closedWeek: 0, hour: 10, day: 20730, ...over })
const acts = { openPane: () => {}, undoClose: () => {}, doNow: () => {} }
const ODD = { day: 20731 }

describe('idlePhrase', () => {
  test('Claude working first, then Chispa asleep, then the week, then the time of day', () => {
    expect(idlePhrase(band({ working: true, mood: 'working', closedWeek: 3 }))).toBe('Aquí vigilo por si queda algo suelto')
    expect(idlePhrase(band({ mood: 'sleeping', closedWeek: 3 }))).toBe('Todo en orden, me echo una siesta')
    expect(idlePhrase(band({ closedWeek: 3 }))).toBe('Semana limpia: 3 cerrados')
    expect(idlePhrase(band({ closedWeek: 1 }))).toBe('Semana limpia: 1 cerrado')
    expect(idlePhrase(band())).toBe('Buenos días. Nada pendiente por aquí')
  })
  test('the variant follows the day, so it changes once a day and not on each redraw', () => {
    expect(idlePhrase(band({ working: true, ...ODD }))).toBe('De guardia mientras Claude trabaja')
    expect(idlePhrase(band({ mood: 'sleeping', ...ODD }))).toBe('Nada suelto, echo una cabezada')
    expect(idlePhrase(band({ closedWeek: 4, ...ODD }))).toBe('Nada suelto. 4 cerrados esta semana')
    expect(idlePhrase(band({ closedWeek: 1, ...ODD }))).toBe('Nada suelto. 1 cerrado esta semana')
    expect(idlePhrase(band({ hour: 8, ...ODD }))).toBe('Buenos días, todo despejado')
    expect(idlePhrase(band({ hour: 16, ...ODD }))).toBe('Tarde despejada, sin cabos')
    expect(idlePhrase(band({ hour: 23, ...ODD }))).toBe('Todo despejado. Descansa')
    expect(idlePhrase(band({ hour: 8 }))).toBe(idlePhrase(band({ hour: 13 })))
  })
  test('morning from 6 to 14, afternoon from 14 to 21, night from 21 to 6', () => {
    const at = (hour: number) => idlePhrase(band({ hour }))
    expect([6, 13].map(at)).toEqual(['Buenos días. Nada pendiente por aquí', 'Buenos días. Nada pendiente por aquí'])
    expect([14, 20].map(at)).toEqual(['Nada suelto. Buen ritmo', 'Nada suelto. Buen ritmo'])
    expect([21, 0, 5].map(at)).toEqual(['Nada pendiente. Buena hora para cerrar el portátil', 'Nada pendiente. Buena hora para cerrar el portátil', 'Nada pendiente. Buena hora para cerrar el portátil'])
  })
  test('in English', () => {
    const en = (over = {}) => idlePhrase(band({ lang: 'en', ...over }))
    expect(en({ working: true })).toBe('Watching in case anything is left loose')
    expect(en({ working: true, ...ODD })).toBe('On watch while Claude works')
    expect(en({ mood: 'sleeping' })).toBe('All tidy, taking a nap')
    expect(en({ mood: 'sleeping', ...ODD })).toBe('Nothing loose, napping')
    expect(en({ closedWeek: 1 })).toBe('Clean week: 1 closed')
    expect(en({ closedWeek: 5, ...ODD })).toBe('Nothing loose. 5 closed this week')
    expect(en({ hour: 9 })).toBe('Good morning. Nothing pending here')
    expect(en({ hour: 9, ...ODD })).toBe('Morning! All clear')
    expect(en({ hour: 15 })).toBe('Nothing loose. Good pace')
    expect(en({ hour: 15, ...ODD })).toBe('A clear afternoon, no loose ends')
    expect(en({ hour: 22 })).toBe('Nothing pending. Good time to close the laptop')
    expect(en({ hour: 22, ...ODD })).toBe('All clear. Rest well')
  })
})

describe('localClock', () => {
  test('the local hour and the number of the local day', () => {
    expect(localClock(new Date(2026, 9, 7, 8, 30).getTime())).toEqual({ hour: 8, day: 20733 })
    expect(localClock(new Date(2026, 9, 7, 23, 59).getTime())).toEqual({ hour: 23, day: 20733 })
    expect(localClock(new Date(2026, 9, 8, 0, 1).getTime())).toEqual({ hour: 0, day: 20734 })
  })
})

describe('band with nothing to say', () => {
  test('desktop: the usual card, Chispa at 44×37 and the phrase in gray, nothing to press', () => {
    const root = renderBand(fake, 'desktop', band({ closedWeek: 2 }), acts)
    expect(root.props).toMatchObject({ flexDirection: 'row', alignItems: 'center', borderStyle: 'round', borderColor: 'promptBorder', backgroundColor: 'userMessageBackground', paddingX: 1 })
    expect(root.props.children[0]).toMatchObject({ type: 'Svg', props: { alt: 'Chispa atenta', width: 44, height: 37 } })
    expect(flat(root).find(n => n?.type === 'Text' && n.props.children === 'Semana limpia: 2 cerrados')?.props).toMatchObject({ dimColor: true, wrap: 'truncate-end' })
    expect(flat(root).some(n => n?.type === 'Button' || n?.type === 'Markdown')).toBe(false)
  })
  test('terminal: the face and the phrase, both dim, no button', () => {
    const root = renderBand(fake, 'terminal', band({ lang: 'en', mood: 'sleeping' }), acts)
    expect(texts(root)).toEqual(['(-_-)zᶻ', 'All tidy, taking a nap'])
    expect(flat(root).filter(n => n?.type === 'Text').every(n => n.props.dimColor === true)).toBe(true)
    expect(flat(root).some(n => n?.type === 'Button')).toBe(false)
  })
  test('the phrase shows only when nothing else does', () => {
    for (const surface of ['terminal', 'desktop'] as const) {
      expect(texts(renderBand(fake, surface, band({ counts: counts({ candidates: 1 }) }), acts))).not.toContain('Buenos días. Nada pendiente por aquí')
      expect(texts(renderBand(fake, surface, band({ justClosed: { text: 'Hecho' } }), acts))).not.toContain('Buenos días. Nada pendiente por aquí')
      expect(texts(renderBand(fake, surface, band({ fileError: 'json' }), acts))).not.toContain('Buenos días. Nada pendiente por aquí')
    }
  })
})

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as any }
const blob = (...items: any[]) => JSON.stringify({ version: 2, items })
const closed = { id: 'd1', text: 'Closed a while ago', category: 'bug', priority: 'medium', status: 'done', branch: 'main', createdAt: '2026-10-03T09:00:00.000Z', closedAt: '2026-10-04T08:00:00.000Z' }
const turns = (on: any) => {
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
}
const mount = ($: any, surface: 'terminal' | 'desktop') => $.ui.mount({ plugin: 'loose-ends', surface, ...BAND })

// The world's clock is 2026-10-04T10:00Z; the variant depends on the local day, so both variants are accepted.
test('nothing open after a close this week: the phrase of the week, on both surfaces', { options: { language: 'es' } }, async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(closed) } })
  await w.start($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mount($, surface)
    expect(await ui.find({ type: 'Text', text: /^(Semana limpia: 1 cerrado|Nada suelto\. 1 cerrado esta semana)$/ })).toBeDefined()
    expect(await ui.find({ key: 'band-act' })).toBeUndefined()
    expect(await ui.find({ key: 'open-pane' })).toBeUndefined()
    await ui.unmount()
  }
})

test('in English, and while Claude works the phrase says she is on watch', { options: { language: 'en' } }, async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(closed) } })
  turns(on)
  await w.start($)
  const term = await mount($, 'terminal')
  expect(await term.find({ type: 'Text', text: /^(Clean week: 1 closed|Nothing loose\. 1 closed this week)$/ })).toBeDefined()
  await $.turn.start({ text: 'hello', turnId: 't' })
  await term.redraw()
  expect(await term.find({ type: 'Text', text: /^(Watching in case anything is left loose|On watch while Claude works)$/ })).toBeDefined()
  await term.unmount()
})
