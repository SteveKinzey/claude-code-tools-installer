# GitHub Publishing Alternatives and Verified Token Scopes

## Recommended choice

For this repository, use **SSH** for interactive local pushes from `~/code/claude-code-tools-installer/`. It avoids an HTTPS personal access token for Git transport. Use a **fine-grained personal access token** only when you also need to configure the GitHub Pages site through the REST API.

> Never place a token in a Git remote URL, commit, shell script, chat message, or tracked repository file. Never upload or share an SSH private key.

## Option A — SSH key for Git push

GitHub supports Ed25519 keys for SSH authentication. Generate a dedicated key locally, add only its **public** half to your GitHub account, verify the SSH connection, then replace the repository remote. [1]

```bash
cd ~/code/claude-code-tools-installer

mkdir -p ~/.ssh
ssh-keygen -t ed25519 -C "YOUR_GITHUB_EMAIL" -f ~/.ssh/id_ed25519_field_guide
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519_field_guide
cat ~/.ssh/id_ed25519_field_guide.pub
```

Copy the public key printed by the final command. In GitHub, open **Profile photo → Settings → SSH and GPG keys → New SSH key**, choose **Authentication Key**, paste the public key, and save it.

Then test and push the prepared commits:

```bash
ssh -T git@github.com
git remote set-url origin git@github.com:SteveKinzey/claude-code-tools-installer.git
git remote -v

git diff --exit-code origin/main..HEAD -- \
  setup-my-claude.sh \
  setup-my-claude-linux.sh \
  setup-my-claude.ps1 \
  releases

git push origin main
```

The scoped `git diff` must be silent. A successful SSH test identifies the GitHub account associated with the key; it does not grant more repository rights than that account already has. [1]

## Option B — HTTPS with a fine-grained personal access token

Create a token under **Profile photo → Settings → Developer settings → Personal access tokens → Fine-grained tokens**. Select **Resource owner: SteveKinzey** and **Only select repositories: claude-code-tools-installer**. GitHub recommends restricting fine-grained tokens to only the owner, repositories, and permissions the task requires. [2]

| Needed action | Fine-grained repository permission |
|---|---|
| Push `docs/installation-guide/**` | **Contents: Read and write** |
| Push `.github/workflows/deploy-field-guide-pages.yml` | **Workflows: Write** in addition to Contents write |
| Create or update the GitHub Pages site through the REST API | **Pages: Read and write** and **Administration: Read and write** |
| Inspect a Pages site/build only | **Pages: Read** |

GitHub’s REST reference states that **Pages: write** plus **Administration: write** are required to create or update a Pages site. [3] The Actions workflow itself uses its scoped `GITHUB_TOKEN` with `pages: write` and `id-token: write` at deployment time; it does not need your personal token embedded in the workflow. [4]

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

git remote set-url origin https://github.com/SteveKinzey/claude-code-tools-installer.git
git push origin main
```

## Enable and verify GitHub Pages after the push

Open **Repository → Settings → Pages** and choose **GitHub Actions** as the publishing source. The prepared workflow uploads only `docs/installation-guide/site`, copies the PDF into the artifact, and deploys through `actions/deploy-pages`. GitHub documents this build/upload/deploy pattern for custom Pages workflows. [4]

After the workflow succeeds, the expected address is:

`https://stevekinzey.github.io/claude-code-tools-installer/`

## Prepared local commits

The local `main` branch is three commits ahead of `origin/main`:

| Commit | Purpose |
|---|---|
| `dab13b0` | Adds the isolated Field Guide static site, local assets, README, and PDF. |
| `5f621d6` | Adds the GitHub Pages deployment workflow. |
| `4d8acf9` | Makes asset references subpath-safe and removes preview-only instrumentation. |

## References

[1] [GitHub Docs — Generating a new SSH key and adding it to the ssh-agent](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent)

[2] [GitHub Docs — Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

[3] [GitHub Docs — REST API endpoints for GitHub Pages](https://docs.github.com/en/rest/pages/pages#create-a-github-pages-site)

[4] [GitHub Docs — Using custom workflows with GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
