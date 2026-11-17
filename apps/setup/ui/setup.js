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
  $("where").textContent = `Wird installiert in: ${info.installDir}`;
  const go = $("go");
  go.disabled = false;

  const inst = info.installed;
  if (inst && inst.perMachine) {
    $("title").textContent = "Nexora ist bereits installiert";
    note(`Nexora ${inst.version} ist für alle Benutzer installiert. Bitte deinstallieren Sie diese Version zuerst unter „Einstellungen → Apps“.`, true);
    go.disabled = true;
  } else if (inst && info.compare < 0) {
    $("title").textContent = "Nexora aktualisieren";
    $("subtitle").textContent = `Version ${inst.version} ist installiert. Das Update auf ${info.version} übernimmt alle Konten, E-Mails und Einstellungen.`;
    go.textContent = "Aktualisieren";
  } else if (inst && info.compare === 0) {
    $("title").textContent = "Nexora ist auf dem neuesten Stand";
    $("subtitle").textContent = `Version ${inst.version} ist bereits installiert. Sie können sie bei Problemen neu installieren – Konten und Daten bleiben erhalten.`;
    go.textContent = "Neu installieren";
  } else if (inst && info.compare > 0) {
    $("title").textContent = "Neuere Version installiert";
    $("subtitle").textContent = `Installiert ist Version ${inst.version}, dieses Setup enthält ${info.version}.`;
    go.disabled = true;
  }
  if (info.running && inst) note("Nexora ist gerade geöffnet und wird für das Update kurz beendet.");
  if (info.legacy) note("Die alte Installation „Mirra Office“ wird dabei entfernt. Ihre Daten wurden bereits übernommen.");
  if (!info.supported) note("Dieses Setup läuft nur unter Windows.", true), (go.disabled = true);
  else if (!info.hasPayload) note("Dieses Setup enthält kein Installationspaket (Entwicklungs-Build).", true), (go.disabled = true);
  show("start");
}

async function run() {
  const updating = info.installed && !info.installed.perMachine;
  $("ptitle").textContent = updating ? "Nexora wird aktualisiert …" : "Nexora wird installiert …";
  $("fill").className = "indeterminate";
  $("fill").style.width = "";
  show("progress");
  try {
    installDir = await invoke("install");
    $("dtitle").textContent = updating ? "Update abgeschlossen!" : "Alles erledigt!";
    $("dtext").textContent = updating
      ? `Nexora ist jetzt auf Version ${info.version}. Ihre Konten und E-Mails sind unverändert da.`
      : "Nexora ist installiert. Orbit finden Sie im Startmenü und auf dem Desktop.";
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
$("retry").onclick = () => init();
$("launch").onclick = async () => {
  try {
    await invoke("launch", { dir: installDir });
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
