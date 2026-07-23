const params = new URLSearchParams(window.location.search);

/**
 * Discord launches an Activity in an iframe served from
 * `<application_id>.discordsays.com` and passes `frame_id` on the query string.
 */
export const isEmbedded =
  params.has("frame_id") || window.location.hostname.endsWith(".discordsays.com");

/**
 * Inside the Activity iframe every network request has to travel through
 * Discord's proxy, which only forwards paths beginning with `/.proxy`. It
 * strips that prefix before handing the request to whatever the developer
 * portal URL mapping points at, so `/.proxy/api/health` arrives as
 * `/api/health`. Outside Discord the prefix must be absent.
 */
export const proxyPrefix = isEmbedded ? "/.proxy" : "";

/** Build a same-origin API path that works both inside and outside Discord. */
export function apiUrl(path: string) {
  return `${proxyPrefix}${path}`;
}

/**
 * Question images are either a server-relative upload path or a fully qualified
 * public URL. Only the former needs the proxy prefix; absolute URLs are left
 * alone (Discord blocks them unless separately mapped).
 */
export function assetUrl(src: string) {
  return /^https?:\/\//i.test(src) ? src : `${proxyPrefix}${src}`;
}

/** Socket.IO's own endpoint needs the same treatment as the REST routes. */
export const socketPath = `${proxyPrefix}/socket.io`;
