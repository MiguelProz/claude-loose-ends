import { en } from './locales/en.mjs'
import { es } from './locales/es.mjs'

// The languages the mod speaks; every text goes through t() with one of them.
export const LANGUAGES = ['es', 'en']
const TABLES = { es, en }
const PRIORITY_NAMES = ['high', 'medium', 'low']

// The language from the `language` option: 'es' or 'en' as given; anything else is auto, where the first of
// LC_ALL, LC_MESSAGES and LANG with a value decides, then APPLE_LOCALE (the macOS system language, which desktop
// apps often get instead of those variables); Spanish when it starts with "es"; none set is English.
export function pickLanguage(option, env = {}) {
  if (option === 'es' || option === 'en') return option
  const value = [env.LC_ALL, env.LC_MESSAGES, env.LANG, env.APPLE_LOCALE].find(v => typeof v === 'string' && v.trim() !== '')
  return value && value.trim().toLowerCase().startsWith('es') ? 'es' : 'en'
}

// Puts each {name} of `text` in from `params`, in one pass: what goes in is never read again, and a name with no
// param stays as written (so JSON in a prompt is left alone).
export function fill(text, params = {}) {
  return String(text).replace(/\{(\w+)\}/g, (all, name) => (Object.hasOwn(params, name) ? String(params[name]) : all))
}

// The text of `key` in `lang`; English when that language lacks it, the key itself when no language has it.
export function t(lang, key, params = {}) {
  const table = Object.hasOwn(TABLES, lang) ? TABLES[lang] : en
  const text = Object.hasOwn(table, key) ? table[key] : Object.hasOwn(en, key) ? en[key] : key
  return fill(text, params)
}

// A text that agrees with a count: `${key}.one` for 1, `${key}.other` otherwise, with the count as {n}.
export function tn(lang, key, n, params = {}) {
  return t(lang, `${key}.${n === 1 ? 'one' : 'other'}`, { n, ...params })
}

// The word for a stored category key; a value the mod does not know is shown as it is.
export function categoryWord(lang, category) {
  if (!category) return ''
  const key = `category.${category}`
  return Object.hasOwn(en, key) ? t(lang, key) : String(category)
}

// The word for a priority; one the mod does not know reads as normal.
export function priorityWord(lang, priority) {
  return t(lang, `priority.${PRIORITY_NAMES.includes(priority) ? priority : 'medium'}`)
}
