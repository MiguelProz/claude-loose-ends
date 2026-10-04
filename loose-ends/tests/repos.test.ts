import { describe, expect, test } from 'claude-code/testing'
import { FILE_TOOLS, candidatePaths, isIgnoredRepo, candidateRepos, formatCandidates, repoName } from '../lib/repos.mjs'

describe('candidatePaths: file tools', () => {
  test('Edit, Write, MultiEdit and Read use file_path', () => {
    for (const tool of ['Edit', 'Write', 'MultiEdit', 'Read']) expect(candidatePaths(tool, { file_path: '/a/b/x.ts' })).toEqual(['/a/b/x.ts'])
  })
  test('NotebookEdit uses notebook_path', () => {
    expect(candidatePaths('NotebookEdit', { notebook_path: '/a/n.ipynb' })).toEqual(['/a/n.ipynb'])
  })
  test('Grep and Glob use path', () => {
    expect(candidatePaths('Grep', { pattern: 'x', path: '/a/src' })).toEqual(['/a/src'])
    expect(candidatePaths('Glob', { pattern: '*.ts', path: '/a' })).toEqual(['/a'])
  })
  test('missing, empty, relative or non-string paths give nothing', () => {
    expect(candidatePaths('Edit', {})).toEqual([])
    expect(candidatePaths('Read', { file_path: '' })).toEqual([])
    expect(candidatePaths('Grep', { pattern: 'x' })).toEqual([])
    expect(candidatePaths('Read', { file_path: 'src/x.ts' })).toEqual([])
    expect(candidatePaths('Read', { file_path: 42 })).toEqual([])
  })
  test('other tools give nothing', () => {
    expect(candidatePaths('WebFetch', { url: 'https://x.dev', file_path: '/a/b' })).toEqual([])
    expect(candidatePaths('mcp__x__y', { path: '/a' })).toEqual([])
  })
  test('FILE_TOOLS are the ones whose path is a file', () => {
    expect([...FILE_TOOLS].sort()).toEqual(['Edit', 'MultiEdit', 'NotebookEdit', 'Read', 'Write'])
  })
})

describe('candidatePaths: Bash', () => {
  const bash = (command: unknown) => candidatePaths('Bash', { command })
  test('cd target and a plain command', () => {
    expect(bash('cd /a/b && npm test')).toEqual(['/a/b'])
  })
  test('git -C target', () => {
    expect(bash('git -C /x/y status')).toEqual(['/x/y'])
  })
  test('absolute path tokens', () => {
    expect(bash('cat /a/b/c.txt | grep foo > out.txt && ls /z/w')).toEqual(['/a/b/c.txt', '/z/w'])
  })
  test('quoted paths, with spaces too', () => {
    expect(bash('cd "/my repo/app" && git -C \'/other repo\' log')).toEqual(['/my repo/app', '/other repo'])
    expect(bash('cat "/a/b c/d.txt"')).toEqual(['/a/b c/d.txt'])
  })
  test('cd after a separator and flags of cd', () => {
    expect(bash('echo hi; cd -P /a/b\ncd /c/d')).toEqual(['/a/b', '/c/d'])
  })
  test('flag=value with an absolute value', () => {
    expect(bash('tool --out=/a/b --x')).toEqual(['/a/b'])
  })
  test('dedupes and keeps the order of appearance', () => {
    expect(bash('cd /a && ls /b/c && cat /a/ /b/c')).toEqual(['/a', '/b/c'])
  })
  test('relative targets, /dev and the bare root are not candidates', () => {
    expect(bash('cd ../other && ls ./x 2>/dev/null && cat /dev/null /')).toEqual([])
    expect(bash('git -C ../other status')).toEqual([])
  })
  test('no paths', () => {
    expect(bash('npm test')).toEqual([])
    expect(bash('')).toEqual([])
    expect(bash(undefined)).toEqual([])
  })
  test('single-segment tokens, URLs and regexes are not loose paths', () => {
    expect(bash("grep -rn '/api' src && rg '/v1/' . && curl 'https://x.dev/a/b' && echo '/https?://x/y'")).toEqual([])
    expect(bash('ls /api')).toEqual([])
  })
  test('explicit targets keep a single segment; real paths stay', () => {
    expect(bash('cd /other && git -C /third status && tool --out=/x && cat /Users/x/repo/file.ts')).toEqual(['/other', '/third', '/x', '/Users/x/repo/file.ts'])
  })
  test('a slash inside a word is not a path', () => {
    expect(bash('git checkout feat/x && echo a/b')).toEqual([])
  })
})

describe('isIgnoredRepo', () => {
  test('a toplevel with a .claude segment is ignored', () => {
    expect(isIgnoredRepo('/Users/m/.claude/plugins/cache/x', '/Users/m')).toBe(true)
    expect(isIgnoredRepo('/Users/m/.claude', '/Users/m')).toBe(true)
    expect(isIgnoredRepo('/Users/m/.claude/', null)).toBe(true)
  })
  test('the home directory itself is ignored, with or without a trailing slash', () => {
    expect(isIgnoredRepo('/Users/m', '/Users/m')).toBe(true)
    expect(isIgnoredRepo('/Users/m/', '/Users/m')).toBe(true)
    expect(isIgnoredRepo('/Users/m', '/Users/m/')).toBe(true)
  })
  test('ordinary repos stay, also under home and when home is unknown', () => {
    expect(isIgnoredRepo('/Users/m/dev/web-app', '/Users/m')).toBe(false)
    expect(isIgnoredRepo('/Users/m', null)).toBe(false)
    expect(isIgnoredRepo('/Users/m/my.claude/x', '/Users/m')).toBe(false)
    expect(isIgnoredRepo('/Users/m/.claudex', '/Users/m')).toBe(false)
  })
})

describe('repo lists', () => {
  test('repoName is the basename', () => {
    expect(repoName('/Users/m/dev/web-app')).toBe('web-app')
    expect(repoName('/Users/m/dev/web-app/')).toBe('web-app')
  })
  test('candidateRepos puts the session repo first, without duplicates', () => {
    expect(candidateRepos('/s', new Set(['/t', '/s', '/u']))).toEqual(['/s', '/t', '/u'])
    expect(candidateRepos(null, new Set(['/t']))).toEqual(['/t'])
    expect(candidateRepos('/s', new Set())).toEqual(['/s'])
    expect(candidateRepos(null, new Set())).toEqual([])
  })
  test('formatCandidates lists basename and absolute path', () => {
    expect(formatCandidates(['/Users/m/web-app', '/Users/m/api'])).toBe('- web-app: /Users/m/web-app\n- api: /Users/m/api')
  })
})
