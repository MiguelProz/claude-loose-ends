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
      else if (c === '\\' && quote === '"' && i + 1 < command.length) word += command[++i]
      else word += c
    } else if (c === "'" || c === '"') {
      quote = c
      started = true
    } else if (c === '\\' && i + 1 < command.length) {
      word += command[++i]
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

const isAbsolute = p => typeof p === 'string' && p.startsWith('/') && p.length > 1 && !p.startsWith('/dev/')

function bashPaths(command) {
  const found = []
  for (const words of shellCommands(command)) {
    if (words[0] === 'cd') {
      const target = words.slice(1).find(w => !w.startsWith('-'))
      if (target) found.push(target)
    }
    const git = words.indexOf('git')
    if (git !== -1) for (let k = git + 1; k < words.length - 1; k++) if (words[k] === '-C') found.push(words[k + 1])
    for (const w of words) {
      if (w.startsWith('/')) found.push(w)
      else {
        const value = /^-[^=\s]*=(\/.*)$/.exec(w)
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
  return [...new Set(found.filter(isAbsolute))]
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
