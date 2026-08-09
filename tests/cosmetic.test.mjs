import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { loadRuntime } from './runtime-loader.mjs';

/**
 * Ocultamento de elementos.
 *
 * Um seletor não executa código, mas pode apagar a página inteira. A validação
 * do parser é a fronteira real, e a precedência da allowlist do usuário precisa
 * valer aqui exatamente como vale na rede e na classificação.
 */

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

/**
 * Os objetos devolvidos pelo parser e pelo background nascem dentro do vm e
 * carregam o Array.prototype daquele realm, o que faz deepStrictEqual falhar
 * mesmo com conteúdo idêntico. Reconstruir aqui compara conteúdo, não realm.
 */
function hostArray(value) {
    return Array.from(value ?? []);
}

const runtime = await loadRuntime(['src/shared/filters/filter-list-parser.js']);
const parser = runtime.GuardiaoFilterParser;

function parseOne(line) {
    return parser.parse(`[Adblock Plus 2.0]\n${line}\n`);
}

// ---------------------------------------------------------------------------
// Sintaxe aceita
// ---------------------------------------------------------------------------

test('ocultamento genérico e por domínio são aceitos', () => {
    const generic = parseOne('##.ad-banner');
    assert.equal(generic.cosmetic.length, 1);
    assert.deepEqual(hostArray(generic.cosmetic[0].domains), []);
    assert.equal(generic.cosmetic[0].exception, false);

    const specific = parseOne('exemplo.com##.patrocinado');
    assert.equal(specific.cosmetic.length, 1);
    assert.deepEqual(hostArray(specific.cosmetic[0].domains), ['exemplo.com']);
});

test('exceção é registrada como exceção, não como regra', () => {
    const parsed = parseOne('exemplo.com#@#.patrocinado');
    assert.equal(parsed.cosmetic.length, 1);
    assert.equal(parsed.cosmetic[0].exception, true);
});

test('vários domínios na mesma linha viram entradas ordenadas e únicas', () => {
    const parsed = parseOne('b.com,a.com,a.com##.anuncio');
    assert.deepEqual(hostArray(parsed.cosmetic[0].domains), ['a.com', 'b.com']);
});

test('comentário não é confundido com filtro cosmético', () => {
    const parsed = parseOne('! isto ## não é um filtro');
    assert.equal(parsed.cosmetic.length, 0);
    assert.equal(parsed.stats.comments, 1);
});

// ---------------------------------------------------------------------------
// Seletores que quebrariam a página
// ---------------------------------------------------------------------------

test('seletor que atinge estrutura da página é recusado', () => {
    for (const line of [
        '##body',
        '##html',
        '##head',
        '##*',
        '##:root',
        '##main',
        '##article',
        '##html > div',
        '##body .anuncio',
        '##div, body',
        '##body:not(.never)',
        '##html#page',
        '##:is(body)',
        '##div:has(body)',
        '##div:not(:root)',
        '##section:is(*)'
    ]) {
        const parsed = parseOne(line);
        assert.equal(parsed.cosmetic.length, 0, `${line} deveria ser recusado`);
        assert.ok(parsed.stats.rejected > 0, `${line} deveria contar como recusa`);
    }
});

test('nomes estruturais em classe, id e atributo não geram falso positivo', () => {
    for (const line of [
        '##.body',
        '###html',
        '##[data-element="body"]',
        '##div:not(.advert)'
    ]) {
        const parsed = parseOne(line);
        assert.equal(parsed.cosmetic.length, 1, `${line} deveria ser aceito`);
    }
});

test('sintaxe procedural continua recusada', () => {
    for (const line of [
        'exemplo.com##.x:has-text(anuncio)',
        'exemplo.com##.x:matches-css(display: block)',
        'exemplo.com##.x:xpath(//div)',
        'exemplo.com##.x:upward(2)',
        'exemplo.com##.x:remove()'
    ]) {
        const parsed = parseOne(line);
        assert.equal(parsed.cosmetic.length, 0, `${line} deveria ser recusado`);
    }
});

test('injeção de estilo e scriptlet continuam recusados', () => {
    for (const line of [
        'exemplo.com#$#.x { display: none }',
        'exemplo.com#$?#.x { color: red }',
        'exemplo.com##+js(nano-setInterval-booster)',
        'exemplo.com##^script:has-text(anuncio)'
    ]) {
        const parsed = parseOne(line);
        assert.equal(parsed.cosmetic.length, 0, `${line} deveria ser recusado`);
    }
});

test('seletor não pode conter chave nem barra invertida', () => {
    for (const line of ['##.x{color:red}', '##.x\\3a hover']) {
        assert.equal(parseOne(line).cosmetic.length, 0, `${line} deveria ser recusado`);
    }
});

test('exclusão de domínio é recusada em vez de aplicada mais amplamente', () => {
    const parsed = parseOne('~exemplo.com##.anuncio');
    assert.equal(parsed.cosmetic.length, 0);
    assert.equal(parsed.stats.reasons['unsupported-domain-exclusion'], 1);
});

test('seletor longo demais é recusado', () => {
    const parsed = parseOne(`##${'.a'.repeat(200)}`);
    assert.equal(parsed.cosmetic.length, 0);
});

// ---------------------------------------------------------------------------
// A lista embarcada precisa obedecer às próprias regras
// ---------------------------------------------------------------------------

test('a seed list embarcada não produz nenhuma recusa', async () => {
    const text = await readFile(
        resolve(projectRoot, 'src', 'filters', 'sources', 'cosmetic.txt'),
        'utf8'
    );
    const parsed = parser.parse(text);
    assert.deepEqual(
        hostArray(parsed.errors).map(error => `${error.reason}: ${error.source}`),
        [],
        'toda linha recusada precisa ser corrigida, não ignorada'
    );
    assert.ok(parsed.cosmetic.length >= 40, `apenas ${parsed.cosmetic.length} seletores`);
});

// ---------------------------------------------------------------------------
// Integração: precedência da allowlist e do toggle
// ---------------------------------------------------------------------------

const storageData = {};
let dynamicRules = [];
let messageListener;
const event = () => ({ addListener() {} });

const browser = {
    runtime: {
        id: 'guardiao-test',
        getURL: path => `moz-extension://guardiao-test/${path}`,
        getManifest: () => ({ version: '3.1.1' }),
        onMessage: { addListener(listener) { messageListener = listener; } },
        onInstalled: event(),
        sendMessage: async () => ({ ok: true })
    },
    storage: {
        local: {
            async get(keys) {
                const result = {};
                for (const key of Array.isArray(keys) ? keys : [keys]) {
                    if (key in storageData) result[key] = storageData[key];
                }
                return result;
            },
            async set(values) { Object.assign(storageData, structuredClone(values)); },
            async remove(key) { delete storageData[key]; }
        }
    },
    declarativeNetRequest: {
        async updateEnabledRulesets() {},
        async getEnabledRulesets() { return []; },
        async getDynamicRules() { return structuredClone(dynamicRules); },
        async updateDynamicRules({ removeRuleIds = [], addRules = [] }) {
            const removed = new Set(removeRuleIds);
            dynamicRules = dynamicRules.filter(rule => !removed.has(rule.id));
            dynamicRules.push(...structuredClone(addRules));
        }
    },
    tabs: {
        async query() { return []; },
        async sendMessage() {},
        async update(tabId, update) { return { id: tabId, ...update }; }
    },
    webNavigation: { onBeforeNavigate: event(), onHistoryStateUpdated: event() }
};

const context = vm.createContext({
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    crypto: webcrypto,
    console,
    setTimeout,
    clearTimeout,
    structuredClone,
    browser,
    fetch: async () => ({ ok: true, text: async () => 'bet365.com\n' })
});
for (const path of [
    'src/shared/platform.js',
    'src/shared/appearance.js',
    'src/shared/detection/constants.js',
    'src/shared/lists/list-matcher.js',
    'src/shared/filters/filter-list-parser.js',
    'src/shared/detection/detection-engine.js',
    'src/shared/messaging/message-schema.js',
    'src/background/blocklist-index.js',
    'src/background/cosmetic-filters.js',
    'src/background/service-worker.js'
]) {
    vm.runInContext(await readFile(resolve(projectRoot, path), 'utf8'), context, { filename: path });
}

function invoke(message, sender) {
    return new Promise((resolveResponse, reject) => {
        const keepAlive = messageListener(message, sender, resolveResponse);
        if (keepAlive !== true) {
            setTimeout(() => reject(new Error('Listener não manteve o canal aberto')), 50);
        }
    });
}

const extensionSender = {
    id: 'guardiao-test',
    url: 'moz-extension://guardiao-test/src/options/options.html'
};
const contentSender = url => ({ id: 'guardiao-test', url, frameId: 0, tab: { id: 3, url } });

test('uma página comum recebe os seletores embarcados', async () => {
    const response = await invoke(
        { type: 'getCosmeticFilters' },
        contentSender('https://noticias.example/materia')
    );
    assert.equal(response.ok, true);
    assert.ok(response.selectors.length >= 40, 'a lista embarcada deveria ser servida');
    assert.ok(response.selectors.includes('ins.adsbygoogle'));
});

test('página da extensão não pode pedir seletores', async () => {
    const response = await invoke({ type: 'getCosmeticFilters' }, extensionSender);
    assert.equal(response.ok, false);
    assert.equal(response.code, 'FORBIDDEN');
});

test('site na whitelist do usuário não recebe ocultamento', async () => {
    await invoke({
        type: 'addListEntry',
        payload: { list: 'whitelist', entry: { pattern: 'permitido.example', type: 'subdomain' } }
    }, extensionSender);

    const response = await invoke(
        { type: 'getCosmeticFilters' },
        contentSender('https://permitido.example/pagina')
    );
    assert.deepEqual(hostArray(response.selectors), [], 'a exceção do usuário tem precedência');

    const subdomain = await invoke(
        { type: 'getCosmeticFilters' },
        contentSender('https://www.permitido.example/pagina')
    );
    assert.deepEqual(hostArray(subdomain.selectors), [], 'a precedência vale para subdomínios');
});

test('desligar o bloqueio de anúncios desliga o ocultamento', async () => {
    await invoke({
        type: 'updateSettings',
        payload: { settings: { blockAds: false } }
    }, extensionSender);

    const response = await invoke(
        { type: 'getCosmeticFilters' },
        contentSender('https://noticias.example/materia')
    );
    assert.deepEqual(hostArray(response.selectors), []);

    await invoke({
        type: 'updateSettings',
        payload: { settings: { blockAds: true } }
    }, extensionSender);
});

test('pausar a proteção desliga o ocultamento', async () => {
    await invoke({ type: 'toggleProtection', payload: { enabled: false } }, extensionSender);
    const paused = await invoke(
        { type: 'getCosmeticFilters' },
        contentSender('https://noticias.example/materia')
    );
    assert.deepEqual(hostArray(paused.selectors), []);

    await invoke({ type: 'toggleProtection', payload: { enabled: true } }, extensionSender);
    const resumed = await invoke(
        { type: 'getCosmeticFilters' },
        contentSender('https://noticias.example/materia')
    );
    assert.ok(resumed.selectors.length > 0);
});
