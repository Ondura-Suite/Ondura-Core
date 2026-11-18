// UI logic of Nexora Setup (commands in src-tauri/src/main.rs).
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const win = window.__TAURI__.window.getCurrentWindow();
const $ = (id) => document.getElementById(id);

let info = null;
let installDir = null;

function show(id) {
  for (const s of ["start", "progress", "done", "error"]) $(s).hidden = s !== id;
}

function note(text, warn = false) {
  const el = document.createElement("div");
  el.className = warn ? "note warn" : "note";
  el.textContent = text;
  $("notes").appendChild(el);
}

async function init() {
  info = await invoke("setup_info");
  $("ver").textContent = `Version ${info.version}`;
  $("notes").replaceChildren();
  $("where").textContent = `Wird installiert in: ${info.installDir} · Administratorrechte erforderlich`;
  const go = $("go");
  go.disabled = false;

  const inst = info.installed;
  $("c-orbit").checked = info.components.orbit;
  $("c-office").checked = info.components.office;
  if (inst && !inst.perMachine) {
    $("title").textContent = "Nexora aktualisieren";
    $("subtitle").textContent = `Version ${inst.version} ist nur für Ihr Benutzerkonto installiert. Nexora ${info.version} wird jetzt für alle Benutzer installiert – Konten, E-Mails und Einstellungen bleiben erhalten.`;
    $("golabel").textContent = "Aktualisieren";
  } else if (inst && info.compare < 0) {
    $("title").textContent = "Nexora aktualisieren";
    $("subtitle").textContent = `Version ${inst.version} ist installiert. Das Update auf ${info.version} übernimmt alle Konten, E-Mails und Einstellungen.`;
    $("golabel").textContent = "Aktualisieren";
  } else if (inst && info.compare === 0) {
    $("title").textContent = "Nexora ändern";
    $("subtitle").textContent = `Version ${inst.version} ist installiert. Sie können Apps hinzufügen oder entfernen oder Nexora neu installieren – Konten und Daten bleiben erhalten.`;
    $("golabel").textContent = "Übernehmen";
  } else if (inst && info.compare > 0) {
    $("title").textContent = "Neuere Version installiert";
    $("subtitle").textContent = `Installiert ist Version ${inst.version}, dieses Setup enthält ${info.version}.`;
    go.disabled = true;
  }
  if (info.running && inst) note("Nexora ist gerade geöffnet und wird für das Update kurz beendet.");
  if (!info.supported) note("Dieses Setup läuft nur unter Windows.", true), (go.disabled = true);
  else if (!info.hasPayload) note("Dieses Setup enthält kein Installationspaket (Entwicklungs-Build).", true), (go.disabled = true);
  blocked = go.disabled;
  updateChoice();
  show("start");
}

let blocked = false;

function choice() {
  return { orbit: $("c-orbit").checked, office: $("c-office").checked };
}

function updateChoice() {
  const c = choice();
  $("go").disabled = blocked || (!c.orbit && !c.office);
}

async function run() {
  const updating = !!info.installed;
  $("ptitle").textContent = updating ? "Nexora wird aktualisiert …" : "Nexora wird installiert …";
  $("fill").className = "indeterminate";
  $("fill").style.width = "";
  const c = choice();
  for (const el of document.querySelectorAll("[data-part]")) el.hidden = !c[el.dataset.part];
  $("launch").textContent = c.orbit ? "Orbit öffnen" : "Nexora öffnen";
  show("progress");
  try {
    installDir = await invoke("install", c);
    $("dtitle").textContent = updating ? "Update abgeschlossen!" : "Alles erledigt!";
    $("dtext").textContent = updating
      ? `Nexora ist jetzt auf Version ${info.version}. Ihre Konten und E-Mails sind unverändert da.`
      : `Nexora ist für alle Benutzer installiert. ${c.orbit && c.office ? "Orbit und die Office-Apps finden" : c.orbit ? "Orbit finden" : "Text, Tabellen und Präsentation finden"} Sie im Startmenü und auf dem Desktop.`;
    show("done");
  } catch (e) {
    $("emsg").textContent = String(e);
    show("error");
  }
}

listen("setup-progress", ({ payload }) => {
  $("step").textContent = payload.step;
  const fill = $("fill");
  if (payload.fraction == null) {
    fill.className = "indeterminate";
    fill.style.width = "";
  } else {
    fill.className = "";
    fill.style.width = `${Math.round(payload.fraction * 100)}%`;
  }
});

$("go").onclick = run;
$("c-orbit").onchange = updateChoice;
$("c-office").onchange = updateChoice;
$("retry").onclick = () => init();
$("launch").onclick = async () => {
  try {
    await invoke("launch", { dir: installDir, app: choice().orbit ? "mail" : "home" });
  } finally {
    win.close();
  }
};
$("finish").onclick = () => win.close();
$("quit").onclick = () => win.close();
$("close").onclick = () => win.close();
$("min").onclick = () => win.minimize();

init().catch((e) => {
  $("emsg").textContent = String(e);
  show("error");
});
