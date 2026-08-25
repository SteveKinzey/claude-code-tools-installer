# SSH Setup for `claude-code-tools-installer`

This guide configures a **dedicated SSH key** for pushing the prepared Field Guide and GitHub Pages commits from:

```text
~/code/claude-code-tools-installer
```

It does **not** use a personal access token for Git pushes. You will add only the **public** key to GitHub; the private key must remain only on your machine.

## Step 1 — Create a dedicated Ed25519 key

Run the following in your own terminal. Replace the placeholder email with the email address on your GitHub account.

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
ssh-keygen -t ed25519 -C "YOUR_GITHUB_EMAIL" -f ~/.ssh/id_ed25519_claude_tools
```

When prompted, set a strong passphrase. GitHub recommends Ed25519 for a new SSH key when your system supports it. [1]

## Step 2 — Load the key into the SSH agent

```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519_claude_tools
```

Check that the agent has the intended key:

```bash
ssh-add -l
```

## Step 3 — Add only the public key to GitHub

Display the public key:

```bash
cat ~/.ssh/id_ed25519_claude_tools.pub
```

Copy the full single line, beginning with `ssh-ed25519`. Then, in GitHub:

1. Select your profile photo.
2. Open **Settings**.
3. Select **SSH and GPG keys**.
4. Select **New SSH key**.
5. Choose **Authentication Key**.
6. Use a recognisable title such as `Claude Tools local publishing`.
7. Paste the public key and select **Add SSH key**.

> Do **not** copy `~/.ssh/id_ed25519_claude_tools`. That file is private. Only the `.pub` file belongs in GitHub. [2]

## Step 4 — Keep this key scoped to this repository remote

Append this block to `~/.ssh/config`:

```bash
cat >> ~/.ssh/config <<'EOF'

Host github-claude-tools
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_claude_tools
  IdentitiesOnly yes
EOF

chmod 600 ~/.ssh/config
```

This creates a local alias that uses the new key for this repository, without changing GitHub authentication for your other repositories.

## Step 5 — Test SSH before changing Git

```bash
ssh -T git@github-claude-tools
```

GitHub should display a greeting naming the authenticated account. A message that GitHub does not provide shell access is normal; it means authentication succeeded. [3]

## Step 6 — Point this repository at the SSH remote

```bash
cd ~/code/claude-code-tools-installer
git remote set-url origin git@github-claude-tools:SteveKinzey/claude-code-tools-installer.git
git remote -v
```

The remote should now read:

```text
git@github-claude-tools:SteveKinzey/claude-code-tools-installer.git
```

## Step 7 — Verify the three prepared commits are documentation-only

```bash
git log --oneline origin/main..HEAD
git diff --name-only origin/main..HEAD
git diff --exit-code origin/main..HEAD -- \
  setup-my-claude.sh \
  setup-my-claude-linux.sh \
  setup-my-claude.ps1 \
  releases
```

The final command must be silent. The prepared local commits are:

| Commit | Content |
|---|---|
| `dab13b0` | Isolated Field Guide site, assets, README, and PDF |
| `5f621d6` | GitHub Pages deployment workflow |
| `4d8acf9` | GitHub Pages subpath and preview-path fixes |

## Step 8 — Push the commits

```bash
git push origin main
```

If the repository’s `main` branch requires a pull request, push a documentation branch instead:

```bash
git push origin HEAD:docs/installation-guide
```

## Step 9 — Verify the remote state

```bash
git fetch origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" \
  && echo "Remote main matches local HEAD"
```

After the push, enable **GitHub Actions** as the repository’s Pages source under **Settings → Pages**. The workflow deploys only `docs/installation-guide/site` and copies the downloadable PDF into the published artifact. The expected URL is:

```text
https://stevekinzey.github.io/claude-code-tools-installer/
```

## Troubleshooting

| Symptom | Likely cause | Corrective action |
|---|---|---|
| `Permission denied (publickey)` | The key was not added to GitHub, the wrong key is being offered, or the SSH agent has no key. | Repeat Steps 2–5; run `ssh -vT git@github-claude-tools` to see which identity is offered. |
| GitHub greets the wrong account | A different key is being selected. | Verify the `Host github-claude-tools` configuration and run `ssh-add -D`, then reload only the intended key. |
| Push is denied after SSH authentication succeeds | The authenticated account lacks write access or branch protection blocks direct pushes. | Confirm repository access for the GitHub account; use the documentation branch command in Step 8 if required. |
| Pages does not deploy | Pages is not configured to use GitHub Actions, or the workflow did not run. | Open **Actions**, inspect `Deploy Field Guide to GitHub Pages`, then set **Settings → Pages → GitHub Actions**. |

## References

[1] [GitHub Docs — Generating a new SSH key and adding it to the ssh-agent](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent)

[2] [GitHub Docs — Adding a new SSH key to your GitHub account](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/adding-a-new-ssh-key-to-your-github-account)

[3] [GitHub Docs — Testing your SSH connection](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/testing-your-ssh-connection)
