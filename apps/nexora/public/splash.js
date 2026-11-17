// Start screen shown while the app loads, in the style of the Office splash
// (logo, app name, running dots). It is plain DOM so it appears before the
// React bundle has been parsed; the app removes it with
// `window.__nexoraSplashDone()` as soon as its first data is on screen.
(function () {
  var w = window;
  var hash = (location.hash.replace(/^#\/?/, "").split("/")[0] || w.__NEXORA_APP__ || "home");
  var orbit = ["mail", "calendar", "contacts", "tasks"].indexOf(hash) >= 0;
  var dark = false;
  try {
    var t = localStorage.getItem("nexora.theme");
    dark = t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  } catch (e) {}

  var el = document.createElement("div");
  el.id = "nexora-splash";
  if (dark) el.className = "dark";
  el.innerHTML =
    '<img src="/' + (orbit ? "orbit" : "nexora") + '.svg" alt="">' +
    "<span>" + (orbit ? "Orbit" : "Nexora") + "</span>" +
    '<div class="dots"><i></i><i></i><i></i><i></i><i></i></div>';
  document.body.appendChild(el);

  var done = false;
  w.__nexoraSplashDone = function () {
    if (done) return;
    done = true;
    el.classList.add("hide");
    setTimeout(function () { el.remove(); }, 250);
  };
  // Never hide the app behind the splash for long if something goes wrong.
  setTimeout(w.__nexoraSplashDone, 20000);
})();
