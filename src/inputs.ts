import * as core from '@actions/core'
import type { ActionInputs, CommitMessage } from './types'

export function parseInputs(): ActionInputs {
  const token = core.getInput('token', { required: true })
  const rawMessage = core.getInput('commit-message', { required: true })
  const message = parseCommitMessage(rawMessage)

  const refOverride = core.getInput('ref').trim()

  const rawFiles = core.getInput('files')
  const filePatterns = parseFilePatterns(rawFiles)

  const tagNameRaw = core.getInput('tag-name').trim()
  const tagName = tagNameRaw || undefined

  const tagMessageRaw = core.getInput('tag-message').trim()
  const tagMessage = tagMessageRaw || undefined

  const failOnEmpty = core.getBooleanInput('fail-on-empty')

  return {
    token,
    message,
    refOverride,
    filePatterns,
    tagName,
    tagMessage,
    failOnEmpty,
  }
}

function parseCommitMessage(raw: string): CommitMessage {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new Error('commit-message must not be empty')
  }

  const lines = trimmed.split('\n')
  const headlineIndex = lines.findIndex((l) => l.trim() !== '')
  if (headlineIndex === -1) {
    throw new Error('commit-message must not be empty')
  }

  const headline = lines[headlineIndex].trim()
  const remaining = lines.slice(headlineIndex + 1)

  // Trim leading and trailing blank lines from body
  let start = 0
  while (start < remaining.length && remaining[start].trim() === '') {
    start++
  }
  let end = remaining.length - 1
  while (end >= start && remaining[end].trim() === '') {
    end--
  }

  const bodyLines = remaining.slice(start, end + 1)
  const body = bodyLines.length > 0 ? bodyLines.join('\n') : undefined

  return { headline, body }
}

function parseFilePatterns(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}
