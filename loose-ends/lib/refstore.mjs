// Where a repo keeps its loose ends: the ref refs/loose-ends/items, outside every branch, whose commit holds one
// blob. Pure: argv builders, parsers and the merge; register.mjs runs the commands.
// Two components under refs/, because a remote refuses a ref with one ("funny refname").
export const REF = 'refs/loose-ends/items'
// Origin's copy, as the last fetch or push left it; outside refs/remotes, so `git branch -r` and `fetch --prune`
// never see it and a branch called loose-ends never clashes with it.
export const REMOTE_REF = 'refs/loose-ends/origin'
export const BLOB = 'loose-ends.json'
// commit-tree needs an identity, and a repo without user.name or user.email must still work
export const GIT_ENV = { GIT_AUTHOR_NAME: 'loose-ends', GIT_AUTHOR_EMAIL: 'loose-ends@localhost', GIT_COMMITTER_NAME: 'loose-ends', GIT_COMMITTER_EMAIL: 'loose-ends@localhost' }
// fetch and push fail at once instead of waiting for a credential prompt nobody sees
export const NET_ENV = { GIT_TERMINAL_PROMPT: '0' }

export const shaArgs = (ref = REF) => ['rev-parse', '--verify', '--quiet', ref]
export const blobArgs = sha => ['cat-file', 'blob', `${sha}:${BLOB}`]
export const HASH_ARGS = ['hash-object', '-w', '--stdin']
export const TREE_ARGS = ['mktree']
export const treeInput = blob => `100644 blob ${blob}\t${BLOB}\n`
export const commitArgs = (tree, parent) => ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', 'loose-ends']
// The old value makes the move fail when another session moved the ref first; empty means "must not exist yet"
// (40 zeros would be refused by a SHA-256 repo).
export const updateArgs = (next, prev) => ['update-ref', REF, next, prev ?? '']
export const REMOTE_ARGS = ['remote']
export const FETCH_ARGS = ['fetch', '--quiet', 'origin', `+${REF}:${REMOTE_REF}`]
// Sends commit `sha` (the one just read) to origin's ref, only if origin still holds what was fetched (nothing,
// when lease is null).
export const pushArgs = (lease, sha) => ['push', '--quiet', `--force-with-lease=${REF}:${lease ?? ''}`, 'origin', `${sha}:${REF}`]
export const trackArgs = sha => ['update-ref', REMOTE_REF, sha]
export const SYNC_GET_ARGS = ['config', '--get', 'loose-ends.sync']
export const syncSetArgs = on => ['config', 'loose-ends.sync', on ? 'true' : 'false']
export const COMMON_DIR_ARGS = ['rev-parse', '--path-format=absolute', '--git-common-dir']
// The last commit of HEAD made since `since` (an ISO timestamp); prints nothing when there is none.
export const lastCommitArgs = since => ['log', '-1', `--since=${since}`, '--format=%h']

// First line of a git answer, trimmed; null when there is none.
export function firstLine(stdout) {
  const line = typeof stdout === 'string' ? stdout.split('\n')[0].trim() : ''
  return line || null
}

export function hasOrigin(stdout) {
  return typeof stdout === 'string' && stdout.split('\n').some(line => line.trim() === 'origin')
}

const stamp = item => Date.parse(item.updatedAt ?? item.createdAt ?? '') || 0

// Union by id: mine first, then what only theirs has. When both hold an item the later updatedAt wins
// (createdAt when there is none); a tie keeps mine.
export function mergeItems(mine, theirs) {
  const byId = new Map(mine.map(i => [i.id, i]))
  for (const t of theirs) {
    const m = byId.get(t.id)
    if (!m || stamp(t) > stamp(m)) byId.set(t.id, t)
  }
  return [...byId.values()]
}

// Whether two lists hold the same items, whatever their order: a local ref whose merge with origin's is the same
// as origin's holds nothing origin lacks.
export function sameItems(a, b) {
  if (a.length !== b.length) return false
  const theirs = new Map(b.map(i => [i.id, JSON.stringify(i)]))
  const seen = new Set()
  return a.every(i => {
    if (seen.has(i.id)) return false
    seen.add(i.id)
    return theirs.get(i.id) === JSON.stringify(i)
  })
}
