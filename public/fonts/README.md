# Self-hosted fonts (optional)

The app works without any file here: it falls back to the system Arabic stack
(`Segoe UI`, `Tahoma`, `Noto Naskh Arabic`, `sans-serif`).

To get the intended typography, download these from the official IBM Plex repository
(SIL OFL licence) and convert/keep them as **WOFF2**, then place them in this folder:

- `IBMPlexSansArabic-Regular.woff2` (400)
- `IBMPlexSansArabic-Medium.woff2` (500)
- `IBMPlexSansArabic-SemiBold.woff2` (600)
- `IBMPlexSansArabic-Bold.woff2` (700)
- `IBMPlexMono-Medium.woff2` (500, used for codes like ERP-104)

The `@font-face` rules live in `src/styles/_fonts.scss` and use `font-display: swap`.
Files are served from `/fonts/` with long-lived cache headers (see `docs/DEPLOYMENT.md`).
