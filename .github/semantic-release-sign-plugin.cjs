'use strict'

// Semantic-release prepare plugin that creates a Verified (signed) release
// commit using this action itself, instead of a plain git commit.
//
// Runs after @semantic-release/npm has already updated package.json on disk.
// This plugin:
//   1. Rebuilds dist/ to bundle the updated package version
//   2. Uses the action binary to push a Verified commit via the GitHub
//      GraphQL API (signed by the configured GitHub App)
//   3. Syncs local HEAD to that new remote commit so @semantic-release/github
//      creates the version tag and GitHub release on the signed commit
//
// Required env var: RELEASE_APP_TOKEN — the GitHub App installation token.
// Set via the release workflow step's `env:` block.

const { execFileSync } = require('child_process')

async function prepare(_pluginConfig, context) {
  const { logger, cwd: releaseCwd, nextRelease } = context
  const cwd = releaseCwd || process.cwd()
  const token = process.env.RELEASE_APP_TOKEN

  if (!token) {
    throw new Error('RELEASE_APP_TOKEN environment variable is required')
  }

  logger.log('Rebuilding dist...')
  execFileSync('npm', ['run', 'build'], { cwd, stdio: 'inherit' })

  const commitMessage = `chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}`
  logger.log('Creating signed release commit via create-signed-commit...')
  execFileSync('node', ['dist/index.js'], {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      GITHUB_WORKSPACE: cwd,
      INPUT_TOKEN: token,
      'INPUT_COMMIT-MESSAGE': commitMessage,
      INPUT_FILES: 'package.json\ndist/index.js',
      INPUT_REF: 'refs/heads/main',
      'INPUT_FAIL-ON-EMPTY': 'false',
    },
  })

  logger.log('Syncing local HEAD to signed commit...')
  execFileSync('git', ['fetch', 'origin', 'main'], { cwd, stdio: 'inherit' })
  execFileSync('git', ['reset', '--hard', 'origin/main'], { cwd, stdio: 'inherit' })
}

module.exports = { prepare }
