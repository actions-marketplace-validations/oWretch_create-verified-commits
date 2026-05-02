# Security Policy

## Reporting Vulnerabilities

Please report security vulnerabilities using [GitHub private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) for this repository. Do not open a public issue for security concerns.

## Token Handling

The `token` input is used exclusively for authenticated GitHub API calls within this action. It is:

- **Never logged** or included in step outputs
- **Never transmitted** to any third-party service
- Used only for the `createCommitOnBranch` GraphQL mutation and (when creating tags) the Git Data REST API

**Minimum required scope:** `contents: write`. Add `workflows: write` only when committing files under `.github/workflows/`.

**Prefer short-lived tokens:**

- `GITHUB_TOKEN` — expires automatically at the end of the workflow run
- GitHub App installation tokens — expire after 1 hour

## Commit Verification

Commits created by this action are verified and signed by GitHub using the authenticated identity:

- **`GITHUB_TOKEN`** → commits appear as `github-actions[bot]`, verified by GitHub
- **Custom GitHub App token** → commits appear as `your-app[bot]`, verified by GitHub

### Tags

Tags created by this action are **unsigned** annotated tag objects. The GitHub API does not support creating cryptographically signed tags. For supply chain integrity, pair tags created by this action with [GitHub immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases), which provide cryptographic attestations.

## Least Privilege

Grant only the permissions this action requires:

```yaml
permissions:
  contents: write # required for all usage


  # Add only when committing files under .github/workflows/:
  # workflows: write
```

Avoid granting `actions: write`, `admin`, or other elevated permissions unless required by other steps in the same job.

## Fork PR Warning

`GITHUB_TOKEN` is granted **read-only** access to fork repositories. Using this action on a pull request from a fork with `GITHUB_TOKEN` will fail. If you need to commit to a fork PR branch, use a GitHub App installation token that has been explicitly granted write access to the target repository.

## Supply Chain Integrity

### Pinning this action

Pin to a specific release version for reproducible builds:

```yaml
- uses: oWretch/create-signed-commit@v1.0.0
```

This action uses **immutable releases** — there are no floating `@v1` major-version tags. To receive updates automatically, enable Dependabot for GitHub Actions in your repository (see the [Versioning and updates](../README.md#versioning-and-updates) section of the README).

### Releases

Releases of this action use annotated tags. Pair them with [GitHub immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases) to obtain cryptographic attestations that can be verified with the GitHub CLI:

```bash
gh attestation verify --owner oWretch <artifact>
```
