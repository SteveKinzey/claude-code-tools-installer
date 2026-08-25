# SSH-only Git publishing

Use this reference when HTTPS credentials fail or when the repository owner wants SSH-only local Git publishing. This configures an SSH key for Git transport only; it does not create or modify a GitHub Pages site through the REST API.

## Safety rules

- Create a dedicated Ed25519 key with a passphrase.
- Add only the `.pub` file contents to GitHub.
- Never upload, attach, copy into chat, or commit the private key.
- Use a repository-specific SSH host alias to avoid changing other GitHub repositories on the machine.

## Create and register the key

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
ssh-keygen -t ed25519 -C "your_github_email@example.com" -f ~/.ssh/id_ed25519_claude_tools
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519_claude_tools
cat ~/.ssh/id_ed25519_claude_tools.pub
```

Copy only the public key shown by the last command. In GitHub, go to **Settings → SSH and GPG keys → New SSH key**, select **Authentication Key**, paste it, and save. See GitHub’s SSH key guidance: https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent

## Restrict the key to this repository’s remote

Create or append the following block to `~/.ssh/config`:

```text
Host github-claude-tools
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_claude_tools
  IdentitiesOnly yes
```

Then set strict permissions and test the intended identity:

```bash
chmod 600 ~/.ssh/config
ssh -T git@github-claude-tools
```

GitHub should identify the account associated with the key. The greeting verifies authentication; it does not change repository contents.

## Switch and push the Field Guide repository

```bash
cd ~/code/claude-code-tools-installer
git remote set-url origin git@github-claude-tools:SteveKinzey/claude-code-tools-installer.git
git remote -v

git diff --name-only origin/main..HEAD
git diff --exit-code origin/main..HEAD -- \
  setup-my-claude.sh \
  setup-my-claude-linux.sh \
  setup-my-claude.ps1 \
  releases

git push origin main
```

The scoped `git diff` must be silent. If branch protection blocks direct writes, push the exact current branch to a documentation branch and open a pull request:

```bash
git push origin HEAD:docs/installation-guide
```

## Verify

```bash
git fetch origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" && echo "Remote main matches local HEAD"
```

Do not generate a second key or retry a denied push until the GitHub account associated with the registered key has confirmed repository write access.
