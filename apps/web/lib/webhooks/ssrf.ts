/**
 * Webhook URLs must reach the public internet, never SaphraONE's own network.
 * The address rules are pure and unit-tested. `publicLookup` applies them to
 * every DNS answer at connect time, so a host that re-points to a private
 * address after it was saved (DNS rebinding) still can't be reached.
 */
import dns from "node:dns";
import net from "node:net";

export const MAX_WEBHOOK_URL_LENGTH = 2048;

function ipv4Octets(ip: string) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

function isPublicIpv4(ip: string) {
  const octets = ipv4Octets(ip);
  if (!octets) return false;
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127) return false; // this network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

/** Eight 16-bit groups, or null when `ip` isn't an IPv6 address. */
function ipv6Groups(ip: string) {
  let text = ip.toLowerCase();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  // A trailing dotted IPv4 (::ffff:10.0.0.1) becomes two groups.
  const dotted = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (dotted) {
    const octets = ipv4Octets(dotted[2]);
    if (!octets) return null;
    text = `${dotted[1]}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => parseInt(group, 16));
}

function embeddedIpv4(groups: number[]) {
  const [g6, g7] = [groups[6], groups[7]];
  return `${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`;
}

function isPublicIpv6(ip: string) {
  const groups = ipv6Groups(ip);
  if (!groups) return false;
  const [g0, g1] = groups;
  const upperZero = groups.slice(0, 5).every((group) => group === 0);
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) carry an IPv4 address.
  if (upperZero && groups[5] === 0xffff) return isPublicIpv4(embeddedIpv4(groups));
  if (g0 === 0x64 && g1 === 0xff9b && groups.slice(2, 6).every((group) => group === 0)) {
    return isPublicIpv4(embeddedIpv4(groups));
  }
  // 6to4 (2002::/16) carries an IPv4 address in groups 1–2.
  if (g0 === 0x2002) {
    return isPublicIpv4(`${g1 >> 8}.${g1 & 255}.${groups[2] >> 8}.${groups[2] & 255}`);
  }
  // Only global unicast (2000::/3). That leaves out ::, ::1, fc00::/7 (ULA),
  // fe80::/10 (link-local) and ff00::/8 (multicast).
  if (g0 < 0x2000 || g0 > 0x3fff) return false;
  if (g0 === 0x2001 && g1 === 0x0db8) return false; // documentation
  if (g0 === 0x2001 && g1 === 0) return false; // Teredo
  return true;
}

/** True only for an address on the public internet. */
export function isPublicAddress(ip: string) {
  const version = net.isIP(ip.replace(/^\[|\]$/g, "").split("%")[0]);
  if (version === 4) return isPublicIpv4(ip);
  if (version === 6) return isPublicIpv6(ip.replace(/^\[|\]$/g, ""));
  return false;
}

function isInternalHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    !host.includes(".") ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa")
  );
}

/**
 * A webhook URL as saved: https, no username or password, and a public host.
 * Returns the normalized URL or a message saying what is wrong. Pure, so the
 * DNS check happens separately (and again at every delivery).
 */
export function checkWebhookUrl(value: unknown): { ok: true; url: string } | { ok: false; message: string } {
  if (typeof value !== "string" || !value.trim()) return { message: "Enter the URL of your webhook endpoint.", ok: false };
  const raw = value.trim();
  if (raw.length > MAX_WEBHOOK_URL_LENGTH) {
    return { message: `The URL is longer than ${MAX_WEBHOOK_URL_LENGTH} characters.`, ok: false };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { message: "Enter a full URL, starting with https://.", ok: false };
  }
  if (url.protocol !== "https:") {
    return {
      message: "Webhook URLs must use https. To test on your machine, use a tunnel such as ngrok or Cloudflare Tunnel.",
      ok: false,
    };
  }
  if (url.username || url.password) return { message: "The URL must not contain a username or password.", ok: false };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (!isPublicAddress(host)) return { message: "The URL must point to a public address.", ok: false };
  } else if (isInternalHostname(host)) {
    return { message: "The URL must use a public domain name.", ok: false };
  }
  url.hash = "";
  return { ok: true, url: url.toString() };
}

export class PrivateAddressError extends Error {
  constructor(hostname: string) {
    super(`${hostname} resolves to a private address.`);
    this.name = "PrivateAddressError";
  }
}

/**
 * Resolves `hostname` and fails unless every answer is public. Used when an
 * endpoint is saved, to give the merchant an error straight away.
 */
export async function assertPublicHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (!isPublicAddress(host)) throw new PrivateAddressError(hostname);
    return;
  }
  const answers = await dns.promises.lookup(host, { all: true, verbatim: true });
  if (answers.length === 0 || answers.some((answer) => !isPublicAddress(answer.address))) {
    throw new PrivateAddressError(hostname);
  }
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

/**
 * A `lookup` for node:https that refuses private answers, so the address we
 * check is the address we connect to.
 */
export function publicLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback) {
  dns.lookup(hostname, { ...options, all: true, verbatim: true }, (error, answers) => {
    if (error) return callback(error, []);
    const list = answers as dns.LookupAddress[];
    if (list.length === 0 || list.some((answer) => !isPublicAddress(answer.address))) {
      return callback(new PrivateAddressError(hostname) as NodeJS.ErrnoException, []);
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}
