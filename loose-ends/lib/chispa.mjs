const C = 4
const W = 24
const H = 20
const INK = '#2B2B2B'
const PAL = { body: '#D97757', arm: '#B85F43', green: '#4ADE80', key: '#4B5058', blue: '#8AA4FF', amber: '#F5C542', card: '#FDCBB2', cardInk: '#6B2E14' }
const CONFETTI = ['#E5484D', '#F5C542', '#4ADE80', '#60A5FA', '#D97757']

// In order of priority; lib/mood.mjs picks one.
export const MOODS = ['note', 'worried', 'celebrate', 'working', 'idle', 'sleeping']

export const MOOD_LABELS = {
  note: 'Chispa con una nota: hay cabos por revisar',
  worried: 'Chispa preocupada por un cabo urgente',
  celebrate: 'Chispa celebrando un cierre',
  working: 'Chispa trabajando',
  idle: 'Chispa atenta',
  sleeping: 'Chispa durmiendo',
}

export const TERMINAL_FACES = {
  note: '(•ᴗ•)✎',
  worried: '(•_•)!',
  celebrate: '\\(•ᴗ•)/',
  working: '(•̀ᴗ•́)⌨',
  idle: '(•ᴗ•)',
  sleeping: '(-_-)zᶻ',
}

const cells = (...v) => v.map(n => n * C).join(';')
const anim = (attr, values, dur, begin = 0) => `<animate attributeName="${attr}" values="${values}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>`
const shift = (values, dur) => `<animateTransform attributeName="transform" type="translate" values="${values}" dur="${dur}s" repeatCount="indefinite"/>`
const BLINK = `<animate attributeName="height" values="${cells(2, 2, 0.5, 2)}" keyTimes="0;0.92;0.96;1" dur="3.2s" repeatCount="indefinite"/>`

function px(x, y, w, h, fill, inner = '') {
  const a = `x="${x * C}" y="${y * C}" width="${w * C}" height="${h * C}" fill="${fill}"`
  return inner ? `<rect ${a}>${inner}</rect>` : `<rect ${a}/>`
}

function body() {
  return [px(6, 7, 12, 8, PAL.body), px(5, 8, 1, 5, PAL.body), px(18, 8, 1, 5, PAL.body), ...[7, 10, 13, 16].map(x => px(x, 15, 1, 2, PAL.body))].join('')
}

function motion(mood) {
  if (mood === 'idle') return shift(`0 0;0 ${-C};0 0`, 2)
  if (mood === 'sleeping') return shift(`0 0;0 ${C / 2};0 0`, 2.4)
  if (mood === 'celebrate') return shift(`0 0;0 ${-3 * C};0 0`, 0.5)
  return ''
}

function eyes(mood) {
  if (mood === 'sleeping') return px(9, 10, 2, 1, INK) + px(14, 10, 2, 1, INK)
  return px(9, 9, 1, 2, INK, BLINK) + px(14, 9, 1, 2, INK, BLINK)
}

function mouth(mood) {
  if (mood === 'celebrate') return px(10, 13, 4, 1, INK) + px(9, 12, 1, 1, INK) + px(14, 12, 1, 1, INK)
  if (mood === 'worried') return px(11, 13, 2, 1, INK)
  return ''
}

function arms(mood) {
  return [4, 19]
    .map((x, k) => {
      if (mood === 'working') return px(x, 10, 1, 2, PAL.arm, anim('y', cells(10, 11, 10), 0.2, k * 0.1))
      if (mood === 'note') return px(x, 4, 1, 4, PAL.arm)
      if (mood === 'celebrate') return px(x, 6, 1, 2, PAL.arm)
      return px(x, 10, 1, 2, PAL.arm)
    })
    .join('')
}

function extras(mood) {
  if (mood === 'working') {
    const bits = [0, 1, 2, 3].map(k => px(3 + k * 5, 14, 1, 1, PAL.green, anim('y', cells(14, 2), 1.2, k * 0.3) + anim('opacity', '1;0', 1.2, k * 0.3)))
    return px(5, 15, 14, 2, PAL.key) + px(6, 15, 1, 1, PAL.green, anim('x', cells(6, 17), 1)) + bits.join('')
  }
  if (mood === 'note') {
    const line = px(8, 1, 6, 1, PAL.cardInk, anim('width', cells(6, 4, 6), 2.4))
    return px(7, 0, 10, 4, PAL.card) + line + px(8, 2, 4, 1, PAL.cardInk) + px(5, 3, 2, 1, PAL.arm) + px(17, 3, 2, 1, PAL.arm)
  }
  if (mood === 'sleeping') {
    return [0, 1, 2]
      .map(k => `<text x="${(17 + k * 1.5) * C}" y="${9 * C}" font-family="monospace" font-weight="bold" font-size="13" fill="${PAL.blue}">z${anim('y', cells(9, 1), 2.4, k * 0.8)}${anim('opacity', '1;0', 2.4, k * 0.8)}</text>`)
      .join('')
  }
  if (mood === 'celebrate') {
    return Array.from({ length: 12 }, (_, k) => px((k * 7 + 3) % W, 0, 1, 1, CONFETTI[k % 5], anim('y', cells(-1, H), 1.2 + (k % 3) * 0.3, k * 0.1))).join('')
  }
  if (mood === 'worried') return px(20, 1, 1, 3, PAL.amber, anim('opacity', '1;0.2;1', 0.6)) + px(20, 5, 1, 1, PAL.amber)
  return ''
}

export function chispaSvg(mood) {
  const m = MOODS.includes(mood) ? mood : 'idle'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W * C} ${H * C}" width="${W * C}" height="${H * C}" shape-rendering="crispEdges" style="color-scheme:light dark;background:transparent"><g>${motion(m)}${body()}${arms(m)}${eyes(m)}${mouth(m)}</g>${extras(m)}</svg>`
}
