import { describe, expect, test } from 'claude-code/testing'
import { BANNED_STARTS, rejectReason, rejectText, similarity, startsBanned, words } from '../lib/filter.mjs'

const T0 = '2026-10-04T10:00:00.000Z'
const it = (id: string, text: string, over = {}) => ({ id, text, status: 'open', priority: 'medium', createdAt: T0, ...over })
const cand = (over = {}) => ({ text: 'Corregir el envío duplicado de correo', category: 'bug', ...over })

describe('words and banned openings', () => {
  test('words drops case, accents and punctuation', () => {
    expect(words('¡Comprobár el CI, ya!')).toEqual(['comprobar', 'el', 'ci', 'ya'])
  })
  test('every Spanish banned opening is caught, also after «hay que»', () => {
    for (const start of BANNED_STARTS.es) expect(startsBanned(`${start[0].toUpperCase()}${start.slice(1)} lo del despliegue`)).toBe(true)
    expect(startsBanned('Hay que verificar en producción la clave')).toBe(true)
    expect(startsBanned('hay que hacer push a main')).toBe(true)
    expect(startsBanned('Ejecutar npm run holidays:sync en producción')).toBe(true)
    expect(startsBanned('Enviar la plantilla a Meta')).toBe(true)
    expect(startsBanned('Probar en el navegador el panel')).toBe(true)
    expect(startsBanned('Fusionar y subir a main los commits de la rama')).toBe(true)
  })
  test('every English banned opening is caught, also after need to, should or must', () => {
    expect(BANNED_STARTS.en).toEqual(['verify', 'confirm', 'wait', 'decide', 'inform', 'notify', 'ask', 'tell', 'push to', 'push origin', 'push the branch', 'push changes', 'merge the branch', 'merge and push', 'merge into main', 'merge to main', 'deploy to', 'deploy the', 'check that', 'check whether', 'check if', 'run the tests', 'run the test suite', 'run ci', 'run the ci', 'test manually', 'test in production', 'test on staging', 'review the pr', 'review the pull request', 'report back', 'report to', 'watch the ci', 'watch the deploy', 'monitor the ci', 'monitor the deploy', 'monitor the deployment'])
    for (const start of BANNED_STARTS.en) expect(startsBanned(`${start[0].toUpperCase()}${start.slice(1)} the deploy thing`)).toBe(true)
    expect(startsBanned('We need to check that the logs are on staging')).toBe(true)
    expect(startsBanned('Need to verify the migration')).toBe(true)
    expect(startsBanned('We have to wait for CI')).toBe(true)
    expect(startsBanned('Should deploy the worker again')).toBe(true)
    expect(startsBanned('Must notify the team about the API change')).toBe(true)
    for (const text of ['Verify the fix in production', 'Wait for CI', 'Push to origin after review', 'Deploy to staging', 'Check that the build passes', 'Run the tests again', 'Test manually in the browser', 'Review the PR before merging', 'Report back to the user', 'Need to check whether the token expires', 'Ask the user which option']) expect(startsBanned(text)).toBe(true)
  })
  test('the same words later in the sentence, or other forms, are not caught', () => {
    expect(startsBanned('Corregir la verificación de la firma')).toBe(false)
    expect(startsBanned('Revisión pendiente del parser')).toBe(false)
    expect(startsBanned('Hacer pushes atómicos en la cola')).toBe(false)
    expect(startsBanned('Subir la cobertura del parser')).toBe(false)
    expect(startsBanned('Fusionar las dos funciones de fechas')).toBe(false)
    expect(startsBanned('Fix the verification of the signature')).toBe(false)
    expect(startsBanned('Reviewer avatars are missing in the list')).toBe(false)
    expect(startsBanned('Testing helpers duplicate the setup')).toBe(false)
    expect(startsBanned('Merge the two date helpers')).toBe(false)
    expect(startsBanned('Add a test for the parser')).toBe(false)
    for (const text of ['Test the parser with empty input', 'Check for null before dereferencing user', 'Try/catch swallows errors', 'Report errors from the worker to the UI', 'Send retries with backoff', 'Push state down into the child component', 'Watch the file for changes instead of polling', 'Monitor memory use in the cache', 'Launch the worker lazily', 'Deploy script lacks a rollback', 'Run the migration script only once', 'Review the error handling in sync.mjs']) expect(startsBanned(text)).toBe(false)
    expect(startsBanned('')).toBe(false)
  })
})

describe('similarity', () => {
  test('Jaccard of the word sets', () => {
    expect(similarity('a b c', 'a b c')).toBe(1)
    expect(similarity('a b c', 'a b d')).toBe(0.5)
    expect(similarity('A b, C', 'c b a')).toBe(1)
    expect(similarity('', 'x')).toBe(0)
  })
})

describe('rejectReason', () => {
  test('a clean candidate passes', () => {
    expect(rejectReason(cand(), [])).toBe(null)
  })
  test('no category, or an unknown one', () => {
    expect(rejectReason(cand({ category: undefined }), [])).toBe('noCategory')
    expect(rejectReason(cand({ category: 'tarea' }), [])).toBe('noCategory')
  })
  test('a banned opening, in either language whatever the mod speaks', () => {
    expect(rejectReason(cand({ text: 'Esperar a que termine el CI' }), [])).toBe('notCode')
    expect(rejectReason(cand({ text: 'Wait for CI to finish' }), [])).toBe('notCode')
  })
  test('the same text as a candidate, open or doing item', () => {
    for (const status of ['candidate', 'open', 'doing']) expect(rejectReason(cand(), [it('a', 'corregir el ENVÍO duplicado de correo', { status })])).toBe('duplicate')
    expect(rejectReason(cand(), [it('a', 'Corregir el envío duplicado de correo', { status: 'done' })])).toBe(null)
  })
  test('the same quote as a live item', () => {
    expect(rejectReason(cand({ evidence: 'lo dejo para otro día' }), [it('a', 'Otra cosa distinta', { evidence: 'Lo dejo para otro día.' })])).toBe('sameQuote')
  })
  test('the same file and a similar text', () => {
    const items = [it('a', 'Corregir el envío duplicado del correo', { file: 'lib/facturas.ts' })]
    expect(rejectReason(cand({ file: 'lib/facturas.ts' }), items)).toBe('sameFile')
    expect(rejectReason(cand({ file: 'lib/otro.ts' }), items)).toBe(null)
  })
  test('a sweep candidate similar to anything in the queue, whatever the file', () => {
    const items = [it('a', 'Corregir el envío duplicado del correo de facturas', { status: 'candidate', source: 'tool' })]
    expect(rejectReason(cand({ source: 'sweep' }), items)).toBe('similar')
    expect(rejectReason(cand({ source: 'tool' }), items)).toBe(null)
  })
  test('similar to one of the last 50 rejected', () => {
    const rejected = [it('r', 'Corregir el envío duplicado del correo', { status: 'rejected', closedAt: T0 })]
    expect(rejectReason(cand(), rejected)).toBe('likeRejected')
    const old = Array.from({ length: 50 }, (_, k) => it(`n${k}`, `Rechazo distinto número ${k}`, { status: 'rejected', closedAt: '2026-10-04T12:00:00.000Z' }))
    expect(rejectReason(cand(), [...rejected, ...old])).toBe(null)
  })
})

describe('rejectText', () => {
  test('every reason in Spanish, as 0.4 said it', () => {
    expect(['noCategory', 'notCode', 'duplicate', 'sameQuote', 'sameFile', 'similar', 'likeRejected', 'tooShort'].map(code => rejectText('es', code))).toEqual([
      'sin categoría (bug, deuda, test, aviso o mejora)',
      'no es trabajo sobre el código (comprobar, esperar, decidir, avisar, hacer push o desplegar)',
      'ya está apuntado',
      'repite la cita de otro cabo',
      'se parece a otro cabo del mismo fichero',
      'se parece a otro cabo',
      'se parece a uno que rechazaste',
      'texto demasiado corto',
    ])
  })
  test('every reason in English', () => {
    expect(['noCategory', 'notCode', 'duplicate', 'sameQuote', 'sameFile', 'similar', 'likeRejected', 'tooShort'].map(code => rejectText('en', code))).toEqual([
      'no category (bug, debt, test, warning or improvement)',
      'not work on the code (checking, waiting, deciding, notifying, pushing or deploying)',
      'already noted',
      'repeats the quote of another loose end',
      'looks like another loose end in the same file',
      'looks like another loose end',
      'looks like one you rejected',
      'text too short',
    ])
  })
})
