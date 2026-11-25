import { describe, expect, it } from 'vitest';
import { parseIpv4, parseIpv6, validateUrl } from './url-validation';

describe('IPv4 and IPv6 parsers', () => {
	it('parses valid canonical IPv4 addresses and rejects invalid ones', () => {
		expect(parseIpv4('0.0.0.0')).toBe(0);
		expect(parseIpv4('127.0.0.1')).toBe(0x7f000001);
		expect(parseIpv4('255.255.255.255')).toBe(0xffffffff);
		expect(parseIpv4('256.0.0.1')).toBeNull();
		expect(parseIpv4('01.2.3.4')).toBeNull();
		expect(parseIpv4('1.2.3')).toBeNull();
		expect(parseIpv4('example.com')).toBeNull();
	});

	it('parses compressed, expanded, bracketed, and IPv4-embedded IPv6 addresses', () => {
		expect(parseIpv6('::')).toBe(0n);
		expect(parseIpv6('[::1]')).toBe(1n);
		expect(parseIpv6('0:0:0:0:0:0:0:1')).toBe(1n);
		expect(parseIpv6('::ffff:127.0.0.1')).toBe(0xffff7f000001n);
		expect(parseIpv6('[::ffff:7f00:1]')).toBe(0xffff7f000001n);
		expect(parseIpv6('::ffff:0:127.0.0.1')).toBe(0xffff00007f000001n);
		expect(parseIpv6('2606:4700:4700::1111')).toBe(
			0x26064700470000000000000000001111n,
		);
		expect(parseIpv6('::1::2')).toBeNull();
		expect(parseIpv6('1:2:3:4:5:6:7:8:9')).toBeNull();
		expect(parseIpv6('gggg::1')).toBeNull();
	});
});

describe('validateUrl SSRF protection', () => {
	it.each([
		'https://example.com',
		'http://sub.domain.co.uk/path?a=1',
		'https://my-localhost.com',
		'https://localhost-tools.dev',
		'https://notlocalhost.example.com/favicon',
		'https://8.8.8.8',
		'https://1.1.1.1',
		'https://93.184.216.34',
		'https://100.63.255.255',
		'https://100.128.0.0',
		'https://172.15.255.255',
		'https://172.32.0.0',
		'https://[2606:4700:4700::1111]',
		'https://[2001:4860:4860::8888]',
	])('allows public URL %s', (input) => {
		const result = validateUrl(input);
		expect('domain' in result).toBe(true);
	});

	it.each([
		'http://localhost',
		'https://localhost:3000',
		'http://LOCALHOST.',
		'http://sub.localhost',
		'https://a.b.localhost/path',
		'https://sub.localhost.',
	])('blocks localhost variation %s', (input) => {
		const result = validateUrl(input);
		expect(result).toEqual({ error: 'Localhost domains are not allowed' });
	});

	it.each([
		// 0.0.0.0/8
		'http://0.0.0.0',
		'http://0.1.2.3',
		'http://0.255.255.255',
		// 10.0.0.0/8
		'http://10.0.0.1',
		'http://10.255.255.254',
		// 100.64.0.0/10 (CGNAT)
		'http://100.64.0.1',
		'http://100.127.255.254',
		// 127.0.0.0/8 (including obfuscated IPv4 encodings normalized by WHATWG URL)
		'http://127.0.0.1',
		'http://127.255.255.254',
		'http://127.1',
		'http://2130706433',
		'http://0x7f000001',
		'http://0177.0.0.1',
		// 169.254.0.0/16 (link-local / cloud metadata)
		'http://169.254.169.254/latest/meta-data/',
		'http://169.254.0.1',
		// 172.16.0.0/12
		'http://172.16.0.1',
		'http://172.31.255.254',
		// 192.168.0.0/16
		'http://192.168.0.1',
		'http://192.168.255.254',
		// 224.0.0.0/4 multicast and 240.0.0.0/4 reserved/broadcast
		'http://224.0.0.1',
		'http://239.255.255.255',
		'http://240.0.0.1',
		'http://255.255.255.255',
		// Additional RFC 6890 non-global ranges
		'http://192.0.0.1',
		'http://192.0.2.1',
		'http://198.18.0.1',
		'http://198.51.100.1',
		'http://203.0.113.1',
	])('blocks private/reserved IPv4 URL %s', (input) => {
		const result = validateUrl(input);
		expect(result).toEqual({
			error: 'Private/internal domains are not allowed',
		});
	});

	it.each([
		// ::/128 and ::1/128
		'http://[::]',
		'http://[::1]',
		'http://[0:0:0:0:0:0:0:1]',
		// ::/96 (IPv4-compatible)
		'http://[::127.0.0.1]',
		'http://[::7f00:1]',
		'http://[::8.8.8.8]',
		// ::ffff:0:0/96 (IPv4-mapped)
		'http://[::ffff:127.0.0.1]',
		'http://[::ffff:169.254.169.254]',
		'http://[::ffff:7f00:1]',
		'http://[::ffff:8.8.8.8]',
		// ::ffff:0:0:0/96 (SIIT IPv4-translated)
		'http://[::ffff:0:127.0.0.1]',
		'http://[::ffff:0:7f00:1]',
		// NAT64, discard, documentation
		'http://[64:ff9b::127.0.0.1]',
		'http://[64:ff9b:1::1]',
		'http://[100::1]',
		'http://[2001:db8::1]',
		// fc00::/7 (ULA)
		'http://[fc00::1]',
		'http://[fd12:3456:789a::1]',
		'http://[fdff:ffff::1]',
		// fe80::/10 (link-local) and fec0::/10 (site-local)
		'http://[fe80::1]',
		'http://[febf::1]',
		'http://[fec0::1]',
		// ff00::/8 (multicast)
		'http://[ff02::1]',
		'http://[ffff::1]',
	])('blocks private/reserved IPv6 URL %s', (input) => {
		const result = validateUrl(input);
		expect(result).toEqual({
			error: 'Private/internal domains are not allowed',
		});
	});

	it('rejects missing, malformed, non-HTTP(S), and single-label URLs', () => {
		expect(validateUrl('')).toEqual({ error: 'URL parameter is required' });
		expect(validateUrl('not a url')).toEqual({ error: 'Invalid URL format' });
		expect(validateUrl('ftp://example.com')).toEqual({
			error: 'URL must use HTTP or HTTPS protocol',
		});
		expect(validateUrl('javascript:alert(1)')).toEqual({
			error: 'URL must use HTTP or HTTPS protocol',
		});
		expect(validateUrl('http://intranet')).toEqual({
			error: 'Invalid domain format',
		});
		expect(validateUrl('http://example..com')).toEqual({
			error: 'Invalid domain format',
		});
	});
});
