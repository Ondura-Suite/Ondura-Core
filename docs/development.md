# Ondura – developer guide

How Ondura is built, how to build it from source, and how releases are made. To use Ondura, download it from the [releases page](https://github.com/Ondura-Suite/Ondura-Core/releases) instead; see the [README](../README.md).

## Repository layout

```
Ondura-Core/
├── apps/
│   ├── ondura/              # the desktop suite (Tauri 2)
│   │   ├── src/             #   UI: React 19 + Fluent UI 9 (translations in src/locales)
│   │   │   ├── shell/       #     shared UI: title bar, theme, accessibility checker, macros
│   │   │   ├── lib/         #     API bindings and demo data for the browser
│   │   │   └── apps/        #     launcher (start page), mailwindow, mail, calendar, contacts, tasks, text, sheets, slides
│   │   ├── src-tauri/       #   Rust host: commands, windows, credential store, updater, installer
│   │   ├── public/          #   splash screen and app icons
│   │   └── branding/        #   logo source (ondura.svg)
│   └── setup/               # Ondura Setup for Windows (embeds the NSIS installer)
├── crates/
│   ├── mail-core/           # mail model, SQLite store, provider trait, sync engine, S/MIME keyring
│   ├── mail-imap/           # IMAP (async-imap) + SMTP (lettre), IDLE, ManageSieve
│   ├── mail-graph/          # Microsoft Graph (mail, calendar, contacts, To Do)
│   ├── mail-ews/            # Exchange Web Services (Exchange Server, NTLM)
│   ├── pim-core/            # calendars, contacts, tasks: model, store, iCalendar/vCard, recurrence, reminders
│   ├── pim-dav/             # CalDAV + CardDAV
│   ├── smime/               # S/MIME in pure Rust: X.509, PKCS#12, CMS
│   ├── i18n/                # translations of backend messages (tr!)
│   └── office/              # Office Open XML and OpenDocument reader/writer
├── docs/                    # admin guide, this guide, screenshots
├── scripts/release.sh       # version bump + tag
├── .github/workflows/       # CI: tests, installers, releases
└── Jenkinsfile              # alternative build on a Linux agent
```

## Architecture

- **Local first.** The UI reads only from local SQLite stores (`mail.sqlite`, `pim.sqlite`). `SyncEngine` and `PimEngine` mirror server state into them.
- **Action queue.** User actions (read, flag, move, delete, send, save draft) change the store immediately and are queued in `pending_ops`. A background flusher sends them in order and retries with backoff (15 s up to 15 min) while the server is unreachable. A sync that runs before a queued change reached the server does not undo it locally. Messages the server refuses stay in the outbox.
- **Push.** IMAP keeps an IDLE connection on the inbox; EWS uses streaming notifications; Graph polls the inbox every minute (change notifications would need a public webhook). All folders are synced every few minutes.
- **Separate connections.** IMAP uses one connection for background sync, one for user actions and one for IDLE, so opening a message never waits behind a sync. Every operation has a timeout; broken connections are re-established.
- **Protocols are adapters.** Mail adapters implement `MailProvider` (`crates/mail-core/src/provider.rs`), calendar/contact adapters `PimProvider` (`crates/pim-core/src/provider.rs`). Graph and EWS implement both.
- **One binary, many apps.** `ondura --app mail|text|sheets|slides` opens an app (`calendar`, `contacts`, `tasks` open Ondura Mail on that module); without arguments it opens the start page. A second launch hands its arguments to the running instance, so all apps are windows of one process and share accounts, stores and sync.
- **Own title bar.** Windows have no native decorations; the header is the title bar (Windows 11 style buttons on all systems).
- **Secrets** (passwords, OAuth refresh tokens, S/MIME keys) live in the OS credential store; without one, in a user-only `secrets.json` with a warning in the settings.
- **Search.** SQLite FTS5 over subject, sender and text (prefix matching, umlauts folded). Encrypted messages are not indexed and stay encrypted in the store.
- **S/MIME** (`crates/smime`): BER/DER reader, X.509, PKCS#12 (PBES2, PKCS#12 PBE with 3DES/RC2), CMS SignedData and EnvelopedData (AES-CBC, 3DES, RSA PKCS#1 v1.5 and OAEP). Chains are checked against `webpki-roots`. `mail-core::smime` holds the process-wide keyring; message parsing (`preview::parse_body`) and the adapters' send paths call into it.
- **Office formats** (`crates/office`): each format has a reader and writer to a JSON-serialisable model shared with the UI. Parts the model doesn't cover are reported as warnings (*Datei › Informationen*).
- **Extras without a file format counterpart.** Sheets keeps slicers, threaded comments, sheet views, in-cell checkboxes and data queries as JSON in the custom document property `OnduraExtras` (`docProps/custom.xml`); other apps ignore it, and threaded comments are also written as notes. Text and Slides map their features to standard OOXML (OMML equations, `wps` shapes, VML watermarks, `w:documentProtection`, `p14:sectionLst`, PowerPoint comments).
- **Web services** (`src-tauri/src/textservices.rs`, `weather.rs`): LanguageTool, LibreTranslate/DeepL, Open-Meteo and the web source of data queries are called from Rust only when the user starts them. Speech output uses the system engine (PowerShell System.Speech, `say`, `spd-say`/`espeak`); dictation, live captions and Presenter Coach use the web view's speech recognition (Windows dictation via Win+H for Text).
- **Design.** Outlook/Office layout with its own look: "Ondura Indigo", a soft colour backdrop and translucent surfaces (`src/shell/theme.tsx`, `src/styles.css`).

## Building

Requirements: Rust ≥ 1.90 and Node.js ≥ 20.

- **Linux (Debian/Ubuntu):**
  ```sh
  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev build-essential
  ```
- **Windows:** Visual Studio Build Tools (C++ workload). WebView2 is part of Windows 10/11.

```sh
cd apps/ondura
npm ci
npx tauri dev                       # development, with hot reload
npx tauri build                     # installers in target/release/bundle/
npx tauri build --bundles deb       # only the .deb package
```

`npm run dev` alone starts the UI in the browser with **demo data** – handy for UI work without any account.

### Build-time settings

| Variable | Purpose |
| --- | --- |
| `ONDURA_GRAPH_CLIENT_ID` | Client ID of the Entra app registration used for Microsoft 365 sign-in. Without it, users have to enter a client ID when adding a Microsoft 365 account. |
| `ONDURA_UPDATE_PUBKEY` | Minisign public key for updates. Without it, Ondura announces updates but only links to the release page. |

Official builds get both from the repository variables. A fork that publishes its own builds needs its own app registration (see [admin guide › Using your own app registration](admin.md#using-your-own-app-registration-optional), with *Accounts in any organizational directory and personal Microsoft accounts*) and its own update key.

## Tests

```sh
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cd apps/ondura && npm test
```

- Office formats: fixtures created with python-docx, openpyxl and python-pptx, plus round trips (read → write → read).
- S/MIME: fixtures made with OpenSSL 3 (`crates/smime/tests/fixtures`) – PKCS#12 in OpenSSL 3, Windows and legacy formats, detached and opaque signatures, AES, 3DES and RSA-OAEP encryption. Ondura's output was verified with `openssl smime`.
- Graph and EWS: mock servers (`crates/mail-graph/tests`, `crates/mail-ews/tests`); the NTLM crypto is checked against the MS-NLMP test vectors.

Tests against real servers (ignored or skipped by default):

```sh
# IMAP (e.g. a local Dovecot): sync, IDLE, flags, action queue, move/delete, drafts
ONDURA_IMAP_TEST_PORT=10993 ONDURA_IMAP_TEST_USER=test@localhost ONDURA_IMAP_TEST_PASS=secret \
ONDURA_IMAP_TEST_CA=/path/to/ca.pem cargo test -p ondura-mail-imap --test dovecot -- --ignored --test-threads=1

# ManageSieve automatic replies (Dovecot with Pigeonhole, port 4190)
ONDURA_SIEVE_TEST=127.0.0.1:user:password cargo test -p ondura-mail-imap live_server

# CalDAV/CardDAV (e.g. Radicale with a calendar "privat" and an address book "kontakte")
ONDURA_DAV_URL=http://127.0.0.1:5232/user/ ONDURA_DAV_USER=user ONDURA_DAV_PASS=password \
cargo test -p ondura-pim-dav --test radicale -- --ignored --test-threads=1
```

## Continuous integration

- **GitHub Actions** (`.github/workflows/build.yml`): every push runs the tests and builds Ondura Setup and the NSIS installer for Windows, `.deb`/`.rpm`/`.AppImage` for Linux and a universal `.dmg` (plus `Ondura_<version>_universal.app.tar.gz` for the updater) for macOS. A tag `vX.Y.Z` publishes a GitHub release.
- **Jenkins** (`Jenkinsfile`): builds everything on a Linux agent; the Windows installer is cross-compiled with [cargo-xwin](https://github.com/rust-cross/cargo-xwin). Agent setup (Debian/Ubuntu):
  ```sh
  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
                   build-essential file nsis lld llvm clang
  curl https://sh.rustup.rs -sSf | sh -s -- -y        # as the jenkins user
  rustup target add x86_64-pc-windows-msvc
  cargo install --locked cargo-xwin
  # plus Node.js >= 20
  ```
  Job parameters: `BUILD_WINDOWS` (default on) and `GRAPH_CLIENT_ID`.

Repository settings used by the workflow:

| Name | Kind | Content |
| --- | --- | --- |
| `ONDURA_GRAPH_CLIENT_ID` | variable | Client ID of the Entra app registration |
| `ONDURA_UPDATE_PUBKEY` | variable | Content of `update.key.pub` |
| `TAURI_SIGNING_PRIVATE_KEY` | secret | Content of `update.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | secret | Its password, if set |

## Releases and updates

The updater (`apps/ondura/src-tauri/src/update.rs`) reads the latest release of `Ondura-Suite/Ondura-Core`, downloads the installer for the running system from that repository's release assets and installs it only if its minisign signature (`<file>.sig`) matches `ONDURA_UPDATE_PUBKEY`.

The download runs in the background (`update_download`), `update_install` hands the verified file to the privileged helper in `update_helper.rs`, which checks the signature and version again before installing:

- Windows: service `OnduraUpdate` (registered in `windows/installer-hooks.nsh`), entry point `ondura.exe --update-service`.
- Linux: `linux/ondura-update.path` + `linux/ondura-update.service` (installed with `linux/postinst.sh`), entry point `ondura --apply-update`.

Fallbacks are a UAC prompt (Windows) and `pkexec` (Linux).

One-time key setup:

```sh
cd apps/ondura
npx tauri signer generate -w ~/.ondura/update.key
```

Keep `update.key` and its password safe: without them no further updates can be published, and installed versions only accept updates signed with this key. Never commit the private key.

Publishing a release – either in GitHub under *Actions › Release › Run workflow* (optionally with a version; empty means the current version if it hasn't been released yet, otherwise the next patch version), or locally:

```sh
scripts/release.sh 0.2.0          # sets the version everywhere, commits and tags
git push origin main v0.2.0       # CI builds, signs and publishes the release
```

Both end in the *Build* workflow for the tag, which signs the installers (secrets `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) and attaches them to the GitHub release. Builds of other commits only keep the installers as workflow artifacts (zipped by GitHub).

## Windows code signing

Unsigned Windows builds get SmartScreen warnings and are sometimes reported by Defender's machine learning (e.g. `Trojan:Win32/Bearfoos.B!ml`) – an installer that unpacks and starts another installer, as Ondura Setup does, looks like a dropper to these heuristics. Authenticode signing fixes this; `scripts/windows-sign.ps1` signs `ondura.exe`, the NSIS installer and uninstaller (as Tauri's `signCommand`, set by CI) and Ondura Setup. Configure one of:

- **Azure Artifact Signing** (formerly Trusted Signing; for organisations in the EU, individual developers only in the USA and Canada): secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` (app registration with the *Artifact Signing Certificate Profile Signer* role), `ARTIFACT_SIGNING_ENDPOINT` (e.g. `https://weu.codesigning.azure.net`), `ARTIFACT_SIGNING_ACCOUNT`, `ARTIFACT_SIGNING_PROFILE`.
- **A code signing certificate as `.pfx`**: secrets `WINDOWS_CERTIFICATE` (base64 of the file) and `WINDOWS_CERTIFICATE_PASSWORD`.

Without them the build stays unsigned. Until then, a false positive can be reported at <https://www.microsoft.com/wdsi/filesubmission> (*Software developer*, select *Incorrectly detected as malware*).

## macOS

- One universal bundle (`--target universal-apple-darwin`), macOS 11 or later. Without the optional secrets `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` (signing) and `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` (notarization) the app is signed ad hoc, and Gatekeeper asks users to confirm the first start (right-click › Open, or *System Settings › Privacy & Security*).
- Windows keep the system traffic lights over Ondura's own title bar (`chrome` in `windows.rs`, left padding in `SuiteHeader.tsx`).
- `src/macos.rs`: menu bar (its *Edit* menu makes ⌘C/⌘V work in the webview), documents opened from Finder (`RunEvent::Opened`), Dock click without windows (`RunEvent::Reopen`).
- PDF export: WKWebView print operation saved to a file (`pdf.rs`). Updates: `Ondura.app.tar.gz` replaces the bundle (`install_macos` in `update.rs`).
- Shortcut labels show ⌘ instead of Strg/Ctrl (`tl()`); keyboard handlers accept `metaKey` like `ctrlKey`.

## Context menus and taskbar

- The webview's own context menu is turned off in every window (`src/shell/contextMenu.tsx`, rendered in `main.tsx`). Components open their own menu with `openContextMenu(e, items)` in an `onContextMenu` handler; text fields and selected text without one get a standard edit menu (undo, cut, copy, paste, select all). Paste reads the clipboard through `navigator.clipboard`, falling back to the clipboard plugin.
- All apps run in one process. On Windows every window gets its own AppUserModelID (`de.mirranet.ondura.<app>`, `windows.rs`) and the Start menu/desktop shortcuts the same id (`ONDURA_SET_AUMID` in `windows/installer-hooks.nsh`), so Mail, Text, Sheets and Slides have separate taskbar buttons and can be pinned separately.

## Translations

German is the source language: UI texts are written in German and wrapped in `tl()` (frontend) or `tr!()` (Rust); the German text is the key of the translation catalogs.

| Part | Function | Catalogs |
| --- | --- | --- |
| UI (`apps/ondura/src`) | `tl("Seite {0} von {1}", page, total)`, `tlc("app", "Tabellen")` for words with several meanings | `apps/ondura/src/locales/{en,fr}.json` |
| Backend (errors, notifications, tray, compatibility notes) | `ondura_i18n::tr!("Die Datei konnte nicht gelesen werden: {0}", e)` | `crates/i18n/locales/{en,fr}.json` |
| Windows setup (`apps/setup/ui`) | `T("…")` in `i18n.js` | `apps/setup/ui/i18n.js` |
| NSIS installer | `$(OnduraAppsTitle)` | `LangString`s in `windows/installer.nsi` |

- Placeholders are `{0}`, `{1}` …; keep them in every translation.
- The language is chosen in *Hilfe › Sprache* (stored in `localStorage` as `ondura.lang`, default: system language, fallback English). Each window reports it to the backend (`set_language`), which stores it for the next start.
- Dates and numbers use `LOCALE` from `src/lib/i18n.ts` instead of a fixed `"de-DE"`. The spreadsheet shows German function names only in the German UI.
- `src/lib/i18n.test.ts` fails when a `tl()` text has no English or French translation; texts that are the same in every language (brand names, fonts) go into `src/locales/same.json`. `crates/i18n` tests that placeholders survive.

A new language needs a catalog file per part, an entry in `LANGUAGES` (`src/lib/i18n.ts`) and `Lang` (`crates/i18n`), and the NSIS language in `tauri.conf.json`.

## Licenses

Ondura is licensed under GPL-3.0-or-later (`LICENSE`, `license.workspace = true` in every crate). All dependencies must be compatible with it – permissive licenses (MIT, Apache-2.0, BSD, ISC, Zlib, Unicode) and MPL-2.0 are fine; GPL-2.0-only, AGPL and proprietary licenses are not.

`THIRD-PARTY-NOTICES.txt` contains the license texts of all shipped Rust crates and npm packages and is bundled with the app (shown in *Hilfe › Über Ondura*). After changing dependencies, regenerate it:

```sh
(cd apps/ondura && npm ci)
python3 scripts/third-party-notices.py
```

CI fails if the committed file is out of date.

## Commit and documentation conventions

- Code comments and technical documentation are in English; the user interface is in German.
- `crates/office` is formatted with `rustfmt --edition 2024`; the other crates and the app use a wider style and are not run through rustfmt.
