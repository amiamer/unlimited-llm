/**
 * The terminal is for the machine running the app only. A request qualifies
 * when it addresses localhost directly and carries no sign of a proxy or tunnel
 * (ngrok, Cloudflare and other reverse proxies add these headers).
 */

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);
const TUNNEL_HEADERS = ['cf-connecting-ip', 'cf-ray', 'x-real-ip', 'forwarded', 'ngrok-trace-id', 'x-original-host'];

function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']'));
  return h.split(':')[0];
}

export function isLocalRequest(headers: Headers): boolean {
  if (!LOOPBACK.has(hostnameOf(headers.get('host') || ''))) return false;
  if (TUNNEL_HEADERS.some((name) => headers.get(name))) return false;
  const forwardedHost = headers.get('x-forwarded-host');
  if (forwardedHost && !LOOPBACK.has(hostnameOf(forwardedHost))) return false;
  // Next.js may set x-forwarded-for itself for a direct local request; only
  // loopback addresses are acceptable there.
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor && !forwardedFor.split(',').every((ip) => LOOPBACK.has(ip.trim().toLowerCase()))) return false;
  return true;
}
