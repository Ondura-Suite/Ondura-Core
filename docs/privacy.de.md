# Datenschutzerklärung – Ondura

*Stand: 22. November 2026 · [English version](privacy.md)*

Ondura ist ein Programm, das auf Ihrem Computer läuft. Der Entwickler betreibt
keinen Server für Ondura und erhält, erhebt oder speichert keine personenbezogenen
Daten über Sie oder über die Inhalte, mit denen Sie arbeiten.

## Verantwortlich

Niklas Linz (MirraNET)
Bezirksstraße 109, 66440 Niederwürzbach, Deutschland
E-Mail: niklas.linz@mirranet.de

## Was auf Ihrem Computer bleibt

- E-Mails, Termine, Kontakte und Aufgaben, die Ondura für die Offline-Nutzung vorhält,
  Ihre Einstellungen, Notizbücher, Pläne und zuletzt verwendeten Dateien liegen nur auf Ihrem Computer.
- Passwörter und Anmelde-Token liegen in der Windows-Anmeldeinformationsverwaltung
  (unter Linux im Secret Service, unter macOS im Schlüsselbund).
- Dokumente, die Sie öffnen oder speichern, bleiben dort, wo Sie sie ablegen.
- Wenn Sie Ondura über den Microsoft Store deinstallieren, werden die Daten der Store-Version entfernt.

Ondura enthält keine Telemetrie, keine Analyse, keine Werbung und keine Absturzberichte.

## Verbindungen, die Ondura aufbaut

Ondura verbindet sich direkt mit den Diensten, die Sie einrichten oder nutzen. Der
Entwickler ist an diesen Verbindungen nicht beteiligt; es gelten die Datenschutzerklärungen
dieser Dienste.

| Dienst | Wann | Was übertragen wird |
| --- | --- | --- |
| Ihre Mail-, Kalender- und Kontaktserver (IMAP/SMTP, Exchange, CalDAV/CardDAV) | Solange Ondura Mail läuft | Ihre Anmeldung und die Daten, die Sie senden oder abgleichen |
| Microsoft 365 / Microsoft-Konto (`login.microsoftonline.com`, `graph.microsoft.com`, OneDrive, SharePoint) | Wenn Sie ein solches Konto hinzufügen oder Dateien aus OneDrive/SharePoint öffnen | Anmeldung über Microsoft, danach Ihre Mails, Termine, Kontakte, Aufgaben, Notizbücher, Pläne und Dateien, so wie Sie sie nutzen |
| Automatische Kontoeinrichtung (`autoconfig.thunderbird.net`, `cloudflare-dns.com`, `autoconfig.<Domain>`, `autodiscover.<Domain>`, `/.well-known/ondura-server` auf `<Domain>` und `mail.<Domain>`) | Beim Hinzufügen eines Kontos | Nur die Domain Ihrer E-Mail-Adresse |
| Wetter im Kalender (Open-Meteo) | Nur wenn Sie es einschalten | Der eingegebene Ortsname |
| Grammatikprüfung (LanguageTool) | Nur wenn Sie sie in Ondura Text starten | Der geprüfte Text, an den im Dialog eingestellten Server |
| Übersetzung (LibreTranslate oder DeepL) | Nur wenn Sie sie in Ondura Text starten | Der zu übersetzende Text und bei DeepL Ihr eigener API-Schlüssel |
| Webdaten in Ondura Tabellen | Nur wenn Sie eine solche Abfrage anlegen | Eine Anfrage an die eingegebene Adresse |
| Updates (GitHub) | Nur bei der Version von der Website; die Store-Version aktualisiert der Microsoft Store | Eine Abfrage nach neuen Versionen; GitHub sieht dabei Ihre IP-Adresse |

## Microsoft Store

Wenn Sie Ondura über den Microsoft Store installieren, verarbeitet Microsoft Daten für
Download, Lizenzierung und Updates nach der
[Microsoft-Datenschutzerklärung](https://privacy.microsoft.com/de-de/privacystatement).
Der Entwickler erhält nur die zusammengefassten, anonymen Statistiken, die Microsoft
allen Anbietern zur Verfügung stellt (etwa die Zahl der Installationen).

## Kinder

Ondura richtet sich nicht an Kinder und erhebt keine Daten über sie.

## Ihre Rechte

Da der Entwickler keine personenbezogenen Daten über Sie hat, gibt es bei uns nichts
einzusehen, zu berichtigen oder zu löschen. Ihre Daten in Ondura liegen unter Ihrer Kontrolle
auf Ihrem Computer und bei Ihrem Mail- oder Cloud-Anbieter. Bei Fragen schreiben Sie an die
oben genannte Adresse. Sie haben außerdem das Recht, sich bei einer
Datenschutz-Aufsichtsbehörde zu beschweren.

## Änderungen

Ändert sich diese Erklärung, wird die neue Fassung hier mit neuem Datum veröffentlicht.
