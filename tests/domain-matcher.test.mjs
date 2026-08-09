import assert from 'node:assert/strict';
import test from 'node:test';

import { loadRuntime } from './runtime-loader.mjs';

/**
 * Corpus adversarial do matcher de domínio.
 *
 * Confundir `example.com` com `example.com.evil.com` é a falha clássica de
 * bloqueador — e nas duas direções ela é grave: um falso positivo bloqueia
 * site legítimo, um falso negativo deixa passar o domínio que o usuário pediu
 * explicitamente para bloquear.
 *
 * Estes casos existem para nunca mais serem verificados por inspeção visual.
 */

const runtime = await loadRuntime([
    'src/shared/detection/constants.js',
    'src/shared/lists/list-matcher.js',
    'src/shared/detection/detection-engine.js'
]);
const lists = runtime.GuardiaoLists;
const detector = runtime.GuardiaoDetection;

function compiled(type, pattern) {
    return lists.compile([{ pattern, type }], 'blocklist');
}

async function matches(compiledList, url) {
    const entry = await lists.match(compiledList, { url });
    return entry !== null;
}

// ---------------------------------------------------------------------------
// subdomain: cobre o domínio e seus filhos, nada além
// ---------------------------------------------------------------------------

test('subdomain cobre o próprio domínio e descendentes reais', async () => {
    const list = compiled('subdomain', 'example.com');
    for (const host of [
        'example.com',
        'ads.example.com',
        'sub.example.com',
        'a.b.c.example.com'
    ]) {
        assert.equal(await matches(list, `https://${host}/`), true, `${host} deveria casar`);
    }
});

test('subdomain não é enganado por sufixo, prefixo ou domínio-isca', async () => {
    const list = compiled('subdomain', 'example.com');
    for (const host of [
        'example.com.br',          // TLD diferente
        'example.com.evil.com',    // o domínio real é evil.com
        'fakeexample.com',         // prefixo colado
        'notexample.com',
        'example.company',         // rótulo mais longo
        'myexample.com',
        'example.co'
    ]) {
        assert.equal(
            await matches(list, `https://${host}/`),
            false,
            `${host} NÃO deveria casar com example.com`
        );
    }
});

// ---------------------------------------------------------------------------
// domain: exato, sem descendentes
// ---------------------------------------------------------------------------

test('domain exato não alcança subdomínios', async () => {
    const list = compiled('domain', 'example.com');
    assert.equal(await matches(list, 'https://example.com/'), true);
    assert.equal(await matches(list, 'https://ads.example.com/'), false);
    assert.equal(
        await matches(list, 'https://www.example.com/'),
        false,
        'www é um subdomínio como qualquer outro e não é implícito no tipo exato'
    );
});

// ---------------------------------------------------------------------------
// O domínio não pode ser lido de outra parte da URL
// ---------------------------------------------------------------------------

test('domínio no caminho, query ou fragmento não conta como host', async () => {
    const list = compiled('subdomain', 'example.com');
    for (const url of [
        'https://evil.com/example.com',
        'https://evil.com/?redirect=https://example.com/',
        'https://evil.com/?next=example.com',
        'https://evil.com/#example.com',
        'https://evil.com/path/example.com/deeper'
    ]) {
        assert.equal(await matches(list, url), false, `${url} tem host evil.com`);
    }
});

test('userinfo não é confundido com host', async () => {
    const list = compiled('subdomain', 'example.com');
    // O host real aqui é evil.com; example.com é apenas o usuário.
    assert.equal(await matches(list, 'https://example.com@evil.com/'), false);
});

test('o host verdadeiro é bloqueado mesmo com userinfo enganoso', async () => {
    const list = compiled('subdomain', 'example.com');
    assert.equal(await matches(list, 'https://safe.org@example.com/'), true);
});

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------

test('caixa, ponto final e porta são normalizados', async () => {
    const list = compiled('subdomain', 'example.com');
    for (const url of [
        'https://EXAMPLE.COM/',
        'https://Example.Com/',
        'https://example.com./',
        'https://example.com:8443/',
        'http://ADS.EXAMPLE.COM:80/'
    ]) {
        assert.equal(await matches(list, url), true, `${url} deveria normalizar para example.com`);
    }
});

test('apenas http e https entram no escopo', async () => {
    const list = compiled('subdomain', 'example.com');
    for (const url of [
        'ftp://example.com/',
        'file:///example.com',
        'javascript:location="https://example.com"',
        'data:text/html,example.com',
        'about:blank'
    ]) {
        assert.equal(await matches(list, url), false, `${url} está fora do escopo HTTP(S)`);
    }
});

// ---------------------------------------------------------------------------
// TLD
// ---------------------------------------------------------------------------

test('regra de TLD casa o último rótulo, não uma substring', async () => {
    const list = compiled('tld', 'casino');
    assert.equal(await matches(list, 'https://sorte.casino/'), true);
    assert.equal(await matches(list, 'https://a.b.sorte.casino/'), true);
    assert.equal(await matches(list, 'https://casino.com/'), false);
    assert.equal(await matches(list, 'https://meucasino.net/'), false);
    assert.equal(await matches(list, 'https://casino.com.br/'), false);
});

// ---------------------------------------------------------------------------
// Domínios confiáveis embutidos — a mesma semântica precisa valer
// ---------------------------------------------------------------------------

test('a lista de confiáveis não é enganada por domínio-isca', () => {
    assert.equal(detector.isTrustedHostname('google.com'), true);
    assert.equal(detector.isTrustedHostname('mail.google.com'), true);
    assert.equal(detector.isTrustedHostname('google.com.evil.com'), false);
    assert.equal(detector.isTrustedHostname('fakegoogle.com'), false);
    assert.equal(detector.isTrustedHostname('google.com.br'), false);
    assert.equal(detector.isTrustedHostname('notgithub.com'), false);
});

test('hospedagens multiusuário não são confiáveis por sufixo', () => {
    for (const hostname of [
        'casino.vercel.app',
        'bets.github.io',
        'promocao.netlify.app',
        'conteudo.githubusercontent.com'
    ]) {
        assert.equal(detector.isTrustedHostname(hostname), false, hostname);
    }
});

test('os padrões institucionais exigem rótulo completo', () => {
    assert.equal(detector.isTrustedHostname('usp.edu.br'), true);
    assert.equal(detector.isTrustedHostname('sp.gov.br'), true);
    assert.equal(detector.isTrustedHostname('cam.ac.uk'), true);
    assert.equal(detector.isTrustedHostname('notedu.com'), false);
    assert.equal(detector.isTrustedHostname('edu.evil.com'), false);
    assert.equal(detector.isTrustedHostname('gov.casino'), false);
});

// ---------------------------------------------------------------------------
// Entradas malformadas não devem casar nem lançar
// ---------------------------------------------------------------------------

test('entradas inválidas são recusadas na normalização', () => {
    for (const pattern of [
        '',
        ' ',
        '.',
        '..',
        'exemplo com espaco.com',
        'http://example.com',   // URL não é hostname
        'example.com/path',
        '-example.com',
        'example-.com',
        '.example.com'
    ]) {
        assert.equal(
            lists.normalizeHostname(pattern),
            '',
            `${JSON.stringify(pattern)} não é hostname válido`
        );
    }
});

test('URL malformada não casa e não lança', async () => {
    const list = compiled('subdomain', 'example.com');
    for (const url of ['', 'não é url', 'https://', 'https://[', '///example.com']) {
        assert.equal(await matches(list, url), false);
    }
});

// ---------------------------------------------------------------------------
// IDN e homógrafos
// ---------------------------------------------------------------------------

test('homógrafo cirílico não é tratado como o domínio latino', async () => {
    const list = compiled('subdomain', 'example.com');
    // O "а" aqui é U+0430 (cirílico), não U+0061.
    assert.equal(await matches(list, 'https://exаmple.com/'), false);
});

test('IDN é normalizado de forma consistente entre entrada e consulta', async () => {
    const punycode = lists.normalizeHostname('münchen.de');
    assert.ok(punycode, 'o hostname IDN deve normalizar');
    const list = compiled('subdomain', 'münchen.de');
    assert.equal(
        await matches(list, 'https://münchen.de/'),
        true,
        'a mesma forma IDN precisa casar consigo mesma'
    );
});
