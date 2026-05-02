import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as core from '@actions/core'
import * as github from '@actions/github'
import type { CommitMessage, FileChange, TargetRef } from '../src/types'

vi.mock('@actions/core')
vi.mock('@actions/github', () => ({
  getOctokit: vi.fn(() => ({
    graphql: vi.fn(),
  })),
  context: { repo: { owner: 'myorg', repo: 'myrepo' } },
}))

const { createCommit } = await import('../src/commit')

const defaultRef: TargetRef = {
  branch: 'main',
  repositoryNameWithOwner: 'myorg/myrepo',
  isForkPR: false,
}

const defaultMessage: CommitMessage = {
  headline: 'feat: add feature',
}

const defaultFiles: FileChange[] = [
  { path: 'src/index.ts', base64Content: 'Y29udGVudA==', deleted: false },
]

function mockGraphql(implementation: ReturnType<typeof vi.fn>): ReturnType<typeof vi.fn> {
  const mockOctokit = { graphql: implementation }
  vi.mocked(github.getOctokit).mockReturnValue(mockOctokit as ReturnType<typeof github.getOctokit>)
  return implementation
}

function makeGraphqlSequence(...responses: Array<unknown | Error>): ReturnType<typeof vi.fn> {
  const fn = vi.fn()
  for (const resp of responses) {
    if (resp instanceof Error) {
      fn.mockRejectedValueOnce(resp)
    } else {
      fn.mockResolvedValueOnce(resp)
    }
  }
  return fn
}

const headResponse = {
  repository: { ref: { target: { oid: 'abc123headoid' } } },
}

const commitResponse = {
  createCommitOnBranch: {
    commit: {
      oid: 'def456commitoid',
      url: 'https://github.com/myorg/myrepo/commit/def456commitoid',
    },
  },
}

describe('createCommit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('happy path: returns CommitResult with commitSha', async () => {
    mockGraphql(makeGraphqlSequence(headResponse, commitResponse))

    const promise = createCommit('ghp_token', defaultRef, defaultMessage, defaultFiles)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toEqual({ commitSha: 'def456commitoid' })
    expect(core.info).toHaveBeenCalledWith('Created commit: def456commitoid')
  })

  it('conflict error: throws helpful message', async () => {
    mockGraphql(
      makeGraphqlSequence(
        headResponse,
        Object.assign(new Error('Expected head to be abc123 but got xyz789'), { status: 422 }),
      ),
    )

    const promise = createCommit('ghp_token', defaultRef, defaultMessage, defaultFiles)
    const check = expect(promise).rejects.toThrow('Commit conflict:')
    await vi.runAllTimersAsync()
    await check
  })

  it('NOT_FOUND error: throws helpful message', async () => {
    mockGraphql(
      makeGraphqlSequence(
        headResponse,
        Object.assign(new Error('NOT_FOUND: Repository not found'), { status: 404 }),
      ),
    )

    const promise = createCommit('ghp_token', defaultRef, defaultMessage, defaultFiles)
    const check = expect(promise).rejects.toThrow('Repository or branch not found')
    await vi.runAllTimersAsync()
    await check
  })

  it('rate limit then success: retries and succeeds', async () => {
    const rateLimitError = Object.assign(new Error('rate limit exceeded'), { status: 429 })
    mockGraphql(makeGraphqlSequence(headResponse, rateLimitError, commitResponse))

    const promise = createCommit('ghp_token', defaultRef, defaultMessage, defaultFiles)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toEqual({ commitSha: 'def456commitoid' })
  })

  it('rate limit all 3 attempts: throws after max retries', async () => {
    const rateLimitError = Object.assign(new Error('rate limit exceeded'), { status: 429 })
    mockGraphql(makeGraphqlSequence(headResponse, rateLimitError, rateLimitError, rateLimitError))

    const promise = createCommit('ghp_token', defaultRef, defaultMessage, defaultFiles)
    const check = expect(promise).rejects.toThrow('rate limit exceeded')
    await vi.runAllTimersAsync()
    await check
  })

  it('non-retryable 403: throws immediately without retry', async () => {
    const forbiddenError = Object.assign(new Error('Forbidden'), { status: 403 })
    const graphqlMock = makeGraphqlSequence(headResponse, forbiddenError)
    mockGraphql(graphqlMock)

    const promise = createCommit('ghp_token', defaultRef, defaultMessage, defaultFiles)
    const check = expect(promise).rejects.toThrow('Forbidden')
    await vi.runAllTimersAsync()
    await check
    // graphql called twice: once for head OID, once for mutation (no retries)
    expect(graphqlMock).toHaveBeenCalledTimes(2)
  })

  it('mixed additions and deletions: passes correct input structure', async () => {
    const graphqlMock = makeGraphqlSequence(headResponse, commitResponse)
    mockGraphql(graphqlMock)

    const files: FileChange[] = [
      { path: 'added.ts', base64Content: 'Y29udGVudA==', deleted: false },
      { path: 'deleted.ts', deleted: true },
      { path: 'also-added.ts', base64Content: 'bW9yZQ==', deleted: false },
    ]

    const promise = createCommit('ghp_token', defaultRef, defaultMessage, files)
    await vi.runAllTimersAsync()
    await promise

    const mutationCall = graphqlMock.mock.calls[1]
    const input = mutationCall[1].input

    expect(input.fileChanges.additions).toEqual([
      { path: 'added.ts', contents: 'Y29udGVudA==' },
      { path: 'also-added.ts', contents: 'bW9yZQ==' },
    ])
    expect(input.fileChanges.deletions).toEqual([{ path: 'deleted.ts' }])
  })

  it('no body in message: body field is undefined in mutation input', async () => {
    const graphqlMock = makeGraphqlSequence(headResponse, commitResponse)
    mockGraphql(graphqlMock)

    const message: CommitMessage = { headline: 'fix: quick fix' }

    const promise = createCommit('ghp_token', defaultRef, message, defaultFiles)
    await vi.runAllTimersAsync()
    await promise

    const mutationCall = graphqlMock.mock.calls[1]
    const input = mutationCall[1].input

    expect(input.message.headline).toBe('fix: quick fix')
    expect(input.message.body).toBeUndefined()
  })

  it('branch not found: throws with branch name in message', async () => {
    mockGraphql(
      makeGraphqlSequence({
        repository: { ref: null },
      }),
    )

    const promise = createCommit('ghp_token', defaultRef, defaultMessage, defaultFiles)
    const check = expect(promise).rejects.toThrow('Branch "main" not found in myorg/myrepo')
    await vi.runAllTimersAsync()
    await check
  })
})
