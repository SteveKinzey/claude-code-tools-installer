# Microsoft Store MSIX readiness

## Purpose

This guide is the no-certificate-cost fallback for **Claude Code Tools Installer**. It does not create a Microsoft account, submit an app, charge the owner, change the live ZIP download, or create a Store listing.

For an app submitted as **MSIX** through the Microsoft Store, Microsoft signs the Store-delivered package after certification. This avoids buying and managing a separate code-signing certificate. A direct-download NSIS EXE is different: it still needs its own trusted Authenticode signature. [1]

## Current readiness

| Item | Current state | Action before a Store submission |
|---|---|---|
| App model | Electron app packaged as an NSIS EXE and ZIP | A Store-only AppX/MSIX build command is prepared; it does not alter the default NSIS/ZIP command. |
| Store identity | Not reserved | Owner must create or use a Partner Center account and reserve the display name. |
| Publisher value | Unknown until reservation | Copy the exact Partner Center publisher identity into the package configuration; do not invent it. |
| AppX tile assets | Required Store logo, square 150, square 44, and wide 310×150 images are in `desktop/build/appx/` | Keep the validated images with the Windows build inputs. |
| Store configuration | Placeholder template plus guarded local resolver | Set the three exact Partner Center values as environment variables; the resolver refuses to build with blanks or placeholders. |
| Windows build validation | Not available in this macOS/Linux workspace | Build and test the AppX/MSIX on a Windows build machine after identity values exist. |
| Listing and certification | Not started | Provide screenshots, description, privacy-policy URL, support URL, age rating, and availability answers in Partner Center. |

## Safe next sequence

1. The owner confirmed that **“M6” means Microsoft Store MSIX**. This remains the free Store-delivery path under evaluation.
2. The owner opens or uses a Partner Center account and reserves the app identity. This step can involve account and business information, so it must be completed or explicitly approved by the owner.
3. Copy—not guess—the Partner Center **Identity name**, **Application ID**, and **Publisher** fields. Put them in the three environment variables shown below, not in source control.
4. Run the guarded resolver and build the Store-only AppX/MSIX package on Windows.
5. Test the package on a clean Windows machine. Confirm the app launches, all installer adapters are present, and the app uninstalls cleanly.
6. Submit the free app for Store certification. Microsoft signs the Store package only after it completes this process.

## Configuration template and resume command

Fill the bracketed values only after they come from Partner Center. Keep the existing NSIS target alongside this configuration.

```json
{
  "win": { "target": ["nsis", "appx"] },
  "appx": {
    "identityName": "[Partner Center identity name]",
    "applicationId": "[Partner Center application ID]",
    "publisher": "[Partner Center publisher value]",
    "publisherDisplayName": "SK America LLC",
    "displayName": "Claude Code Tools Installer",
    "languages": ["en-US"],
    "capabilities": ["runFullTrust", "internetClient"],
    "minVersion": "10.0.17763.0"
  }
}
```

Do not add guessed values to `desktop/package.json`. Electron Builder requires the publisher setting to match the certificate subject, and a mismatched Store identity can prevent package installation. [2]

On the Windows build machine, after the owner supplies the exact reserved values, set them for the current PowerShell session and run the Store build:

```powershell
$env:CCTI_APPX_IDENTITY_NAME = "<exact Partner Center Identity name>"
$env:CCTI_APPX_APPLICATION_ID = "<exact Partner Center Application ID>"
$env:CCTI_APPX_PUBLISHER = "<exact Partner Center Publisher>"

cd desktop
npm run msix:prepare
npm run dist:win:store
```

`msix:prepare` writes an ignored local resolved configuration only after all three values are present and the four required tile images exist. `dist:win:store` makes an AppX/MSIX target only. It does not submit the package, change price, create a Partner Center account, or replace the current Windows ZIP.

## Cost and user experience

Microsoft’s current Windows documentation states that Microsoft Store certification re-signs MSIX packages and says Store developer registration has zero registration fees in its current publishing overview. Confirm the current registration and account conditions in Partner Center before entering any business or tax information. The app can remain free to Windows users; Store use does not require charging them. [1] [3]

> A Store route does not make a direct EXE signed. It provides Microsoft-signed Store delivery for the MSIX package. The current direct Windows ZIP remains available and accurately labeled until a separate signed EXE exists.

## References

[1] [Microsoft — Code Signing Options for Windows App Developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)

[2] [Electron Builder — AppX Configuration](https://www.electron.build/docs/appx)

[3] [Microsoft — Publish Apps and Games to Microsoft Store on Windows](https://learn.microsoft.com/en-us/windows/apps/publish/)
