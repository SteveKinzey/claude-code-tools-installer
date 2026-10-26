# Superseded staging candidates and release drift

Dated tags normally require a published release with an uploaded, positive-size,
recognized executable asset carrying GitHub's SHA-256 digest after 24 hours.
The drift check remains a metadata/inventory gate; it does not independently
verify downloaded bytes, notarization, Sigstore signatures or Windows provenance.
The existing platform trust and shared publication workflows retain those duties.

Some immutable tags identify unpublished staging attempts later incorporated into
a published revision. These are **superseded staging candidates**, not source-only
releases and not public downloads. Publishing old candidates solely to silence a
scheduled check would bypass the intended release decision.

## Evidence established on October 26, 2026

| Retained staging tag | Tagged commit | Published replacement | Evidence |
| --- | --- | --- | --- |
| `v2026.10.02.02` | `6b351bcffd0767742b554480636356dd8a9776bf` | `v2026.10.02.03` | [Published notes](https://github.com/SteveKinzey/claude-code-tools-installer/releases/tag/v2026.10.02.03) explicitly incorporate the unpublished .02 draft; [historical changelog](https://github.com/SteveKinzey/claude-code-tools-installer/blob/5a803978f6d2a8070e7cba7a7c3fe2fd8baefb13/CHANGELOG.md) records the same boundary. |
| `v2026.10.14.00` | `51098e8d9ba75069b8b6445273590644edbe8eb9` | `v2026.10.14.01` | [Published notes](https://github.com/SteveKinzey/claude-code-tools-installer/releases/tag/v2026.10.14.01) and the [release decision log](https://github.com/SteveKinzey/claude-code-tools-installer/blob/5a803978f6d2a8070e7cba7a7c3fe2fd8baefb13/RELEASE_LOG.md) retain .00 private staging after the Windows wrapper false failure and require a new revision. |

Authenticated release inventory confirmed both originals remain drafts with staged
assets. Both replacement commits descend from the original tagged commits, and
both replacements are published with executable coverage for macOS, Windows and
Linux. This establishes disposition and continuity, not a new cryptographic
attestation of historical bytes. Windows installers remain intentionally unsigned;
the current Windows release lane verifies checksums and provenance.

## Protected change process

1. Investigate tag annotation, exact source, release state, published replacement
   notes, source ancestry and recorded release decisions before proposing a record.
2. Propose `docs/release-staging-dispositions.json` changes through a PR to protected
   main, with evidence and a reason. Manifest-only changes must trigger the required
   complete Linux/Windows desktop validation. Never add wildcard exclusions or
   classify an unpublished binary staging attempt as a source-only public release.
3. Pin the original tag object and commit plus the replacement tag and commit.
   On every check, resolve the actual refs and verify replacement ancestry. Require
   the replacement to remain public, non-prerelease and to pass the existing
   executable/digest gate. No recursive exemption through another staging record.
4. Retain tags, drafts and staged assets. Report `SUPERSEDED` separately from
   `VERIFIED`, with empty executable coverage for unpublished staging. A later
   published original must satisfy the ordinary artifact gate. Missing/changed refs,
   invalid records or replacement asset drift fail closed.
5. New binary publication still requires the existing exact-tag security, native
   acceptance, platform trust and final publication authorization. This record
   grants no signing, publication, tag-rewrite or updater-promotion authority.

The October 26 repair proposes these two evidence-backed dispositions. Their
activation on the scheduled main workflow occurs only when that PR is accepted
through the repository's protected process. Unlisted dated tags retain the normal
24-hour deadline. Existing public downloads and historical tag targets are retained.
