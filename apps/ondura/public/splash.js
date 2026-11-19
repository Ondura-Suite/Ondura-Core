// Start screen shown while the app loads, in the style of the Office splash
// (logo, app name, running dots). It is plain DOM so it appears before the
// React bundle has been parsed; the app removes it with
// `window.__onduraSplashDone()` as soon as its first data is on screen.
(function () {
  var w = window;
  var hash = (location.hash.replace(/^#\/?/, "").split("/")[0] || w.__ONDURA_APP__ || "home");
  var mailApp = ["mail", "calendar", "contacts", "tasks", "message"].indexOf(hash) >= 0;
  var dark = false;
  var lang = "de";
  try {
    var t = localStorage.getItem("ondura.theme");
    dark = t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    var l = localStorage.getItem("ondura.lang") || (navigator.language || "de").slice(0, 2);
    if (l === "en" || l === "fr") lang = l;
  } catch (e) {}

  // Each app starts with its own logo, name and colour, like Office.
  var apps = {
    text: { logo: "text", color: "#2b5bd7", name: { de: "Ondura Text", en: "Ondura Text", fr: "Ondura Texte" } },
    sheets: { logo: "sheets", color: "#107c41", name: { de: "Ondura Tabellen", en: "Ondura Sheets", fr: "Ondura Tableur" } },
    slides: { logo: "slides", color: "#c43e1c", name: { de: "Ondura Präsentation", en: "Ondura Slides", fr: "Ondura Présentation" } },
    pdf: { logo: "pdf", color: "#c4314b", name: { de: "Ondura PDF", en: "Ondura PDF", fr: "Ondura PDF" } },
    notes: { logo: "notes", color: "#7719aa", name: { de: "Ondura Notizen", en: "Ondura Notes", fr: "Ondura Notes" } },
    planner: { logo: "planner", color: "#0b7a75", name: { de: "Ondura Planer", en: "Ondura Planner", fr: "Ondura Planificateur" } },
    diagram: { logo: "diagram", color: "#4f52b2", name: { de: "Ondura Diagramme", en: "Ondura Diagrams", fr: "Ondura Diagrammes" } },
    forms: { logo: "forms", color: "#c27c0e", name: { de: "Ondura Formulare", en: "Ondura Forms", fr: "Ondura Formulaires" } },
  };
  var app = apps[hash] || { logo: mailApp ? "mail" : "ondura", color: "#3b5bdb", name: { de: mailApp ? "Ondura Mail" : "Ondura", en: mailApp ? "Ondura Mail" : "Ondura", fr: mailApp ? "Ondura Mail" : "Ondura" } };

  var el = document.createElement("div");
  el.id = "ondura-splash";
  if (dark) el.className = "dark";
  el.style.setProperty("--splash-tint", app.color);
  el.innerHTML =
    '<img src="/' + app.logo + '.svg" alt="">' +
    "<span>" + app.name[lang] + "</span>" +
    '<div class="dots"><i></i><i></i><i></i><i></i><i></i></div>';
  document.body.appendChild(el);

  var done = false;
  w.__onduraSplashDone = function () {
    if (done) return;
    done = true;
    el.classList.add("hide");
    setTimeout(function () { el.remove(); }, 250);
  };
  // Never hide the app behind the splash for long if something goes wrong.
  setTimeout(w.__onduraSplashDone, 20000);
})();
