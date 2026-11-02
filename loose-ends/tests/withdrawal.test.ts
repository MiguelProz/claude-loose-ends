import { describe, expect, test } from 'claude-code/testing'
import { parseSweepReply } from '../lib/detect.mjs'

// Real items and quotes from a repo where the sweep withdrew all 106 candidates, so the person never saw one.
const reply = (...resolved: { id: string; quote: string }[]) => JSON.stringify({ new: [], resolved })
const item = (id: string, text: string, over = {}) => ({ id, text, status: 'candidate', ...over })
const closes = (items: any[], answer: string, resolved: { id: string; quote: string }[], opts = {}) =>
  parseSweepReply(reply(...resolved), items, [], answer, { allowNew: false, ...opts })?.resolved.map(r => r.id)

const STOP = item('f40413da', "Stop non-speech audio (a tone, music, TV) from firing a fast stop: add non-speech clips to the voice bench negatives, and gate stop matches on faster-whisper's no_speech_prob/avg_logprob.", { file: 'services/core/src/pacho_core/voice/session.py' })
const FIRST_PERSON = item('39b9ce78', 'Have the reply after see speak in the first person («Veo…», not «Ve un robot…»), with a JSON-mode see example in the prompt, checked with an llm-bench run on the VPS.')
const STILL = item('b3f73a1d', "Take the simulator's camera still (toggle off) from the duck's head, not the viewer's orbit camera, so Pacho stops describing himself.", { file: 'apps/web/src/lib/camera/still.ts' })

describe('a quote must show that specific item done', () => {
  test('saying it was logged never counts', () => {
    for (const quote of [
      'I logged it as a loose end, so you can save it from the card',
      'I added it as a loose end, fixed nothing yet',
      'Apuntado como cabo suelto: llevar la conexión del robot al worker.',
      'Los dos primeros los he dejado apuntados como pendientes',
    ]) {
      expect(closes([STOP], `Fast stop on noise. ${quote}`, [{ id: STOP.id, quote }])).toEqual([])
    }
  })

  test('a sentence about another bug proves nothing, even when it says fixed', () => {
    const quote = 'Arreglado y comprobado en producción: a «¿Qué ves?» Pacho ahora hace la foto y la describe.'
    expect(closes([FIRST_PERSON], quote, [{ id: FIRST_PERSON.id, quote }])).toEqual([])
    expect(closes([STILL], quote, [{ id: STILL.id, quote }])).toEqual([])
  })

  test('one quote cannot close two items', () => {
    const quote = 'Arreglado: el modelo responde en primera persona y la foto sale de la cámara de la cabeza.'
    const a = item('a', 'Responder en primera persona con el modelo')
    const b = item('b', 'Sacar la foto de la cámara de la cabeza')
    expect(closes([a, b], quote, [{ id: 'a', quote }, { id: 'b', quote }])).toEqual([])
    expect(closes([a], quote, [{ id: 'a', quote }])).toEqual(['a'])
  })

  test('a sentence naming the item without saying it is done does not close it', () => {
    const moves = item('8f80d0a2', 'Investigar y corregir que gemma4 se mueve sin que se lo pidan (3 de 11 casos)')
    const stillMoves = 'gemma4 aún se mueve sin que se lo pidan en 3 de 11 casos, por ejemplo al preguntarle cómo está.'
    expect(closes([moves], stillMoves, [{ id: moves.id, quote: stillMoves }])).toEqual([])
    const latency = item('886b7186', 'Simulator latency reads ~460 ms in production because core acks only once per heartbeat')
    const later = 'Lo arreglo al empezar M2b: core acks each heartbeat in production'
    expect(closes([latency], later, [{ id: latency.id, quote: later }])).toEqual([])
    const notFixed = 'The simulator latency in production is not fixed yet'
    expect(closes([latency], notFixed, [{ id: latency.id, quote: notFixed }])).toEqual([])
  })

  test('a done sentence on the same subject closes it, whatever the language of the item', () => {
    const trail = item('535d6ddf', 'Pintar el rastro del recorrido con el color del tema en lugar de líneas negras')
    const painted = 'Corregido: el rastro se pinta con el color del tema.'
    expect(closes([trail], painted, [{ id: trail.id, quote: painted }])).toEqual([trail.id])
    const guard = item('f78ebc4d', 'Add a guard to bootstrap.sql that aborts when PACHO_WEB_DB_PASSWORD is empty', { file: 'deploy/bootstrap.sql' })
    const added = 'Añadida la protección contra contraseñas vacías en bootstrap.sql.'
    expect(closes([guard], added, [{ id: guard.id, quote: added }])).toEqual([guard.id])
  })

  test('a true closure with no done word stays as a candidate: one click for the person, where accepting these lets «se verá» through', () => {
    const trail = item('535d6ddf', 'Pintar el rastro del recorrido con el color del tema en lugar de líneas negras')
    const described = 'El rastro se pinta con el color del tema, semitransparente y más grueso'
    expect(closes([trail], described, [{ id: trail.id, quote: described }])).toEqual([])
  })

  test('a short «Corregido.» after the sentence counts as said of it', () => {
    const trail = item('t', 'Pintar el rastro del recorrido con el color del tema')
    const quote = 'El rastro se pinta con el color del tema.'
    expect(closes([trail], `${quote} Corregido.`, [{ id: 't', quote }])).toEqual(['t'])
  })

  test('the subject of a commit proves its own subject, and a merge proves nothing', () => {
    const photo = item('c1', 'Comprimir la foto 3 al subirla')
    const log = 'a3f9c21 perf: comprimir la foto 3 al subirla\nb2 Merge pull request #7 from MiguelProz/feat/comprimir-foto'
    expect(closes([photo], 'corto', [{ id: 'c1', quote: 'perf: comprimir la foto 3 al subirla' }], { log })).toEqual(['c1'])
    expect(closes([photo], 'corto', [{ id: 'c1', quote: 'Merge pull request #7 from MiguelProz/feat/comprimir-foto' }], { log })).toEqual([])
  })

  test('an item in progress needs a done sentence but not the same words: the turn was about it', () => {
    const doing = { ...STOP, status: 'doing' }
    const done = 'Arreglado: el ruido ya no dispara la parada rápida.'
    expect(closes([doing], done, [{ id: doing.id, quote: done }])).toEqual([doing.id])
    const logged = 'I logged it as a loose end, so you can save it from the card'
    expect(closes([doing], logged, [{ id: doing.id, quote: logged }])).toEqual([])
  })

  test('what is refused goes to the debug log with its reason', () => {
    const quote = 'I logged it as a loose end, so you can save it from the card'
    const parsed = parseSweepReply(reply({ id: STOP.id, quote }), [STOP], [], quote, { allowNew: false })
    expect(parsed?.skipped).toEqual([{ text: STOP.text, reason: 'not a closure: the sentence says it was noted' }])
  })
})
