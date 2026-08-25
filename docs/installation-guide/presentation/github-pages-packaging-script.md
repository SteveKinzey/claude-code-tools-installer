# GitHub Pages + Field Guide Packaging: Presentation Script

**Presenter:** Stephen J. Kinzey, Ph.D.  
**Brand:** SK America LLC  
**Format:** 12 slides; approximately 18 minutes plus questions

## Slide 1 — Publish the Guide Without Touching the Installer

**Time:** 1 minute

**Visual:** Split-screen: the installation guide on one side and a protected installer terminal on the other.

**Script:**

“This workflow solves a simple business problem: how do we publish a polished installation guide, a downloadable PDF, and supporting visuals from the same repository without creating risk for the installer itself? The answer is separation. The application stays where it is. The guide becomes a self-contained documentation package. GitHub Pages publishes only that package.”

## Slide 2 — The Boundary Is the Product Decision

**Time:** 1.5 minutes

**Visual:** A repository tree with `docs/installation-guide/` highlighted and installer scripts muted.

**Script:**

“The key design decision is the boundary. We do not place guide assets beside runtime logic. We keep them under `docs/installation-guide/`, then we validate every commit against the installer scripts and release directory. That prevents a content or design update from becoming an installation regression.”

> “A guide release should be able to move independently of a product release.”

## Slide 3 — The Documentation Package

**Time:** 1.5 minutes

**Visual:** The directory structure below rendered as a clean vertical tree.

```text
docs/installation-guide/
├── README.md
├── site/
│   ├── index.html
│   └── assets/
└── downloads/
    └── claude-code-tools-installer-guide-2026.pdf
```

**Script:**

“The package has three jobs. The README explains that this is documentation only. The `site` directory contains the static experience GitHub Pages serves. The `downloads` directory holds the validated PDF. This structure is explicit enough to review quickly and portable enough to archive or move later.”

## Slide 4 — Treat the Website as the Canonical Guide

**Time:** 1 minute

**Visual:** Website page flowing into PDF pages, then into repository documentation.

**Script:**

“The live guide is the canonical design and content source. We render its static output, make all assets local, and create the PDF from that version. This avoids drift where the website says one thing, the PDF says another, and the repository stores a third version.”

## Slide 5 — Make Static Assets Repository-Safe

**Time:** 1.5 minutes

**Visual:** Red callout around `/manus-storage/` and root-relative `/assets/`; green callout around `./assets/`.

**Script:**

“Hosted preview links are not deployment assets. Before packaging, replace managed or expiring URLs with local files and switch root-relative paths to relative paths. GitHub Pages serves a project site below a repository subpath, so `/assets` is wrong here; `./assets` is portable. We also remove preview-only instrumentation before release.”

## Slide 6 — Validate Before You Stage

**Time:** 1.5 minutes

**Visual:** A three-gate flow: assets, PDF, installer boundary.

**Script:**

“We validate three things before staging. First, there are no managed URLs or preview artifacts. Second, the published PDF matches the reviewed PDF. Third, a scoped Git diff confirms that installer scripts and releases have no changes. If any gate fails, the documentation package is not ready to publish.”

## Slide 7 — GitHub Pages Workflow: Build, Upload, Deploy

**Time:** 2 minutes

**Visual:** Three connected blocks: checkout → Pages artifact → Pages deployment.

**Script:**

“The deployment workflow is deliberately narrow. On a push that touches the guide site or this workflow file, it checks out the repository, configures Pages, copies the PDF into the site artifact, and uploads only `docs/installation-guide/site`. The deploy job then publishes that artifact to GitHub Pages. GitHub documents this custom workflow pattern: configure, upload the Pages artifact, and deploy it with the required Pages and ID-token permissions. [1]”

## Slide 8 — Why the PDF Is Copied Into the Artifact

**Time:** 1 minute

**Visual:** A browser download button pointing to `downloads/claude-code-tools-installer-guide-2026.pdf`.

**Script:**

“The PDF starts in the repository’s durable downloads directory. The workflow copies it into the site artifact at deployment time. That gives visitors a stable download experience while preserving one source PDF in the repository. The Pages site publishes only what a reader needs.”

## Slide 9 — Authentication: SSH for Git, Token for Pages Administration

**Time:** 2 minutes

**Visual:** Two lanes: SSH key → Git push; fine-grained token → GitHub API / Pages settings.

**Script:**

“Use SSH when an owner is pushing locally. A dedicated Ed25519 key authenticates Git without putting a token into the remote URL. Use a fine-grained token when you need API-level Pages administration. For this workflow, the minimum token permissions depend on the action: Contents write for the guide; Workflows write when changing the workflow; and Pages plus Administration write when creating or updating the Pages site through the API. [2] [3]”

## Slide 10 — The Safe Push Sequence

**Time:** 1.5 minutes

**Visual:** Four numbered terminal cards: authenticate, inspect, push, verify.

**Script:**

“The push sequence is not a blind `git push`. Authenticate with the intended method. Inspect the three commits ahead of `origin/main`. Confirm the protected paths are unchanged. Push to `main`, or to a docs branch if branch protection requires a pull request. Then verify the remote branch points to the same local HEAD.”

## Slide 11 — Expected Published Outcome

**Time:** 1 minute

**Visual:** URL card: `stevekinzey.github.io/claude-code-tools-installer/` and an open download card.

**Script:**

“Once GitHub Pages is enabled for GitHub Actions and the workflow completes, the guide is served from the project Pages URL. The installer repository stays the product source of truth, while the guide becomes a public, versioned, downloadable learning asset.”

## Slide 12 — The Operating Principle

**Time:** 1.5 minutes

**Visual:** Three large words: **Isolate. Validate. Publish.**

**Script:**

“The operating principle is simple: isolate documentation from runtime, validate the package and the boundary, then publish through a controlled workflow. This makes every guide update repeatable. It also gives the product a durable distribution surface: the website, the PDF, the workshop deck, and the webinar all compound from the same field-guide system.”

## Facilitated Q&A Prompts

| If the audience asks | Suggested response |
|---|---|
| “Why not put the site at the repository root?” | “The installer repository has a runtime purpose. A dedicated docs boundary makes review, deployment, rollback, and ownership clearer.” |
| “Why use Actions instead of branch publishing?” | “The workflow can publish exactly one static directory and prepare the PDF download inside the artifact. That creates a stricter boundary than publishing an arbitrary branch folder.” |
| “Why do we need both Pages and Administration permissions?” | “Those are needed when creating or updating the Pages site through the REST API. The deployment job itself uses its short-lived workflow token with Pages and ID-token permissions.” |
| “Could SSH solve the 403?” | “It can bypass a broken HTTPS credential path, but it still uses the GitHub account’s repository rights. The key must be added to the account that has write access.” |

## References

[1] [GitHub Docs — Using custom workflows with GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

[2] [GitHub Docs — Generating a new SSH key and adding it to the ssh-agent](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent)

[3] [GitHub Docs — REST API endpoints for GitHub Pages](https://docs.github.com/en/rest/pages/pages#create-a-github-pages-site)
