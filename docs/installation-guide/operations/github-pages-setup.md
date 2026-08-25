# GitHub Pages Setup: Claude Code Tools Installer Field Guide

## Intended public URL

Once the Pages workflow is enabled and the documentation commit is pushed to `main`, the Field Guide will be served from:

`https://stevekinzey.github.io/claude-code-tools-installer/`

This replaces the Manus-hosted URL for the GitHub-hosted version. The repository URL remains the source-code location; GitHub Pages is the public web address.

## Why the current integration cannot publish

The connected credentials can read repository metadata but returned **403 Resource not accessible by integration** when attempting both a Git push and GitHub Pages API configuration. The repository package and deployment workflow are prepared locally, but the credentials do not currently have effective write access for this repository.

> A GitHub token can never grant more access than its owner already has. Fine-grained tokens should be limited to one owner, selected repositories, and only the permissions required for the task. [1]

## Create a repository-scoped fine-grained token

In GitHub, open **Profile photo → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**. GitHub documents this creation flow and recommends fine-grained tokens when they support the required task. [1]

Use these values:

| Token setting | Required value |
|---|---|
| Token name | `field-guide-pages-publisher` |
| Resource owner | `SteveKinzey` |
| Expiration | 30 or 90 days; rotate before expiration |
| Repository access | **Only select repositories** → `claude-code-tools-installer` |
| Contents | **Read and write** — pushes the documentation package |
| Workflows | **Write** — commits the Pages workflow under `.github/workflows/` |
| Pages | **Read and write** — configures and reads the Pages site through the API |
| Administration | **Read and write** — enables the repository Pages site when required by the Pages configuration endpoint |
| Metadata | Read; added automatically by GitHub |

Do **not** use the token in a repository URL, source file, workflow file, chat, or commit. Treat it like a password. [1]

## Authenticate GitHub CLI securely

Run the following on your own machine or in the terminal holding the prepared repository workspace. The shell prompt accepts the token without embedding it in command history.

```bash
cd /path/to/claude-code-tools-installer

gh auth logout --hostname github.com
read -rsp "Paste the fine-grained GitHub token: " FGH_TOKEN
echo
printf '%s' "$FGH_TOKEN" | gh auth login --hostname github.com --git-protocol https --with-token
unset FGH_TOKEN
gh auth setup-git
gh auth status
```

The final status should show `github.com` with the intended account as active. If an environment variable such as `GH_TOKEN` is set to an older credential, clear it in the terminal before pushing:

```bash
unset GH_TOKEN GITHUB_TOKEN
```

## Push the prepared documentation and Pages workflow

The prepared local repository workspace is:

`/home/ubuntu/claude-code-tools-installer-live-publish`

It contains a docs-only commit, `dab13b0`, with the static Field Guide, local assets, PDF, README, and the Pages workflow. Before pushing, verify that no installer or release files appear in the commit.

```bash
cd /home/ubuntu/claude-code-tools-installer-live-publish

git show --stat --oneline --summary dab13b0
git diff --exit-code dab13b0^ dab13b0 -- \
  setup-my-claude.sh \
  setup-my-claude-linux.sh \
  setup-my-claude.ps1 \
  releases

git push origin dab13b0:main
```

The scoped `git diff` command should return no output. If it does not, stop and inspect the unexpected path before pushing.

## Enable GitHub Pages with GitHub Actions

After the commit is on `main`, open the repository on GitHub and go to **Settings → Pages**. Under **Build and deployment**, set **Source** to **GitHub Actions**. GitHub supports either a branch source or a custom GitHub Actions workflow; this setup uses the custom workflow because the static site lives in an isolated nested documentation directory. [2]

The prepared workflow is:

`/.github/workflows/deploy-field-guide-pages.yml`

It deploys only:

`docs/installation-guide/site`

It does not package, execute, or modify installer scripts. GitHub’s documented Actions flow checks out the repository, uploads the static files as a Pages artifact, and deploys that artifact with `actions/deploy-pages`. [2]

## Verify the deployment

```bash
gh run list --repo SteveKinzey/claude-code-tools-installer --workflow deploy-field-guide-pages.yml
gh api repos/SteveKinzey/claude-code-tools-installer/pages
```

When the workflow succeeds, open:

`https://stevekinzey.github.io/claude-code-tools-installer/`

Confirm that the main guide, local images, and PDF download link all load. GitHub Pages sites are public on the internet, so do not put secrets or private installation records in the published directory. [2]

## References

[1] [GitHub Docs — Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

[2] [GitHub Docs — Configuring a publishing source for your GitHub Pages site](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
