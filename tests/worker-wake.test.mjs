import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/**
 * Ciclo de vida do service worker.
 *
 * No Chromium o worker é encerrado por ociosidade e recriado na próxima
 * navegação — `initialize()` roda de novo a cada despertar. Um despertar em que
 * nada mudou não pode reescrever o storage nem republicar as regras dinâmicas:
 * com o perfil máximo do projeto isso custava ~1,5 MiB de escrita e a
 * republicação de 4.900 regras, repetidamente, sem alterar nada.
 *
 * Carregar os módulos num contexto novo, contra o MESMO storage, é exatamente
 * o que o navegador faz ao recriar o worker.
 */

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

const MODULES = [
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
];
const sources = [];
for (const path of MODULES) {
    sources.push([path, await readFile(resolve(projectRoot, path), 'utf8')]);
}

// Sobrevivem ao encerramento do worker, como no navegador.
const storageData = {};
let dynamicRules = [];

const counters = { storageWrites: 0, dnrRuleWrites: 0, rulesetToggles: 0 };

function resetCounters() {
    counters.storageWrites = 0;
    counters.dnrRuleWrites = 0;
    counters.rulesetToggles = 0;
}

const event = () => ({ addListener() {} });

/** Cada chamada devolve um worker "novo", como após um encerramento. */
function bootWorker() {
    let messageListener;
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
                async set(values) {
                    counters.storageWrites += 1;
                    Object.assign(storageData, structuredClone(values));
                },
                async remove(key) { delete storageData[key]; }
            }
        },
        declarativeNetRequest: {
            async updateEnabledRulesets() { counters.rulesetToggles += 1; },
            async getEnabledRulesets() { return ['ads_rules', 'tracker_rules']; },
            async getDynamicRules() { return structuredClone(dynamicRules); },
            async updateDynamicRules({ removeRuleIds = [], addRules = [] }) {
                counters.dnrRuleWrites += 1;
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
    for (const [filename, source] of sources) {
        vm.runInContext(source, context, { filename });
    }

    return function invoke(message, sender) {
        return new Promise((resolveResponse, reject) => {
            const keepAlive = messageListener(message, sender, resolveResponse);
            if (keepAlive !== true) {
                setTimeout(() => reject(new Error('Listener não manteve o canal aberto')), 50);
            }
        });
    };
}

const extensionSender = {
    id: 'guardiao-test',
    url: 'moz-extension://guardiao-test/src/options/options.html'
};

test('primeiro início grava o estado e publica as regras', async () => {
    const invoke = bootWorker();
    const added = await invoke({
        type: 'addListEntry',
        payload: { list: 'whitelist', entry: { pattern: 'meu-site.example', type: 'subdomain' } }
    }, extensionSender);

    assert.equal(added.ok, true);
    assert.ok(counters.storageWrites > 0, 'o primeiro início precisa persistir');
    assert.ok(dynamicRules.length > 0, 'a whitelist do usuário deve gerar regra');
});

test('despertar sem mudança não reescreve o storage nem o DNR', async () => {
    const rulesBeforeWake = structuredClone(dynamicRules);
    const storageBeforeWake = structuredClone(storageData);
    resetCounters();

    // Worker encerrado e recriado: contexto novo, mesmo storage.
    const invoke = bootWorker();
    const response = await invoke({ type: 'getState' }, extensionSender);

    assert.equal(response.ok, true, 'o worker recriado precisa responder normalmente');
    assert.equal(
        counters.storageWrites,
        0,
        'nada mudou — reescrever o estado inteiro é escrita pura de desperdício'
    );
    assert.equal(
        counters.dnrRuleWrites,
        0,
        'nada mudou — republicar as regras dinâmicas é trabalho puro de desperdício'
    );
    assert.deepEqual(dynamicRules, rulesBeforeWake, 'as regras devem permanecer intactas');
    assert.deepEqual(storageData, storageBeforeWake, 'o storage deve permanecer intacto');
});

test('o estado sobrevive ao despertar', async () => {
    const invoke = bootWorker();
    const response = await invoke({ type: 'getState' }, extensionSender);

    assert.equal(
        response.state.whitelist.some(entry => entry.pattern === 'meu-site.example'),
        true,
        'a entrada criada antes do encerramento precisa continuar valendo'
    );
});

test('uma mudança real depois do despertar volta a gravar', async () => {
    resetCounters();
    const invoke = bootWorker();
    const added = await invoke({
        type: 'addListEntry',
        payload: { list: 'blocklist', entry: { pattern: 'ruim.example', type: 'subdomain' } }
    }, extensionSender);

    assert.equal(added.ok, true);
    assert.ok(
        counters.storageWrites > 0,
        'a otimização não pode silenciar uma gravação legítima'
    );
});
