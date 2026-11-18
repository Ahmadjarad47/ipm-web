# Deployment

The front end is a static Angular bundle (`npm run build` -> `dist/ipm-web/browser`). It is served by nginx (or any static host) behind HTTPS and talks to the ASP.NET Core API under `/api/v1`.

## 1. Environment switch: mock -> real API

`src/environments/environment.ts` (dev) and `environment.prod.ts` (production build):

| Key | Dev default | Production |
|---|---|---|
| `useMockBackend` | `true` (in-app mock answers every `/api` request) | **`false`** |
| `apiBaseUrl` | `/api/v1` | `/api/v1` (same origin through the reverse proxy) |
| `timeZone` | `Asia/Riyadh` | organisation time zone (NFR-10) |

Checklist: set `useMockBackend: false`, make sure `src/app/mock/**` is no longer referenced from `app.config.ts` (the import is tree-shaken when the flag is false, but delete the folder before the final release), rebuild, smoke test login + one write per module.

## 2. HTTPS / reverse proxy (nginx)

TLS terminates at nginx; the API is never exposed directly.

```nginx
server {
  listen 80;
  server_name ipm.example.internal;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name ipm.example.internal;

  ssl_certificate     /etc/ssl/ipm/fullchain.pem;
  ssl_certificate_key /etc/ssl/ipm/privkey.pem;
  ssl_protocols       TLSv1.2 TLSv1.3;
  ssl_prefer_server_ciphers off;
  ssl_session_timeout 1d;
  ssl_session_cache   shared:SSL:10m;

  root /var/www/ipm-web;
  index index.html;

  # ---- Security headers ----
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
  # Example CSP (see section 3 for the reasoning). Test in Report-Only first.
  add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" always;

  # ---- API proxy ----
  location /api/ {
    proxy_pass         http://127.0.0.1:5000;
    proxy_http_version 1.1;
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_set_header   X-Correlation-Id $request_id;   # kept if the client already sent one, see API config
    client_max_body_size 25m;                         # attachments
    proxy_read_timeout 60s;
  }

  # ---- Cache headers ----
  # Hashed build assets: cache for a year.
  location ~* \.(?:js|css|woff2|svg|png|jpg|ico)$ {
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri =404;
  }
  # Never cache the shell, the manifest or the runtime config.
  location = /index.html            { add_header Cache-Control "no-store"; }
  location = /manifest.webmanifest  { add_header Cache-Control "no-cache"; }

  # ---- SPA fallback ----
  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

Note: repeat the security `add_header` lines inside any `location` that defines its own `add_header` (nginx does not inherit them there).

## 3. Content-Security-Policy

CSP is delivered as an **HTTP header** (above), not as a `<meta>` tag. Notes:

- No third-party origins are needed: fonts are self-hosted (section 4) and there is no CDN script.
- `style-src 'unsafe-inline'` is required because Angular component styles are injected as `<style>` elements. To remove it, enable Angular's `autoCsp`/nonce support (`ngCspNonce` attribute on `<app-root>` with a per-response nonce) in a later hardening pass.
- Start with `Content-Security-Policy-Report-Only` plus a `report-uri` to confirm nothing breaks, then enforce.

## 4. Fonts (self-hosted)

No Google Fonts links remain. `src/styles/_fonts.scss` declares `IBM Plex Sans Arabic` / `IBM Plex Mono` with `local()` first, then optional files in `public/fonts/`, `font-display: swap`. Without the files the system stack `'Segoe UI', Tahoma, 'Noto Naskh Arabic', sans-serif` is used and the app is fully functional.

To get the intended look: download the official IBM Plex fonts (SIL OFL), convert to **WOFF2**, and place these in `public/fonts/` (see `public/fonts/README.md`):

```
IBMPlexSansArabic-Regular.woff2   IBMPlexSansArabic-Medium.woff2
IBMPlexSansArabic-SemiBold.woff2  IBMPlexSansArabic-Bold.woff2
IBMPlexMono-Medium.woff2
```

They are copied to `dist/.../fonts/` by the build and cached for a year by the nginx rule above. Optionally add `<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/IBMPlexSansArabic-Regular.woff2">` to `index.html`.

## 5. Backup and restore (NFR-12)

| Item | Value (placeholder - agree with the business owner) |
|---|---|
| Data to back up | Primary database, attachment storage, secrets/configuration (encrypted) |
| Frequency | Full nightly, incremental / log shipping every 15 minutes |
| Retention | 30 days daily, 12 months monthly |
| **RPO** | `<TBD>` (target <= 15 minutes) |
| **RTO** | `<TBD>` (target <= 4 hours) |
| Storage | Off-host, encrypted at rest, access logged |

### Restore drill checklist (run at least once per quarter)

- [ ] Pick a backup at random and record its timestamp.
- [ ] Restore database + attachments into an isolated environment (never over production).
- [ ] Start the API against the restored data; run migrations check.
- [ ] Log in with a known account; open a project, a work item with attachments, an approval, the audit log.
- [ ] Compare record counts / latest audit event with the source at backup time.
- [ ] Measure elapsed time -> actual RTO; compute data loss window -> actual RPO.
- [ ] Record results, gaps and owners; update this document.

## 6. API versioning and OpenAPI (NFR-15)

- All endpoints live under `/api/v1`. A breaking change ships as `/api/v2` alongside v1; v1 stays supported for at least one release cycle with a `Deprecation`/`Sunset` header.
- Additive changes (new optional fields, new endpoints) do not bump the version. The client must ignore unknown fields.
- The API publishes an OpenAPI 3 document (`/api/v1/openapi.json`); the TypeScript models in `src/app/domain/**` must be kept consistent with it (generate or diff in CI).

## 7. Browser support (NFR-01)

Evergreen browsers, latest two major versions:

| Browser | Support |
|---|---|
| Chrome / Edge (Chromium) | Supported |
| Firefox | Supported |
| Safari (macOS / iOS) | Supported |
| Internet Explorer, legacy Edge | Not supported |

Features relied upon: CSS logical properties, `color-mix()`, `:focus-visible`, native `<dialog>`, `prefers-color-scheme`, `Intl.RelativeTimeFormat`. Layout is verified from 360px (mobile) to 1920px; RTL is the only direction.
