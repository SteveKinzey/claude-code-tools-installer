---
name: field-guide-publication
description: "Turn a published field-guide or installation-guide website into a downloadable paginated PDF and isolated repository documentation without changing application runtime files. Use when a live guide needs a matching PDF, a safe docs-only GitHub commit, branded attribution, or troubleshooting for a documentation-publishing push."
---

# Field Guide Publication

Use this workflow to turn a published guide into a downloadable PDF and a repository-safe documentation package. Treat the live website as the **canonical visual source** and keep all publishing artifacts isolated from application or installer runtime paths.

## Inputs

Collect the live guide URL, target repository, current local repository checkout, product owner and author names, copyright year, and the intended documentation directory. For installer repositories, default to `docs/<guide-name>/`.

Read `references/repository-isolation.md` before copying files into a repository or making a Git commit. Read `references/github-write-access.md` when a GitHub push returns `403`, when a workflow file or GitHub Pages configuration is being published, or when the user asks for PAT or SSH setup commands. Read `references/ssh-publishing.md` when the user wants SSH-only Git publishing or a dedicated SSH key for a single repository.

## Workflow

### 1. Confirm the canonical guide

Open the supplied live site and capture its section structure, CTA labels, visual hierarchy, author credit, ownership statement, and copyright. Do not treat a separately written article as the source of truth when the user explicitly identifies the website version.

Record the canonical URL and any design constraints. The PDF should preserve the same section sequence and branded attribution.

### 2. Produce the paginated PDF

Render the static guide, rather than an unrelated content adaptation, when the user wants the **website version** as a PDF.

1. Build the website and copy its static output to a temporary standalone folder.
2. Replace environment-managed asset URLs such as `/manus-storage/...` with local asset paths and copy every referenced image into the package.
3. Serve the folder from an isolated local static server.
4. Print the local site to PDF with background graphics enabled and header/footer disabled. Use a browser PDF API or print command that reliably suppresses browser chrome.
5. Verify page count, page size, title, author/owner text, and absence of preview-host overlays or watermarks.
6. Visually inspect the cover, one dense interior page, one command page, a visual-heavy page, and the final attribution page. Record findings before further review operations.

If browser printing introduces unavoidable print chrome, disclose it and either correct the print method or offer a separately typeset PDF. Do not represent a screenshot capture with preview overlays as the final clean PDF.

### 3. Package documentation safely

Use this structure unless the repository establishes a documented alternative:

```text
docs/<guide-name>/
├── README.md
├── site/
│   ├── index.html
│   └── assets/
└── downloads/
    └── <guide-name>-<year>.pdf
```

Write a `README.md` that states the contents are documentation-only and identifies the website and PDF. Add owner, author, and copyright attribution if provided.

Before committing, validate all of the following:

- No managed or expiring asset URLs remain in static HTML, JS, or CSS.
- The packaged PDF is byte-identical to the validated PDF source.
- The installer or runtime scripts and release artifacts have no modifications.
- Untracked local-server caches, build caches, or preview artifacts are removed.

### 4. Publish with GitHub safely

Stage only the intended documentation directory. Use a documentation-only commit message such as `Add isolated installation guide website and PDF`. Confirm the commit's changed-path list contains no installer, application runtime, release, credential, or package-management files.

Push once using the configured GitHub authentication. If GitHub returns `403`, inspect `gh auth status`, repository viewer permission, repository remote URL, and token scopes when available. A successful API read or `ADMIN` viewer permission does not guarantee that Git-over-HTTPS push authorization is working.

Use the copy-paste-safe HTTPS-token or SSH-key runbook in `references/github-write-access.md`. For a Pages workflow, verify the static site is deployable from the repository subpath before committing. Never put a token in a Git remote URL, shell script, commit, chat message, or tracked file. Never copy or attach an SSH private key.

After registering an SSH key and switching the repository remote, run `scripts/verify_ssh_repository.sh [repository-path]`. This read-only check verifies the expected SSH remote, SSH authentication greeting, Pages workflow structure, static guide boundary, and protected installer paths. Read `references/ssh-publishing.md` first for the required host alias and key setup.

After an authorized push, run `scripts/verify_pages_deployment.sh [repository-path]`. Set `DISPATCH=1` only when a manual workflow dispatch is required; otherwise the workflow runs from the push trigger. The script waits for the matching Pages run and checks both the site URL and the PDF download URL.

After two distinct credential remediation attempts fail, stop retrying. Tell the user that the local documentation-only commit is prepared, name its hash, and request a refreshed GitHub connection or token with repository content-write access. Never alter installer scripts merely to work around a documentation push failure.

### 5. Deliver

Provide the downloadable PDF, the canonical website URL, the exact documentation directory, the commit hash or published URL, and an explicit statement of whether the repository push succeeded. State separately when the documentation commit remains local because access is blocked.
