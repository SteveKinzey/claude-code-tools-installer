# GitHub authentication and docs-only push runbook

Use either a fine-grained personal access token over HTTPS or a dedicated SSH key. Prefer SSH for interactive local Git publishing when the user controls the repository account. Use a fine-grained token for API configuration and automated command-line workflows.

## Permission matrix for a fine-grained token

Limit the token to the target repository and select only the permissions required for the intended operation. Metadata read is added automatically.

| Operation | Repository permission |
|---|---|
| Push static documentation files | Contents: write |
| Push a file under `.github/workflows/` | Contents: write; Workflows: write |
| Create or update the GitHub Pages site through REST | Pages: write; Administration: write |
| Read a Pages site or build status | Pages: read |

Do not add unnecessary Actions, Secrets, Pull requests, or organization permissions. The GitHub Pages workflow’s own deploy job uses `GITHUB_TOKEN` with `pages: write` and `id-token: write`; do not place a personal token in the workflow.

## HTTPS with a fine-grained token

Create a token under **GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens**. Select the repository explicitly. Keep the token out of source files, remote URLs, shell history, chat, and commits.

```bash
cd ~/code/claude-code-tools-installer

unset GH_TOKEN GITHUB_TOKEN
gh auth logout --hostname github.com
read -rsp "Paste the fine-grained GitHub token: " FGH_TOKEN
echo
printf '%s' "$FGH_TOKEN" | gh auth login --hostname github.com --git-protocol https --with-token
unset FGH_TOKEN
gh auth setup-git
gh auth status

git remote set-url origin https://github.com/OWNER/REPOSITORY.git
git push origin main
```

## SSH key alternative

Generate a dedicated Ed25519 key and protect it with a passphrase. Never share, upload, or attach the private key file.

```bash
mkdir -p ~/.ssh
ssh-keygen -t ed25519 -C "your_github_email@example.com" -f ~/.ssh/id_ed25519_field_guide
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519_field_guide
cat ~/.ssh/id_ed25519_field_guide.pub
```

Copy only the displayed public key. In GitHub, open **Settings → SSH and GPG keys → New SSH key**, choose an authentication key, paste the public key, and save it. Then verify and switch the remote:

```bash
ssh -T git@github.com
cd ~/code/claude-code-tools-installer
git remote set-url origin git@github.com:OWNER/REPOSITORY.git
git remote -v
git push origin main
```

If `main` is branch-protected, push a documentation branch instead and open a pull request:

```bash
git push origin HEAD:docs/installation-guide
```

## Final boundary check

Before any push, confirm that only documentation and approved workflow paths are ahead of the remote branch:

```bash
git diff --name-only origin/main..HEAD
git diff --exit-code origin/main..HEAD -- \
  setup-my-claude.sh \
  setup-my-claude-linux.sh \
  setup-my-claude.ps1 \
  releases
```

The scoped `git diff` must be silent. After two distinct credential remediation attempts fail, stop. Keep the local commit intact and request an authorized key or token; never change installer behavior to work around a GitHub authorization error.
