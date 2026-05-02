import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as core from '@actions/core'
import type { ActionInputs, TargetRef, FileChange, CommitResult, TagResult } from '../src/types'

vi.mock('@actions/core')
vi.mock('../src/inputs')
vi.mock('../src/ref')
vi.mock('../src/files')
vi.mock('../src/preflight')
vi.mock('../src/commit')
vi.mock('../src/tag')

import { parseInputs } from '../src/inputs'
import { resolveTargetRef, validateWorkspaceHead } from '../src/ref'
import { discoverFiles } from '../src/files'
import { runPreflightChecks } from '../src/preflight'
import { createCommit } from '../src/commit'
import { createTag } from '../src/tag'

const defaultInputs: ActionInputs = {
  token: 'ghp_test',
  message: { headline: 'chore: update files' },
  refOverride: '',
  filePatterns: [],
  failOnEmpty: true,
}

const defaultRef: TargetRef = {
  branch: 'main',
  repositoryNameWithOwner: 'myorg/myrepo',
  isForkPR: false,
}

const defaultFiles: FileChange[] = [
  { path: 'README.md', base64Content: 'aGVsbG8=', deleted: false },
]
const defaultCommitResult: CommitResult = { commitSha: 'abc123' }
const defaultTagResult: TagResult = { tagSha: 'def456' }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(parseInputs).mockReturnValue(defaultInputs)
  vi.mocked(resolveTargetRef).mockResolvedValue(defaultRef)
  vi.mocked(validateWorkspaceHead).mockResolvedValue(undefined)
  vi.mocked(discoverFiles).mockResolvedValue(defaultFiles)
  vi.mocked(runPreflightChecks).mockResolvedValue(true)
  vi.mocked(createCommit).mockResolvedValue(defaultCommitResult)
  vi.mocked(createTag).mockResolvedValue(defaultTagResult)
})

async function runMain(): Promise<void> {
  const { run } = await import('../src/main')
  await run()
}

describe('main orchestration', () => {
  it('full happy path (no tag)', async () => {
    await runMain()

    expect(vi.mocked(core.setOutput)).toHaveBeenCalledWith('commit-sha', 'abc123')
    expect(vi.mocked(core.setOutput)).toHaveBeenCalledWith('tag-sha', '')
    expect(vi.mocked(core.setOutput)).toHaveBeenCalledWith('committed', 'true')
    expect(vi.mocked(createTag)).not.toHaveBeenCalled()
    expect(vi.mocked(core.setFailed)).not.toHaveBeenCalled()
  })

  it('full happy path (with tag)', async () => {
    vi.mocked(parseInputs).mockReturnValue({
      ...defaultInputs,
      tagName: 'v1.0.0',
      tagMessage: 'Release v1.0.0',
    })

    await runMain()

    expect(vi.mocked(createTag)).toHaveBeenCalledWith(
      'ghp_test',
      'myorg/myrepo',
      'v1.0.0',
      'Release v1.0.0',
      'abc123',
    )
    expect(vi.mocked(core.setOutput)).toHaveBeenCalledWith('tag-sha', 'def456')
    expect(vi.mocked(core.setOutput)).toHaveBeenCalledWith('committed', 'true')
  })

  it('no-op when runPreflightChecks returns false', async () => {
    vi.mocked(runPreflightChecks).mockResolvedValue(false)

    await runMain()

    expect(vi.mocked(createCommit)).not.toHaveBeenCalled()
    expect(vi.mocked(core.setOutput)).toHaveBeenCalledWith('committed', 'false')
    expect(vi.mocked(core.setOutput)).toHaveBeenCalledWith('commit-sha', '')
    expect(vi.mocked(core.setOutput)).toHaveBeenCalledWith('tag-sha', '')
  })

  it('sets failed when parseInputs throws', async () => {
    vi.mocked(parseInputs).mockImplementation(() => {
      throw new Error('missing required input: token')
    })

    await runMain()

    expect(vi.mocked(core.setFailed)).toHaveBeenCalledWith('missing required input: token')
    expect(vi.mocked(resolveTargetRef)).not.toHaveBeenCalled()
  })

  it('sets failed when resolveTargetRef throws', async () => {
    vi.mocked(resolveTargetRef).mockRejectedValue(new Error('could not resolve ref'))

    await runMain()

    expect(vi.mocked(core.setFailed)).toHaveBeenCalledWith('could not resolve ref')
    expect(vi.mocked(discoverFiles)).not.toHaveBeenCalled()
  })

  it('sets failed when createCommit throws', async () => {
    vi.mocked(createCommit).mockRejectedValue(new Error('GraphQL mutation failed'))

    await runMain()

    expect(vi.mocked(core.setFailed)).toHaveBeenCalledWith('GraphQL mutation failed')
  })

  it('uses commit message headline as tagMessage when tagMessage not set', async () => {
    vi.mocked(parseInputs).mockReturnValue({
      ...defaultInputs,
      tagName: 'v2.0.0',
      tagMessage: undefined,
    })

    await runMain()

    expect(vi.mocked(createTag)).toHaveBeenCalledWith(
      'ghp_test',
      'myorg/myrepo',
      'v2.0.0',
      'chore: update files',
      'abc123',
    )
  })

  it('propagates validateWorkspaceHead rejection to setFailed', async () => {
    vi.mocked(validateWorkspaceHead).mockRejectedValue(new Error('HEAD mismatch'))

    await runMain()

    expect(vi.mocked(core.setFailed)).toHaveBeenCalledWith('HEAD mismatch')
    expect(vi.mocked(discoverFiles)).not.toHaveBeenCalled()
  })
})
