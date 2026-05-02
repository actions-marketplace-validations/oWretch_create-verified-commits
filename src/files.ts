import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as fs from 'fs'
import { minimatch } from 'minimatch'
import type { FileChange } from './types'

interface RawFileStatus {
  path: string
  statusCode: string
  deleted: boolean
  unsupported: boolean
  unsupportedReason?: string
}

async function runGitStatus(): Promise<RawFileStatus[]> {
  const result = await exec.getExecOutput(
    'git',
    ['status', '--porcelain=v1', '-z', '--no-renames'],
    {
      ignoreReturnCode: false,
      silent: true,
    },
  )

  const entries = result.stdout.split('\0').filter((e) => e.length > 0)

  return entries
    .map((entry): RawFileStatus => {
      const statusCode = entry.slice(0, 2)
      const filePath = entry.slice(3)

      // Skip ignored files
      if (statusCode.startsWith('!')) {
        return {
          path: filePath,
          statusCode,
          deleted: false,
          unsupported: true,
          unsupportedReason: 'ignored',
        }
      }

      // Untracked
      if (statusCode === '??') {
        return { path: filePath, statusCode, deleted: false, unsupported: false }
      }

      // Deleted
      if (statusCode === 'D ' || statusCode === ' D') {
        return { path: filePath, statusCode, deleted: true, unsupported: false }
      }

      // Added to index
      if (statusCode === 'A ') {
        return { path: filePath, statusCode, deleted: false, unsupported: false }
      }

      // Modified (any combination)
      if (statusCode === 'M ' || statusCode === ' M' || statusCode === 'MM') {
        return { path: filePath, statusCode, deleted: false, unsupported: false }
      }

      // Type change (possible symlink)
      if (statusCode === 'T ' || statusCode === ' T') {
        return {
          path: filePath,
          statusCode,
          deleted: false,
          unsupported: true,
          unsupportedReason: 'type change (possible symlink)',
        }
      }

      // Unknown status — warn and skip
      core.warning(`Skipping file with unknown git status '${statusCode}': ${filePath}`)
      return {
        path: filePath,
        statusCode,
        deleted: false,
        unsupported: true,
        unsupportedReason: `unknown status '${statusCode}'`,
      }
    })
    .filter((entry) => {
      // Belt-and-suspenders: check for symlinks on non-deleted, non-unsupported files
      if (!entry.unsupported && !entry.deleted) {
        try {
          if (fs.lstatSync(entry.path).isSymbolicLink()) {
            entry.unsupported = true
            entry.unsupportedReason = 'type change (possible symlink)'
          }
        } catch {
          // File may not exist on disk yet in some edge cases; skip lstat check
        }
      }
      return true
    })
}

async function readFileAsBase64(filePath: string): Promise<string> {
  const contents = await fs.promises.readFile(filePath)
  return contents.toString('base64')
}

/**
 * Discovers changed files in the workspace using git status.
 * If filePatterns is non-empty, only files matching at least one pattern are included.
 * Returns structured FileChange objects ready for the GraphQL mutation.
 */
export async function discoverFiles(filePatterns: string[]): Promise<FileChange[]> {
  const rawStatuses = await runGitStatus()

  // Warn about and filter out unsupported entries
  const supported = rawStatuses.filter((entry) => {
    if (entry.unsupported) {
      // Don't warn for silently-ignored files
      if (entry.unsupportedReason !== 'ignored') {
        core.warning(`Skipping unsupported file: ${entry.path} (${entry.unsupportedReason})`)
      }
      return false
    }
    return true
  })

  // Apply pattern filtering if patterns are provided
  let filtered = supported
  if (filePatterns.length > 0) {
    filtered = supported.filter((entry) =>
      filePatterns.some((pattern) => minimatch(entry.path, pattern, { dot: true })),
    )

    if (filtered.length === 0) {
      core.info(`No changed files matched the provided patterns: ${filePatterns.join(', ')}`)
      return []
    }
  }

  // Build FileChange objects
  const fileChanges: FileChange[] = await Promise.all(
    filtered.map(async (entry): Promise<FileChange> => {
      if (entry.deleted) {
        return { path: entry.path, deleted: true }
      }
      const base64Content = await readFileAsBase64(entry.path)
      return { path: entry.path, base64Content, deleted: false }
    }),
  )

  return fileChanges
}
