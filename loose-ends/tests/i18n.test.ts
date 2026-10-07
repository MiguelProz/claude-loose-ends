import { describe, expect, test } from 'claude-code/testing'
import { LANGUAGES, categoryWord, fill, pickLanguage, priorityWord, t, tn } from '../lib/i18n.mjs'
import { en } from '../lib/locales/en.mjs'
import { es } from '../lib/locales/es.mjs'

describe('pickLanguage', () => {
  test('an explicit option wins over the environment', () => {
    expect(pickLanguage('es', { LANG: 'en_US.UTF-8' })).toBe('es')
    expect(pickLanguage('en', { LC_ALL: 'es_ES.UTF-8' })).toBe('en')
  })
  test('auto: the first of LC_ALL, LC_MESSAGES and LANG with a value decides', () => {
    expect(pickLanguage('auto', { LC_ALL: 'es_ES.UTF-8', LANG: 'en_US.UTF-8' })).toBe('es')
    expect(pickLanguage('auto', { LC_ALL: 'en_GB.UTF-8', LANG: 'es_ES.UTF-8' })).toBe('en')
    expect(pickLanguage('auto', { LC_ALL: '', LC_MESSAGES: 'es_MX.UTF-8', LANG: 'en_US.UTF-8' })).toBe('es')
    expect(pickLanguage('auto', { LC_ALL: '  ', LANG: 'es' })).toBe('es')
    expect(pickLanguage('auto', { LANG: 'ES_es' })).toBe('es')
    expect(pickLanguage('auto', { LANG: 'C.UTF-8' })).toBe('en')
  })
  test('auto with nothing set is English; an unknown option counts as auto', () => {
    expect(pickLanguage('auto', {})).toBe('en')
    expect(pickLanguage(undefined, { LANG: undefined })).toBe('en')
    expect(pickLanguage('fr', { LANG: 'es_ES.UTF-8' })).toBe('es')
    expect(LANGUAGES).toEqual(['es', 'en'])
  })
})

describe('locales', () => {
  test('es and en have exactly the same keys, and no value is empty', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort())
    for (const table of [es, en]) {
      for (const [key, value] of Object.entries(table)) {
        expect(typeof value === 'string' && value.trim().length > 0 ? key : `${key} is empty`).toBe(key)
      }
    }
  })
})

describe('t and tn', () => {
  test('fill puts in the named params once and leaves unknown names alone', () => {
    expect(fill('{n} de {total} y {otro}', { n: 2, total: '5' })).toBe('2 de 5 y {otro}')
    expect(fill('{a}', { a: '{b}', b: 'x' })).toBe('{b}')
    expect(fill('{"new":[]}', {})).toBe('{"new":[]}')
  })
  test('a key in each language; an unknown language falls back to English, an unknown key to itself', () => {
    expect(t('es', 'priority.high')).toBe('urgente')
    expect(t('en', 'priority.high')).toBe('urgent')
    expect(t('fr', 'priority.low')).toBe('low')
    expect(t('es', 'no.such.key')).toBe('no.such.key')
  })
  test('plurals: one only for 1', () => {
    expect(tn('es', 'band.open', 1)).toBe('1 abierto')
    expect(tn('es', 'band.open', 3)).toBe('3 abiertos')
    expect(tn('es', 'band.open', 0)).toBe('0 abiertos')
    expect(tn('en', 'band.open', 1)).toBe('1 open')
    expect(tn('en', 'band.open', 2)).toBe('2 open')
  })
  test('category and priority words in each language', () => {
    expect(['bug', 'deuda', 'test', 'aviso', 'mejora'].map(c => categoryWord('es', c))).toEqual(['bug', 'deuda', 'test', 'aviso', 'mejora'])
    expect(['bug', 'deuda', 'test', 'aviso', 'mejora'].map(c => categoryWord('en', c))).toEqual(['bug', 'debt', 'test', 'warning', 'improvement'])
    expect(categoryWord('en', 'tarea')).toBe('tarea')
    expect(categoryWord('en', undefined)).toBe('')
    expect(['high', 'medium', 'low'].map(p => priorityWord('es', p))).toEqual(['urgente', 'normal', 'baja'])
    expect(['high', 'medium', 'low'].map(p => priorityWord('en', p))).toEqual(['urgent', 'normal', 'low'])
    expect(priorityWord('es', 'weird')).toBe('normal')
    expect(priorityWord('en', undefined)).toBe('normal')
  })
})
