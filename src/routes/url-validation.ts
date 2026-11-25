/**
 * URL Validation Utilities
 *
 * Provides security-focused URL validation for the favicon proxy route.
 * Uses strict IPv4/IPv6 CIDR matching and exact localhost checks to prevent SSRF.
 */

interface Ipv4Cidr {
	network: number;
	mask: number;
}

interface Ipv6Cidr {
	prefix: bigint;
	shift: bigint;
}

/**
 * Parse a canonical dotted-quad IPv4 address into an unsigned 32-bit integer.
 */
export function parseIpv4(host: string): number | null {
	const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
	if (!match) return null;

	let result = 0;
	for (let i = 1; i <= 4; i++) {
		const part = match[i];
		if (part.length > 1 && part.startsWith('0')) return null;
		const octet = Number(part);
		if (octet > 255) return null;
		result = ((result << 8) | octet) >>> 0;
	}
	return result;
}

function createIpv4Cidr(cidr: string): Ipv4Cidr {
	const [ipText, prefixText] = cidr.split('/');
	const ip = parseIpv4(ipText);
	const prefixLen = Number(prefixText);
	if (ip === null || !Number.isInteger(prefixLen) || prefixLen < 0 || prefixLen > 32) {
		throw new Error(`Invalid IPv4 CIDR: ${cidr}`);
	}
	const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
	return { network: (ip & mask) >>> 0, mask };
}

/**
 * Parse an IPv6 literal (with or without surrounding brackets, including :: compression
 * and embedded dotted-quad IPv4 tails) into an unsigned 128-bit BigInt.
 */
export function parseIpv6(host: string): bigint | null {
	let raw = host;
	if (raw.startsWith('[') && raw.endsWith(']')) {
		raw = raw.slice(1, -1);
	}
	if (!raw || !raw.includes(':')) return null;

	// Expand embedded dotted-quad IPv4 tail (e.g., ::ffff:127.0.0.1)
	if (raw.includes('.')) {
		const lastColon = raw.lastIndexOf(':');
		if (lastColon === -1) return null;
		const ipv4 = parseIpv4(raw.slice(lastColon + 1));
		if (ipv4 === null) return null;
		const high = ((ipv4 >>> 16) & 0xffff).toString(16);
		const low = (ipv4 & 0xffff).toString(16);
		raw = `${raw.slice(0, lastColon + 1)}${high}:${low}`;
	}

	const doubleColonParts = raw.split('::');
	if (doubleColonParts.length > 2) return null;

	let groups: string[];
	if (doubleColonParts.length === 2) {
		const left = doubleColonParts[0] ? doubleColonParts[0].split(':') : [];
		const right = doubleColonParts[1] ? doubleColonParts[1].split(':') : [];
		const missing = 8 - (left.length + right.length);
		if (missing < 1) return null;
		groups = [...left, ...Array<string>(missing).fill('0'), ...right];
	} else {
		groups = raw.split(':');
		if (groups.length !== 8) return null;
	}

	let value = 0n;
	for (const group of groups) {
		if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
		value = (value << 16n) | BigInt(parseInt(group, 16));
	}
	return value;
}

function createIpv6Cidr(cidr: string): Ipv6Cidr {
	const [ipText, prefixText] = cidr.split('/');
	const ip = parseIpv6(ipText);
	const prefixLen = Number(prefixText);
	if (ip === null || !Number.isInteger(prefixLen) || prefixLen < 0 || prefixLen > 128) {
		throw new Error(`Invalid IPv6 CIDR: ${cidr}`);
	}
	const shift = BigInt(128 - prefixLen);
	return { prefix: ip >> shift, shift };
}

const BLOCKED_IPV4_CIDRS: readonly Ipv4Cidr[] = [
	'0.0.0.0/8', // "This host on this network" (RFC 1122)
	'10.0.0.0/8', // Private-Use (RFC 1918)
	'100.64.0.0/10', // Shared Address Space / CGNAT (RFC 6598)
	'127.0.0.0/8', // Loopback (RFC 1122)
	'169.254.0.0/16', // Link-Local / Cloud metadata (RFC 3927)
	'172.16.0.0/12', // Private-Use (RFC 1918)
	'192.0.0.0/24', // IETF Protocol Assignments (RFC 6890)
	'192.0.2.0/24', // TEST-NET-1 (RFC 5737)
	'192.168.0.0/16', // Private-Use (RFC 1918)
	'198.18.0.0/15', // Benchmarking (RFC 2544)
	'198.51.100.0/24', // TEST-NET-2 (RFC 5737)
	'203.0.113.0/24', // TEST-NET-3 (RFC 5737)
	'224.0.0.0/4', // Multicast (RFC 5771)
	'240.0.0.0/4', // Reserved & Limited Broadcast 255.255.255.255 (RFC 1112)
].map(createIpv4Cidr);

const BLOCKED_IPV6_CIDRS: readonly Ipv6Cidr[] = [
	'::/128', // Unspecified address (RFC 4291)
	'::1/128', // Loopback address (RFC 4291)
	'::/96', // Deprecated IPv4-compatible IPv6
	'::ffff:0:0/96', // IPv4-mapped IPv6 (RFC 4291)
	'::ffff:0:0:0/96', // IPv4-translated / SIIT IPv6 (RFC 2765)
	'64:ff9b::/96', // NAT64 well-known prefix (RFC 6052)
	'64:ff9b:1::/48', // NAT64 local-use prefix (RFC 8215)
	'100::/64', // Discard-Only prefix (RFC 6666)
	'2001:db8::/32', // Documentation (RFC 3849)
	'fc00::/7', // Unique Local Address (RFC 4193)
	'fe80::/10', // Link-Local Unicast (RFC 4291)
	'fec0::/10', // Deprecated Site-Local
	'ff00::/8', // Multicast (RFC 4291)
].map(createIpv6Cidr);

function isBlockedIpv4(ip: number): boolean {
	return BLOCKED_IPV4_CIDRS.some(({ network, mask }) => (ip & mask) >>> 0 === network);
}

function isBlockedIpv6(ip: bigint): boolean {
	return BLOCKED_IPV6_CIDRS.some(({ prefix, shift }) => ip >> shift === prefix);
}

function isLocalhostDomain(normalizedHost: string): boolean {
	return normalizedHost === 'localhost' || normalizedHost.endsWith('.localhost');
}

/**
 * Validates a URL string for safe favicon fetching.
 */
export function validateUrl(urlString: string): { error: string } | { url: URL; domain: string } {
	if (!urlString) {
		return { error: 'URL parameter is required' };
	}

	let parsedUrl: URL;
	try {
		parsedUrl = new URL(urlString);
	} catch {
		return { error: 'Invalid URL format' };
	}

	if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
		return { error: 'URL must use HTTP or HTTPS protocol' };
	}

	const hostname = parsedUrl.hostname.toLowerCase();
	if (!hostname) {
		return { error: 'Could not extract domain from URL' };
	}

	// Bracketed IPv6 literal
	if (hostname.startsWith('[') && hostname.endsWith(']')) {
		const ipv6 = parseIpv6(hostname);
		if (ipv6 === null) {
			return { error: 'Invalid domain format' };
		}
		if (isBlockedIpv6(ipv6)) {
			return { error: 'Private/internal domains are not allowed' };
		}
		return { url: parsedUrl, domain: hostname };
	}

	const normalizedHost = hostname.replace(/\.+$/, '');
	if (!normalizedHost) {
		return { error: 'Could not extract domain from URL' };
	}

	// Block exact localhost and *.localhost
	if (isLocalhostDomain(normalizedHost)) {
		return { error: 'Localhost domains are not allowed' };
	}

	// Check IPv4 literal against private/reserved CIDRs
	const ipv4 = parseIpv4(normalizedHost);
	if (ipv4 !== null) {
		if (isBlockedIpv4(ipv4)) {
			return { error: 'Private/internal domains are not allowed' };
		}
		return { url: parsedUrl, domain: normalizedHost };
	}

	// Basic FQDN validation (must have at least one dot and no empty labels)
	if (!normalizedHost.includes('.') || normalizedHost.startsWith('.') || normalizedHost.includes('..')) {
		return { error: 'Invalid domain format' };
	}

	return { url: parsedUrl, domain: normalizedHost };
}
