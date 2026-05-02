/** Represents a single file change to be committed */
export interface FileChange {
  /** Repository-relative path */
  path: string
  /** Base64-encoded file contents. Undefined means this is a deletion. */
  base64Content?: string
  /** True if this file should be deleted in the commit */
  deleted: boolean
}

/** Parsed commit message split into headline and optional body */
export interface CommitMessage {
  /** First line of the commit message */
  headline: string
  /** Remaining lines joined as the body, or undefined if single-line */
  body?: string
}

/** Resolved target branch and repository */
export interface TargetRef {
  /** Short branch name (e.g. "main", "feature/x") */
  branch: string
  /** Full repository name in owner/repo format */
  repositoryNameWithOwner: string
  /** Whether this is a fork PR (head repo differs from base repo) */
  isForkPR: boolean
}

/** Parsed and validated action inputs */
export interface ActionInputs {
  token: string
  message: CommitMessage
  /** Explicit ref override (empty string means auto-detect) */
  refOverride: string
  /** Glob patterns for filtering changed files (empty array means all changes) */
  filePatterns: string[]
  tagName?: string
  tagMessage?: string
  failOnEmpty: boolean
}

/** Result of a successful commit operation */
export interface CommitResult {
  commitSha: string
}

/** Result of a successful tag operation */
export interface TagResult {
  tagSha: string
}
