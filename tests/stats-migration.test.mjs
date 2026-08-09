import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/**
 * Migração de contadores v4 → v5 e honestidade semântica.
 *
 * Os nomes antigos (`sitesBlocked`, `adsBlocked`, `trackersBlocked`) afirmavam
 * bloqueio para números que, no caso de anúncios e rastreadores, mediam
 * recursos que CARREGARAM. A migração precisa preservar o valor acumulado do
 * usuário sob nomes que descrevam o que de fato é medido.
 */

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

// Estado de um perfil que já rodava a versão anterior.
const storageData = {
    schemaVersion: 4,
    stats: {
        totalBlocked: 1500,
        sitesBlocked: 12,
        adsBlocked: 900,
        trackersBlocked: 588,
        lastReset: 1750000000000
    }
};

let dynamicRules = [];
let messageListener;

const event = () => ({ addListener(listener) { this.listener = listener; } });

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
        async getEnabledRulesets() { return ['ads_rules', 'tracker_rules']; },
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
    webNavigation: {
        onBeforeNavigate: event(),
        onHistoryStateUpdated: event(),
        onReferenceFragmentUpdated: event()
    }
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
    'src/background/verified-betting-domains.js',
    'src/background/blocklist-index.js',
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

test('contadores legados migram sem perder o acumulado do usuário', async () => {
    const response = await invoke({ type: 'getState' }, extensionSender);
    const stats = response.state.stats;

    assert.equal(stats.pagesBlocked, 12, 'sitesBlocked deve virar pagesBlocked');
    assert.equal(stats.adsObserved, 900, 'adsBlocked deve virar adsObserved');
    assert.equal(stats.trackersObserved, 588, 'trackersBlocked deve virar trackersObserved');
    assert.equal(stats.lastReset, 1750000000000, 'a data do último reset é preservada');
});

test('o agregado enganoso e os nomes antigos desaparecem do estado', async () => {
    const response = await invoke({ type: 'getState' }, extensionSender);
    const stats = response.state.stats;

    // totalBlocked somava um evento real (páginas) com duas estimativas.
    assert.equal('totalBlocked' in stats, false);
    for (const legacy of ['sitesBlocked', 'adsBlocked', 'trackersBlocked']) {
        assert.equal(legacy in stats, false, `${legacy} não deve sobreviver à migração`);
    }
});

test('a migração é persistida com o novo schemaVersion', async () => {
    await invoke({ type: 'getState' }, extensionSender);
    assert.equal(storageData.schemaVersion, 5);
    assert.equal(storageData.stats.pagesBlocked, 12);
    assert.equal('adsBlocked' in storageData.stats, false);
});

test('zerar contadores parte dos nomes atuais', async () => {
    const response = await invoke({ type: 'resetStats' }, extensionSender);
    const stats = response.state.stats;

    assert.equal(stats.pagesBlocked, 0);
    assert.equal(stats.adsObserved, 0);
    assert.equal(stats.trackersObserved, 0);
    assert.ok(stats.lastReset > 1750000000000, 'o reset registra o instante atual');
});
