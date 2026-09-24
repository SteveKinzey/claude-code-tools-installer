# CCTI Windows Direct Signing & Distribution Technical Roadmap

## 1. Executive Summary & Objective

**Objective:** Establish a production-ready, direct Windows distribution model for Claude Code Tools Installer (CCTI).

Windows users currently have access to portable test builds and setup scripts, but lack a frictionless, signed installer experience. By implementing Microsoft Trusted Signing (Authenticode) and an NSIS installer, CCTI can provide:
- **Zero SmartScreen Warnings:** Established publisher reputation without the "Windows protected your PC" blocker.
- **One-Click Installation:** Automated per-user setup without admin (UAC) elevation or manual ZIP extraction.
- **Seamless Auto-Updates:** Background updates matching the macOS `electron-updater` workflow.
- **Release Ownership:** Complete control of the verified release process and download channel.

---

## 2. Technical Evaluation of Code Signing Options

Since June 2023, the CA/Browser Forum requires all code-signing private keys to reside on hardware security modules (HSM) or secure cloud services.

| Criteria | Microsoft Trusted Signing (Recommended) | Traditional OV/EV Token (e.g., DigiCert, Sectigo) | Self-Signed / Test Certificate |
| :--- | :--- | :--- | :--- |
| **Hosting Model** | Cloud-native via Microsoft Azure | Physical USB token or cloud HSM | Local file (`.pfx`) |
| **Monthly Cost** | ~$9.99 / month (Basic tier) | $300 - $700 / year upfront | Free |
| **CI/CD Integration** | Official GitHub Action (`azure/trusted-signing-action`) | Complex USB forwarding or vendor proprietary APIs | Easy in CI, but fails on client machines |
| **SmartScreen Trust** | Immediate Microsoft root trust; fastest reputation growth | Fast reputation growth (EV) or gradual (OV) | Immediate permanent SmartScreen block |
| **Maintenance** | Auto-managed key rotation & timestamps | Certificate renewals every 1–3 years | Manual certificate generation |

**Recommendation:** Adopt **Microsoft Trusted Signing**. It is purpose-built for GitHub Actions CI/CD workflows, eliminates hardware dongles, and carries native trust on Windows 10/11.

---

## 3. Architecture & Packaging Specifications

### 3.1 Installer Target (NSIS)
- **Format:** Nullsoft Scriptable Install System (`.exe`) generated via `electron-builder --win nsis`.
- **Install Scope:** Per-user installation to `%LOCALAPPDATA%\Programs\claude-code-tools-installer`.
  - *Advantage:* Does not require Windows Administrator (UAC) privileges to install or update.
- **Shortcut Management:** Start Menu and optional Desktop shortcut.
- **Uninstall Cleanliness:** Uninstaller cleanly deregisters shortcuts and leaves user skills and Claude Code configurations intact.

### 3.2 Dual Architecture Support
- `Claude-Code-Tools-Installer-<version>-win-x64.exe` (Intel/AMD 64-bit)
- `Claude-Code-Tools-Installer-<version>-win-arm64.exe` (Qualcomm Snapdragon / Windows on ARM)

### 3.3 Auto-Update Pipeline (`electron-updater`)
- Windows auto-update requires a signed executable and a `latest.yml` metadata feed hosted on GitHub Releases.
- `latest.yml` structure:
  ```yaml
  version: 2026.9.22
  files:
    - url: Claude-Code-Tools-Installer-2026.9.22-win-x64.exe
      sha512: <base64-hash>
      size: <bytes>
  path: Claude-Code-Tools-Installer-2026.9.22-win-x64.exe
  sha512: <base64-hash>
  releaseDate: '2026-09-22T04:00:00.000Z'
  ```

---

## 4. Phased Implementation Roadmap

```
Phase 1: Identity & Azure Setup  ──►  Phase 2: CI/CD & Build Pipeline  ──►  Phase 3: Testing & UI Sync
(Azure Trusted Signing Profile)        (GitHub Actions Workflow)             (claudetool.app download card)
```

### Phase 1: Identity & Credentials Provisioning
1. **Azure Resource Setup:**
   - Create an Azure subscription (or use existing).
   - Deploy a **Trusted Signing Account** in Azure portal (`Microsoft.CodeSigning/codeSigningAccounts`).
2. **Identity Verification:**
   - Complete identity validation in Azure (Individual developer or Organization).
   - Create a Certificate Profile under Trusted Signing (Public Trust).
3. **Service Principal & GitHub Secrets:**
   - Create an Azure Service Principal with `Code Signing Certificate Profile Signer` role.
   - Add GitHub repository secrets:
     - `AZURE_TENANT_ID`
     - `AZURE_CLIENT_ID`
     - `AZURE_CLIENT_SECRET`
     - `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
     - `AZURE_CERTIFICATE_PROFILE_NAME`

### Phase 2: Build & Signing Pipeline Automation
1. **Electron Builder Configuration:**
   - Update `desktop/package.json` to define Windows NSIS target with custom signing hook.
2. **Dedicated GitHub Workflow (`.github/workflows/release-windows-signed.yml`):**
   - Trigger on dated release tags (`vYYYY.MM.DD`) via `workflow_dispatch`.
   - Windows Server 2025 runner (`windows-latest`).
   - Run full CCTI desktop test suite (`npm run check`).
   - Build NSIS packages via `npm run dist:win:x64` and `npm run dist:win:arm64`.
   - Sign executables, DLLs, and uninstallers using `azure/trusted-signing-action`.
   - Generate SHA-256 sidecars and `latest.yml` update metadata.
   - Stage to draft GitHub release.

### Phase 3: Validation, Website Sync & Public Launch
1. **Clean VM Validation:**
   - Download the signed installer to a clean Windows 11 VM.
   - Verify Authenticode signature (`Get-AuthenticodeSignature -FilePath <installer>`).
   - Confirm launch without SmartScreen warning.
   - Verify Step 1 "Verify setup" panel accurately identifies Windows runtime state.
2. **Website & Distribution Sync:**
   - Update `claudetool.app` Windows download card: replace portable ZIP instructions with direct "Download for Windows (64-bit)" button.
   - Maintain SHA-256 digest transparency on the download card.
