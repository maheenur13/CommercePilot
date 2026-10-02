import { lookup as dnsLookup, type LookupAddress, type LookupAllOptions } from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

/** A failed import fetch; `code` becomes the API error code. */
export class ImportFetchError extends Error {
  constructor(
    readonly code:
      'IMPORT_URL_FORBIDDEN' | 'IMPORT_FETCH_FAILED' | 'IMPORT_TOO_LARGE' | 'IMPORT_NOT_CSV',
    message: string,
  ) {
    super(message);
  }
}

// Everything that isn't public unicast. IPv4-mapped IPv6 (::ffff:a.b.c.d) is matched against the
// IPv4 rules by BlockList itself.
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3], // multicast, reserved, broadcast
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 96], // unspecified, loopback, IPv4-compatible
  ['64:ff9b::', 96], // NAT64 can embed private IPv4
  ['2002::', 16], // 6to4 can embed private IPv4
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  return family === 0 || blocked.check(ip, family === 6 ? 'ipv6' : 'ipv4');
}

/**
 * DNS lookup that refuses private addresses. It runs at connect time, so the address that was
 * checked is the address that is dialled (no DNS-rebinding gap between check and connect).
 */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true } as LookupAllOptions, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = addresses;
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
      return callback(forbidden(hostname), '', 0);
    }
    if ((options as LookupAllOptions).all) return (callback as AllCallback)(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
};
type AllCallback = (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void;

function forbidden(host: string) {
  return new ImportFetchError('IMPORT_URL_FORBIDDEN', `Refusing to fetch private address ${host}`);
}

export interface SafeFetchOptions {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  /** Exact lowercase `host:port` pairs exempt from the private-address check (tests only). */
  allowedHosts: readonly string[];
}

/**
 * GET a text document from an untrusted URL: http(s) only, no private/loopback/link-local/metadata
 * addresses (checked on every redirect hop), one overall deadline and a body size cap.
 */
export async function safeFetchText(start: URL, opts: SafeFetchOptions): Promise<string> {
  const signal = AbortSignal.timeout(opts.timeoutMs);
  let url = start;
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const res = await get(url, opts, signal);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      url = new URL(res.headers.location, url);
      continue;
    }
    if (status < 200 || status >= 300) {
      res.resume();
      throw new ImportFetchError('IMPORT_FETCH_FAILED', `Source responded with HTTP ${status}`);
    }
    if (/html/i.test(res.headers['content-type'] ?? '')) {
      res.resume();
      throw new ImportFetchError(
        'IMPORT_NOT_CSV',
        'Source returned an HTML page, not CSV (is the sheet shared publicly?)',
      );
    }
    return readCapped(res, opts.maxBytes, signal);
  }
  throw new ImportFetchError('IMPORT_FETCH_FAILED', 'Too many redirects');
}

function get(url: URL, opts: SafeFetchOptions, signal: AbortSignal): Promise<IncomingMessage> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ImportFetchError('IMPORT_URL_FORBIDDEN', `Unsupported protocol ${url.protocol}`);
  }
  const exempt = opts.allowedHosts.includes(url.host.toLowerCase());
  const literal = url.hostname.replace(/^\[|\]$/g, '');
  // IP literals skip DNS, so the lookup hook never sees them; check them here.
  if (!exempt && isIP(literal) && isBlockedAddress(literal)) throw forbidden(url.hostname);

  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.get(url, {
      signal,
      ...(!exempt && { lookup: safeLookup }),
      headers: { accept: 'text/csv, text/plain;q=0.9, */*;q=0.1' },
    });
    req.on('response', resolve);
    req.on('error', (err) => reject(toFetchError(err, signal)));
  });
}

function readCapped(res: IncomingMessage, maxBytes: number, signal: AbortSignal): Promise<string> {
  const declared = Number(res.headers['content-length']);
  if (declared > maxBytes) {
    res.destroy();
    return Promise.reject(tooLarge(maxBytes));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    res.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        res.destroy();
        reject(tooLarge(maxBytes));
      } else chunks.push(chunk);
    });
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    res.on('error', (err) => reject(toFetchError(err, signal)));
  });
}

function tooLarge(maxBytes: number) {
  return new ImportFetchError('IMPORT_TOO_LARGE', `Source is larger than ${maxBytes} bytes`);
}

function toFetchError(err: unknown, signal?: AbortSignal): ImportFetchError {
  if (err instanceof ImportFetchError) return err;
  if (signal?.aborted) return new ImportFetchError('IMPORT_FETCH_FAILED', 'Source timed out');
  return new ImportFetchError('IMPORT_FETCH_FAILED', 'Could not reach the source');
}
