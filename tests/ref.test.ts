import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as github from '@actions/github'
import { resolveTargetRef, validateWorkspaceHead } from '../src/ref'

vi.mock('@actions/core', () => ({
  warning: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('@actions/exec', () => ({
  exec: vi.fn(),
}))

vi.mock('@actions/github', () => ({
  context: {
    eventName: 'push',
    repo: { owner: 'myorg', repo: 'myrepo' },
    payload: {},
  },
  getOctokit: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.GITHUB_REF
  Object.assign(github.context, {
    eventName: 'push',
    repo: { owner: 'myorg', repo: 'myrepo' },
    payload: {},
  })
})

describe('resolveTargetRef', () => {
  it('returns immediately with refOverride when provided', async () => {
    const result = await resolveTargetRef('feature/my-branch')
    expect(result).toEqual({
      branch: 'feature/my-branch',
      repositoryNameWithOwner: 'myorg/myrepo',
      isForkPR: false,
    })
  })

  it('push event with GITHUB_REF=refs/heads/main → branch=main', async () => {
    process.env.GITHUB_REF = 'refs/heads/main'
    const result = await resolveTargetRef('')
    expect(result).toEqual({
      branch: 'main',
      repositoryNameWithOwner: 'myorg/myrepo',
      isForkPR: false,
    })
  })

  it('push event with GITHUB_REF=refs/tags/v1.0.0 → throws tag ref error', async () => {
    process.env.GITHUB_REF = 'refs/tags/v1.0.0'
    await expect(resolveTargetRef('')).rejects.toThrow(
      'Cannot commit to a tag ref. This action requires a branch target. Event: push, GITHUB_REF: refs/tags/v1.0.0',
    )
  })

  it('push event with GITHUB_REF=refs/pull/1/merge → throws unknown ref error', async () => {
    process.env.GITHUB_REF = 'refs/pull/1/merge'
    await expect(resolveTargetRef('')).rejects.toThrow(
      'Unable to determine target branch from GITHUB_REF: refs/pull/1/merge. Provide the ref input explicitly.',
    )
  })

  it('pull_request event, same-repo PR → branch from payload, isForkPR=false', async () => {
    Object.assign(github.context, {
      eventName: 'pull_request',
      payload: {
        pull_request: {
          head: {
            ref: 'feature/pr-branch',
            repo: { full_name: 'myorg/myrepo' },
          },
        },
      },
    })
    const result = await resolveTargetRef('')
    expect(result).toEqual({
      branch: 'feature/pr-branch',
      repositoryNameWithOwner: 'myorg/myrepo',
      isForkPR: false,
    })
  })

  it('pull_request event, fork PR → branch from payload, isForkPR=true', async () => {
    Object.assign(github.context, {
      eventName: 'pull_request',
      payload: {
        pull_request: {
          head: {
            ref: 'feature/fork-branch',
            repo: { full_name: 'forkuser/myrepo' },
          },
        },
      },
    })
    const result = await resolveTargetRef('')
    expect(result).toEqual({
      branch: 'feature/fork-branch',
      repositoryNameWithOwner: 'forkuser/myrepo',
      isForkPR: true,
    })
  })

  it('workflow_dispatch with branch ref → extracts branch', async () => {
    Object.assign(github.context, { eventName: 'workflow_dispatch' })
    process.env.GITHUB_REF = 'refs/heads/release/1.0'
    const result = await resolveTargetRef('')
    expect(result).toEqual({
      branch: 'release/1.0',
      repositoryNameWithOwner: 'myorg/myrepo',
      isForkPR: false,
    })
  })

  it('schedule event → extracts branch from GITHUB_REF', async () => {
    Object.assign(github.context, { eventName: 'schedule' })
    process.env.GITHUB_REF = 'refs/heads/nightly'
    const result = await resolveTargetRef('')
    expect(result).toEqual({
      branch: 'nightly',
      repositoryNameWithOwner: 'myorg/myrepo',
      isForkPR: false,
    })
  })

  it('repository_dispatch event → extracts branch from GITHUB_REF', async () => {
    Object.assign(github.context, { eventName: 'repository_dispatch' })
    process.env.GITHUB_REF = 'refs/heads/main'
    const result = await resolveTargetRef('')
    expect(result).toEqual({
      branch: 'main',
      repositoryNameWithOwner: 'myorg/myrepo',
      isForkPR: false,
    })
  })

  it('unknown event → throws unsupported event message', async () => {
    Object.assign(github.context, { eventName: 'release' })
    await expect(resolveTargetRef('')).rejects.toThrow(
      'Unsupported event type: release. Provide the ref input explicitly to override event-based detection.',
    )
  })
})

describe('validateWorkspaceHead', () => {
  const ref = { branch: 'main', repositoryNameWithOwner: 'myorg/myrepo', isForkPR: false }

  function mockExecWithSha(sha: string) {
    vi.mocked(exec.exec).mockImplementation(async (_cmd, _args, options) => {
      options?.listeners?.stdout?.(Buffer.from(sha + '\n'))
      return 0
    })
  }

  it('local matches remote → no warning emitted', async () => {
    const sha = 'abc123'
    mockExecWithSha(sha)
    vi.mocked(github.getOctokit).mockReturnValue({
      rest: {
        repos: {
          getBranch: vi.fn().mockResolvedValue({ data: { commit: { sha } } }),
        },
      },
    } as unknown as ReturnType<typeof github.getOctokit>)

    await validateWorkspaceHead(ref, 'token')
    expect(core.warning).not.toHaveBeenCalled()
  })

  it('local differs from remote → warning emitted', async () => {
    mockExecWithSha('localsha')
    vi.mocked(github.getOctokit).mockReturnValue({
      rest: {
        repos: {
          getBranch: vi.fn().mockResolvedValue({ data: { commit: { sha: 'remotesha' } } }),
        },
      },
    } as unknown as ReturnType<typeof github.getOctokit>)

    await validateWorkspaceHead(ref, 'token')
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('localsha') && expect.stringContaining('remotesha'),
    )
  })

  it('REST call fails → no error thrown, debug logged', async () => {
    mockExecWithSha('localsha')
    vi.mocked(github.getOctokit).mockReturnValue({
      rest: {
        repos: {
          getBranch: vi.fn().mockRejectedValue(new Error('network error')),
        },
      },
    } as unknown as ReturnType<typeof github.getOctokit>)

    await expect(validateWorkspaceHead(ref, 'token')).resolves.not.toThrow()
    expect(core.debug).toHaveBeenCalledWith(expect.stringContaining('network error'))
  })
})
