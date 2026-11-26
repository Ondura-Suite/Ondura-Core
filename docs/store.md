# Ondura in the Microsoft Store (MSIX)

Besides the installers on the releases page, every Windows build makes
MSIX packages for the Microsoft Store. The Store signs them after
certification, distributes them and installs updates, so the Store versions
need no code signing certificate and show no SmartScreen warning.

There are three packages, each its own product in the Store:

| Package | File | Contents |
| --- | --- | --- |
| **Ondura** | `Ondura_<version>_x64.msix` | the whole suite ([Store page](https://apps.microsoft.com/detail/9nzhmbcz0v85), product ID `9NZHMBCZ0V85`) |
| **Ondura Mail** | `OnduraMail_<version>_x64.msix` | Ondura Mail on its own (mail, calendar, contacts, tasks) |
| **Ondura PDF** | `OnduraPDF_<version>_x64.msix` | Ondura PDF on its own |

## What the package contains

| | |
| --- | --- |
| Manifest | `apps/ondura/src-tauri/msix/AppxManifest.xml` (template) |
| Texts (de-DE, en-US, fr-FR) | `apps/ondura/src-tauri/msix/Strings/<language>/Resources.resw` |
| Logos | rendered from the app icons by `scripts/msix-assets.py` |
| Check | the MSIX step fails if a logo of the manifest is missing or not indexed in `resources.pri` (the dump is the artifact `msix-resources-dump`) |
| Build | `scripts/windows-msix.ps1` → `target/release/bundle/msix/*.msix` (`-Package suite\|mail\|pdf` for one) |

- The Store accepts at most 8 `Application`s (Start entries) per package.
  Ondura (start page), Ondura Mail, Text, Sheets, Slides, PDF, Notes and
  Diagrams have one; Planner and Forms start from the Ondura start page,
  and `.ondform` files open in Forms through an extension of the Ondura
  entry. The programs are the same as in the NSIS installation
  (`ondura-<app>.exe` and `ondura_core.dll`).
- File types (`.docx`, `.odt`, `.xlsx`, `.ods`, `.pptx`, `.odp`, `.pdf`,
  `.drawio`, `.ondform`) belong to the matching app, `mailto:` to Ondura
  Mail. As with every app, the user picks Ondura as the default in
  *Settings › Apps › Default apps*.
- The standalone packages contain `ondura.exe`, `ondura_core.dll` and
  their own program (`ondura-mail.exe` or `ondura-pdf.exe`), and only the
  Start entry of that app from the same manifest. A `components.ini` with
  `apps=mail` (or `apps=pdf`) tells the app that it is the only one: the
  start page is never shown, and a document of another app (a `.docx` from
  Ondura PDF, say) opens in the program Windows has for it.
- The package depends on `Microsoft.VCLibs.140.00.UWPDesktop` (C/C++
  runtime); the Store installs it automatically.
- The manifest declares `runFullTrust`, as every packaged desktop program
  must. Partner Center asks why: *"Ondura is a desktop application (Win32,
  WebView2). It needs full trust to run its own programs, access the files
  the user opens and connect to mail servers (IMAP, SMTP, Exchange)."*

## Differences from the NSIS installation

When Ondura runs from the package (`src-tauri/src/package.rs` detects
the package identity):

- **Updates** come from the Store. Ondura's own updater is off; *Check for
  updates* says so and opens the Store's download page.
- **Taskbar and notifications** use the AppUserModelIDs of the Start
  entries (`<package family name>!Mail`, `!Text`, …).
- **Data**: Windows keeps files that a packaged app writes to `%APPDATA%`
  and `%LOCALAPPDATA%` in the package's own folder. The Store version
  therefore does not see the accounts and settings of an NSIS installation
  on the same PC, and its data is removed when it is uninstalled.
  Passwords are in the Windows Credential Manager in both cases.
- There is no choice of apps (each package installs its apps) and no
  desktop shortcut option.
- Ondura and a standalone package can be installed side by side. They are
  separate installations: their own data, their own instance pipes; only
  the passwords in the Credential Manager are shared.

## Publishing

1. **Developer account** in [Partner Center](https://partner.microsoft.com/dashboard)
   (free for individuals and companies).
2. **Reserve the names** *Ondura*, *Ondura Mail* and *Ondura PDF* (Apps
   and games › New product › MSIX or PWA app), one product each.
3. **Product identity** (Product management › Product identity of each
   product): set these values as repository variables in GitHub (Settings ›
   Secrets and variables › Actions › Variables):

   | Variable | Partner Center |
   | --- | --- |
   | `MSIX_PUBLISHER` | Package/Identity/Publisher (`CN=…`, the same for all three) |
   | `MSIX_PUBLISHER_DISPLAY_NAME` | Package/Properties/PublisherDisplayName |
   | `MSIX_IDENTITY_NAME` | Package/Identity/Name of *Ondura* |
   | `MSIX_DISPLAY_NAME` | reserved name (optional, default *Ondura*) |
   | `MSIX_MAIL_IDENTITY_NAME` | Package/Identity/Name of *Ondura Mail* |
   | `MSIX_MAIL_DISPLAY_NAME` | reserved name (optional, default *Ondura Mail*) |
   | `MSIX_PDF_IDENTITY_NAME` | Package/Identity/Name of *Ondura PDF* |
   | `MSIX_PDF_DISPLAY_NAME` | reserved name (optional, default *Ondura PDF*) |

4. **Build**: run the release as usual (Actions › Release › Run workflow).
   The three `.msix` files are attached to the GitHub release and are the
   artifact `ondura-msix` of the *Build* run. If the MSIX step fails,
   the installers and the release are still made (the step is marked with
   a warning).
5. **Submission** in Partner Center, for each product:
   - *Packages*: upload its `.msix` (`OnduraMail_…` for *Ondura Mail*, …).
   - *Properties*: category *Productivity*; privacy policy URL (required,
     Ondura handles mail, contacts and calendars): [privacy.md](privacy.md)
     ([German](privacy.de.md)).
   - *Age ratings*: questionnaire (no user-generated content shared
     through Ondura, no purchases).
   - *Store listings* in German, English and French: description,
     screenshots (`docs/screenshots`), search terms. Name Microsoft products
     only to say what Ondura works with ("works with Microsoft 365 and
     Exchange"), without their logos.
   - *Restricted capabilities*: justification for `runFullTrust` (above).
6. Certification takes up to three business days. For every new version,
   create a new submission of each product with its new `.msix` (the version must be higher
   than the last one; the fourth part is always 0).

## Trying the package locally

The unsigned package cannot be installed by double-clicking. To test the
package layout:

```powershell
# Developer Mode on: Settings › System › For developers
pwsh scripts/windows-msix.ps1        # after a release build (npx tauri build)
Add-AppxPackage -Register target\msix\suite\layout\AppxManifest.xml   # or mail, pdf
```

The apps then appear in the Start menu. Remove them with
`Get-AppxPackage *Ondura* | Remove-AppxPackage`.
