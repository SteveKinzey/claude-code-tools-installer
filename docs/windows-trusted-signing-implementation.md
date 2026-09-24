# CCTI Windows Direct Distribution: Azure Signing and Download Measurement Specification

## Decision

Use **Azure Artifact Signing**—the current Azure name for its managed signing product—as the direct Windows signing route. The initial direct channel should ship **one x64 NSIS installer** with a GitHub Release `latest.yml` updater feed. Do not publish an Arm64 updater from the same GitHub feed until the updater uses architecture-aware metadata; one `latest.yml` cannot safely express the correct installer for two architectures.

Electron Builder `26.16.1` already supports Azure signing through `win.azureSignOptions`. Use it rather than signing only the finished installer after packaging. Builder can sign the embedded application executable and NSIS uninstaller while it packages the installer.

> **No Azure account, identity validation, billing configuration, GitHub environment, secrets, or direct Windows artifact has been created by this specification.** Phase 1 requires the owner to perform Azure identity and authorization actions in Microsoft’s portals.

## Phase 1: Exact Azure Artifact Signing Setup

### 1. Confirm the legal identity path

Choose one identity scope before creating anything.

| Choice | Choose it when | Required match |
|---|---|---|
| **Organization / Public Trust** | CCTI is released by a registered legal entity | Legal entity name, address, web domain, primary email, business identifier, and signatory identity |
| **Individual / Public Trust** | CCTI is released personally and the developer is eligible in the United States or Canada | Azure billing account legal name and sold-to address must match the government-issued identity document |

Public Trust eligibility is region-limited. Microsoft currently lists organization eligibility in the United States, Canada, EU, UK, Australia, New Zealand, Japan, South Korea, Singapore, Switzerland, Norway, and Israel; individual validation is limited to the United States and Canada.[1]

### 2. Create the Azure signing resources

1. Sign in to the [Azure portal](https://portal.azure.com/) with an account that can create resources in the target subscription.
2. Open **Subscriptions** → select the target subscription → **Resource providers**.
3. Search for `Microsoft.CodeSigning` and select **Register**. Wait until status is **Registered**.[1]
4. Search for **Artifact Signing Accounts** → select **Create**.
5. Create a dedicated resource group, for example `rg-ccti-signing-prod`.
6. Choose a supported signing region. For a US setup, choose **East US** and retain the endpoint `https://eus.codesigning.azure.net/`; the endpoint must match the resource region exactly.[1] [2]
7. Set a globally unique account name, for example `cctisigningprod`. Azure requires 3–24 alphanumeric characters, beginning with a letter and ending with a letter or number.[1]
8. Select the intended pricing tier, review charges in Azure before creating, then create the account.

### 3. Complete Public identity validation

1. Open the new Artifact Signing account → **Identity validations**.
2. In **Access control (IAM)**, assign the human completing the request the **Artifact Signing Identity Verifier** role. That person also needs at least **Reader** at subscription scope.[3]
3. Select **New identity** → **Organization** or **Individual developer** → **Public**.
4. Enter the legal identity data exactly as it appears in the company records or government ID. For an organization, use a monitored email address on a domain owned by the legal entity.
5. Select **Certificate subject preview**. Confirm the publisher text is exactly the identity CCTI should show in Windows signature dialogs and in its updater trust check.
6. Submit the request. Complete email verification and upload any requested documents only in Azure Portal. Microsoft states processing can take **1–20 business days** and may require more documentation.[1]
7. Wait for status **Completed**. Do not proceed with a public release while validation is pending, failed, or the subject preview is wrong.

### 4. Create a Public Trust certificate profile

1. Artifact Signing account → **Certificate profiles** → **Create**.
2. Choose **Public Trust**.
3. Use a stable descriptive profile name, for example `cctiWindowsPublicTrust`. The profile name must be 5–100 alphanumeric characters and unique inside the account.[1]
4. Select the completed identity validation from **Verified CN and O**.
5. Keep program type **None**, unless CCTI enrolls in a Microsoft special program.
6. Review the certificate subject preview, then create the profile.

Record these non-secret values in the password manager or deployment runbook, not source code:

```text
Signing endpoint: https://eus.codesigning.azure.net/
Signing account name: cctisigningprod
Certificate profile name: cctiWindowsPublicTrust
Publisher name: <exact certificate subject common name>
Subscription ID: <Azure subscription UUID>
Tenant ID: <Microsoft Entra tenant UUID>
```

### 5. Configure least-privilege GitHub Actions OIDC

Use federation instead of a long-lived client secret.

1. Microsoft Entra ID → **App registrations** → **New registration**. Name it `ccti-github-release-signing` and select the single-tenant option.
2. Open its **Overview** and copy the **Application (client) ID** and **Directory (tenant) ID**.
3. Open **Certificates & secrets** → **Federated credentials** → **Add credential**.
4. Choose **GitHub Actions deploying Azure resources**.
5. Set organization `SteveKinzey`, repository `claude-code-tools-installer`, entity type **Environment**, and environment `windows-release`. This produces a subject restricted to the protected release environment, rather than granting all branches signing access.
6. Open the Artifact Signing account → **Access control (IAM)** → **Add role assignment**.
7. Assign **Artifact Signing Certificate Profile Signer** to the new service principal. Scope it to the certificate profile when practical:

```text
/subscriptions/<subscription-id>/resourceGroups/rg-ccti-signing-prod/providers/Microsoft.CodeSigning/codeSigningAccounts/cctisigningprod/certificateProfiles/cctiWindowsPublicTrust
```

8. In GitHub → repository **Settings** → **Environments**, create `windows-release`.
9. Add required reviewers and restrict deployment branches/tags to release tags matching the project policy. GitHub recommends environment protection when an OIDC policy uses environments.[4]
10. Add these environment secrets or variables:

| GitHub name | Type | Value |
|---|---|---|
| `AZURE_CLIENT_ID` | Secret | Entra application (client) ID |
| `AZURE_TENANT_ID` | Secret | Entra tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Secret | Azure subscription ID |
| `AZURE_CODESIGN_ENDPOINT` | Variable | Region-matched signing endpoint |
| `AZURE_CODESIGN_ACCOUNT_NAME` | Variable | Artifact Signing account name |
| `AZURE_CODESIGN_PROFILE_NAME` | Variable | Certificate profile name |
| `CCTI_WINDOWS_PUBLISHER_NAME` | Variable | Exact certificate Common Name |

Do **not** add `AZURE_CLIENT_SECRET`. The workflow exchanges a short-lived GitHub OIDC token through `azure/login` and needs `id-token: write` to do so.[4]

## Desktop Code Changes

### A. Add a resolved Azure signing config generator

Create `scripts/prepare-windows-azure-signing-config.js`. It keeps environment-specific signing identity out of `desktop/package.json` and fails closed when a release value is missing.

```js
#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const desktopDir = path.resolve(__dirname, "..", "desktop");
const packagePath = path.join(desktopDir, "package.json");
const required = {
  AZURE_CODESIGN_ENDPOINT: "Azure Artifact Signing endpoint",
  AZURE_CODESIGN_ACCOUNT_NAME: "Azure Artifact Signing account name",
  AZURE_CODESIGN_PROFILE_NAME: "Azure certificate profile name",
  CCTI_WINDOWS_PUBLISHER_NAME: "exact certificate publisher name",
};

function outputPath() {
  const index = process.argv.indexOf("--out");
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error("Use --out <desktop-relative-path>.");
  }
  const output = path.resolve(desktopDir, process.argv[index + 1]);
  if (!output.startsWith(`${desktopDir}${path.sep}`)) {
    throw new Error("Write resolved config inside desktop/ only.");
  }
  return output;
}

function values() {
  const missing = Object.entries(required).filter(([key]) => !String(process.env[key] || "").trim());
  if (missing.length) {
    throw new Error(`Signing settings are required: ${missing.map(([key, label]) => `${key} (${label})`).join(", ")}`);
  }
  const result = Object.fromEntries(Object.keys(required).map((key) => [key, String(process.env[key]).trim()]));
  if (Object.values(result).some((value) => value.includes("<") || value.includes(">") || value.includes("["))) {
    throw new Error("Signing settings cannot contain placeholders.");
  }
  return result;
}

try {
  const out = outputPath();
  const env = values();
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const config = {
    ...packageJson.build,
    forceCodeSigning: true,
    win: {
      ...(packageJson.build.win || {}),
      target: [{ target: "nsis", arch: ["x64"] }],
      azureSignOptions: {
        publisherName: env.CCTI_WINDOWS_PUBLISHER_NAME,
        endpoint: env.AZURE_CODESIGN_ENDPOINT,
        codeSigningAccountName: env.AZURE_CODESIGN_ACCOUNT_NAME,
        certificateProfileName: env.AZURE_CODESIGN_PROFILE_NAME,
        fileDigest: "SHA256",
        timestampRfc3161: "http://timestamp.acs.microsoft.com",
        timestampDigest: "SHA256",
      },
    },
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Prepared signed Windows config: ${path.relative(desktopDir, out)}`);
} catch (error) {
  console.error(`[Windows signing preparation] ${error.message}`);
  process.exitCode = 2;
}
```

Add these package scripts and ignore the generated file:

```json
{
  "scripts": {
    "windows-signing:prepare": "node ../scripts/prepare-windows-azure-signing-config.js --out build/windows-signed.resolved.json",
    "dist:win:signed:x64": "node ../scripts/prepare-windows-azure-signing-config.js --out build/windows-signed.resolved.json && electron-builder --win nsis --x64 --config build/windows-signed.resolved.json --publish never"
  }
}
```

```gitignore
# Local/CI resolved signing configuration
/desktop/build/windows-signed.resolved.json
```

This preserves the existing unsigned/test `dist:win` command. Only the protected release workflow invokes `dist:win:signed:x64`.

### B. Enable native updates for signed NSIS builds

Update `desktop/src/main.js` so native update download/install is offered only for packaged macOS or Windows installs, and the release selector requires an artifact compatible with the current platform.

```js
function isVerifiedDesktopArtifact(asset, platform = process.platform) {
  const name = String(asset?.name || "").toLowerCase();
  const hasReleaseDigest = /^sha256:[a-f0-9]{64}$/i.test(String(asset?.digest || ""));
  const isUploaded = asset?.state === "uploaded";
  const hasPositiveSize = Number.isFinite(Number(asset?.size)) && Number(asset.size) > 0;
  const allowedArtifact = platform === "win32"
    ? /-win-x64\.exe$/.test(name)
    : platform === "darwin"
      ? /\.(dmg|zip)$/.test(name)
      : /\.tar\.gz$/.test(name);
  return isUploaded && hasPositiveSize && hasReleaseDigest && allowedArtifact;
}

function newestVerifiedRelease(releases, platform = process.platform) {
  return (Array.isArray(releases) ? releases : [])
    .filter(isPublicReleaseRecord)
    .filter((release) => Array.isArray(release.assets) && release.assets.some((asset) => isVerifiedDesktopArtifact(asset, platform)))
    .sort((left, right) => compareVersions(String(right.tag_name || ""), String(left.tag_name || "")))[0] || null;
}

function nativeUpdaterSupported() {
  return app.isPackaged && (process.platform === "darwin" || process.platform === "win32");
}
```

Keep `win.azureSignOptions.publisherName` identical to the certificate subject. Electron Builder’s Windows updater verifies the expected publisher name on updates.[5]

## GitHub Actions Workflow

Create `.github/workflows/release-windows-signed.yml`. It should be manually dispatched from an existing immutable dated tag and gated by the `windows-release` environment.

```yaml
name: Build, sign, and stage Windows CCTI installer

on:
  workflow_dispatch:
    inputs:
      tag:
        description: Existing dated release tag, such as v2026.09.22
        required: true
        type: string

permissions:
  contents: write
  id-token: write

concurrency:
  group: windows-release-${{ inputs.tag }}
  cancel-in-progress: false

jobs:
  release:
    name: Build, sign, verify, and stage Windows installer
    if: github.ref_type == 'tag' && github.ref_name == inputs.tag
    runs-on: windows-2022
    environment: windows-release
    timeout-minutes: 45
    defaults:
      run:
        working-directory: desktop
        shell: pwsh

    steps:
      - name: Check out immutable release tag
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ inputs.tag }}
          persist-credentials: false
          fetch-depth: 0

      - id: release
        name: Validate tag and package version
        env:
          TAG: ${{ inputs.tag }}
        run: |
          if ($env:TAG -notmatch '^v\d{4}\.\d{2}\.\d{2}$') { throw "Use a dated tag such as v2026.09.22." }
          $package = Get-Content package.json -Raw | ConvertFrom-Json
          $expected = "v{0:D4}.{1:D2}.{2:D2}" -f @($package.version.Split('.') | ForEach-Object { [int]$_ })
          if ($env:TAG -ne $expected) { throw "Tag $env:TAG must match desktop/package.json version $expected." }
          "tag=$env:TAG" | Out-File -FilePath $env:GITHUB_OUTPUT -Append -Encoding utf8

      - name: Set up Node.js 22
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: '22.12.0'
          package-manager-cache: false

      - name: Install and validate desktop dependencies
        run: |
          npm ci
          npm run check

      - name: Sign in to Azure through GitHub OIDC
        uses: Azure/login@a641126d1b8aa4d1fa005f4f92df94a3a4c4c906 # v3.1.0
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Build signed x64 NSIS installer
        env:
          AZURE_CODESIGN_ENDPOINT: ${{ vars.AZURE_CODESIGN_ENDPOINT }}
          AZURE_CODESIGN_ACCOUNT_NAME: ${{ vars.AZURE_CODESIGN_ACCOUNT_NAME }}
          AZURE_CODESIGN_PROFILE_NAME: ${{ vars.AZURE_CODESIGN_PROFILE_NAME }}
          CCTI_WINDOWS_PUBLISHER_NAME: ${{ vars.CCTI_WINDOWS_PUBLISHER_NAME }}
        run: |
          Remove-Item ..\releases\test-builds\*-win-x64.exe -Force -ErrorAction SilentlyContinue
          npm run dist:win:signed:x64

      - id: artifact
        name: Verify one signed installer and updater feed
        env:
          EXPECTED_PUBLISHER: ${{ vars.CCTI_WINDOWS_PUBLISHER_NAME }}
        run: |
          $installers = @(Get-ChildItem ..\releases\test-builds -File -Filter '*-win-x64.exe' | Where-Object { $_.Name -notmatch 'uninstaller' })
          if ($installers.Count -ne 1) { throw "Expected exactly one x64 NSIS installer; found $($installers.Count)." }
          $installer = $installers[0]
          $signature = Get-AuthenticodeSignature -FilePath $installer.FullName
          if ($signature.Status -ne 'Valid') { throw "Authenticode status is $($signature.Status)." }
          if (-not $signature.TimeStamperCertificate) { throw 'Installer is missing an RFC3161 timestamp.' }
          if ($signature.SignerCertificate.Subject -notlike "*$env:EXPECTED_PUBLISHER*") { throw "Unexpected signer subject: $($signature.SignerCertificate.Subject)" }
          $metadata = Join-Path $installer.DirectoryName 'latest.yml'
          if (-not (Test-Path -LiteralPath $metadata -PathType Leaf)) { throw 'electron-builder did not create latest.yml.' }
          $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer.FullName).Hash.ToLowerInvariant()
          "$hash  $($installer.Name)" | Set-Content -LiteralPath "$($installer.FullName).sha256" -NoNewline
          if (-not (Select-String -LiteralPath $metadata -SimpleMatch $installer.Name -Quiet)) { throw 'latest.yml does not reference the signed installer.' }
          "installer=$($installer.FullName)" | Out-File -FilePath $env:GITHUB_OUTPUT -Append -Encoding utf8
          "checksum=$($installer.FullName).sha256" | Out-File -FilePath $env:GITHUB_OUTPUT -Append -Encoding utf8
          "metadata=$metadata" | Out-File -FilePath $env:GITHUB_OUTPUT -Append -Encoding utf8

      - name: Create or reuse matching draft release
        working-directory: .
        env:
          GH_TOKEN: ${{ github.token }}
          TAG: ${{ steps.release.outputs.tag }}
        run: |
          gh release view $env:TAG 2>$null
          if ($LASTEXITCODE -ne 0) { gh release create $env:TAG --target $env:GITHUB_SHA --title $env:TAG --generate-notes --draft }
          $isDraft = gh release view $env:TAG --json isDraft --jq '.isDraft'
          if ($isDraft -ne 'true') { throw 'Windows signing workflow stages artifacts only on a draft release.' }

      - name: Upload staged Windows assets
        working-directory: .
        env:
          GH_TOKEN: ${{ github.token }}
          TAG: ${{ steps.release.outputs.tag }}
          INSTALLER: ${{ steps.artifact.outputs.installer }}
          CHECKSUM: ${{ steps.artifact.outputs.checksum }}
          METADATA: ${{ steps.artifact.outputs.metadata }}
        run: |
          gh release upload $env:TAG $env:INSTALLER $env:CHECKSUM $env:METADATA --clobber
```

Keep the final cross-platform publisher as a separate workflow. Extend its required asset list to include the Windows `.exe`, `.exe.sha256`, and `latest.yml` only after a clean Windows VM validates the installer and update path.

## Windows Download Click Telemetry

### Measurement definition

A **Windows download click** is one primary download-CTA click per browser tab, for a fixed daily aggregate dimension. It is neither a GitHub download nor an installation. The event contains no name, email, IP address, user agent, client hint, cookie, local path, direct URL, or session identifier.

| Field | Purpose | Allowed values |
|---|---|---|
| `day` | UTC daily aggregation key | `YYYY-MM-DD` |
| `releaseVersion` | Ties click intent to one verified release | `vYYYY.MM.DD` |
| `architecture` | Architecture of the artifact—not detected user hardware | `x64`, `arm64` |
| `artifact` | Distribution route | `portable_zip`, `signed_nsis` |
| `clicks` | Aggregate counter | Positive integer |

### A. Drizzle schema

Add to `drizzle/schema.ts`:

```ts
/** One row per UTC day, published Windows release version, artifact architecture, and delivery route. This is aggregate-only download click telemetry. */
export const anonymousWindowsReleaseDownloadDaily = mysqlTable("anonymous_windows_release_download_daily", {
  day: varchar("day", { length: 10 }).notNull(),
  releaseVersion: varchar("releaseVersion", { length: 32 }).notNull(),
  architecture: mysqlEnum("architecture", ["x64", "arm64"]).notNull(),
  artifact: mysqlEnum("artifact", ["portable_zip", "signed_nsis"]).notNull(),
  clicks: int("clicks").default(0).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [primaryKey({ columns: [table.day, table.releaseVersion, table.architecture, table.artifact] })]);
```

### B. Exact migration SQL

Generate the normal Drizzle migration after adding the schema, review it, then apply its equivalent through the WebDev SQL executor. The expected migration is:

```sql
CREATE TABLE `anonymous_windows_release_download_daily` (
  `day` varchar(10) NOT NULL,
  `releaseVersion` varchar(32) NOT NULL,
  `architecture` enum('x64','arm64') NOT NULL,
  `artifact` enum('portable_zip','signed_nsis') NOT NULL,
  `clicks` int NOT NULL DEFAULT 0,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`day`,`releaseVersion`,`architecture`,`artifact`)
);
```

The project’s daily anonymous-signal retention function must add:

```ts
await db.delete(anonymousWindowsReleaseDownloadDaily)
  .where(lt(anonymousWindowsReleaseDownloadDaily.day, cutoffDay));
```

### C. Database upsert

Add this function to `server/db.ts` and import the new schema table:

```ts
export type AnonymousWindowsReleaseDownload = {
  releaseVersion: string;
  architecture: "x64" | "arm64";
  artifact: "portable_zip" | "signed_nsis";
};

export async function recordAnonymousWindowsReleaseDownload(input: AnonymousWindowsReleaseDownload) {
  const db = await getDb();
  if (!db) throw new Error("Anonymous download totals are temporarily unavailable");

  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  await db.transaction(async (tx) => {
    // Keep the existing platform aggregate and its extraction-alert denominator
    // in lockstep with the release-attributed click.
    await tx.insert(anonymousPlatformDownloadDaily).values({
      day,
      macos: 0,
      windows: 1,
      linux: 0,
      updatedAt: now,
    }).onDuplicateKeyUpdate({
      set: {
        windows: sql`${anonymousPlatformDownloadDaily.windows} + 1`,
        updatedAt: now,
      },
    });
    await tx.insert(anonymousWindowsReleaseDownloadDaily).values({
      day,
      releaseVersion: input.releaseVersion,
      architecture: input.architecture,
      artifact: input.artifact,
      clicks: 1,
      updatedAt: now,
    }).onDuplicateKeyUpdate({
      set: {
        clicks: sql`${anonymousWindowsReleaseDownloadDaily.clicks} + 1`,
        updatedAt: now,
      },
    });
  });
  await recordWindowsExtractionAlertIfThresholdExceeded(db, day, now);
}
```

### D. tRPC procedure

In `server/routers.ts`, import the helper and add this to `signals`:

```ts
reportWindowsReleaseDownload: publicProcedure.input(z.object({
  releaseVersion: z.string().regex(/^v\d{4}\.\d{2}\.\d{2}$/),
  architecture: z.enum(["x64", "arm64"]),
  artifact: z.enum(["portable_zip", "signed_nsis"]),
})).mutation(async ({ input }) => {
  enforceAnonymousSignalRateLimit();
  await recordAnonymousWindowsReleaseDownload(input);
  return { recorded: true } as const;
}),
```

The helper, not the route, atomically increments the generic `anonymous_platform_download_daily.windows` counter and the new release-level row. This preserves existing platform trend reporting and the Windows extraction-issue rate denominator without a partial-write state.

### E. Release catalog and Windows UI prerequisites

The existing CCTI site deliberately accepts only one exact portable-ZIP filename in both `server/releaseCatalog.ts` and `client/src/lib/platformReleaseMetadata.ts`. A signed `.exe` will otherwise be filtered out before the download CTA or telemetry code can run. Update both allowlists before enabling the signed channel.

```ts
const WINDOWS_PORTABLE_ZIP = /^Claude\.Code\.Tools\.Installer-\d{4}\.\d{1,2}\.\d{1,2}-windows-portable-x64\.zip$/i;
const WINDOWS_SIGNED_NSIS = /^Claude-Code-Tools-Installer-\d{4}\.\d{1,2}\.\d{1,2}-win-x64\.exe$/i;

function windowsArtifactKind(fileName: string): "portable_zip" | "signed_nsis" | null {
  if (WINDOWS_PORTABLE_ZIP.test(fileName)) return "portable_zip";
  if (WINDOWS_SIGNED_NSIS.test(fileName)) return "signed_nsis";
  return null;
}
```

Use that helper in the server release-platform pattern and client release selection. Do **not** accept arbitrary `.exe` uploads. Only the immutable, expected signed installer naming convention is eligible.

Branch the Windows guide on this same artifact kind:

| Artifact | Download page behavior | Product wording |
|---|---|---|
| `portable_zip` | Keep the extraction animation, extraction checklist, ZIP checksum, and optional PowerShell extractor. | “Extract first. Then run CCTI.” |
| `signed_nsis` | Hide ZIP extraction content. Show “Download → open installer → approve your chosen install location → open CCTI,” plus signature/checksum verification. | “Signed Windows installer.” |

Update `architectureMetadata` so a Windows x64 artifact is labelled **Windows x64**, not **Intel x64**. Update the bundled fallback catalog only after the signed release is public and its filename, bytes, and SHA-256 digest have been independently verified.

### F. CTA wiring

Extend `PlatformDownloadGuide` with a dedicated prop for release-level Windows telemetry. Do not transmit user-agent or detected device architecture.

```ts
type WindowsReleaseDownloadInput = {
  releaseVersion: string;
  architecture: "x64" | "arm64";
  artifact: "portable_zip" | "signed_nsis";
};

type PlatformDownloadGuideProps = {
  // existing props
  onWindowsReleaseDownload?: (input: WindowsReleaseDownloadInput) => void;
};

function recordOncePerWindowsReleaseSession(input: WindowsReleaseDownloadInput) {
  if (typeof window === "undefined") return true;
  try {
    const key = `ccti-windows-download-${input.releaseVersion}-${input.architecture}-${input.artifact}`;
    if (window.sessionStorage.getItem(key)) return false;
    window.sessionStorage.setItem(key, "1");
  } catch {
    // Preserve the download when session storage is blocked.
  }
  return true;
}

const handleDownload = () => {
  if (!release) return;
  // Existing generic platform telemetry remains unchanged for macOS/Linux.
  if (platform === "windows") {
    const input: WindowsReleaseDownloadInput = {
      releaseVersion: release.version,
      architecture: "x64", // Artifact build target, not browser/device detection.
      artifact: release.fileName.toLowerCase().endsWith(".exe") ? "signed_nsis" : "portable_zip",
    };
    if (recordOncePerWindowsReleaseSession(input)) onWindowsReleaseDownload?.(input);
  } else if (recordOncePerPlatformSession(platform)) {
    onPlatformDownload?.(platform);
  }
  // Continue existing UI transition and quick-start behavior.
};
```

In `Home.tsx`:

```tsx
const windowsReleaseDownload = trpc.signals.reportWindowsReleaseDownload.useMutation();

<PlatformDownloadGuide
  // existing props
  onPlatformDownload={(downloadPlatform) => platformDownload.mutate({ platform: downloadPlatform })}
  onWindowsReleaseDownload={(input) => windowsReleaseDownload.mutate(input)}
/>
```

Update the download-card disclosure from “one anonymous daily platform total” to:

> This Windows download link records one anonymous daily click for the shown release and artifact type. It does not retain your IP address, browser details, device ID, local path, or an individual event record.

### G. Regression tests

Add tests that assert:

1. Invalid release tags, unsupported architecture, and unsupported artifact names are rejected.
2. The helper inserts a counter of one and increments the exact primary key on a second click.
3. The retention job deletes expired release-level daily rows.
4. The primary Windows CTA calls only `reportWindowsReleaseDownload` after session de-duplication.
5. A ZIP reports `portable_zip`; a signed `.exe` reports `signed_nsis`.
6. No browser string, URL, path, cookie value, or user identity reaches the tRPC payload or table.
7. Only the exact reviewed ZIP and signed NSIS filenames become Windows release assets; a generic executable is rejected.
8. A signed installer renders installer steps, while a portable ZIP retains extraction steps.

## Release Acceptance Gate

Do not swap the public Windows CTA from portable ZIP to a signed installer until all of these are true:

- Artifact Signing identity validation and Public Trust certificate profile are **Completed**.
- GitHub Actions OIDC federation and profile-scoped signer role work from the protected `windows-release` environment.
- The NSIS installer, bundled app executable, and uninstaller have valid Authenticode signatures and RFC3161 timestamps.
- A clean Windows 11 VM installs, launches, passes CCTI Step 1 verification, uninstalls safely, and updates from the prior signed version.
- The generated `latest.yml` references the signed x64 installer with matching SHA-512 and size.
- The staged GitHub release has SHA-256 digests and matching sidecars.
- The website declares **signed Windows installer**, not Store availability, and version-level click measurement passes its privacy and regression tests.

## References

[1]: https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart "Quickstart: Set up Artifact Signing"
[2]: https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations "Set up signing integrations to use Artifact Signing"
[3]: https://learn.microsoft.com/en-us/azure/artifact-signing/tutorial-assign-roles "Tutorial: Assign roles in Artifact Signing"
[4]: https://docs.github.com/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-azure "Configuring OpenID Connect in Azure"
[5]: https://www.electron.build/win.html "Electron Builder Windows Configuration"
[6]: https://github.com/Azure/artifact-signing-action "Azure Artifact Signing Action"
