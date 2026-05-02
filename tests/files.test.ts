import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as fs from 'fs'

vi.mock('@actions/core')
vi.mock('@actions/exec', () => ({
  getExecOutput: vi.fn(),
}))
vi.mock('fs', () => ({
  promises: { readFile: vi.fn() },
  lstatSync: vi.fn(() => ({ isSymbolicLink: () => false })),
}))

const { discoverFiles } = await import('../src/files')

function makeGitOutput(lines: string[]): string {
  return lines.join('\0')
}

function mockGitStatus(entries: string[]): void {
  vi.mocked(exec.getExecOutput).mockResolvedValue({
    exitCode: 0,
    stdout: makeGitOutput(entries),
    stderr: '',
  })
}

function mockReadFile(content: string): void {
  vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from(content) as never)
}

describe('discoverFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fs.lstatSync).mockReturnValue({ isSymbolicLink: () => false } as never)
  })

  it('happy path: returns modified, added, and deleted files', async () => {
    mockGitStatus(['M  src/foo.ts', 'A  src/bar.ts', 'D  src/old.ts'])
    mockReadFile('file contents')

    const result = await discoverFiles([])

    expect(result).toHaveLength(3)
    expect(result.find((f) => f.path === 'src/foo.ts')).toMatchObject({ deleted: false })
    expect(result.find((f) => f.path === 'src/bar.ts')).toMatchObject({ deleted: false })
    const deleted = result.find((f) => f.path === 'src/old.ts')
    expect(deleted).toMatchObject({ deleted: true })
    expect(deleted?.base64Content).toBeUndefined()
  })

  it('untracked file (??) is treated as addition', async () => {
    mockGitStatus(['?? new-file.txt'])
    mockReadFile('hello')

    const result = await discoverFiles([])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ path: 'new-file.txt', deleted: false })
    expect(result[0].base64Content).toBeDefined()
  })

  it('deleted file (D ) has deleted=true and no content', async () => {
    mockGitStatus(['D  removed.txt'])

    const result = await discoverFiles([])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ path: 'removed.txt', deleted: true })
    expect(result[0].base64Content).toBeUndefined()
    expect(fs.promises.readFile).not.toHaveBeenCalled()
  })

  it('modified file ( M) is read and base64-encoded', async () => {
    mockGitStatus([' M src/modified.ts'])
    vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from('hello world') as never)

    const result = await discoverFiles([])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      path: 'src/modified.ts',
      deleted: false,
      base64Content: Buffer.from('hello world').toString('base64'),
    })
  })

  it('T  status (type change) is logged as warning and excluded', async () => {
    mockGitStatus(['T  symlink-file.txt', 'M  normal.ts'])
    mockReadFile('content')

    const result = await discoverFiles([])

    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('normal.ts')
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('symlink-file.txt'))
  })

  it('symlink detected via lstatSync is excluded with warning', async () => {
    mockGitStatus(['M  link.ts', 'M  normal.ts'])
    mockReadFile('content')
    vi.mocked(fs.lstatSync).mockImplementation((p) => {
      if (p === 'link.ts') return { isSymbolicLink: () => true } as never
      return { isSymbolicLink: () => false } as never
    })

    const result = await discoverFiles([])

    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('normal.ts')
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('link.ts'))
  })

  it('pattern filtering: returns only matching files', async () => {
    mockGitStatus(['M  src/a.ts', 'M  src/b.ts', 'M  docs/readme.md'])
    mockReadFile('content')

    const result = await discoverFiles(['src/**'])

    expect(result).toHaveLength(2)
    expect(result.map((f) => f.path)).toEqual(expect.arrayContaining(['src/a.ts', 'src/b.ts']))
    expect(result.find((f) => f.path === 'docs/readme.md')).toBeUndefined()
  })

  it('pattern filtering: deleted file matching pattern is included', async () => {
    mockGitStatus(['D  src/deleted.ts', 'M  docs/readme.md'])

    const result = await discoverFiles(['src/**'])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ path: 'src/deleted.ts', deleted: true })
    expect(result[0].base64Content).toBeUndefined()
  })

  it('pattern matches nothing: returns empty array and logs info', async () => {
    mockGitStatus(['M  src/a.ts', 'M  src/b.ts'])

    const result = await discoverFiles(['docs/**'])

    expect(result).toEqual([])
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('No changed files matched'))
  })

  it('empty workspace (no git status output): returns empty array', async () => {
    mockGitStatus([])

    const result = await discoverFiles([])

    expect(result).toEqual([])
  })

  it('filename with spaces is parsed correctly', async () => {
    mockGitStatus(['M  path/to/my file with spaces.ts'])
    mockReadFile('content')

    const result = await discoverFiles([])

    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('path/to/my file with spaces.ts')
  })

  it('filename with special chars (unicode) is parsed correctly', async () => {
    mockGitStatus(['A  src/ünïcödé_文件.ts'])
    mockReadFile('content')

    const result = await discoverFiles([])

    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('src/ünïcödé_文件.ts')
  })

  it('filename with quotes is parsed correctly', async () => {
    mockGitStatus(['M  src/"quoted".ts'])
    mockReadFile('content')

    const result = await discoverFiles([])

    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('src/"quoted".ts')
  })

  it('MM (modified in both index and worktree) is treated as modification', async () => {
    mockGitStatus(['MM src/both.ts'])
    mockReadFile('updated content')

    const result = await discoverFiles([])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ path: 'src/both.ts', deleted: false })
    expect(result[0].base64Content).toBeDefined()
  })

  it(' D (deleted in worktree) is treated as deletion', async () => {
    mockGitStatus([' D staged-then-deleted.ts'])

    const result = await discoverFiles([])

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ path: 'staged-then-deleted.ts', deleted: true })
  })

  it('no patterns provided returns all changed files', async () => {
    mockGitStatus(['M  a.ts', 'A  b.ts'])
    mockReadFile('x')

    const result = await discoverFiles([])

    expect(result).toHaveLength(2)
  })
})
