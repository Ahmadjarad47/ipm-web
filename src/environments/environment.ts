export const environment = {
  production: false,
  /** Same origin: the dev server proxies `/api` to the backend (proxy.conf.json), a reverse proxy does in production. */
  apiBaseUrl: '/api/v1',
  timeZone: 'Asia/Riyadh',
  /** Screens whose API does not exist yet are hidden, not broken (attachments are not part of the first release). */
  features: { attachments: false },
};
