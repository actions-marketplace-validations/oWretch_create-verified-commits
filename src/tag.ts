import * as core from '@actions/core'
import * as github from '@actions/github'
import type { TagResult } from './types'

/**
 * Creates an unsigned annotated tag pointing to the given commit SHA.
 * Handles 422 idempotently: if the tag ref already exists pointing to our
 * tag object, treat as success. If it points elsewhere, throw a conflict error.
 */
export async function createTag(
  token: string,
  repositoryNameWithOwner: string,
  tagName: string,
  tagMessage: string,
  commitSha: string,
): Promise<TagResult> {
  const [owner, repo] = repositoryNameWithOwner.split('/')
  const octokit = github.getOctokit(token)

  // Pre-check: if tag ref already exists, fail fast with a clear message
  try {
    const { data: existingRef } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `tags/${tagName}`,
    })
    throw new Error(
      `Tag "${tagName}" already exists at ${existingRef.object.sha}. Delete the tag first or use a different tag name.`,
    )
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 404) {
      // Good — tag doesn't exist yet
    } else {
      throw error
    }
  }

  // Create the tag object
  const { data: tagObject } = await octokit.rest.git.createTag({
    owner,
    repo,
    tag: tagName,
    message: tagMessage,
    object: commitSha,
    type: 'commit',
  })
  const tagObjectSha = tagObject.sha
  core.debug(`Created tag object: ${tagObjectSha}`)

  // Create the tag reference with idempotent 422 handling
  try {
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/tags/${tagName}`,
      sha: tagObjectSha,
    })
    core.info(`Created tag: ${tagName} → ${tagObjectSha}`)
    return { tagSha: tagObjectSha }
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 422) {
      // If getRef fails, re-throw the original 422
      const existingRef = await octokit.rest.git
        .getRef({
          owner,
          repo,
          ref: `tags/${tagName}`,
        })
        .then((r) => r.data)
        .catch(() => {
          throw error
        })
      if (existingRef.object.sha === tagObjectSha) {
        core.info(`Tag "${tagName}" already exists pointing to our commit. Treating as success.`)
        return { tagSha: tagObjectSha }
      } else {
        throw new Error(
          `Tag "${tagName}" already exists (SHA: ${existingRef.object.sha}) and points to a different object. ` +
            `Delete the tag first or use a different tag name.`,
        )
      }
    }
    throw error
  }
}
