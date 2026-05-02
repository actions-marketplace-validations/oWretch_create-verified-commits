import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as core from '@actions/core'

vi.mock('@actions/core')
vi.mock('@actions/github')

const { runPreflightChecks } = await import('../src/preflight')

import type { FileChange, TargetRef } from '../src/types'

function makeRef(overrides: Partial<TargetRef> = {}): TargetRef {
  return {
    branch: 'main',
    repositoryNameWithOwner: 'owner/repo',
    isForkPR: false,
    ...overrides,
  }
}

function makeFile(path: string): FileChange {
  return { path, base64Content: 'dGVzdA==', deleted: false }
}

describe('runPreflightChecks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('empty changeset', () => {
    it('throws when files is empty and failOnEmpty is true', async () => {
      await expect(runPreflightChecks([], makeRef(), true)).rejects.toThrow(
        'No changed files were detected. If this is expected, set fail-on-empty: false to skip the commit silently.',
      )
    })

    it('returns false and logs info when files is empty and failOnEmpty is false', async () => {
      const result = await runPreflightChecks([], makeRef(), false)
      expect(result).toBe(false)
      expect(core.info).toHaveBeenCalledWith('No changed files detected. Skipping commit.')
    })
  })

  describe('normal files', () => {
    it('returns true with no warnings for non-empty, non-fork, non-workflow files', async () => {
      const result = await runPreflightChecks([makeFile('src/index.ts')], makeRef(), true)
      expect(result).toBe(true)
      expect(core.warning).not.toHaveBeenCalled()
    })
  })

  describe('fork PR', () => {
    it('emits a warning but returns true for fork PRs', async () => {
      const ref = makeRef({ isForkPR: true, repositoryNameWithOwner: 'fork-owner/repo' })
      const result = await runPreflightChecks([makeFile('src/index.ts')], ref, true)
      expect(result).toBe(true)
      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('fork-owner/repo'))
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('GITHUB_TOKEN has read-only access to fork repositories'),
      )
    })
  })

  describe('workflow file changes', () => {
    it('emits a warning but returns true when a workflow file is included', async () => {
      const result = await runPreflightChecks(
        [makeFile('.github/workflows/ci.yml')],
        makeRef(),
        true,
      )
      expect(result).toBe(true)
      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('.github/workflows/**'))
    })

    it('does NOT warn for files that look similar but are not under .github/workflows/', async () => {
      const result = await runPreflightChecks([makeFile('src/workflows/test.ts')], makeRef(), true)
      expect(result).toBe(true)
      expect(core.warning).not.toHaveBeenCalled()
    })

    it('matches nested workflow files', async () => {
      const result = await runPreflightChecks(
        [makeFile('.github/workflows/subdir/deploy.yml')],
        makeRef(),
        true,
      )
      expect(result).toBe(true)
      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('.github/workflows/**'))
    })
  })

  describe('combined scenarios', () => {
    it('emits both warnings when fork PR and workflow file are present', async () => {
      const ref = makeRef({ isForkPR: true, repositoryNameWithOwner: 'fork/repo' })
      const result = await runPreflightChecks([makeFile('.github/workflows/ci.yml')], ref, true)
      expect(result).toBe(true)
      expect(core.warning).toHaveBeenCalledTimes(2)
    })
  })
})
