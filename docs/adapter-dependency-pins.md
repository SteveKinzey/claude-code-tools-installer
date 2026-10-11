# Installer dependency and skill-source pins

## Scope

CCTI already pins the setup-time skills CLI (`1.7.0`), Playwright MCP (`0.0.83`), Claude-Mem (`13.28.0`), gstack (`7fca42ad8b6c707b8a38f579f72bf3c4f7de6d85`), and other third-party npm tools. These values are unchanged by this follow-up. All three standalone adapters carry identical constants; `scripts/test-pinned-setup-code.js` rejects drift.

This follow-up pins the four curated repositories installed through the skills CLI. The chosen snapshots are the last commits before October 2, 2026 UTC, retaining the release-era source baseline instead of silently adopting unrelated latest changes. This is a source/command review, not a claim of comprehensive upstream security auditing.

| Skill | Source commit | Selected directory |
|---|---|---|
| Ponytail | [`e3ba2aa6f1e6f0bc4d69eb09c9f0d0a93af56156`](https://github.com/DietrichGebert/ponytail/commit/e3ba2aa6f1e6f0bc4d69eb09c9f0d0a93af56156) | `skills/ponytail` |
| Design Taste Frontend | [`ce26fc25c0e5e8cab638f883de62d9a86ee5e45b`](https://github.com/Leonxlnx/taste-skill/commit/ce26fc25c0e5e8cab638f883de62d9a86ee5e45b) | `skills/taste-skill` |
| Planning with Files | [`dab9d16fbd9314448b319d112e99f497d7638d89`](https://github.com/OthmanAdi/planning-with-files/commit/dab9d16fbd9314448b319d112e99f497d7638d89) | `skills/planning-with-files` |
| Graphify | [`ef4450d9c28acb2b8cdc22d369c1777b77148eef`](https://github.com/Graphify-Labs/graphify/commit/ef4450d9c28acb2b8cdc22d369c1777b77148eef) | `graphify` |

Each source is fetched by full SHA into a CCTI-owned staging directory. The checkout's HEAD is checked against that SHA before the already-pinned skills CLI is invoked on the local directory. `--copy` creates a standalone skill rather than a symlink to a temporary checkout. The staging checkout is always removed after install or failure.

Graphify upstream ships its entry file as lowercase `skill.md`. The staged checkout alone is renamed via an intermediate filename to `SKILL.md`, preserving bytes and working on case-sensitive and case-insensitive filesystems. Its bundled references are copied with the selected directory. This installs only the skill content; it does not install Graphify's Python package or execute its setup instructions.

## Existing installations and identity

- Existing `SKILL.md` or occupied skill directories are skipped, not overwritten or downgraded. No legacy content is silently claimed to match a new pin.
- Global and project scopes retain their explicit noninteractive flags and locations. The temporary source never changes the chosen project's working directory.
- The isolated `npx --prefix` helper still prevents a selected project's `.npmrc` and node_modules from influencing npm. Deliberate user/global npm settings remain respected.
- Successful new installations record `source=<repository>@<full SHA>;cli=skills@<version>;scope=<scope>` in the existing manifest's `Extra` field. Rollback still uses the unchanged `skill` kind and destination path.
- Missing commits, mismatched checkouts, missing skill entry files and CLI errors stop setup. They do not fall back to default HEAD or record success. An upstream CLI can leave partial destination state after its own failure; CCTI does not broadly delete user locations to hide that outcome.
- gstack remains Unix-only for final setup. Existing gstack checkouts are preserved. Windows signing, releases and proxy settings are outside this change.

## Update procedure

1. Review the requested upstream release/commit and selected skill name, entry path, references, scripts and changed behavior. Do not use tags, ranges or HEAD as the runtime pin.
2. Resolve the immutable full commit SHA and fetch it in a disposable checkout. Verify the selected `SKILL.md`/Graphify entry and frontmatter name. Do not run upstream scripts during source inspection.
3. Update the relevant constant in **all three** adapters and this table together. No override from environment/project files is accepted.
4. Run `node scripts/test-pinned-setup-code.js`, `node scripts/test-curated-skill-pins.js`, `node scripts/test-project-npm-isolation.js`, Bash syntax checks and `npm --prefix desktop run check`.
5. Obtain passing Linux and Windows PR CI, including native PowerShell fixtures, before merge. Do not bypass protected main or trigger a desktop release from this dependency-only PR.
6. Validate a reviewed real CLI copy in disposable HOME/project locations before a future release. Confirm no source checkout links, exact installed content, unchanged existing content and source identity ledger. Never test against the owner's real skill directories.

## Test coverage

The additional cross-platform test exercises full-SHA fetch versus newer upstream HEAD, both scopes, successful standalone copies and identity, missing/short refs, missing skill directories, failed CLI, existing-install skip, Graphify casing and no-write dry runs. Native PowerShell behavior runs in Windows CI; static parity is checked on every platform. The hostile-project `.npmrc` test remains in the full suite. No package versions were bumped and no production installer was published.

The real `skills@1.7.0` CLI was additionally tested against all four exact upstream checkouts in disposable HOME/project folders: selected skill entry bytes matched SHA-256, installed destinations were not source symlinks, and all four skills remained readable after deleting the temporary checkouts. Telemetry was disabled and no upstream setup scripts were executed. This verifies content-copy compatibility, not every skill's runtime behavior.

The October 11, 2026 local full suite reached its security gate and failed on pre-existing dependency advisories. A separate exact committed-lock audit also reported a high-severity advisory. This dependency-only pinning change does not bypass the gate or claim a green full suite; native Windows PR checks and any existing security blocker must be resolved before merge.
