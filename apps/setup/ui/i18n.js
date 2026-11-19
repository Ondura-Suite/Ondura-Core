// Translations of the setup UI. German is the source text; the language
// follows the system (German, English, French; anything else: English).
// T("Version {0}", v) → translated text with placeholders filled in.

const LANG = (() => {
  const l = (navigator.languages?.[0] || navigator.language || "en").slice(0, 2).toLowerCase();
  return l === "de" || l === "fr" ? l : "en";
})();

const CATALOG = {
  en: {
    "Ondura als Standard-App festlegen": "Make Ondura the default app",
    "Für E-Mail-Links und Office-Dateien. Windows öffnet nach der Installation die Einstellungen, in denen Sie die Auswahl bestätigen.": "For email links and Office files. Windows opens Settings after the installation, where you confirm the choice.",
    "Bestätigen Sie Ondura in den Windows-Einstellungen als Standard-App.": "Confirm Ondura as the default app in Windows Settings.",
    "Minimieren": "Minimize",
    "Schließen": "Close",
    "Ondura installieren": "Install Ondura",
    "Wählen Sie die Apps, die für alle Benutzer dieses PCs installiert werden.": "Choose the apps to install for all users of this PC.",
    "E-Mail, Kalender, Kontakte und Aufgaben": "Email, calendar, contacts and tasks",
    "Office-Apps": "Office apps",
    "Text, Tabellen, Präsentation und PDF – werden gemeinsam installiert": "Text, Sheets, Slides and PDF – installed together",
    "Installieren": "Install",
    "Ondura wird installiert …": "Installing Ondura …",
    "Installation wird vorbereitet …": "Preparing installation …",
    "Ondura Tabellen": "Ondura Sheets",
    "Ondura Präsentation": "Ondura Slides",
    "Alles erledigt!": "All done!",
    "Ondura ist installiert. Ondura Mail finden Sie im Startmenü und auf dem Desktop.": "Ondura is installed. You'll find Ondura Mail in the Start menu and on the desktop.",
    "Ondura Mail öffnen": "Open Ondura Mail",
    "Ondura öffnen": "Open Ondura",
    "Das hat nicht geklappt": "That didn't work",
    "Erneut versuchen": "Try again",
    "Version {0}": "Version {0}",
    "Wird installiert in: {0} · Administratorrechte erforderlich": "Installs to: {0} · administrator rights required",
    "Ondura aktualisieren": "Update Ondura",
    "Version {0} ist nur für Ihr Benutzerkonto installiert. Ondura {1} wird jetzt für alle Benutzer installiert – Konten, E-Mails und Einstellungen bleiben erhalten.": "Version {0} is installed for your user account only. Ondura {1} will now be installed for all users – accounts, emails and settings are kept.",
    "Aktualisieren": "Update",
    "Version {0} ist installiert. Das Update auf {1} übernimmt alle Konten, E-Mails und Einstellungen.": "Version {0} is installed. The update to {1} keeps all accounts, emails and settings.",
    "Ondura ändern": "Modify Ondura",
    "Version {0} ist installiert. Sie können Apps hinzufügen oder entfernen oder Ondura neu installieren – Konten und Daten bleiben erhalten.": "Version {0} is installed. You can add or remove apps or reinstall Ondura – accounts and data are kept.",
    "Übernehmen": "Apply",
    "Neuere Version installiert": "Newer version installed",
    "Installiert ist Version {0}, dieses Setup enthält {1}.": "Version {0} is installed; this setup contains {1}.",
    "Ondura ist gerade geöffnet und wird für das Update kurz beendet.": "Ondura is open and will be closed briefly for the update.",
    "Dieses Setup läuft nur unter Windows.": "This setup only runs on Windows.",
    "Dieses Setup enthält kein Installationspaket (Entwicklungs-Build).": "This setup contains no installation package (development build).",
    "Ondura wird aktualisiert …": "Updating Ondura …",
    "Update abgeschlossen!": "Update complete!",
    "Ondura ist jetzt auf Version {0}. Ihre Konten und E-Mails sind unverändert da.": "Ondura is now on version {0}. Your accounts and emails are unchanged.",
    "Ondura ist für alle Benutzer installiert. Ondura Mail und die Office-Apps finden Sie im Startmenü und auf dem Desktop.": "Ondura is installed for all users. You'll find Ondura Mail and the Office apps in the Start menu and on the desktop.",
    "Ondura ist für alle Benutzer installiert. Ondura Mail finden Sie im Startmenü und auf dem Desktop.": "Ondura is installed for all users. You'll find Ondura Mail in the Start menu and on the desktop.",
    "Ondura ist für alle Benutzer installiert. Text, Tabellen und Präsentation finden Sie im Startmenü und auf dem Desktop.": "Ondura is installed for all users. You'll find Text, Sheets and Slides in the Start menu and on the desktop.",
  },
  fr: {
    "Ondura als Standard-App festlegen": "Définir Ondura comme application par défaut",
    "Für E-Mail-Links und Office-Dateien. Windows öffnet nach der Installation die Einstellungen, in denen Sie die Auswahl bestätigen.": "Pour les liens e-mail et les fichiers Office. Windows ouvre les Paramètres après l'installation, où vous confirmez le choix.",
    "Bestätigen Sie Ondura in den Windows-Einstellungen als Standard-App.": "Confirmez Ondura comme application par défaut dans les Paramètres Windows.",
    "Minimieren": "Réduire",
    "Schließen": "Fermer",
    "Ondura installieren": "Installer Ondura",
    "Wählen Sie die Apps, die für alle Benutzer dieses PCs installiert werden.": "Choisissez les applications à installer pour tous les utilisateurs de ce PC.",
    "E-Mail, Kalender, Kontakte und Aufgaben": "E-mail, calendrier, contacts et tâches",
    "Office-Apps": "Applications Office",
    "Text, Tabellen, Präsentation und PDF – werden gemeinsam installiert": "Texte, Tableur, Présentation et PDF – installés ensemble",
    "Installieren": "Installer",
    "Ondura wird installiert …": "Installation d'Ondura …",
    "Installation wird vorbereitet …": "Préparation de l'installation …",
    "Ondura Text": "Ondura Texte",
    "Ondura Tabellen": "Ondura Tableur",
    "Ondura Präsentation": "Ondura Présentation",
    "Alles erledigt!": "Terminé !",
    "Ondura ist installiert. Ondura Mail finden Sie im Startmenü und auf dem Desktop.": "Ondura est installé. Vous trouverez Ondura Mail dans le menu Démarrer et sur le bureau.",
    "Ondura Mail öffnen": "Ouvrir Ondura Mail",
    "Ondura öffnen": "Ouvrir Ondura",
    "Das hat nicht geklappt": "Cela n'a pas fonctionné",
    "Erneut versuchen": "Réessayer",
    "Version {0}": "Version {0}",
    "Wird installiert in: {0} · Administratorrechte erforderlich": "Installation dans : {0} · droits d'administrateur requis",
    "Ondura aktualisieren": "Mettre à jour Ondura",
    "Version {0} ist nur für Ihr Benutzerkonto installiert. Ondura {1} wird jetzt für alle Benutzer installiert – Konten, E-Mails und Einstellungen bleiben erhalten.": "La version {0} n'est installée que pour votre compte utilisateur. Ondura {1} va maintenant être installé pour tous les utilisateurs – les comptes, e-mails et paramètres sont conservés.",
    "Aktualisieren": "Mettre à jour",
    "Version {0} ist installiert. Das Update auf {1} übernimmt alle Konten, E-Mails und Einstellungen.": "La version {0} est installée. La mise à jour vers {1} conserve tous les comptes, e-mails et paramètres.",
    "Ondura ändern": "Modifier Ondura",
    "Version {0} ist installiert. Sie können Apps hinzufügen oder entfernen oder Ondura neu installieren – Konten und Daten bleiben erhalten.": "La version {0} est installée. Vous pouvez ajouter ou supprimer des applications ou réinstaller Ondura – les comptes et données sont conservés.",
    "Übernehmen": "Appliquer",
    "Neuere Version installiert": "Version plus récente installée",
    "Installiert ist Version {0}, dieses Setup enthält {1}.": "La version {0} est installée ; ce programme d'installation contient la {1}.",
    "Ondura ist gerade geöffnet und wird für das Update kurz beendet.": "Ondura est ouvert et sera brièvement fermé pour la mise à jour.",
    "Dieses Setup läuft nur unter Windows.": "Ce programme d'installation ne fonctionne que sous Windows.",
    "Dieses Setup enthält kein Installationspaket (Entwicklungs-Build).": "Ce programme d'installation ne contient aucun paquet (version de développement).",
    "Ondura wird aktualisiert …": "Mise à jour d'Ondura …",
    "Update abgeschlossen!": "Mise à jour terminée !",
    "Ondura ist jetzt auf Version {0}. Ihre Konten und E-Mails sind unverändert da.": "Ondura est maintenant en version {0}. Vos comptes et e-mails sont inchangés.",
    "Ondura ist für alle Benutzer installiert. Ondura Mail und die Office-Apps finden Sie im Startmenü und auf dem Desktop.": "Ondura est installé pour tous les utilisateurs. Vous trouverez Ondura Mail et les applications Office dans le menu Démarrer et sur le bureau.",
    "Ondura ist für alle Benutzer installiert. Ondura Mail finden Sie im Startmenü und auf dem Desktop.": "Ondura est installé pour tous les utilisateurs. Vous trouverez Ondura Mail dans le menu Démarrer et sur le bureau.",
    "Ondura ist für alle Benutzer installiert. Text, Tabellen und Präsentation finden Sie im Startmenü und auf dem Desktop.": "Ondura est installé pour tous les utilisateurs. Vous trouverez Texte, Tableur et Présentation dans le menu Démarrer et sur le bureau.",
  },
};

function T(text, ...args) {
  const s = (CATALOG[LANG] && CATALOG[LANG][text]) || text;
  return s.replace(/\{(\d+)\}/g, (m, i) => (Number(i) < args.length ? String(args[Number(i)]) : m));
}

// Static texts of index.html.
function translateDocument() {
  document.documentElement.lang = LANG;
  if (LANG === "de") return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue.trim();
    if (t && CATALOG[LANG][t]) n.nodeValue = n.nodeValue.replace(t, CATALOG[LANG][t]);
  }
  for (const el of document.querySelectorAll("[title], [aria-label], [alt]")) {
    for (const a of ["title", "aria-label", "alt"]) {
      const v = el.getAttribute(a);
      if (v && CATALOG[LANG][v]) el.setAttribute(a, CATALOG[LANG][v]);
    }
  }
}
translateDocument();
