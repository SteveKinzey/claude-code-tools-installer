# CCTI Partner Center Identity Binding Instructions

These instructions explain how to apply the reserved Partner Center identity to the CCTI MSIX build. Do not execute these steps in an unauthenticated or public environment.

## 1. Retrieve the reserved identity

Log in to Partner Center and navigate to the reserved application's **Product identity** page. Locate the exact values for these three fields:

- `Package/Identity/Name`
- `Package/Identity/Publisher`
- `Package/Properties/PublisherDisplayName`

Do not guess, abbreviate, or normalize these values. The `Publisher` value typically begins with `CN=`.

## 2. Configure the protected build environment

The CCTI build workflow (`.github/workflows/build-windows-store-msix.yml`) requires these values as protected environment secrets.

1. In the CCTI GitHub repository, go to **Settings > Environments**.
2. Create or select the protected environment (e.g., `msix-store-release`).
3. Add the three values as environment secrets exactly as they appear in Partner Center:
   - `CCTI_APPX_IDENTITY_NAME`
   - `CCTI_APPX_PUBLISHER`
   - `CCTI_APPX_PUBLISHER_DISPLAY_NAME`

Do not add these as repository variables or workflow-dispatch inputs. Workflow-dispatch inputs are not masked by default and will expose the identity in the run history.

## 3. Dispatch the final build

1. Go to **Actions > Build Microsoft Store MSIX bundle**.
2. Click **Run workflow**.
3. Select the exact final release commit or tag.
4. The workflow will automatically inject the protected secrets into the `msix:prepare` step, build the x64 and ARM64 packages, and produce the final unsigned `.msixbundle` and its `.sha256` companion file.

## 4. Safe CI test mode

The same workflow includes a **test mode** for verifying the Windows package and bundle stages before the protected Partner Center identity is available. Select **test mode** when dispatching the workflow. It injects a fixed, non-production fixture identity and uploads an artifact named `claude-code-tools-installer-store-test.msixbundle`.

Test-mode output is not a Store submission candidate. Do not upload it to Partner Center, distribute it, or treat it as evidence that the protected identity is configured. Leave test mode off for the final candidate build.

## 5. Verify the resulting bundle

Download the produced bundle and its checksum file. Run the evidence verifier to confirm the identity was applied correctly:

```bash
python scripts/validate_listing_evidence.py \
  --manifest templates/capture-manifest.template.json \
  --bundle claude-code-tools-installer-store-submission.msixbundle \
  --checksum-file claude-code-tools-installer-store-submission.sha256 \
  --allow-template
```

The verifier will confirm the checksum matches and print a redacted fingerprint of the applied identity. It will fail if the packages do not share the same identity or if the checksum is invalid.
