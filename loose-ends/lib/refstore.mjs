// Where a repo keeps its loose ends: the ref refs/loose-ends, outside every branch, whose commit holds one
// blob. Pure: argv builders, parsers and the merge; register.mjs runs the commands.
export const REF = 'refs/loose-ends'
export const REMOTE_REF = 'refs/remotes/origin/loose-ends'
export const BLOB = 'loose-ends.json'
export const ZERO = '0'.repeat(40)
// commit-tree needs an identity, and a repo without user.name or user.email must still work
export const GIT_ENV = { GIT_AUTHOR_NAME: 'loose-ends', GIT_AUTHOR_EMAIL: 'loose-ends@localhost', GIT_COMMITTER_NAME: 'loose-ends', GIT_COMMITTER_EMAIL: 'loose-ends@localhost' }

export const shaArgs = (ref = REF) => ['rev-parse', '--verify', '--quiet', ref]
export const blobArgs = sha => ['cat-file', 'blob', `${sha}:${BLOB}`]
export const HASH_ARGS = ['hash-object', '-w', '--stdin']
export const TREE_ARGS = ['mktree']
export const treeInput = blob => `100644 blob ${blob}\t${BLOB}\n`
export const commitArgs = (tree, parent) => ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', 'loose-ends']
// The old value makes the move fail when another session moved the ref first; ZERO means "must not exist yet".
export const updateArgs = (next, prev) => ['update-ref', REF, next, prev ?? ZERO]
export const REMOTE_ARGS = ['remote']
export const FETCH_ARGS = ['fetch', '--quiet', 'origin', `+${REF}:${REMOTE_REF}`]
// Overwrites origin's ref only if it still holds what was fetched (nothing, when lease is null).
export const pushArgs = lease => ['push', '--quiet', `--force-with-lease=${REF}:${lease ?? ''}`, 'origin', `${REF}:${REF}`]
export const trackArgs = sha => ['update-ref', REMOTE_REF, sha]
export const SYNC_GET_ARGS = ['config', '--get', 'loose-ends.sync']
export const syncSetArgs = on => ['config', 'loose-ends.sync', on ? 'true' : 'false']
export const COMMON_DIR_ARGS = ['rev-parse', '--path-format=absolute', '--git-common-dir']
export const LAST_COMMIT_ARGS = ['log', '-1', '--format=%h']

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
