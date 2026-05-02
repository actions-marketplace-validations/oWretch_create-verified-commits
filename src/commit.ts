import * as core from '@actions/core'
import * as github from '@actions/github'
import type { CommitMessage, CommitResult, FileChange, TargetRef } from './types'

const GET_BRANCH_HEAD_OID = `
  query GetBranchHeadOid($owner: String!, $repo: String!, $branch: String!) {
    repository(owner: $owner, name: $repo) {
      ref(qualifiedName: $branch) {
        target {
          oid
        }
      }
    }
  }
`

const CREATE_COMMIT_MUTATION = `
  mutation CreateCommit($input: CreateCommitOnBranchInput!) {
    createCommitOnBranch(input: $input) {
      commit {
        oid
        url
      }
    }
  }
`

function isRetryable(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('rate limit') || msg.includes('secondary rate')) return true
    if (msg.includes('etimedout') || msg.includes('econnreset')) return true
  }
  const status = (error as { status?: number }).status
  if (status === 429 || (status !== undefined && status >= 500)) return true
  return false
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (!isRetryable(error) || attempt === maxAttempts) throw error
      const delayMs = Math.pow(2, attempt - 1) * 1000
      core.debug(`Attempt ${attempt} failed, retrying in ${delayMs}ms: ${String(error)}`)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw lastError
}

export async function createCommit(
  token: string,
  ref: TargetRef,
  message: CommitMessage,
  files: FileChange[],
): Promise<CommitResult> {
  const [owner, repo] = ref.repositoryNameWithOwner.split('/')

  const octokit = github.getOctokit(token)

  // Fetch the current HEAD OID of the target branch
  const headData = await withRetry(() =>
    octokit.graphql<{ repository: { ref: { target: { oid: string } } | null } | null }>(
      GET_BRANCH_HEAD_OID,
      { owner, repo, branch: ref.branch },
    ),
  )

  if (!headData.repository?.ref) {
    throw new Error(`Branch "${ref.branch}" not found in ${ref.repositoryNameWithOwner}`)
  }

  const headOid = headData.repository.ref.target.oid

  const input = {
    branch: {
      repositoryNameWithOwner: ref.repositoryNameWithOwner,
      branchName: ref.branch,
    },
    message: {
      headline: message.headline,
      body: message.body,
    },
    fileChanges: {
      additions: files
        .filter((f) => !f.deleted)
        .map((f) => ({ path: f.path, contents: f.base64Content })),
      deletions: files.filter((f) => f.deleted).map((f) => ({ path: f.path })),
    },
    expectedHeadOid: headOid,
  }

  try {
    const result = await withRetry(() =>
      octokit.graphql<{ createCommitOnBranch: { commit: { oid: string; url: string } } }>(
        CREATE_COMMIT_MUTATION,
        { input },
      ),
    )
    const commitOid = result.createCommitOnBranch.commit.oid
    core.info('Created commit: ' + commitOid)
    return { commitSha: commitOid }
  } catch (error) {
    const msg = String(error)
    if (msg.includes('Expected head to be') || msg.includes('expectedHeadOid')) {
      throw new Error(
        'Commit conflict: the branch was updated by another push after this workflow started. Re-run the workflow to retry.',
      )
    }
    if (msg.includes('NOT_FOUND')) {
      throw new Error(
        `Repository or branch not found. Check token permissions (contents: write) and that branch "${ref.branch}" exists.`,
      )
    }
    throw error
  }
}
