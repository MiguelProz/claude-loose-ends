import { CATEGORIES } from './items.mjs'
import { categoryWord, t } from './i18n.mjs'

export const TOOL_NAME = 'note_loose_end'
export const TOOL_ID = 'mcp__loose-ends__note_loose_end'

export const toolDescription = lang => t(lang, 'tool.description')

// The schema names the categories in the mod's language; the tool stores them under the keys of items.mjs.
export function toolSchema(lang) {
  return {
    type: 'object',
    properties: {
      text: { type: 'string', description: t(lang, 'tool.text') },
      category: { type: 'string', enum: CATEGORIES.map(c => categoryWord(lang, c)), description: t(lang, 'tool.category') },
      priority: { type: 'string', enum: ['high', 'medium', 'low'], description: t(lang, 'tool.priority') },
      evidence: { type: 'string', description: t(lang, 'tool.evidence') },
      file: { type: 'string', description: t(lang, 'tool.file') },
      repo: { type: 'string', description: t(lang, 'tool.repo') },
    },
    required: ['text', 'category', 'priority'],
  }
}

export const toolGuide = lang => t(lang, 'tool.guide', { toolId: TOOL_ID })
export const sweepSystem = lang => t(lang, 'sweep.system')

export const toolTooShort = lang => t(lang, 'tool.tooShort')
export const noGitNote = lang => t(lang, 'tool.noGit')
export const notARepo = lang => t(lang, 'tool.notARepo')
export const toolProposed = (lang, item) => t(lang, 'tool.proposed', { id: item.id, text: item.text })
export const toolRejected = (lang, reason) => t(lang, 'tool.rejected', { reason })
export const toolUnreadable = (lang, target, error) => t(lang, 'tool.unreadable', { target, error })

export function formatContext(lang, liveItems, max = 10) {
  const top = liveItems.filter(i => i.priority !== 'low').slice(0, max)
  if (!top.length) return null
  return [t(lang, 'context.head'), ...top.map(i => `- [${i.priority}] ${i.text} (${i.id}${i.branch ? t(lang, 'context.branch', { branch: i.branch }) : ''})`)].join('\n')
}

export function doNowText(lang, item) {
  return `${t(lang, 'doNow.text', { id: item.id, text: item.text })}${item.evidence ? t(lang, 'doNow.evidence', { evidence: item.evidence }) : ''}`
}

export const suggestPrefix = lang => t(lang, 'suggest.prefix')
export const suggestText = (lang, item) => `${suggestPrefix(lang)}${item.text}`
export const passingText = (lang, items) => t(lang, 'passing.text', { list: items.map(i => `${i.text} (${i.id})`).join('; ') })
