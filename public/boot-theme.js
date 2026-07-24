// Boot-time theme/accent bootstrap.
//
// Externalized from index.html (SEC-01) so the Firebase Hosting CSP's
// script-src can be `'self'` with no `'unsafe-inline'`/hash maintenance
// burden — a hashed inline script would silently break the deployed app
// the next time anyone edited this logic without recomputing the hash in
// firebase.json. Runs synchronously before first paint (loaded with a
// blocking <script src> in <head>, same as the inline version it
// replaces) to avoid a flash of the wrong theme/accent.
(function () {
  document.documentElement.dataset.accent = localStorage.getItem('engram-accent') || 'blue';
  var d = localStorage.getItem('engram-dark-mode');
  var isDark = d === 'dark' || (d !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (isDark) {
    document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = 'dark';
  } else {
    document.documentElement.style.colorScheme = 'light';
  }
})();
