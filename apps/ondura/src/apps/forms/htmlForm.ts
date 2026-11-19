// Web form: a single HTML file that respondents open in any browser. On
// "Absenden" it prepares an e-mail to the form owner with the answers
// (readable, plus a machine-readable block that Ondura Formulare imports
// from the mailbox); without an address the answers are saved as a file.

import { tl } from "../../lib/i18n";
import { mailSubject, type Form } from "./model";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function formToHtml(form: Form): string {
  const data = {
    id: form.id,
    subject: mailSubject(form),
    replyTo: form.replyTo,
    thanks: form.thanks,
    questions: form.questions,
    t: {
      required: tl("Bitte beantworten Sie diese Frage."),
      other: tl("Sonstiges"),
      send: tl("Absenden"),
      choose: tl("Bitte auswählen"),
      mailHint: tl("Ihr E-Mail-Programm öffnet sich mit Ihren Antworten. Bitte senden Sie die E-Mail ab."),
      fileHint: tl("Ihre Antworten wurden als Datei gespeichert. Bitte senden Sie diese Datei an den Absender des Formulars."),
      again: tl("Weitere Antwort senden"),
      answers: tl("Antworten"),
    },
  };
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const color = /^#[0-9a-f]{6}$/i.test(form.color) ? form.color : "#c27c0e";
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(form.title)}</title>
<style>
  :root { --c: ${color}; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 "Segoe UI", system-ui, -apple-system, Arial, sans-serif; color: #242424; background: color-mix(in srgb, var(--c) 10%, #f5f5f5); }
  .wrap { max-width: 720px; margin: 0 auto; padding: 32px 16px 64px; }
  .head { background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,.08); margin-bottom: 16px; }
  .band { height: 10px; background: var(--c); }
  .head h1 { margin: 20px 24px 6px; font-size: 26px; font-weight: 600; }
  .head p { margin: 0 24px 20px; color: #555; white-space: pre-wrap; }
  .q { background: #fff; border-radius: 10px; padding: 18px 24px; margin-bottom: 12px; box-shadow: 0 1px 6px rgba(0,0,0,.06); }
  .q.err { box-shadow: 0 0 0 2px #c50f1f; }
  .q h2 { font-size: 16px; font-weight: 600; margin: 0 0 4px; }
  .q .req { color: #c50f1f; }
  .q .desc { color: #666; font-size: 13px; margin: 0 0 8px; }
  .q.section { background: transparent; box-shadow: none; padding: 16px 4px 4px; }
  .q.section h2 { font-size: 20px; color: var(--c); }
  label.opt { display: flex; gap: 10px; align-items: center; padding: 6px 0; cursor: pointer; }
  input[type=text], input[type=number], input[type=date], textarea, select { width: 100%; font: inherit; padding: 8px 10px; border: 1px solid #c8c8c8; border-radius: 6px; background: #fff; }
  input:focus, textarea:focus, select:focus { outline: 2px solid var(--c); border-color: transparent; }
  textarea { min-height: 90px; resize: vertical; }
  .stars, .scale { display: flex; gap: 6px; flex-wrap: wrap; }
  .stars button { font-size: 28px; line-height: 1; background: none; border: none; cursor: pointer; color: #c8c8c8; padding: 0 2px; }
  .stars button.on { color: #f7b500; }
  .scale button { min-width: 38px; height: 38px; border-radius: 6px; border: 1px solid #c8c8c8; background: #fff; cursor: pointer; font: inherit; }
  .scale button.on { background: var(--c); color: #fff; border-color: var(--c); }
  .ends { display: flex; justify-content: space-between; color: #777; font-size: 12px; margin-top: 4px; }
  .msg { color: #c50f1f; font-size: 13px; margin-top: 6px; display: none; }
  .q.err .msg { display: block; }
  .send { background: var(--c); color: #fff; border: none; border-radius: 6px; font: inherit; font-weight: 600; padding: 10px 28px; cursor: pointer; }
  .done { background: #fff; border-radius: 10px; padding: 32px 24px; text-align: center; box-shadow: 0 1px 6px rgba(0,0,0,.06); }
  .done pre { text-align: left; white-space: pre-wrap; word-break: break-all; background: #f5f5f5; padding: 12px; border-radius: 6px; font-size: 11px; }
  .foot { color: #888; font-size: 12px; text-align: center; margin-top: 24px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="head"><div class="band"></div><h1>${esc(form.title)}</h1>${form.description ? `<p>${esc(form.description)}</p>` : ""}</div>
  <form id="f" novalidate></form>
  <div class="foot">Ondura Formulare</div>
</div>
<script>
(function () {
  var D = ${json};
  var f = document.getElementById("f");
  var answers = {};
  var n = 0;
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) { if (k === "text") e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  D.questions.forEach(function (q) {
    var box = el("div", { class: "q" + (q.type === "section" ? " section" : ""), id: "q_" + q.id });
    if (q.type !== "section") n++;
    var h = el("h2", { text: (q.type === "section" ? "" : n + ". ") + (q.title || "") });
    if (q.required) h.appendChild(el("span", { class: "req", text: " *" }));
    box.appendChild(h);
    if (q.description) box.appendChild(el("p", { class: "desc", text: q.description }));
    var name = "q_" + q.id;
    if (q.type === "text" || q.type === "number" || q.type === "date") {
      var i = el("input", { type: q.type === "text" ? "text" : q.type, name: name });
      i.oninput = function () { answers[q.id] = q.type === "number" ? (i.value === "" ? null : Number(i.value)) : i.value; };
      box.appendChild(i);
    } else if (q.type === "longtext") {
      var t = el("textarea", { name: name });
      t.oninput = function () { answers[q.id] = t.value; };
      box.appendChild(t);
    } else if (q.type === "dropdown") {
      var s = el("select", { name: name }, [el("option", { value: "", text: D.t.choose })]);
      (q.options || []).forEach(function (o) { s.appendChild(el("option", { value: o, text: o })); });
      s.onchange = function () { answers[q.id] = s.value || null; };
      box.appendChild(s);
    } else if (q.type === "choice" || q.type === "multi") {
      var multi = q.type === "multi";
      var other = null;
      var update = function () {
        var picked = [];
        box.querySelectorAll("input[data-o]").forEach(function (x) { if (x.checked) picked.push(x.getAttribute("data-o") === "__other" ? (other.value || D.t.other) : x.getAttribute("data-o")); });
        answers[q.id] = multi ? picked : picked[0] || null;
      };
      (q.options || []).concat(q.other ? ["__other"] : []).forEach(function (o) {
        var inp = el("input", { type: multi ? "checkbox" : "radio", name: name, "data-o": o });
        inp.onchange = update;
        var lab = el("label", { class: "opt" }, [inp, document.createTextNode(o === "__other" ? D.t.other + ":" : o)]);
        if (o === "__other") { other = el("input", { type: "text" }); other.style.flex = "1"; other.oninput = function () { inp.checked = true; update(); }; lab.appendChild(other); }
        box.appendChild(lab);
      });
    } else if (q.type === "rating") {
      var stars = el("div", { class: "stars" });
      for (var k = 1; k <= (q.max || 5); k++) (function (v) {
        var b = el("button", { type: "button", text: "\\u2605", "aria-label": String(v) });
        b.onclick = function () { answers[q.id] = v; stars.querySelectorAll("button").forEach(function (x, j) { x.className = j < v ? "on" : ""; }); };
        stars.appendChild(b);
      })(k);
      box.appendChild(stars);
    } else if (q.type === "scale") {
      var sc = el("div", { class: "scale" });
      for (var v0 = 0; v0 <= (q.max || 10); v0++) (function (v) {
        var b = el("button", { type: "button", text: String(v) });
        b.onclick = function () { answers[q.id] = v; sc.querySelectorAll("button").forEach(function (x) { x.className = x === b ? "on" : ""; }); };
        sc.appendChild(b);
      })(v0);
      box.appendChild(sc);
      if (q.minLabel || q.maxLabel) box.appendChild(el("div", { class: "ends" }, [el("span", { text: q.minLabel || "" }), el("span", { text: q.maxLabel || "" })]));
    }
    if (q.type !== "section") box.appendChild(el("div", { class: "msg", text: D.t.required }));
    f.appendChild(box);
  });
  f.appendChild(el("button", { class: "send", type: "submit", text: D.t.send }));
  function b64(str) { var bytes = new TextEncoder().encode(str); var s = ""; bytes.forEach(function (b) { s += String.fromCharCode(b); }); return btoa(s); }
  function rid() { var a = new Uint32Array(2); crypto.getRandomValues(a); return "w" + a[0].toString(36) + a[1].toString(36); }
  f.onsubmit = function (e) {
    e.preventDefault();
    var first = null;
    D.questions.forEach(function (q) {
      var box = document.getElementById("q_" + q.id);
      var a = answers[q.id];
      var empty = a === undefined || a === null || a === "" || (Array.isArray(a) && !a.length);
      var bad = q.required && q.type !== "section" && empty;
      box.classList.toggle("err", bad);
      if (bad && !first) first = box;
    });
    if (first) { first.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    var env = { f: D.id, r: rid(), t: new Date().toISOString(), a: answers };
    var block = "----- ONDURA-FORMULAR-ANTWORT -----\\n" + b64(JSON.stringify(env)).replace(/(.{76})/g, "$1\\n") + "\\n----- ENDE -----";
    var readable = "";
    var m = 0;
    D.questions.forEach(function (q) {
      if (q.type === "section") return;
      m++;
      var a = answers[q.id];
      readable += m + ". " + (q.title || "") + "\\n   " + (Array.isArray(a) ? a.join("; ") : a === undefined || a === null ? "" : String(a)) + "\\n";
    });
    var done = el("div", { class: "done" }, [el("h2", { text: D.thanks })]);
    if (D.replyTo) {
      location.href = "mailto:" + encodeURIComponent(D.replyTo) + "?subject=" + encodeURIComponent(D.subject) + "&body=" + encodeURIComponent(D.t.answers + ":\\n\\n" + readable + "\\n" + block);
      done.appendChild(el("p", { text: D.t.mailHint }));
    } else {
      var blob = new Blob([D.subject + "\\n\\n" + readable + "\\n" + block], { type: "text/plain" });
      var a = el("a", { href: URL.createObjectURL(blob), download: "Antwort.ondresponse" });
      document.body.appendChild(a);
      a.click();
      done.appendChild(el("p", { text: D.t.fileHint }));
    }
    var again = el("button", { class: "send", type: "button", text: D.t.again });
    again.onclick = function () { location.reload(); };
    done.appendChild(again);
    f.replaceWith(done);
    window.scrollTo(0, 0);
  };
})();
</script>
</body>
</html>
`;
}
