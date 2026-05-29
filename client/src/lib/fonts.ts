/**
 * Self-hosted IBM Plex (§7.1). @fontsource bundles the woff2 files into the
 * build output, so the container serves them from its own origin — no external
 * font CDN, and the CSP can stay tight (font-src 'self').
 */
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-serif/600.css';
