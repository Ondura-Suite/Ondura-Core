// Demo backend used when the frontend runs in a plain browser (`npm run dev`)
// instead of inside Tauri. Keeps UI work possible without a mail account.

import { threadKeyOf } from "./format";
import type { Account, Folder, MessageDetail, MessageSummary, OutgoingMessage } from "./types";

const now = Date.now();
const h = 3600_000;
const iso = (offsetHours: number) => new Date(now - offsetHours * h).toISOString();

export const mockAccounts: Account[] = [
  {
    id: "acc-mirranet",
    displayName: "Demo Benutzer",
    email: "demo@mirranet.de",
    kind: {
      type: "imap",
      imapHost: "mail.mirranet.de",
      imapPort: 993,
      imapSecurity: "tls",
      smtpHost: "mail.mirranet.de",
      smtpPort: 587,
      smtpSecurity: "startTls",
      username: "demo@mirranet.de",
    },
    color: "#4f54d4",
    signature: "<p>Viele Grüße<br>Demo Benutzer</p>",
  },
  {
    id: "acc-m365",
    displayName: "Demo Benutzer",
    email: "demo@contoso.onmicrosoft.com",
    kind: { type: "graph", tenant: "common", clientId: "demo" },
    color: "#107c41",
  },
];

const folder = (accountId: string, id: string, name: string, role: Folder["role"], unread = 0, total = 0, parentId: string | null = null): Folder => ({
  id: `${accountId}:${id}`,
  accountId,
  remoteId: id,
  name,
  parentId: parentId ? `${accountId}:${parentId}` : null,
  role,
  unreadCount: unread,
  totalCount: total,
});

export const mockFolders: Folder[] = [
  folder("acc-mirranet", "INBOX", "Posteingang", "inbox", 4, 11),
  folder("acc-mirranet", "Drafts", "Entwürfe", "drafts", 0, 1),
  folder("acc-mirranet", "Sent", "Gesendete Elemente", "sent", 0, 2),
  folder("acc-mirranet", "Archive", "Archiv", "archive", 0, 0),
  folder("acc-mirranet", "Junk", "Junk-E-Mail", "junk", 0, 0),
  folder("acc-mirranet", "Trash", "Gelöschte Elemente", "trash", 0, 0),
  folder("acc-mirranet", "Projekte", "Projekte", "other", 1, 1),
  folder("acc-mirranet", "Projekte/Jenkins", "Jenkins", "other", 1, 1, "Projekte"),
  folder("acc-m365", "inbox", "Posteingang", "inbox", 1, 2),
  folder("acc-m365", "sentitems", "Gesendete Elemente", "sent", 0, 0),
  folder("acc-m365", "deleteditems", "Gelöschte Elemente", "trash", 0, 0),
];

let seq = 0;
const msg = (
  folderId: string,
  hoursAgo: number,
  fromName: string,
  fromEmail: string,
  subject: string,
  html: string,
  opts: Partial<MessageSummary> = {},
): MessageDetail => {
  const accountId = folderId.split(":")[0];
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return {
    summary: {
      id: `m${++seq}`,
      accountId,
      folderId,
      remoteId: String(seq),
      subject,
      from: { name: fromName, email: fromEmail },
      to: [{ name: "Demo Benutzer", email: accountId === "acc-m365" ? "demo@contoso.onmicrosoft.com" : "demo@mirranet.de" }],
      cc: [],
      date: iso(hoursAgo),
      preview: text.slice(0, 200),
      isRead: false,
      isFlagged: false,
      hasAttachments: false,
      importance: "normal",
      internetMessageId: `<demo-${seq}@example.com>`,
      threadKey: threadKeyOf(subject),
      ...opts,
    },
    body: { html: `<div style="font-family:Segoe UI,sans-serif;font-size:14px">${html}</div>`, text: null, attachments: [] },
  };
};

const INBOX = "acc-mirranet:INBOX";

export const mockMessages: MessageDetail[] = [
  msg(INBOX, 0.3, "Jenkins", "jenkins@builds.example.com", "Build #142 erfolgreich: Nexora/main",
    "<p>Der Build <b>#142</b> von <b>Nexora/main</b> war erfolgreich.</p><p>Dauer: 4 min 12 s<br>Artefakte: nexora_0.1.0_amd64.deb, Nexora_0.1.0_x64-setup.exe</p>"),
  msg(INBOX, 1.5, "Sophie Berger", "sophie.berger@example.com", "Termin Donnerstag – Projektabstimmung",
    "<p>Hallo,</p><p>passt dir Donnerstag um 14 Uhr für die Projektabstimmung? Ich bringe die Entwürfe mit.</p><p>Viele Grüße<br>Sophie</p>",
    { isFlagged: true, hasAttachments: true, categories: ["Projekt Nexora"] }),
  msg(INBOX, 3, "Hosting Service", "noreply@hosting.example", "Ihre Rechnung für November",
    "<p>Sehr geehrter Kunde,</p><p>Ihre Rechnung für den Abrechnungszeitraum November steht im Kundenkonto zur Verfügung.</p>", { isRead: true }),
  msg(INBOX, 5, "Lukas Wagner", "lukas@example.org", "Re: Testlauf der neuen Version",
    "<p>Moin,</p><p>hab die neue Version getestet – läuft bei mir problemlos. Nur die Benachrichtigungen kommen manchmal doppelt.</p><p>Gruß Lukas</p>"),
  msg(INBOX, 26, "GitHub", "noreply@github.example", "[LinzN/Nexora] Neues Issue: Dark Mode im Lesebereich",
    "<p>Ein neues Issue wurde eröffnet: <b>Dark Mode im Lesebereich</b></p><p>HTML-Mails sollten im dunklen Design invertiert werden.</p>", { isRead: true }),
  msg(INBOX, 30, "Anna Schmitt", "anna.schmitt@example.com", "Fotos vom Wochenende",
    "<p>Hi! Anbei die Fotos vom Samstag. War ein schöner Tag 🙂</p>", { isRead: true, hasAttachments: true }),
  msg(INBOX, 50, "Backup-Server", "backup@example.com", "Backup abgeschlossen",
    "<p>Das nächtliche Backup wurde nach 41 min erfolgreich abgeschlossen (128 GB).</p>", { isRead: true }),
  msg(INBOX, 75, "Max Becker", "max.becker@example.net", "Angebot Serverschrank",
    "<p>Guten Tag,</p><p>anbei wie besprochen das Angebot für den 19\"-Serverschrank inklusive Montage.</p><p>Mit freundlichen Grüßen<br>Max Becker</p>",
    { importance: "high", hasAttachments: true, categories: ["Rot"] }),
  msg(INBOX, 170, "Monitoring", "monitoring@example.com", "Wochenbericht",
    "<p>Diese Woche: 99,98 % Verfügbarkeit, keine Störungen.</p>", { isRead: true }),
  msg(INBOX, 200, "Julia Hoffmann", "julia@example.com", "Feedback zur App",
    "<p>Die neue Ansicht ist super! Kleiner Bug: Beim Wechsel der Sprache bleibt die Liste hängen.</p>", { isRead: true }),
  msg(INBOX, 400, "Tom Richter", "tom@example.org", "Grillen am See?",
    "<p>Wer ist dabei? Samstag ab 16 Uhr.</p>", { isRead: true }),
  msg("acc-mirranet:Projekte/Jenkins", 8, "Jenkins", "jenkins@builds.example.com", "Build #141 fehlgeschlagen: Demo/main",
    "<p>Der Build <b>#141</b> von <b>Demo/main</b> ist fehlgeschlagen.</p><pre>error[E0308]: mismatched types</pre>"),
  msg("acc-mirranet:Drafts", 6, "Demo Benutzer", "demo@mirranet.de", "Angebot Wartungsvertrag",
    "<p>Guten Tag,</p><p>anbei unser Angebot für den Wartungsvertrag 2027 …</p>", { isRead: true, to: [{ name: "Max Becker", email: "max.becker@example.net" }] }),
  msg("acc-mirranet:Sent", 2, "Demo Benutzer", "demo@mirranet.de", "Re: Termin Donnerstag – Projektabstimmung",
    "<p>Hallo Sophie,</p><p>Donnerstag 14 Uhr passt. Bis dann!</p>", { isRead: true }),
  msg("acc-mirranet:Sent", 9, "Demo Benutzer", "demo@mirranet.de", "Testlauf der neuen Version",
    "<p>Hi Lukas,</p><p>kannst du die neue Version mal testen? Download liegt auf dem Buildserver.</p><p>Danke!</p>", { isRead: true, to: [{ name: "Lukas Wagner", email: "lukas@example.org" }] }),
  msg("acc-m365:inbox", 4, "Microsoft 365", "no-reply@microsoft.example", "Willkommen bei Microsoft 365",
    "<p>Ihr Konto ist eingerichtet. Nexora Mail ist über Microsoft Graph verbunden.</p>"),
  msg("acc-m365:inbox", 48, "Kunde", "kunde@example.com", "Anfrage: Angebot für 20 Stück",
    "<p>Guten Tag, können Sie mir ein Angebot für 20 Stück schicken?</p>", { isRead: true }),
];

mockMessages[3].body.attachments.push({ id: "ics", name: "einladung.ics", contentType: "text/calendar", size: 640, isInline: false, contentId: null });
mockMessages[1].body.attachments = [
  { id: "0", name: "Entwurf_v2.pdf", contentType: "application/pdf", size: 482_133, isInline: false, contentId: null },
];
mockMessages[5].body.attachments = [
  { id: "0", name: "IMG_2041.jpg", contentType: "image/jpeg", size: 2_310_000, isInline: false, contentId: null },
  { id: "1", name: "IMG_2042.jpg", contentType: "image/jpeg", size: 2_145_000, isInline: false, contentId: null },
];
mockMessages[7].body.attachments = [
  { id: "0", name: "Angebot_2026-117.pdf", contentType: "application/pdf", size: 96_512, isInline: false, contentId: null },
];

export function mockSend(accountId: string, m: OutgoingMessage) {
  const sent = mockFolders.find((f) => f.accountId === accountId && f.role === "sent");
  if (!sent) return;
  const account = mockAccounts.find((a) => a.id === accountId)!;
  const d = msg(sent.id, 0, account.displayName, account.email, m.subject, m.bodyHtml, { isRead: true, to: m.to });
  mockMessages.unshift(d);
}
