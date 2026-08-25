# SSH + GitHub Pages Deployment Script

**Presenter:** Stephen J. Kinzey, Ph.D.  
**Brand:** SK America LLC  
**Length:** 12–15 minutes

## Slide 1 — Publish the Guide Without a Token in Git

**Time:** 1 minute

**Visual direction:** A secure SSH key icon points to GitHub; a separate GitHub Pages card points to the Field Guide website.

**Script:**

“This is a clean path from a local Field Guide package to a live GitHub Pages website. The goal is not just to push files. The goal is to publish the guide without putting a personal token into a Git remote, script, or repository. SSH handles local Git authentication. GitHub Actions handles Pages deployment.”

## Slide 2 — Start With the Boundary

**Time:** 1 minute

**Visual direction:** Highlight `docs/installation-guide/` inside a repository tree while installer scripts are greyed out.

**Script:**

“The Field Guide is an isolated documentation package. The website, PDF, assets, and README live under `docs/installation-guide`. The installer scripts and releases stay untouched. That is the first control: publishing content cannot accidentally become a runtime change.”

## Slide 3 — SSH Is the Local Push Mechanism

**Time:** 1 minute

**Visual direction:** A private key remains on a laptop; its public-key counterpart travels to GitHub.

**Script:**

“SSH uses a key pair. The private key stays on the machine. Only the public key is registered with GitHub. Once GitHub recognises the public key, Git can authenticate securely without prompting for a personal access token during every push.”

## Slide 4 — Create a Dedicated Key, Not a Shared Default

**Time:** 1.5 minutes

**Visual direction:** Terminal card with the key-generation command and a lock badge.

**Script:**

“For this workflow, we create a dedicated Ed25519 key named for the Field Guide workflow. We protect it with a passphrase, load it into the SSH agent, and never copy the private key outside the machine. The dedicated name matters because it allows this repository to use a precise identity without changing other GitHub repositories.”

**On-screen command:**

```bash
ssh-keygen -t ed25519 -C "YOUR_GITHUB_EMAIL" -f ~/.ssh/id_ed25519_claude_tools
```

## Slide 5 — Add the Public Key and Test It

**Time:** 1 minute

**Visual direction:** GitHub Settings → SSH and GPG keys → New SSH key, followed by a successful terminal greeting.

**Script:**

“We copy the contents of the `.pub` file—not the private key—into GitHub under SSH and GPG keys. Then we run an SSH test. A GitHub greeting confirms the key and GitHub account are connected. It does not change repository contents; it only verifies identity.”

## Slide 6 — Use a Repository-Specific Host Alias

**Time:** 1.5 minutes

**Visual direction:** `~/.ssh/config` card that maps `github-claude-tools` to the dedicated identity file.

**Script:**

“Instead of making this key the default for every GitHub repository, we use a host alias. The alias tells SSH: when this repository connects to `github-claude-tools`, use this exact private key. That prevents identity collisions and gives the repository an explicit, auditable authentication route.”

## Slide 7 — Verify Before Pushing

**Time:** 1.5 minutes

**Visual direction:** Five green checklist items: remote, SSH greeting, workflow, assets, installer boundary.

**Script:**

“Before a push, we run a read-only verifier. It confirms the origin remote is using the correct SSH alias. It checks the GitHub SSH greeting. It verifies that the Pages workflow targets the isolated site, that the static package contains no managed or preview-only assets, and that installer scripts and releases have not changed.”

## Slide 8 — The GitHub Pages Workflow

**Time:** 1.5 minutes

**Visual direction:** Three connected stages: checkout → artifact → deploy.

**Script:**

“The Pages workflow is narrowly scoped. A documentation push starts the workflow. It checks out the repository, prepares the Pages artifact from `docs/installation-guide/site`, copies the PDF into the downloadable location, and deploys through the GitHub Pages action. The workflow does not publish the rest of the repository.”

## Slide 9 — Manual Dispatch Is a Controlled Test

**Time:** 1 minute

**Visual direction:** Toggle labelled `DISPATCH=1` leading to the same deploy workflow.

**Script:**

“Normally, the workflow runs when the guide or its workflow file changes on `main`. If we need a controlled test after the code is already pushed, the verifier can manually dispatch the workflow. That gives us a repeatable way to test deployment without creating a meaningless content commit.”

## Slide 10 — Verify the Live Deliverables

**Time:** 1 minute

**Visual direction:** Browser request checks for the site home page and PDF download endpoint.

**Script:**

“A workflow that says ‘success’ is not the final check. The verifier waits for the matching Actions run, then confirms the public site URL responds and the PDF download resolves. This is the difference between a deployment event and a usable publishing outcome.”

## Slide 11 — The Expected Outcome

**Time:** 1 minute

**Visual direction:** URL card: `stevekinzey.github.io/claude-code-tools-installer/`, plus a PDF download button.

**Script:**

“The published result is a versioned Field Guide with a stable GitHub Pages address and a downloadable PDF. The repository remains the system of record. The guide becomes a reusable distribution layer for workshops, social content, and support.”

## Slide 12 — Operating Rule: Verify, Then Publish

**Time:** 1 minute

**Visual direction:** Three pillars: Isolate, Authenticate, Verify.

**Script:**

“The operating rule is straightforward. Isolate the documentation. Authenticate with a dedicated SSH key. Verify the remote, the workflow, the static assets, and the installer boundary. Then publish. The process is designed to be repeatable, not heroic.”

## Closing Q&A

| Question | Response |
|---|---|
| “Do I still need a token?” | “Not for Git pushes if SSH is configured. A token is only needed if you want to configure GitHub Pages through the REST API or other API-driven administration.” |
| “Can the SSH key access all repositories?” | “The key authenticates as the GitHub account. Repository access still follows that account’s permissions. The host alias simply ensures this repository uses the intended local key.” |
| “What if the workflow runs but the URL fails?” | “Use the deployment verifier. It checks the workflow run, the site response, and the PDF response separately, which narrows the fault quickly.” |
