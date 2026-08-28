# Secure Developer ID Certificate Transfer

Use this guide only to move a **Developer ID Application certificate with its private key** from your primary signing Mac to the Mac that builds the Claude Code Tools Installer. The certificate/private-key pair is a signing identity. Treat the exported `.p12` file like a production secret.

> Never upload the `.p12` file, its export password, an Apple ID password, an app-specific password, or an App Store Connect `.p8` file to this repository, chat, email, issue tracker, shared drive, or unencrypted cloud storage.

## Option A — Export the existing signing identity from the primary Mac

This option is correct when the primary Mac already signs releases and Keychain Access shows the **Developer ID Application** certificate with its attached private key.

1. On the primary Mac, open **Keychain Access**. Select **login** under Keychains and **My Certificates** under Category.
2. Locate `Developer ID Application: <legal entity> (<team ID>)`. Expand it. The private key must appear beneath the certificate. If it does not, this Mac cannot export a usable signing identity.
3. Select the certificate identity and its private key, then choose **File → Export Items**. Save as a password-protected `.p12` file in a short-lived local folder, such as a folder in Downloads.
4. Use a unique, high-entropy export password. Do not reuse the macOS login password or an Apple ID password.
5. Transfer the encrypted `.p12` through a secure direct channel. AirDrop directly to the target Mac is preferred. If you must use removable media, encrypt the media and erase it after both import and verification. Communicate the export password through a separate trusted channel.
6. Delete the temporary `.p12` from the primary Mac only after the target Mac’s Keychain verification passes and the transfer is no longer needed. Empty Trash afterwards.

Apple documents that Keychain Access can export certificates and keys, protects the exported item with a password, and imports it into a chosen destination keychain. [1]

## Option B — Create a new Developer ID Application certificate for this Mac

Use this option if the private key is unavailable on the primary Mac, or if you deliberately want a new signing identity for the target Mac.

1. On the target Mac, open **Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority**. Create a certificate-signing request (`.certSigningRequest`) and keep its private key in the target Mac’s login Keychain.
2. Sign in to Apple Developer **Certificates, Identifiers & Profiles** with an Account Holder role.
3. Create a **Developer ID Application** certificate, upload the CSR from the target Mac, and download the resulting `.cer` file.
4. Double-click the `.cer` on the target Mac to import it into the login Keychain. Because the CSR and private key were created on this Mac, the certificate should pair with that private key.
5. Do **not** revoke the existing Developer ID certificate unless you have confirmed that no existing production release or signing workflow relies on it. Apple permits up to five Developer ID Application certificates. [2]

A downloaded `.cer` file alone does **not** carry the private key from another Mac. That is why Option A requires a protected `.p12`, while Option B creates a new local private key first.

## Import and verify on the target Mac

Import via Keychain Access instead of putting the `.p12` password in Terminal history:

1. Open **Keychain Access**, select the **login** keychain, then choose **File → Import Items**.
2. Select the transferred `.p12`, choose **login** as the destination, and enter the `.p12` export password when macOS prompts.
3. In **My Certificates**, expand the imported Developer ID Application identity and confirm a private key appears beneath it.
4. Run the read-only verification command:

```bash
security find-identity -v -p codesigning
```

The output must list a valid `Developer ID Application: …` identity. Then use that exact visible name as `CSC_NAME` for the release build:

```bash
export CSC_NAME="Developer ID Application: YOUR LEGAL ENTITY (YOUR_TEAM_ID)"
```

Do not print, copy, or store the certificate’s private-key material. The release configuration reads the identity from Keychain at build time.

## Cleanup and access control

Keep the signing identity in the target Mac’s **login** Keychain, protected by the macOS account and disk encryption. Delete the transferred `.p12` immediately after a successful build-and-notarization dry run. If another person will operate releases, use a dedicated macOS account or CI secret manager rather than sharing the exported identity casually.

## References

[1] [Apple — Import and export Keychain items](https://support.apple.com/guide/keychain-access/import-and-export-keychain-items-kyca35961/mac)

[2] [Apple Developer — Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)
