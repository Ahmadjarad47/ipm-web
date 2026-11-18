/** SSRF guard for repository URLs (§7.2): the server will call this address, so it must be a plain public https endpoint. */

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map(Number);
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.slice(1, -1).toLowerCase();
  if (h === '::1' || h === '::') return true;
  if (/^f[cd]/.test(h)) return true; // fc00::/7
  if (/^fe[89ab]/.test(h)) return true; // fe80::/10 link-local
  if (h.startsWith('::ffff:')) return true; // IPv4-mapped: could hide a private v4 address
  return false;
}

/** Arabic error message, or null when the URL is acceptable. */
export function validateRepositoryUrl(raw: string | undefined): string | null {
  let url: URL;
  try {
    url = new URL(raw ?? '');
  } catch {
    return 'رابط غير صالح';
  }
  if (url.protocol !== 'https:') return 'يجب أن يبدأ بـ https://';
  if (url.username || url.password || /^https:\/\/[^/]*@/.test(raw ?? '')) return 'لا تضع بيانات الدخول في الرابط';
  if (url.port !== '') return 'المنفذ غير مسموح (443 فقط)';
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return 'العنوان المحلي غير مسموح';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && isPrivateIpv4(host)) return 'عنوان شبكة خاصة غير مسموح';
  if (host.startsWith('[') && isPrivateIpv6(host)) return 'عنوان شبكة خاصة غير مسموح';
  return null;
}
