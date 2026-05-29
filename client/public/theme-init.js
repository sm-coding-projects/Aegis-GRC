// Apply persisted / preferred theme before first paint (no flash of wrong theme).
// External (not inline) so the Content-Security-Policy can forbid inline scripts.
(function () {
  try {
    var stored = localStorage.getItem('aegis-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    /* localStorage unavailable; default theme already set on <html> */
  }
})();
