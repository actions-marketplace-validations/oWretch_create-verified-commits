import * as core from '@actions/core'
import { minimatch } from 'minimatch'
import type { FileChange, TargetRef } from './types'

/**
 * Runs pre-commit validation checks.
 * Returns true if commit should proceed, false if it should be skipped (empty changeset + fail-on-empty:false).
 * Throws on hard failures (empty changeset + fail-on-empty:true).
 */
export async function runPreflightChecks(
  files: FileChange[],
  ref: TargetRef,
  failOnEmpty: boolean,
): Promise<boolean> {
  if (ref.isForkPR) {
    core.warning(
      'This appears to be a fork PR (head repo: ' +
        ref.repositoryNameWithOwner +
        '). GITHUB_TOKEN has read-only access to fork repositories. If using GITHUB_TOKEN, the commit will fail. Use a GitHub App token with write access to the fork instead.',
    )
  }

  const hasWorkflowFile = files.some((file) =>
    minimatch(file.path, '.github/workflows/**', { dot: true }),
  )
  if (hasWorkflowFile) {
    core.warning(
      'Changed files include workflow files (.github/workflows/**). Committing workflow files requires the "workflows" permission on the token in addition to "contents: write".',
    )
  }

  if (files.length === 0) {
    if (failOnEmpty) {
      throw new Error(
        'No changed files were detected. If this is expected, set fail-on-empty: false to skip the commit silently.',
      )
    }
    core.info('No changed files detected. Skipping commit.')
    return false
  }

  return true
}
