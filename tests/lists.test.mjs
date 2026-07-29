import assert from 'node:assert/strict';
import test from 'node:test';

import { loadRuntime } from './runtime-loader.mjs';

const runtime = await loadRuntime([
    'src/shared/detection/constants.js',
    'src/shared/lists/list-matcher.js'
]);
const lists = runtime.GuardiaoLists;

test('domínio exato e subdomínio têm semânticas distintas', async () => {
    const exact = lists.compile([{ pattern: 'example.com', type: 'domain' }], 'whitelist');
    assert.ok(await lists.match(exact, { url: 'https://example.com/', hostname: 'example.com' }));
    assert.equal(await lists.match(exact, { url: 'https://sub.example.com/', hostname: 'sub.example.com' }), null);

    const descendants = lists.compile([{ pattern: 'example.com', type: 'subdomain' }], 'whitelist');
    assert.ok(await lists.match(descendants, {
        url: 'https://deep.sub.example.com/',
        hostname: 'deep.sub.example.com'
    }));
});

test('URL, regex, TLD e ASN são suportados com validação', async () => {
    const whitelist = lists.compile([
        { pattern: 'https://example.com/safe?mode=1', type: 'url' },
        { pattern: '^https://docs\\.example\\.com/', type: 'regex' }
    ], 'whitelist');
    assert.ok(await lists.match(whitelist, {
        url: 'https://example.com/safe?mode=1#section',
        hostname: 'example.com'
    }));
    assert.ok(await lists.match(whitelist, {
        url: 'https://docs.example.com/api',
        hostname: 'docs.example.com'
    }));

    const blocklist = lists.compile([
        { pattern: '.casino', type: 'tld' },
        { pattern: 'AS64500', type: 'asn' }
    ], 'blocklist');
    assert.ok(await lists.match(blocklist, {
        url: 'https://unknown.casino/',
        hostname: 'unknown.casino'
    }));
    assert.ok(await lists.match(blocklist, {
        url: 'https://network.example/',
        hostname: 'network.example',
        asn: '64500'
    }));
});

test('regex potencialmente catastrófica é rejeitada', () => {
    assert.equal(lists.validateRegex('(a+)+$').ok, false);
    assert.equal(lists.validateRegex('^https://docs\\.example\\.com/').ok, true);
});

test('hash e assinatura SHA-256 são comparados localmente', async () => {
    const url = 'https://example.com/path?mode=1';
    const hostnameHash = await lists.sha256Hex('example.com');
    const signature = await lists.sha256Hex(lists.signatureSource(url));
    const whitelist = lists.compile([
        { pattern: hostnameHash, type: 'hash' },
        { pattern: signature, type: 'signature' }
    ], 'whitelist');
    assert.ok(await lists.match(whitelist, { url, hostname: 'example.com' }));
});

test('entradas legadas são migradas sem perder subdomínios', () => {
    const result = lists.normalizeEntries(['example.com'], 'whitelist');
    assert.equal(result.entries[0].type, 'subdomain');
    assert.equal(result.entries[0].pattern, 'example.com');
});
