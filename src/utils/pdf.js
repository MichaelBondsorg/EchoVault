// PDF LOADER
//
// jsPDF is bundled as a normal dependency (see package.json — pinned exact,
// SEC-01) but loaded via a dynamic import so it never enters the main
// bundle: Vite/Rollup emits it as its own chunk that only downloads when a
// PDF export actually runs. This replaced a runtime <script src="..."> tag
// that fetched jspdf.umd.min.js from a third-party CDN with no Subresource
// Integrity — arbitrary third-party code execution on every load of this
// module, and a host the CSP would otherwise have had to allow in
// script-src.
let jsPDFPromise = null;

export const loadJsPDF = () => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('PDF export is only available in the browser'));
  }
  if (!jsPDFPromise) {
    jsPDFPromise = import('jspdf').then((mod) => mod.jsPDF ?? mod.default);
  }
  return jsPDFPromise;
};
