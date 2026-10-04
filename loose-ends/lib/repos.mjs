const DRIVE = /^[A-Za-z]:/
// a word that is, or ends in `=`, a drive path so far
const DRIVE_WORD = /(?:^|=)[A-Za-z]:/

// Backslashes to slashes and no trailing separator (the root, `/` or `C:/`, keeps its one), so a path has one spelling.
export function normalizePath(path) {
  const slashed = path.replace(/\\/g, '/')
  return /^([A-Za-z]:)?\/$/.test(slashed) ? slashed : slashed.replace(/\/+$/, '') || '/'
}

// `/x` or `C:\x` / `C:/x`; a drive-relative `C:x` is not absolute.
export const isAbsolutePath = p => typeof p === 'string' && (p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p))

// Parent folder of a normalized path; a root is its own parent.
export function parentPath(path) {
  const parent = path.slice(0, path.lastIndexOf('/'))
  if (parent === '') return '/'
  return DRIVE.test(parent) && parent.length === 2 ? `${parent}/` : parent
}

// Tools whose path argument names a file; for the rest (Grep, Glob, Bash) it can be a folder.
export const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Read'])
const PATH_FIELD = { Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', Read: 'file_path', NotebookEdit: 'notebook_path', Grep: 'path', Glob: 'path' }
// Words that end a shell command: the next word starts another one.
const SEPARATORS = ';&|()\n'

// Splits a shell command into commands made of words, with quotes and escapes resolved. Not a shell: no expansions.
function shellCommands(command) {
  const commands = [[]]
  let word = ''
  let started = false
  let quote = null
  const endWord = () => {
    if (started) commands[commands.length - 1].push(word)
    word = ''
    started = false
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && i + 1 < command.length) word += DRIVE_WORD.test(word) ? c : command[++i]
      else word += c
    } else if (c === "'" || c === '"') {
      quote = c
      started = true
    } else if (c === '\\' && i + 1 < command.length) {
      // in a drive path (`C:\Users`) the backslash is the separator, not an escape
      word += DRIVE_WORD.test(word) ? c : command[++i]
      started = true
    } else if (SEPARATORS.includes(c)) {
      endWord()
      commands.push([])
    } else if (/\s/.test(c)) endWord()
    else {
      word += c
      started = true
    }
  }
  endWord()
  return commands.filter(words => words.length)
}

// A bare word counts as a path only with a second segment: `/api` in a grep pattern is not one, `/Users/x` is.
const LOOSE_PATH = /^(\/|[A-Za-z]:\/)[^/]+\/[^/]+/

const isCandidate = p => isAbsolutePath(p) && p !== '/' && !p.startsWith('/dev/')

function bashPaths(command) {
  const found = []
  for (const words of shellCommands(command)) {
    if (words[0] === 'cd') {
      const target = words.slice(1).find(w => !w.startsWith('-') && w.toLowerCase() !== '/d')
      if (target) found.push(target)
    }
    const git = words.indexOf('git')
    if (git !== -1) for (let k = git + 1; k < words.length - 1; k++) if (words[k] === '-C') found.push(words[k + 1])
    for (const w of words) {
      if (isAbsolutePath(w)) {
        if (LOOSE_PATH.test(normalizePath(w)) && !w.includes('://')) found.push(w)
      } else {
        const value = /^-[^=\s]*=((?:\/|[A-Za-z]:[\\/]).*)$/.exec(w)
        if (value) found.push(value[1])
      }
    }
  }
  return found
}

// Absolute paths a tool call points at, in order and without repeats. Relative ones are left out: without
// the shell's working directory they cannot be told apart from the session's.
export function candidatePaths(tool, input) {
  if (!input || typeof input !== 'object') return []
  let found = []
  if (tool === 'Bash') found = typeof input.command === 'string' ? bashPaths(input.command) : []
  else if (PATH_FIELD[tool]) found = [input[PATH_FIELD[tool]]]
  return [...new Set(found.filter(isAbsolutePath).map(normalizePath).filter(isCandidate))]
}

export function repoName(path) {
  return path.replace(/\/+$/, '').split('/').pop() || path
}

// The session repo first (when there is one), then the touched ones, each once.
export function candidateRepos(sessionRepo, touched) {
  return [...new Set([...(sessionRepo ? [sessionRepo] : []), ...touched])]
}

export function formatCandidates(paths) {
  return paths.map(p => `- ${repoName(p)}: ${p}`).join('\n')
}

// Case does not matter on a drive-letter path (Windows); elsewhere it does.
const key = p => (DRIVE.test(p) ? p.toLowerCase() : p)

// Repos where loose ends must never be written: the home directory itself and everything under its `.claude`
// (Claude Code's own folder, whose plugin caches and marketplaces are git repos). A worktree of a project, which
// Claude Code puts under `<repo>/.claude/worktrees`, is a real repo. Without HOME, only the plugin folders and a
// bare `.claude` are recognized.
export function isIgnoredRepo(top, home) {
  const path = key(normalizePath(top))
  if (typeof home === 'string' && home !== '') {
    const h = key(normalizePath(home))
    return path === h || path === `${h}/.claude` || path.startsWith(`${h}/.claude/`)
  }
  const segments = path.split('/')
  const claude = segments.lastIndexOf('.claude')
  return claude !== -1 && (claude === segments.length - 1 || segments[claude + 1] === 'plugins')
}
