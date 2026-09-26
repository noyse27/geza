import { BlockList, isIP } from 'node:net';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['64:ff9b::', 96],
  ['2002::', 16],
] as const)
  blocked.addSubnet(net, prefix, 'ipv6');
/** Loopback, private, link-local, multicast and other non-public addresses. */
export function isPrivateAddress(address: string) {
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return blocked.check(mapped[1], 'ipv4');
  const family = isIP(address);
  if (!family) return true;
  return blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}
/** Home-lab and test setups can allow http and private addresses explicitly. */
export const allowPrivateFederation = () => process.env.FEDERATION_ALLOW_PRIVATE === '1';
export function parsePeerUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw Error('Ungültige Adresse.');
  }
  if (url.protocol !== 'https:' && !(allowPrivateFederation() && url.protocol === 'http:'))
    throw Error('Nur HTTPS-Adressen sind erlaubt.');
  if (url.username || url.password) throw Error('Adressen mit Zugangsdaten sind nicht erlaubt.');
  return url;
}
const publicLookup: typeof dns.lookup = ((hostname: string, options: unknown, callback: unknown) => {
  const cb = (typeof options === 'function' ? options : callback) as (...args: unknown[]) => void;
  const opts = typeof options === 'function' ? {} : (options as dns.LookupOptions);
  dns.lookup(hostname, { ...opts, all: true }, (error, addresses) => {
    if (error) return cb(error);
    const list = addresses as dns.LookupAddress[];
    if (!list.length || list.some((a) => isPrivateAddress(a.address)))
      return cb(Object.assign(Error('Adresse nicht erlaubt'), { code: 'EBLOCKED' }));
    if (opts.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}) as typeof dns.lookup;
export type SafeFetchOptions = {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  maxBytes?: number;
};
/**
 * JSON request to a peer-controlled URL: https only, non-public addresses are rejected at connect time
 * (no DNS-rebinding window), redirects are errors, and time and size are capped.
 */
export async function safeFetchJson<T = unknown>(
  input: string,
  { method = 'GET', headers = {}, body, timeoutMs = 3000, maxBytes = 64 * 1024 }: SafeFetchOptions = {},
): Promise<{ status: number; data: T | null }> {
  const url = parsePeerUrl(input);
  const permissive = allowPrivateFederation();
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!permissive && isIP(host) && isPrivateAddress(host)) throw Error('Adresse nicht erlaubt.');
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const client = url.protocol === 'https:' ? https : http;
  return await new Promise((resolve, reject) => {
    const request = client.request(
      url,
      {
        method,
        timeout: timeoutMs,
        lookup: permissive ? undefined : publicLookup,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Geza-Federation',
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
          ...headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) return request.destroy(Error('Antwort zu groß.'));
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => {
          const status = response.statusCode || 0;
          if (status >= 300 && status < 400) return reject(Error('Weiterleitungen sind nicht erlaubt.'));
          try {
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({ status, data: text ? (JSON.parse(text) as T) : null });
          } catch {
            resolve({ status, data: null });
          }
        });
      },
    );
    // Deadline for the whole exchange, not only for socket inactivity.
    const deadline = setTimeout(() => request.destroy(Error('Zeitüberschreitung.')), timeoutMs);
    request.on('timeout', () => request.destroy(Error('Zeitüberschreitung.')));
    request.on('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    request.on('close', () => clearTimeout(deadline));
    request.end(payload);
  });
}
