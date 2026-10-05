import { describe, expect, test } from 'claude-code/testing'
import { FETCH_ARGS, GIT_ENV, NET_ENV, REF, REMOTE_REF, blobArgs, commitArgs, firstLine, hasOrigin, lastCommitArgs, mergeItems, pushArgs, sameItems, shaArgs, trackArgs, treeInput, updateArgs } from '../lib/refstore.mjs'

const item = (id: string, over = {}) => ({ id, text: id, createdAt: '2026-10-04T09:00:00.000Z', ...over })

describe('refstore argv', () => {
  test('the data ref has two components under refs/, so a remote takes it; the tracking copy stays outside refs/remotes', () => {
    expect(REF).toBe('refs/loose-ends/items')
    expect(REMOTE_REF).toBe('refs/loose-ends/origin')
    expect(FETCH_ARGS).toEqual(['fetch', '--quiet', 'origin', '+refs/loose-ends/items:refs/loose-ends/origin'])
  })
  test('reads go through rev-parse and cat-file of the one blob', () => {
    expect(shaArgs()).toEqual(['rev-parse', '--verify', '--quiet', 'refs/loose-ends/items'])
    expect(shaArgs(REMOTE_REF)).toEqual(['rev-parse', '--verify', '--quiet', 'refs/loose-ends/origin'])
    expect(blobArgs('abc')).toEqual(['cat-file', 'blob', 'abc:loose-ends.json'])
  })
  test('writes: tree line, commit with or without parent, update-ref guarded by the old value', () => {
    expect(treeInput('b1')).toBe('100644 blob b1\tloose-ends.json\n')
    expect(commitArgs('t1', null)).toEqual(['commit-tree', 't1', '-m', 'loose-ends'])
    expect(commitArgs('t1', 'p1')).toEqual(['commit-tree', 't1', '-p', 'p1', '-m', 'loose-ends'])
    expect(updateArgs('n1', 'p1')).toEqual(['update-ref', 'refs/loose-ends/items', 'n1', 'p1'])
    // empty, not 40 zeros: a SHA-256 repo refuses a SHA-1 zero id
    expect(updateArgs('n1', null)).toEqual(['update-ref', 'refs/loose-ends/items', 'n1', ''])
  })
  test('push leases what was fetched and sends the commit that was read; the tracking ref follows it', () => {
    expect(pushArgs('r1', 'n1')).toEqual(['push', '--quiet', '--force-with-lease=refs/loose-ends/items:r1', 'origin', 'n1:refs/loose-ends/items'])
    expect(pushArgs(null, 'n1')).toEqual(['push', '--quiet', '--force-with-lease=refs/loose-ends/items:', 'origin', 'n1:refs/loose-ends/items'])
    expect(trackArgs('n1')).toEqual(['update-ref', 'refs/loose-ends/origin', 'n1'])
  })
  test('fetch and push never wait for a credential prompt', () => {
    expect(NET_ENV).toEqual({ GIT_TERMINAL_PROMPT: '0' })
  })
  test('the commit of a turn is the last one made since the turn started', () => {
    expect(lastCommitArgs('2026-10-04T10:00:00.000Z')).toEqual(['log', '-1', '--since=2026-10-04T10:00:00.000Z', '--format=%h'])
  })
  test('commit-tree runs with an identity of its own', () => {
    expect(GIT_ENV).toEqual({ GIT_AUTHOR_NAME: 'loose-ends', GIT_AUTHOR_EMAIL: 'loose-ends@localhost', GIT_COMMITTER_NAME: 'loose-ends', GIT_COMMITTER_EMAIL: 'loose-ends@localhost' })
  })
})

describe('refstore parsing', () => {
  test('firstLine trims and gives null for nothing', () => {
    expect(firstLine('abc\nrest')).toBe('abc')
    expect(firstLine('  abc  \n')).toBe('abc')
    expect(firstLine('')).toBe(null)
    expect(firstLine(undefined)).toBe(null)
  })
  test('hasOrigin looks for a line that is exactly origin', () => {
    expect(hasOrigin('origin\n')).toBe(true)
    expect(hasOrigin('upstream\norigin\n')).toBe(true)
    expect(hasOrigin('origin2\n')).toBe(false)
    expect(hasOrigin('')).toBe(false)
    expect(hasOrigin(undefined)).toBe(false)
  })
})

describe('mergeItems', () => {
  test('union by id, mine first, then the ones only theirs has', () => {
    expect(mergeItems([item('a'), item('b')], [item('c'), item('a')]).map(i => i.id)).toEqual(['a', 'b', 'c'])
  })
  test('the later updatedAt wins, createdAt stands in, a tie keeps mine', () => {
    const mine = [item('a', { text: 'mía', updatedAt: '2026-10-04T10:00:00.000Z' }), item('b', { text: 'mía' }), item('c', { text: 'mía', updatedAt: '2026-10-04T10:00:00.000Z' })]
    const theirs = [item('a', { text: 'suya', updatedAt: '2026-10-04T11:00:00.000Z' }), item('b', { text: 'suya', createdAt: '2026-10-04T08:00:00.000Z' }), item('c', { text: 'suya', updatedAt: '2026-10-04T10:00:00.000Z' })]
    expect(mergeItems(mine, theirs).map(i => i.text)).toEqual(['suya', 'mía', 'mía'])
  })
})

describe('sameItems', () => {
  test('the same items in any order are the same; a changed, missing or extra item is not', () => {
    expect(sameItems([item('a'), item('b')], [item('b'), item('a')])).toBe(true)
    expect(sameItems([], [])).toBe(true)
    expect(sameItems([item('a')], [item('a', { text: 'otro' })])).toBe(false)
    expect(sameItems([item('a')], [item('a'), item('b')])).toBe(false)
    expect(sameItems([item('a'), item('a')], [item('a'), item('b')])).toBe(false)
  })
})
