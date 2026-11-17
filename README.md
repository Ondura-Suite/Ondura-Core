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
│   ├── mail-imap/    # IMAP (async-imap) + SMTP (lettre) adapter, IMAP IDLE
│   ├── mail-graph/   # Microsoft Graph adapter (Microsoft 365 / Exchange Online)
│   └── mail-ews/     # Exchange Web Services adapter (Exchange Server on-premises, NTLM)
└── apps/
    └── mirra-office/ # the desktop suite (Tauri 2)
        ├── src/          # UI: React + Fluent UI 9 (Microsoft's own design system)
        └── src-tauri/    # Rust host: commands, windows, OS keychain, installer config
```

* **Local first.** The UI reads only from the local SQLite store. The `SyncEngine` mirrors server state into that store.
* **Action queue.** User actions (read, flag, move, delete, send, save draft) change the store immediately and are queued in `pending_ops`. A background flusher sends them to the server in order. While the server is unreachable, it keeps them and retries with backoff (15 s up to 15 min), so the UI never waits for the network and nothing is lost offline. A sync that runs before a queued change has reached the server does not undo it locally. If the server refuses a message, it stays in the **outbox**, where it can be retried, edited or discarded.
* **Push.** IMAP accounts keep an IDLE connection on the inbox, so new mail shows up within seconds. Graph and EWS accounts poll the inbox every minute. All folders are synced every few minutes (configurable). New mail triggers a desktop notification.
* **Separate connections.** IMAP uses one connection for background sync, one for user actions and one for IDLE, so opening a message never waits behind a long sync. Every operation has a timeout, and broken connections are re-established automatically.
* **Protocols are adapters.** Each adapter implements `MailProvider` (`crates/mail-core/src/provider.rs`). A new protocol does not need changes to the UI or the store.
* **One binary, many apps.** The whole suite is a single executable. `mirra-office --app mail` opens Mirra Mail, and running it without arguments opens the start page. A second launch hands its arguments to the running instance (single instance), so every app runs as a window of the same process and they all share accounts, store and sync.
* **One installer for the whole suite.** The NSIS installer (Windows) and the `.deb`/`.rpm` packages (Linux) install the suite once and add a Start menu entry or `.desktop` file for each app (`src-tauri/windows/installer-hooks.nsh`, `src-tauri/linux/`).
* **Secrets** such as passwords and OAuth refresh tokens are stored in the OS credential store: Windows Credential Manager, or Secret Service (GNOME Keyring / KWallet) on Linux. They are never written to the database. On systems without a credential store, they fall back to a file that only the user can read (`secrets.json` in the data folder), and the settings show a warning.
* **Search.** An SQLite FTS5 index covers subject, sender and message text (prefix matching, umlauts folded).
* **Background mode.** Closing the last window keeps Mirra Office running in the tray (configurable), so mail and notifications keep arriving.
* **Privacy.** HTML mail is shown in a sandboxed iframe with a strict CSP: scripts never run, and remote images (tracking pixels) are blocked until the user allows them.

### Exchange support

Microsoft is switching off EWS in Exchange Online: it is being disabled step by step from 1 October 2026 and will be removed completely on 1 April 2027. Mirra Mail therefore uses:

| Server | Protocol | Status |
| --- | --- | --- |
| Microsoft 365 / Exchange Online / Outlook.com | **Microsoft Graph** (delta sync, OAuth 2.0 + PKCE) | ✅ |
| Exchange Server 2013 SP1+ (on-premises) | **EWS** (`SyncFolderItems`, MIME bodies), NTLMv2 or Basic | ✅ |
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

The Graph and EWS adapters are tested against mock servers (`crates/mail-graph/tests`, `crates/mail-ews/tests`); the EWS test includes the NTLM handshake, whose crypto is checked against the MS-NLMP test vectors.

The IMAP adapter has an integration test that runs against a real server (for example a local Dovecot) and covers sync, IDLE, flags, the action queue, move/delete, drafts and loading older messages:

```sh
MIRRA_IMAP_TEST_PORT=10993 MIRRA_IMAP_TEST_USER=test@localhost MIRRA_IMAP_TEST_PASS=secret \
MIRRA_IMAP_TEST_CA=/path/to/ca.pem cargo test -p mirra-mail-imap --test dovecot -- --ignored --test-threads=1
```

## Roadmap (Mirra Mail)

Done:

- [x] IMAP/SMTP, Microsoft Graph and EWS (Exchange Server) accounts
- [x] Action queue with offline support and an outbox
- [x] IMAP IDLE, desktop notifications, tray icon and background mode
- [x] Load older messages from the server, full-text search (FTS5)
- [x] Attachments when composing (incl. forwarding with the original attachments), drafts, signatures
- [x] Inline images (`cid:`) in the reading pane
- [x] Settings (sync interval, notifications, background mode, remote images, accounts)
- [x] Account status in the folder pane, re-login for expired credentials

Next:

- [ ] Conversation view (the store already computes a `threadKey` per message)
- [ ] Graph change notifications and EWS streaming notifications (push instead of polling)
- [ ] Server-side search
- [ ] Trusting custom/self-signed certificates per account
- [ ] Attachments larger than 150 MB for Microsoft 365
- [ ] Rules, categories, delayed sending
