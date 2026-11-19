# Ondura – admin guide

For IT administrators who roll out Ondura in a company, school or other organisation. End users only need the [README](../README.md) or the website [ondura.mirranet.de](https://ondura.mirranet.de).

Contents:

1. [Installation](#installation)
2. [Updates](#updates)
3. [Microsoft 365](#microsoft-365)
4. [Exchange Server (on-premises)](#exchange-server-on-premises)
5. [IMAP mail servers](#imap-mail-servers)
6. [CalDAV / CardDAV](#caldav--carddav)
7. [S/MIME](#smime)
8. [Network requirements](#network-requirements)
9. [Data and credentials](#data-and-credentials)
10. [Macros and security](#macros-and-security)

## Installation

### Windows

Each release contains two installers for Windows 10/11 (64-bit):

| File | Use |
| --- | --- |
| `Ondura_<version>_x64_Setup.exe` | Interactive setup in the Ondura design – for users who install themselves |
| `Ondura_<version>_x64_SilentInstall.exe` | Plain NSIS installer – for software distribution and silent installs |

Ondura is always installed **per machine** into `C:\Program Files\Ondura` and needs administrator rights. One binary contains all apps; the installer adds a Start menu entry for each app that is installed and registers the file types `.docx`, `.xlsx`, `.pptx`, `.odt`, `.ods` and `.odp` for the office apps.

Silent installation with the NSIS installer:

```bat
Ondura_<version>_x64_SilentInstall.exe /S                 :: all apps
Ondura_<version>_x64_SilentInstall.exe /S /MAILONLY       :: Ondura Mail only
Ondura_<version>_x64_SilentInstall.exe /S /OFFICEONLY     :: Text, Tabellen, Präsentation only
Ondura_<version>_x64_SilentInstall.exe /S /D=D:\Apps\Ondura   :: other folder (/D= must be last)
```

Without `/MAILONLY` or `/OFFICEONLY`, an update keeps the apps chosen at the last installation (stored in `HKLM\Software\MirraNET\Ondura`). A running Ondura is closed by the installer. Uninstall silently with `"C:\Program Files\Ondura\uninstall.exe" /S`; user data stays in the user profiles (see [Data and credentials](#data-and-credentials)).

WebView2 is part of Windows 10/11 and is not installed separately.

### Linux

| Package | Install |
| --- | --- |
| `.deb` (Debian, Ubuntu, Mint) | `sudo apt install ./ondura_<version>_amd64.deb` |
| `.rpm` (Fedora, openSUSE, RHEL) | `sudo dnf install ./ondura-<version>-1.x86_64.rpm` |
| `.AppImage` | make it executable and run it; no installation |

The packages install all apps with one `.desktop` file each. Passwords are stored via the Secret Service (GNOME Keyring, KWallet); without one, Ondura falls back to a file readable only by the user and shows a warning in the settings.

## Updates

Ondura checks the [GitHub releases](https://github.com/Ondura-Suite/Ondura-Core/releases) at start, at most every 12 hours, and via *Hilfe › Nach Updates suchen*. A new version is downloaded in the background and its signature is checked against the key built into Ondura. A *Restart* button then appears in the title bar; clicking it installs the update silently and restarts Ondura. There is no installer window and no administrator prompt.

Installation is done by a small, privileged update helper that is part of the package. It accepts only files signed with the Ondura update key and only versions newer than the installed one, so users can update Ondura without being able to install anything else with it.

- **Windows:** the setup registers the service **Ondura Update** (`OnduraUpdate`, `ondura.exe --update-service`, LocalSystem, manual start). Signed-in users may start it, but not change or stop it. It copies the verified installer to a private temp folder and runs it with `/S /UPDATE`, which keeps the selected apps. Log: `%ProgramData%\Ondura\update.log`. If the service is missing or disabled, Ondura falls back to a single UAC prompt. Disable automatic installation for users with `sc config OnduraUpdate start= disabled` and distribute new versions yourself.
- **Linux (`.deb`/`.rpm`):** the package installs the systemd units `ondura-update.path` and `ondura-update.service`. Ondura drops a request into `/var/lib/ondura/updates` (sticky, write-only for users); the path unit starts `ondura --apply-update` as root, which verifies the package, reads its version from the package itself, and installs it with `dpkg -i` / `rpm -U`. Logs: `journalctl -u ondura-update.service`. Disable with `systemctl disable --now ondura-update.path`; Ondura then falls back to `pkexec`.
- **AppImage:** replaces itself if the user can write the file.
- **macOS:** the new `Ondura.app` replaces the installed bundle after the signature check. If the user can't write to its folder (e.g. `/Applications` for a standard user), macOS asks for an administrator password; to manage updates yourself, deploy Ondura to `/Applications` and don't give users admin rights.

The update check needs access to `api.github.com`, `github.com` and `objects.githubusercontent.com`. If these are blocked, Ondura simply finds no updates.

## Microsoft 365

Ondura signs in to Microsoft 365, Exchange Online and Outlook.com with **Microsoft Graph** and OAuth 2.0 (authorization code with PKCE, in the user's browser). It uses a multi-tenant app registration of the publisher, **MirraNET**, so you don't need to register an app yourself.

### Permissions

Ondura only uses **delegated** permissions: it acts as the signed-in user and can't access anything the user can't.

| Permission | Used for |
| --- | --- |
| `openid`, `profile`, `email`, `offline_access`, `User.Read` | Sign-in, staying signed in |
| `Mail.ReadWrite`, `Mail.Send` | E-mail |
| `Calendars.ReadWrite` | Calendar, meeting invitations, free/busy |
| `Contacts.ReadWrite` | Contacts |
| `Tasks.ReadWrite` | Tasks (Microsoft To Do) |
| `Files.ReadWrite` | Sharing attachments over 150 MB via the user's OneDrive |
| `MailboxSettings.ReadWrite` | Automatic replies |
| `Mail.ReadWrite.Shared`, `Mail.Send.Shared`, `Calendars.ReadWrite.Shared`, `Contacts.ReadWrite.Shared` | Shared mailboxes |
| `Files.ReadWrite.All`, `Sites.Read.All` | Office apps: open and save documents in OneDrive, files shared with the user and the SharePoint sites they follow (asked for when signing in under *Datei › Konto*; personal accounts only get `Files.ReadWrite.All`) |
| `People.Read`, `User.ReadBasic.All` | Address suggestions from the global address list, organization chart |
| `Place.Read.All` (optional) | Room finder – needs admin consent, never asked for at sign-in |

Planner plans appear in Tasks with `Tasks.ReadWrite` (plans of the groups the user belongs to). Calendar sharing and opening colleagues' calendars use `Calendars.ReadWrite.Shared`.

### Allowing Ondura in your tenant

If users may consent to apps themselves, they can just sign in. If your tenant requires **admin consent**, users see "Administratorgenehmigung erforderlich". To approve Ondura for the whole organisation:

1. Sign in to Ondura Mail once with an account that is a *Global Administrator*, *Cloud Application Administrator* or *Application Administrator*.
2. In Microsoft's consent prompt, tick **Consent on behalf of your organization** and accept.

Afterwards Ondura appears in the [Entra admin center](https://entra.microsoft.com) under *Enterprise applications*. There you can:

- review and revoke the granted permissions (*Permissions*),
- grant admin consent for all permissions including `Place.Read.All` (*Permissions › Grant admin consent for …*) – this enables the room finder,
- limit Ondura to assigned users or groups (*Properties › Assignment required*, then *Users and groups*),
- apply Conditional Access policies (Ondura is a public client application that signs in through the system browser).

When a new Ondura version needs an additional permission, users are asked to sign in again the first time they use the feature; with admin consent you grant it once for everybody.

### Restricting sign-in to your organisation

Under *Konto hinzufügen › Microsoft 365 › Erweiterte Einstellungen*, users can enter the domain or tenant ID of the organisation (*Nur Konten dieser Organisation*). Sign-in then goes directly to your tenant instead of `common`.

### Using your own app registration (optional)

Organisations that want full control can register Ondura in their own tenant and enter its client ID under *Erweiterte Einstellungen › Eigene Anwendungs-ID*:

1. [Entra admin center](https://entra.microsoft.com) › *App registrations* › *New registration*. Name: `Ondura`. Supported account types: *Accounts in this organizational directory only*.
2. Redirect URI: platform **Public client/native (mobile & desktop)**, URI `http://localhost` (any port is allowed for loopback).
3. *Authentication*: **Allow public client flows** = *Yes*.
4. *API permissions*: add the delegated Microsoft Graph permissions from the table above, then *Grant admin consent*.
5. *Branding & properties*: optionally upload the Ondura logo.
6. Give users the *Application (client) ID*.

### OneDrive and SharePoint in the office apps

Under *Datei › Konto* users sign in with their Microsoft account (separately from Ondura Mail). The office apps then open and save documents in OneDrive for Business and in the document libraries of the SharePoint sites the user follows; documents in the cloud are saved automatically. A Microsoft 365 mail account set up in Ondura Mail gives access to its own OneDrive without another sign-in. Sharing links (*Datei › Freigeben*) follow the sharing settings of your tenant.

### Shared mailboxes and rooms

- To open a shared mailbox (*Ansicht › Freigegebenes Postfach*), the user needs **Full Access** to it, and **Send As** or **Send on Behalf** to send from it (Exchange admin center › *Recipients › Mailboxes › Mailbox delegation*).
- The room finder lists room mailboxes from the directory (Graph `places`, which needs `Place.Read.All`). Rooms should belong to a room list so they are grouped by building.
- Automatic replies set in Ondura are the same as in Outlook (`mailboxSettings`); your Exchange policies for external replies apply.

## Exchange Server (on-premises)

Exchange Server 2013 SP1 and newer is supported via **Exchange Web Services (EWS)**:

- EWS must be reachable for the clients, usually `https://mail.<domain>/EWS/Exchange.asmx`.
- Authentication: NTLMv2 or Basic over HTTPS. User name as `DOMAIN\user` or `user@domain`.
- Certificates from an internal CA: Ondura shows the certificate and its SHA-256 fingerprint and can trust it after the user confirms.
- New mail arrives via EWS streaming notifications.
- Calendars, contacts, free/busy, room lists (`GetRoomLists`/`GetRooms`), automatic replies (`Get/SetUserOofSettings`) and shared mailboxes (Full Access) are supported.

Exchange Online can't be used via EWS: Microsoft is disabling it from 1 October 2026 and removing it on 1 April 2027. Use the Microsoft 365 account type instead.

## IMAP mail servers

| Service | Default port |
| --- | --- |
| IMAP with TLS / STARTTLS | 993 / 143 |
| SMTP with TLS / STARTTLS (submission) | 465 / 587 |
| ManageSieve (automatic replies) | 4190 |

- **Automatic setup:** when a user enters an address, Ondura looks for the settings in this order: `https://autoconfig.<domain>/mail/config-v1.1.xml`, `https://<domain>/.well-known/autoconfig/mail/config-v1.1.xml`, the Thunderbird ISP database (`autoconfig.thunderbird.net`, also for the domain of the MX host), DNS SRV records (RFC 6186: `_imaps._tcp`, `_imap._tcp`, `_submissions._tcp`, `_submission._tcp`) and finally `imap.`/`smtp.`/`mail.<domain>`, the domain and the MX host on the ports above. Every server is checked with a TLS handshake before it is suggested; plain-text servers are never suggested. To give your users the right settings, publish an autoconfig file or SRV records. Domains whose MX points to Microsoft 365 are offered the Microsoft 365 sign-in; a domain whose Autodiscover asks for NTLM/Negotiate is offered Exchange (EWS).
- New mail arrives via IMAP IDLE.
- **Automatic replies** need ManageSieve (RFC 5804) with the Sieve `vacation` extension, e.g. Dovecot with Pigeonhole (`protocols = … sieve`, `managesieved`). Ondura uploads a script named `ondura` and activates it. If the user already has an active Sieve script, Ondura's script includes it (needs the `include` extension) and activates it again when the reply is switched off. ManageSieve connects to the IMAP server name on port 4190 with STARTTLS and the account's credentials.
- Self-signed certificates can be trusted per server after confirming the SHA-256 fingerprint.

## CalDAV / CardDAV

Calendars, address books and task lists of any CalDAV/CardDAV server (Nextcloud, Radicale, SOGo, mailbox.org, iCloud, …). The server address is enough; collections are discovered via `.well-known`, the principal and the home sets. For Nextcloud, users should use an app password.

## S/MIME

- Users import their own certificate with private key as PKCS#12 (`.p12`/`.pfx`) under *Einstellungen › S/MIME*. Exports from Windows, macOS, Firefox and OpenSSL work (PBES2/AES, 3DES and legacy RC2). Only **RSA** keys are supported.
- The private key is stored in the OS credential store; certificates in the local profile.
- Signatures are checked against the Mozilla root store. Certificates from an internal CA show "Aussteller unbekannt" until the user chooses *Vertrauen* on a signed message (trusting the sender's certificate). Central distribution of trusted CAs isn't available yet.
- Ondura signs with SHA-256 and encrypts with AES-256-CBC (RSA key transport), which current Outlook, Thunderbird and Apple Mail read. Certificates of recipients are learned from signed messages they sent; the global address list isn't searched for certificates yet.
- Encrypted messages are stored encrypted on disk and only decrypted for display.

## Network requirements

| Destination | Purpose |
| --- | --- |
| `login.microsoftonline.com`, `graph.microsoft.com` | Microsoft 365 sign-in and data |
| `*.sharepoint.com`, `*.1drv.com`, `*.files.1drv.com` | Downloading and uploading OneDrive/SharePoint documents |
| your Exchange server (HTTPS) | Exchange Server via EWS |
| your IMAP/SMTP/ManageSieve server | IMAP accounts |
| your CalDAV/CardDAV server (HTTPS) | Calendars and contacts |
| `api.github.com`, `github.com`, `objects.githubusercontent.com` | Update check and download |
| `autoconfig.thunderbird.net`, `cloudflare-dns.com`, `autoconfig.<domain>`, `autodiscover.<domain>` | Automatic account setup (only the domain of the address is sent; MX/SRV lookups via DNS over HTTPS) |
| `api.open-meteo.com`, `geocoding-api.open-meteo.com` | Weather in the calendar (only when switched on; the place name is sent) |
| `api.languagetool.org` or your own LanguageTool server | Grammar check in Text (only when started; the document text is sent) |
| `libretranslate.com` or your own LibreTranslate server, `api.deepl.com` / `api-free.deepl.com` | Translation in Text (only when started; the text is sent) |
| any address users enter in *Daten abrufen › Web* | Data queries in Sheets |

Ondura sends no telemetry. Grammar check, translation and weather contact their services only when a user starts them; the server addresses can be changed in the dialogs (an own LanguageTool or LibreTranslate server keeps texts inside the company).

Dictation uses the dictation of the operating system on Windows (Win+H) and the speech recognition of the web view elsewhere; read aloud uses the speech engine of the system. Live captions and Presenter Coach in Slides need the speech recognition of the web view, which is not available on every system.

## Data and credentials

| | Windows | Linux |
| --- | --- | --- |
| Mail, calendar and contact cache, settings, S/MIME certificates | `%APPDATA%\MirraNET\Ondura\data` | `~/.local/share/ondura` |
| Passwords, OAuth refresh tokens, S/MIME private keys | Windows Credential Manager | Secret Service (GNOME Keyring / KWallet) |
| User interface profile (window state, macros) | `%LOCALAPPDATA%\de.mirranet.ondura` | `~/.local/share/de.mirranet.ondura` |
| Installed apps | `C:\Program Files\Ondura\components.ini` | – |

The cache can be deleted at any time; Ondura downloads everything again. Removing an account in Ondura deletes its cache and its stored credentials.

## Macros and security

- HTML mail is shown in a sandbox: scripts never run, and remote content is blocked until the user allows it.
- Ondura macros are JavaScript scripts that users write or record themselves. They are stored in the user's profile, never in documents, so opening a file can't run code.
- VBA macros in `.xlsm`, `.docm` or `.pptm` files are never run. Ondura warns when opening such a file; saving it with Ondura doesn't keep the VBA project.
