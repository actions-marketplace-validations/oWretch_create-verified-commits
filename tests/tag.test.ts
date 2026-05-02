import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as core from '@actions/core'
import { createTag } from '../src/tag'

vi.mock('@actions/core', () => ({
  debug: vi.fn(),
  info: vi.fn(),
}))

const mockGetRef = vi.fn()
const mockCreateTag = vi.fn()
const mockCreateRef = vi.fn()

vi.mock('@actions/github', () => ({
  getOctokit: vi.fn(() => ({
    rest: { git: { getRef: mockGetRef, createTag: mockCreateTag, createRef: mockCreateRef } },
  })),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createTag', () => {
  const token = 'test-token'
  const repo = 'myorg/myrepo'
  const tagName = 'v1.0.0'
  const tagMessage = 'Release v1.0.0'
  const commitSha = 'abc123commit'
  const tagObjectSha = 'def456tagobj'

  it('happy path: tag does not exist, creates tag object and ref', async () => {
    mockGetRef.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404 }))
    mockCreateTag.mockResolvedValueOnce({ data: { sha: tagObjectSha } })
    mockCreateRef.mockResolvedValueOnce({})

    const result = await createTag(token, repo, tagName, tagMessage, commitSha)

    expect(result).toEqual({ tagSha: tagObjectSha })
    expect(mockCreateTag).toHaveBeenCalledWith({
      owner: 'myorg',
      repo: 'myrepo',
      tag: tagName,
      message: tagMessage,
      object: commitSha,
      type: 'commit',
    })
    expect(mockCreateRef).toHaveBeenCalledWith({
      owner: 'myorg',
      repo: 'myrepo',
      ref: `refs/tags/${tagName}`,
      sha: tagObjectSha,
    })
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining(tagName))
  })

  it('pre-check 404 then proceeds to create', async () => {
    mockGetRef.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404 }))
    mockCreateTag.mockResolvedValueOnce({ data: { sha: tagObjectSha } })
    mockCreateRef.mockResolvedValueOnce({})

    await expect(createTag(token, repo, tagName, tagMessage, commitSha)).resolves.toEqual({
      tagSha: tagObjectSha,
    })
    expect(mockCreateTag).toHaveBeenCalledTimes(1)
  })

  it('pre-check finds existing tag: throws conflict error with existing SHA', async () => {
    const existingSha = 'existing000sha'
    mockGetRef.mockResolvedValueOnce({ data: { object: { sha: existingSha } } })

    await expect(createTag(token, repo, tagName, tagMessage, commitSha)).rejects.toThrow(
      `Tag "${tagName}" already exists at ${existingSha}`,
    )
    expect(mockCreateTag).not.toHaveBeenCalled()
  })

  it('createRef 422 and existing ref points to our tag object: idempotent success', async () => {
    mockGetRef.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404 }))
    mockCreateTag.mockResolvedValueOnce({ data: { sha: tagObjectSha } })
    mockCreateRef.mockRejectedValueOnce(
      Object.assign(new Error('Reference already exists'), { status: 422 }),
    )
    mockGetRef.mockResolvedValueOnce({ data: { object: { sha: tagObjectSha } } })

    const result = await createTag(token, repo, tagName, tagMessage, commitSha)
    expect(result).toEqual({ tagSha: tagObjectSha })
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('already exists pointing to our commit'),
    )
  })

  it('createRef 422 and existing ref points to different SHA: throws conflict error', async () => {
    const differentSha = 'different0sha'
    mockGetRef.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404 }))
    mockCreateTag.mockResolvedValueOnce({ data: { sha: tagObjectSha } })
    mockCreateRef.mockRejectedValueOnce(
      Object.assign(new Error('Reference already exists'), { status: 422 }),
    )
    mockGetRef.mockResolvedValueOnce({ data: { object: { sha: differentSha } } })

    await expect(createTag(token, repo, tagName, tagMessage, commitSha)).rejects.toThrow(
      `Tag "${tagName}" already exists (SHA: ${differentSha}) and points to a different object`,
    )
  })

  it('createRef 422 and fetchRef also fails: throws original 422 error', async () => {
    const original422 = Object.assign(new Error('Reference already exists'), { status: 422 })
    mockGetRef.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404 }))
    mockCreateTag.mockResolvedValueOnce({ data: { sha: tagObjectSha } })
    mockCreateRef.mockRejectedValueOnce(original422)
    mockGetRef.mockRejectedValueOnce(Object.assign(new Error('Server Error'), { status: 500 }))

    await expect(createTag(token, repo, tagName, tagMessage, commitSha)).rejects.toBe(original422)
  })

  it('multi-line tag message is passed correctly to the tag object API', async () => {
    const multiLineMessage = 'Release v1.0.0\n\nThis release includes:\n- feature A\n- bug fix B'
    mockGetRef.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404 }))
    mockCreateTag.mockResolvedValueOnce({ data: { sha: tagObjectSha } })
    mockCreateRef.mockResolvedValueOnce({})

    const result = await createTag(token, repo, tagName, multiLineMessage, commitSha)

    expect(result).toEqual({ tagSha: tagObjectSha })
    expect(mockCreateTag).toHaveBeenCalledWith(
      expect.objectContaining({ message: multiLineMessage }),
    )
  })

  it('createTag fails: throws error', async () => {
    const createTagError = Object.assign(new Error('Validation failed'), { status: 422 })
    mockGetRef.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404 }))
    mockCreateTag.mockRejectedValueOnce(createTagError)

    await expect(createTag(token, repo, tagName, tagMessage, commitSha)).rejects.toBe(
      createTagError,
    )
    expect(mockCreateRef).not.toHaveBeenCalled()
  })

  it('403 on createRef: throws immediately without retry', async () => {
    const forbiddenError = Object.assign(new Error('Forbidden'), { status: 403 })
    mockGetRef.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404 }))
    mockCreateTag.mockResolvedValueOnce({ data: { sha: tagObjectSha } })
    mockCreateRef.mockRejectedValueOnce(forbiddenError)

    await expect(createTag(token, repo, tagName, tagMessage, commitSha)).rejects.toBe(
      forbiddenError,
    )
    // getRef should not have been called again (only the initial pre-check 404)
    expect(mockGetRef).toHaveBeenCalledTimes(1)
  })
})
