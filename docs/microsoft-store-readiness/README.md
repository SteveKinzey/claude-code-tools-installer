# Microsoft Store Readiness Archive

This directory is the repository-resident archive for the Claude Code Tools Installer Microsoft Store readiness work.

| Directory | Contents |
|---|---|
| `reports/` | Listing copy, mandatory-metadata audit, evidence reports, identity-binding instructions, clean-Windows test-record template, checklist, and speaker script. |
| `assets-demo/` | Screenshot provenance template and asset-audit handoff. This is a planning artifact, not upload-ready Store media. |
| `presentation/` | Release-review deck in PDF and PowerPoint formats. |
| `skills/microsoft-store-listing-evidence-verifier/` | Reusable skill, deterministic validator, capture-manifest template, tests, and reference rules. |

## Evidence boundary

The archived ARM64 report is a **template-evidence check** of the available pre-final artifact. It does not establish final submission readiness. Before a Microsoft Store submission, the protected-identity candidate must be built, its bundle and companion checksum independently verified, and a matching clean-Windows test record completed.

## Validation

Run the reusable skill test from the repository root:

```bash
python3 docs/microsoft-store-readiness/skills/microsoft-store-listing-evidence-verifier/tests/test_validator.py
```

Do not place protected Partner Center identity values in this archive, source control, workflow inputs, or reports.
