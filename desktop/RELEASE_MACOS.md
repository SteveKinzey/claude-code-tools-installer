# macOS Desktop Release Runbook

Use this runbook to turn the Electron desktop installer into a signed, notarized, stapled macOS DMG for direct distribution. Run all commands from the repository root unless a command says otherwise.

> Do not place certificates, private keys, app-specific passwords, API-key `.p8` files, or environment-variable values in this repository, shell history, screenshots, or release notes.

## 1. Preconditions

Install Node.js 22 or newer, then verify the build and notarization tools:

```bash
node --version
npm --version
xcode-select --print-path
xcrun notarytool --version
security find-identity -v -p codesigning
```

For direct distribution, the signing identity must be a valid **Developer ID Application** certificate in the login keychain. The build uses hardened runtime and the entitlement files under `desktop/build/`. You also need an Apple Developer Program membership and a notarization authentication method.

## 2. Install and validate dependencies

```bash
cd desktop
npm install
npm run check
cd ..
```

`npm run check` proves the desktop catalog matches the macOS, Linux, and Windows installer catalogs before packaging.

## 3. Store notarization credentials securely

For local releases, use a Keychain profile rather than putting an app-specific password into a shell command:

```bash
xcrun notarytool store-credentials "claude-tools-notary" \
  --apple-id "YOUR_APPLE_ID" \
  --team-id "YOUR_TEAM_ID"
```

The command prompts for an Apple app-specific password, validates it, and saves the result in Keychain. Verify the profile without exposing a secret:

```bash
xcrun notarytool history --keychain-profile "claude-tools-notary"
```

For the managed GitHub Actions release-candidate workflow, use the Apple app-specific password authentication path. Store the following values only as repository Actions secrets; never commit them, put them in `.env` files, or paste them into a terminal command:

| Secret | Value |
| --- | --- |
| `MACOS_CERTIFICATE_P12_BASE64` | Base64 text of the password-protected `.p12` export containing the Developer ID certificate and its private key. |
| `MACOS_CERTIFICATE_PASSWORD` | The export password chosen for that `.p12` file. |
| `MACOS_CODESIGN_IDENTITY` | The exact Developer ID Application identity shown by Keychain Access. |
| `APPLE_NOTARY_ID` | The Apple Account email used to create the app-specific password. |
| `APPLE_NOTARY_APP_PASSWORD` | The app-specific password created for CCTI notarization. |
| `APPLE_NOTARY_TEAM_ID` | The Apple Developer Team ID. |

Run **Build signed notarized macOS CCTI test artifact** manually after all six secrets exist. This workflow fails closed if any secret is unavailable, signs the app, waits for Apple notarization, staples the final DMG, checks Gatekeeper, and uploads a seven-day test artifact. It never creates or changes a public GitHub release.

## 4. Build a signed release candidate

Choose the Developer ID identity present in Keychain, then build. The signed-only command is the correct local path when you use the Keychain `notarytool` profile from Step 3. It fails if code signing cannot be performed.

```bash
export CSC_NAME="Developer ID Application: YOUR LEGAL ENTITY (YOUR_TEAM_ID)"
cd desktop
npm run dist:mac:signed
cd ..
```

For a local automated app-bundle notarization build, provide an Apple ID, an app-specific password, and the Developer Team ID only through the environment. Do not store them in this repository.

```bash
export CSC_NAME="Developer ID Application: YOUR LEGAL ENTITY (YOUR_TEAM_ID)"
export APPLE_ID="YOUR_APPLE_ACCOUNT_EMAIL"
export APPLE_APP_SPECIFIC_PASSWORD="YOUR_APP_SPECIFIC_PASSWORD"
export APPLE_TEAM_ID="YOUR_TEAM_ID"
cd desktop
npm run dist:mac:release
cd ..
```

The `afterSign` hook notarizes the app bundle in the automated path. The generated DMG and ZIP are written to `releases/test-builds/`. The name is a staging location only; a signed artifact is still a release candidate until the **final DMG itself** passes notarization and Gatekeeper validation.

## 5. Verify the signed application before notarization

Find the built app and DMG, then verify the app signature:

```bash
APP=$(find releases/test-builds -type d -name "Claude Code Tools Installer.app" -print -quit)
DMG=$(find releases/test-builds -type f -name "*.dmg" -print -quit)

test -n "$APP" && test -n "$DMG"
codesign --verify --deep --strict --verbose=2 "$APP"
spctl --assess --verbose --type execute "$APP"
```

Stop here if either command fails. Rebuild or correct the signing identity and entitlements before submitting anything to Apple.

## 6. Submit the final DMG and staple the ticket

Even when `npm run dist:mac:release` notarizes the app bundle automatically, submit the **final DMG** after packaging so the disk image has its own ticket. Use the Keychain profile from Step 3:

```bash
xcrun notarytool submit "$DMG" \
  --keychain-profile "claude-tools-notary" \
  --wait

xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"
```

If the submission is rejected, copy the submission ID from `notarytool` output and inspect Apple’s log before changing the build:

```bash
xcrun notarytool log SUBMISSION_ID \
  --keychain-profile "claude-tools-notary"
```

## 7. Final distribution checks

```bash
spctl -a -vv -t open "$DMG"
shasum -a 256 "$DMG"
bash scripts/verify-signed-macos-dmg.sh "$DMG"
```

Perform a clean-machine smoke test: download the final DMG, mount it, copy the app to `/Applications`, launch it, confirm that the desktop interface loads, let it detect or bootstrap Claude Code, select a small tool set, and use the dry-run option before a live install.

Only after these checks should the artifact be renamed or uploaded as the new public macOS release. Replace the legacy CLI-only DMG rather than publishing both artifacts under the same product version.

## References

- [Apple: Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [Apple: TN3147, `notarytool` migration and Keychain profiles](https://developer.apple.com/documentation/technotes/tn3147-migrating-to-the-latest-notarization-tool)
- [Electron Builder: Code signing configuration](https://www.electron.build/docs/features/code-signing/)
