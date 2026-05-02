import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as github from '@actions/github'
import type { TargetRef } from './types'

/**
 * Resolves the target branch and repository for the commit.
 * Uses explicit refOverride if provided, otherwise infers from event context.
 */
export async function resolveTargetRef(refOverride: string): Promise<TargetRef> {
  if (refOverride !== '') {
    return {
      branch: refOverride,
      repositoryNameWithOwner: `${github.context.repo.owner}/${github.context.repo.repo}`,
      isForkPR: false,
    }
  }

  const eventName = github.context.eventName
  const owner = github.context.repo.owner
  const repo = github.context.repo.repo

  if (eventName === 'pull_request') {
    const pr = github.context.payload.pull_request as unknown as {
      head: { ref: string; repo: { full_name: string } }
    }
    const branch = pr.head.ref
    const headRepo = pr.head.repo.full_name
    const baseRepo = `${owner}/${repo}`
    const isForkPR = headRepo !== baseRepo
    return { branch, repositoryNameWithOwner: headRepo, isForkPR }
  }

  if (
    eventName === 'push' ||
    eventName === 'workflow_dispatch' ||
    eventName === 'schedule' ||
    eventName === 'repository_dispatch'
  ) {
    const githubRef = process.env.GITHUB_REF ?? ''
    if (githubRef.startsWith('refs/tags/')) {
      throw new Error(
        `Cannot commit to a tag ref. This action requires a branch target. Event: ${eventName}, GITHUB_REF: ${githubRef}`,
      )
    }
    if (githubRef.startsWith('refs/heads/')) {
      const branch = githubRef.slice('refs/heads/'.length)
      return { branch, repositoryNameWithOwner: `${owner}/${repo}`, isForkPR: false }
    }
    throw new Error(
      `Unable to determine target branch from GITHUB_REF: ${githubRef}. Provide the ref input explicitly.`,
    )
  }

  throw new Error(
    `Unsupported event type: ${eventName}. Provide the ref input explicitly to override event-based detection.`,
  )
}

/**
 * Validates the workspace HEAD matches the remote branch tip.
 * Warns (does not fail) if they differ — this can happen on PR merge refs.
 */
export async function validateWorkspaceHead(ref: TargetRef, token: string): Promise<void> {
  let localHead = ''
  await exec.exec('git', ['rev-parse', 'HEAD'], {
    listeners: {
      stdout: (data: Buffer) => {
        localHead += data.toString()
      },
    },
  })

  try {
    const [owner, repo] = ref.repositoryNameWithOwner.split('/')
    const octokit = github.getOctokit(token)
    const { data: branchData } = await octokit.rest.repos.getBranch({
      owner,
      repo,
      branch: ref.branch,
    })
    const remoteSha = branchData.commit.sha

    if (localHead.trim() !== remoteSha) {
      core.warning(
        `Workspace HEAD (${localHead.trim()}) does not match remote branch HEAD (${remoteSha}). If this is a pull_request event, ensure actions/checkout used ref: github.event.pull_request.head.sha rather than the default merge ref.`,
      )
    }
  } catch (err) {
    core.debug(`Could not validate workspace HEAD against remote: ${err}`)
  }
}
