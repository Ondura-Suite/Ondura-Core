# Mirra Office

An office suite for **Windows and Linux**, written in **Rust**, with a user interface modelled on Microsoft 365.

![Mirra Mail](docs/screenshots/mail-light.png)

| App | Status |
| --- | --- |
| **Mirra Mail**: e-mail for Microsoft 365 / Exchange Online, Exchange Server and IMAP | 🚧 first version |
| Mirra Kalender (calendar) | planned |
| Mirra Kontakte (contacts) | planned |
| Mirra Aufgaben (tasks) | planned |
| Mirra Text (word processor, `.docx`) | planned |
| Mirra Tabellen (spreadsheets, `.xlsx`) | planned |
| Mirra Präsentation (presentations, `.pptx`) | planned |

## Architecture

```
MirraOffice/
├── crates/
│   ├── mail-core/    # domain model, SQLite store, provider trait, sync engine
│   ├── mail-imap/    # IMAP (async-imap) + SMTP (lettre) adapter
│   └── mail-graph/   # Microsoft Graph adapter (Microsoft 365 / Exchange Online)
└── apps/
    └── mirra-office/ # the desktop suite (Tauri 2)
        ├── src/          # UI: React + Fluent UI 9 (Microsoft's own design system)
        └── src-tauri/    # Rust host: commands, windows, OS keychain, installer config
```

* **Local first.** The UI reads only from the local SQLite store. The `SyncEngine` mirrors server state into that store and sends user actions (read, flag, move, delete, send) back to the server. Each change is applied locally first and rolled back if the server rejects it.
* **Protocols are adapters.** Each adapter implements `MailProvider` (`crates/mail-core/src/provider.rs`). A new protocol does not need changes to the UI or the store.
* **One binary, many apps.** The whole suite is a single executable. `mirra-office --app mail` opens Mirra Mail, and running it without arguments opens the start page. A second launch hands its arguments to the running instance (single instance), so every app runs as a window of the same process and they all share accounts, store and sync.
* **One installer for the whole suite.** The NSIS installer (Windows) and the `.deb`/`.rpm` packages (Linux) install the suite once and add a Start menu entry or `.desktop` file for each app (`src-tauri/windows/installer-hooks.nsh`, `src-tauri/linux/`).
* **Secrets** such as IMAP passwords and OAuth refresh tokens are stored in the OS credential store: Windows Credential Manager, or Secret Service (GNOME Keyring / KWallet) on Linux. They are never written to the database.
* **Privacy.** HTML mail is shown in a sandboxed iframe with a strict CSP: scripts never run, and remote images (tracking pixels) are blocked until the user allows them.

### Exchange support

Microsoft is switching off EWS in Exchange Online: it is being disabled step by step from 1 October 2026 and will be removed completely on 1 April 2027. Mirra Mail therefore uses:

| Server | Protocol | Status |
| --- | --- | --- |
| Microsoft 365 / Exchange Online / Outlook.com | **Microsoft Graph** (delta sync, OAuth 2.0 + PKCE) | ✅ |
| Exchange Server (on-premises) | **EWS** (still supported on-prem) | planned (`AccountKind::Ews` exists) |
| Any other mail server | **IMAP + SMTP** (TLS / STARTTLS) | ✅ |
| Calendar/contacts | Graph / EWS / CalDAV + CardDAV | planned for Mirra Kalender & Kontakte |

The Graph sign-in already asks for `Calendars.ReadWrite` and `Contacts.ReadWrite`, so the calendar and contacts apps can reuse the account without signing in again.

## Microsoft 365 setup (one-time)

Graph needs an app registration in Microsoft Entra ID:

1. Go to <https://entra.microsoft.com> → *App registrations* → *New registration*.
2. Name: `Mirra Office`. Supported account types: *Accounts in any organizational directory and personal Microsoft accounts*.
3. Redirect URI: platform **Public client/native (mobile & desktop)**, URI `http://localhost`. Any port is allowed for loopback.
4. Under *Authentication*, set **Allow public client flows** to *Yes*.
5. Under *API permissions*, add these delegated Microsoft Graph permissions: `offline_access`, `User.Read`, `Mail.ReadWrite`, `Mail.Send`, `Calendars.ReadWrite`, `Contacts.ReadWrite`.
6. Copy the *Application (client) ID*. Either enter it in the "add account" dialog, or bake it into the build:
   ```sh
   MIRRA_GRAPH_CLIENT_ID=<client-id> npx tauri build
   ```
   In GitHub Actions, set the repository variable `MIRRA_GRAPH_CLIENT_ID`.

## Building

Requirements: Rust ≥ 1.90 and Node.js ≥ 20.

**Linux (Debian/Ubuntu):**
```sh
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev build-essential
```
**Windows:** Visual Studio Build Tools (C++ workload). WebView2 is part of Windows 10/11.

```sh
cd apps/mirra-office
npm ci
npx tauri dev                       # development, with hot reload
npx tauri build                     # installers in target/release/bundle/
npx tauri build --bundles deb       # only the .deb package
```

`npm run dev` on its own starts the UI in the browser with **demo data**, which is handy for UI work without a mail account.

### Jenkins

The `Jenkinsfile` builds everything on a **Linux agent**: tests, `.deb`/`.rpm`/`.AppImage`, and the **Windows installer** (NSIS), which is cross-compiled with [cargo-xwin](https://github.com/rust-cross/cargo-xwin). Artifacts are archived on the job.

One-time agent setup (Debian/Ubuntu):

```sh
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
                 build-essential file nsis lld llvm clang
curl https://sh.rustup.rs -sSf | sh -s -- -y        # as the jenkins user
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
# plus Node.js >= 20 (e.g. NodeSource packages)
```

Job parameters: `BUILD_WINDOWS` (default on) and `GRAPH_CLIENT_ID` (optional Entra client id baked into the build). On its first run, cargo-xwin downloads the Windows SDK/CRT headers from Microsoft and caches them in `~/.cache/cargo-xwin`.

### GitHub Actions

Every push builds the Windows installer (`.exe`, NSIS) and the Linux packages (`.deb`, `.rpm`, `.AppImage`) with GitHub Actions (`.github/workflows/build.yml`).

## Tests

```sh
cargo test --workspace
cargo clippy --workspace --all-targets
```

The IMAP adapter has an integration test that runs against a real server (for example a local Dovecot) and covers sync, flags, move and delete:

```sh
MIRRA_IMAP_TEST_PORT=10993 MIRRA_IMAP_TEST_USER=test@localhost MIRRA_IMAP_TEST_PASS=secret \
MIRRA_IMAP_TEST_CA=/path/to/ca.pem cargo test -p mirra-mail-imap --test dovecot -- --ignored
```

## Roadmap (Mirra Mail)

- [ ] EWS adapter for Exchange Server on-premises
- [ ] Offline outbox / queue for actions done offline
- [ ] IMAP IDLE and Graph change notifications (push instead of polling every 2 minutes)
- [ ] Conversation view (threading)
- [ ] Attachments when composing, drafts, signatures
- [ ] Load older messages beyond the sync window (500 per folder for IMAP, 90 days for Graph)
- [ ] Full-text search (SQLite FTS5) and server-side search
- [ ] Inline images (`cid:`) in the reading pane
- [ ] Tray icon and notifications for new mail
- [ ] Settings (sync interval, signatures, accounts)
- [ ] Trusting custom/self-signed certificates per account
