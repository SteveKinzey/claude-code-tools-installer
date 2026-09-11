# GitHub Actions Security Audit — 2026-09-11

> **Scope:** Every workflow in `.github/workflows/` on the `main` branch, its visible workflow configuration, package dependency scan results, and repository-level GitHub Actions settings available to the configured GitHub integration.

## Executive Summary

The audit reviewed nine existing GitHub Actions workflows and remediated the four actionable workflow risks found: mutable third-party action tags, checkout credential persistence, workflow-wide Pages write permissions, and a `workflow_run` trigger that executed repository scripts before the review could prove an isolated trust boundary. A new weekly locked-dependency and vulnerability scan now supplements the existing Dependabot policy and pull-request dependency review. All workflow actions are pinned to full commit SHAs, checkout credentials are disabled, sensitive values are scoped only to their consuming steps, and the Pages write and OIDC permissions are limited to the jobs that use them.

The local package audit found **zero known npm vulnerabilities** in both production-only and full dependency trees. GitHub Advanced Security alert lists could not be queried because the configured GitHub integration lacks the required alert-read scope. That limitation is recorded as **not assessed**, rather than treated as a clean alert state. The public repository’s default Actions token is read-only, which is appropriate; its `main` branch has no protection rule or ruleset, which remains the principal repository-level control gap.

## Audit Method

| Check | Result | Evidence |
|---|---|---|
| Workflow static analysis | Passed after remediation | `zizmor` scanned all workflow YAML files with no findings. |
| Action supply-chain integrity | Remediated | Every `uses:` reference is pinned to a reviewed 40-character Git commit SHA with a version comment. |
| Default token permissions | Passed | Repository Actions default workflow permission is `read`; pull-request approval is disabled. |
| Job and workflow permissions | Remediated | Pages write/OIDC permissions are job-scoped; release publishing remains limited to the release workflow. |
| Checkout credential persistence | Remediated | Every checkout step sets `persist-credentials: false`. |
| Secret value scanning | No values exposed in source | No credential values are present in workflows or scripts; secret references are named only. |
| npm production dependency scan | Passed | `npm audit --omit=dev` found 0 vulnerabilities. |
| npm full dependency scan | Passed | `npm audit` found 0 vulnerabilities. |
| Dependabot, code-scanning, and secret-scanning alert state | Not assessed | The GitHub integration returned HTTP 403 for alert-list endpoints. |

## Remediated Findings

### Mutable GitHub Action Tags

**Risk:** All workflow actions previously used mutable major-version tags, such as `actions/checkout@v6`. A compromised or retargeted tag could change the code executed by a future workflow run.

**Remediation:** Every GitHub-maintained action now uses a full commit SHA and a human-readable release comment. The repository Action policy is also configured to require full SHA pinning. Current reviewed revisions include `checkout` v6.1.0, `setup-node` v7.0.0, `upload-artifact` v7.0.1, `configure-pages` v6.0.0, `upload-pages-artifact` v5.0.0, `deploy-pages` v5.0.1, and `dependency-review-action` v5.0.0.

### Checkout Credential Persistence

**Risk:** `actions/checkout` stores the workflow token in the local Git configuration by default. A later command, action, artifact, or diagnostic could unintentionally persist or expose it.

**Remediation:** Every checkout step explicitly sets `persist-credentials: false`. Workflows that publish releases use an explicitly scoped `GH_TOKEN` only in the publishing step rather than relying on persisted Git credentials.

### Over-Broad Pages Permissions

**Risk:** The Field Guide workflow granted `pages: write` and `id-token: write` at workflow scope, so the content build job had deployment authority it did not need.

**Remediation:** The workflow default is now `contents: read`. Pages and OIDC write permissions are declared only on the build and deploy jobs that require the official Pages actions.

### `workflow_run` Health-Check Trigger

**Risk:** `workflow_run` workflows execute using the default branch definition and may receive a more privileged token or repository secrets. The health check subsequently ran checked-out repository scripts and could send an authenticated alert.

**Remediation:** The trigger was removed. Health checks now run by manual dispatch or the established Monday UTC schedule, so they execute the reviewed default-branch workflow directly without inheriting a prior workflow-run trust boundary.

### Automatic Tag-Triggered Signing

**Risk:** Every `v*` tag previously launched the macOS signing, notarization, and release-publishing workflow. A tag is source metadata, not proof that its build artifacts have passed the required release checks.

**Remediation:** The signing and publication workflow now runs only through manual dispatch against an existing, date-formatted tag. This separates creating a source-only changelog release from the privileged production-artifact path, which must be deliberately invoked after signed-artifact verification.

### Secret Scope

**Risk:** macOS signing/notarization and Microsoft Store identity values were available to entire jobs, including setup and validation steps that did not require them.

**Remediation:** Sensitive values are injected only into their consuming steps. The Store workflows retain their fixture mode and do not accept Partner Center identity values through dispatch inputs. The macOS release workflow writes temporary credential files inside `RUNNER_TEMP`, applies `chmod 600`, and deletes them in an `always()` cleanup step.

### Release Cache Poisoning

**Risk:** The macOS release job enabled the package-manager dependency cache while producing and publishing signed release artifacts.

**Remediation:** Package-manager caching is disabled for the release workflow. Locked dependencies are installed with `npm ci`.

## Automated Controls

| Control | Trigger | Failure behavior |
|---|---|---|
| Dependabot npm updates | Daily | Opens dependency and security pull requests against `main`. |
| Dependabot GitHub Actions updates | Weekly | Opens CI update pull requests against `main`. |
| Dependency review | Pull requests changing dependencies or workflows | Blocks new high-severity findings across development, runtime, and unknown scopes. |
| Weekly dependency and security scan | Monday at 08:23 UTC and manual dispatch | Installs the locked dependency graph without lifecycle scripts, validates the workflow security contract, runs `npm audit`, and retains the JSON report for 30 days. |
| Security contract | Local check and CI | Fails on unpinned workflow actions, persisted checkout credentials, invalid workflow permissions, unsafe triggers, or missing scheduled security scans. |
| GitHub secret scanning and push protection | Repository feature | Enabled according to repository metadata. |

## Remaining Owner Actions

| Priority | Control gap | Recommended owner action |
|---|---|---|
| High | `main` has no branch protection rule or ruleset. | Require pull requests, one approving review, passing dependency review, passing weekly scan when relevant, and prohibit force pushes/deletions. |
| High | GitHub alert endpoints were inaccessible to the configured integration. | Review Dependabot, code-scanning, and secret-scanning alert queues in repository Settings or grant alert-read capability to the auditing integration. |
| Medium | `msix-store-release` has no approval rule. | Before adding production Partner Center secrets, require a named reviewer and disable administrator bypass where operationally feasible. |
| Medium | macOS release secrets could not be inventoried through the configured integration. | Confirm the required signing secrets reside only in GitHub Actions secrets, rotate any secret exposed outside the approved secret manager, and use an environment with required reviewers for production releases. |
| Low | The npm tree contains deprecated transitive packages but no current audit finding. | Continue updating Electron/electron-builder release lines via reviewed Dependabot pull requests. |

## Verification Standard

Before creating a downloadable platform release, require a successful platform-specific package workflow, a matching SHA-256 asset, and the appropriate trust verification. A source-only changelog release must state that it does **not** introduce a new binary download and must not replace the latest verified artifact release.

## References

1. [GitHub secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
2. [GitHub Actions permissions API](https://docs.github.com/en/rest/actions/permissions)
3. [GitHub Pages custom workflow permissions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
4. [zizmor workflow security audits](https://docs.zizmor.sh/audits/)
