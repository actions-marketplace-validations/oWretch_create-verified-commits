import * as core from '@actions/core'
import { parseInputs } from './inputs'
import { resolveTargetRef, validateWorkspaceHead } from './ref'
import { discoverFiles } from './files'
import { runPreflightChecks } from './preflight'
import { createCommit } from './commit'
import { createTag } from './tag'

export async function run(): Promise<void> {
  try {
    // 1. Parse inputs
    core.info('Parsing action inputs...')
    const inputs = parseInputs()

    // 2. Resolve target ref
    core.info('Resolving target branch...')
    const ref = await resolveTargetRef(inputs.refOverride)
    core.info(`Target: ${ref.repositoryNameWithOwner}@${ref.branch}`)

    // 3. Validate workspace HEAD (advisory — warns but does not fail)
    await validateWorkspaceHead(ref, inputs.token)

    // 4. Discover changed files
    core.info('Discovering changed files...')
    const files = await discoverFiles(inputs.filePatterns)
    core.info(`Found ${files.length} changed file(s)`)

    // 5. Preflight checks (empty changeset, fork PR warnings, workflow file warnings)
    const shouldCommit = await runPreflightChecks(files, ref, inputs.failOnEmpty)

    if (!shouldCommit) {
      // Empty changeset with fail-on-empty:false — skip commit, set empty outputs
      core.setOutput('commit-sha', '')
      core.setOutput('tag-sha', '')
      core.setOutput('committed', 'false')
      return
    }

    // 6. Create the commit
    core.info(`Creating commit: "${inputs.message.headline}"`)
    const commitResult = await createCommit(inputs.token, ref, inputs.message, files)
    core.info(`Commit created: ${commitResult.commitSha}`)
    core.setOutput('commit-sha', commitResult.commitSha)
    core.setOutput('committed', 'true')

    // 7. Create tag (optional)
    if (inputs.tagName) {
      const tagMessage = inputs.tagMessage ?? inputs.message.headline
      core.info(`Creating tag: ${inputs.tagName}`)
      const tagResult = await createTag(
        inputs.token,
        ref.repositoryNameWithOwner,
        inputs.tagName,
        tagMessage,
        commitResult.commitSha,
      )
      core.info(`Tag created: ${inputs.tagName} → ${tagResult.tagSha}`)
      core.setOutput('tag-sha', tagResult.tagSha)
    } else {
      core.setOutput('tag-sha', '')
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed(`An unexpected error occurred: ${String(error)}`)
    }
  }
}

run()
