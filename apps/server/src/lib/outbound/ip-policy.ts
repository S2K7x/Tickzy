import { BlockList, isIP } from "node:net";

/**
 * Addresses outbound requests may never reach (SSRF, SEC-8, threat model §7): everything that is not a public
 * unicast address — private, loopback, link-local (incl. cloud metadata 169.254.169.254), CGNAT, multicast,
 * reserved, documentation and benchmarking ranges — for IPv4 and IPv6, including IPv6 forms that embed an IPv4
 * address (IPv4-mapped, NAT64, 6to4), which are judged by the embedded address.
 */
const blocked = new BlockList();
const v4: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];
for (const [net, prefix] of v4) blocked.addSubnet(net, prefix, "ipv4");
const v6: [string, number][] = [
  ["::", 128], ["::1", 128], ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
];
for (const [net, prefix] of v6) blocked.addSubnet(net, prefix, "ipv6");

/** Expands an IPv6 address to its 8 hextets (handles "::" and a trailing dotted IPv4 part). */
function hextets(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    const p = dotted[1]!.split(".").map(Number);
    s = s.slice(0, -dotted[1]!.length) + `${((p[0]! << 8) | p[1]!).toString(16)}:${((p[2]! << 8) | p[3]!).toString(16)}`;
  }
  const [head, tail] = s.split("::");
  const a = head ? head.split(":") : [];
  const b = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  const fill = tail !== undefined ? 8 - a.length - b.length : 0;
  const all = [...a, ...Array(Math.max(0, fill)).fill("0"), ...b];
  if (all.length !== 8) return null;
  return all.map((h) => parseInt(h, 16));
}
const v4From = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/** The IPv4 address embedded in an IPv6 address (IPv4-mapped/-compatible, NAT64 64:ff9b::/96, 6to4 2002::/16), if any. */
export function embeddedIPv4(ip: string): string | null {
  const h = hextets(ip);
  if (!h) return null;
  if (h.slice(0, 5).every((x) => x === 0) && (h[5] === 0xffff || h[5] === 0)) return v4From(h[6]!, h[7]!); // ::ffff:a.b.c.d, ::a.b.c.d
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) return v4From(h[6]!, h[7]!); // NAT64
  if (h[0] === 0x2002) return v4From(h[1]!, h[2]!); // 6to4
  return null;
}

/** True when an address must not be contacted. Anything that is not a valid IP literal is refused too. */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return blocked.check(ip, "ipv4");
  if (family === 6) {
    const inner = embeddedIPv4(ip);
    if (inner) return isBlockedAddress(inner);
    return blocked.check(ip, "ipv6");
  }
  return true;
}
