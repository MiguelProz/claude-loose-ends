import { describe, expect, test } from 'claude-code/testing'
import { BANNED_STARTS, rejectReason, similarity, startsBanned, words } from '../lib/filter.mjs'

const T0 = '2026-10-04T10:00:00.000Z'
const it = (id: string, text: string, over = {}) => ({ id, text, status: 'open', priority: 'medium', createdAt: T0, ...over })
const cand = (over = {}) => ({ text: 'Corregir el envío duplicado de correo', category: 'bug', ...over })

describe('words and banned openings', () => {
  test('words drops case, accents and punctuation', () => {
    expect(words('¡Comprobár el CI, ya!')).toEqual(['comprobar', 'el', 'ci', 'ya'])
  })
  test('every banned opening is caught, also after «hay que»', () => {
    for (const start of BANNED_STARTS) expect(startsBanned(`${start[0].toUpperCase()}${start.slice(1)} lo del despliegue`)).toBe(true)
    expect(startsBanned('Hay que verificar en producción la clave')).toBe(true)
    expect(startsBanned('hay que hacer push a main')).toBe(true)
    expect(startsBanned('Ejecutar npm run holidays:sync en producción')).toBe(true)
    expect(startsBanned('Enviar la plantilla a Meta')).toBe(true)
    expect(startsBanned('Probar en el navegador el panel')).toBe(true)
  })
  test('the same words later in the sentence, or other forms, are not caught', () => {
    expect(startsBanned('Corregir la verificación de la firma')).toBe(false)
    expect(startsBanned('Revisión pendiente del parser')).toBe(false)
    expect(startsBanned('Hacer pushes atómicos en la cola')).toBe(false)
    expect(startsBanned('Subir la cobertura del parser')).toBe(false)
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
    expect(rejectReason(cand({ category: undefined }), [])).toContain('sin categoría')
    expect(rejectReason(cand({ category: 'tarea' }), [])).toContain('sin categoría')
  })
  test('a banned opening', () => {
    expect(rejectReason(cand({ text: 'Esperar a que termine el CI' }), [])).toContain('no es trabajo sobre el código')
  })
  test('the same text as a candidate, open or doing item', () => {
    for (const status of ['candidate', 'open', 'doing']) expect(rejectReason(cand(), [it('a', 'corregir el ENVÍO duplicado de correo', { status })])).toBe('ya está apuntado')
    expect(rejectReason(cand(), [it('a', 'Corregir el envío duplicado de correo', { status: 'done' })])).toBe(null)
  })
  test('the same quote as a live item', () => {
    expect(rejectReason(cand({ evidence: 'lo dejo para otro día' }), [it('a', 'Otra cosa distinta', { evidence: 'Lo dejo para otro día.' })])).toBe('repite la cita de otro cabo')
  })
  test('the same file and a similar text', () => {
    const items = [it('a', 'Corregir el envío duplicado del correo', { file: 'lib/facturas.ts' })]
    expect(rejectReason(cand({ file: 'lib/facturas.ts' }), items)).toBe('se parece a otro cabo del mismo fichero')
    expect(rejectReason(cand({ file: 'lib/otro.ts' }), items)).toBe(null)
  })
  test('similar to one of the last 50 rejected', () => {
    const rejected = [it('r', 'Corregir el envío duplicado del correo', { status: 'rejected', closedAt: T0 })]
    expect(rejectReason(cand(), rejected)).toBe('se parece a uno que rechazaste')
    const old = Array.from({ length: 50 }, (_, k) => it(`n${k}`, `Rechazo distinto número ${k}`, { status: 'rejected', closedAt: '2026-10-04T12:00:00.000Z' }))
    expect(rejectReason(cand(), [...rejected, ...old])).toBe(null)
  })
})
