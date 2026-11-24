/* global window */
// Apply the theme before first paint to avoid a flash (see src/theme.ts). A same-origin file, not an inline
// script, so the Content-Security-Policy can forbid inline scripts (T-110, ADR-029).
try {
  var t = window.localStorage.getItem("tickzy.theme");
  var dark = t === "dark" || (t !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  window.document.documentElement.dataset.theme = dark ? "dark" : "light";
} catch {
  // Storage blocked (private mode, policy): the app applies the system theme once it loads.
}
