import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { baseSignals } from './runtime-loader.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const storageData = {};
const tabUpdates = [];
let dynamicRules = [];
let failNextStorageWrite = false;
let messageListener;

const event = () => ({
    addListener(listener) {
        this.listener = listener;
    }
});
const browser = {
    runtime: {
        id: 'guardiao-test',
        getURL: path => `moz-extension://guardiao-test/${path}`,
        getManifest: () => ({ version: '3.1.0' }),
        onMessage: {
            addListener(listener) {
                messageListener = listener;
            }
        },
        onInstalled: event(),
        sendMessage: async () => ({ ok: true })
    },
    storage: {
        local: {
            async get(keys) {
                if (keys === null) return { ...storageData };
                const result = {};
                for (const key of Array.isArray(keys) ? keys : [keys]) {
                    if (key in storageData) result[key] = storageData[key];
                }
                return result;
            },
            async set(values) {
                if (failNextStorageWrite) {
                    failNextStorageWrite = false;
                    throw new Error('storage-test-failure');
                }
                Object.assign(storageData, structuredClone(values));
            },
            async remove(key) {
                delete storageData[key];
            }
        }
    },
    declarativeNetRequest: {
        async updateEnabledRulesets() {},
        async getEnabledRulesets() {
            return ['ads_rules', 'tracker_rules'];
        },
        async getDynamicRules() {
            return structuredClone(dynamicRules);
        },
        async updateDynamicRules({ removeRuleIds = [], addRules = [] }) {
            const removed = new Set(removeRuleIds);
            dynamicRules = dynamicRules.filter(rule => !removed.has(rule.id));
            dynamicRules.push(...structuredClone(addRules));
        }
    },
    tabs: {
        async query() {
            return [];
        },
        async sendMessage() {},
        async update(tabId, update) {
            tabUpdates.push({ tabId, update });
            return { id: tabId, ...update };
        }
    },
    webNavigation: {
        onBeforeNavigate: event()
    }
};
const runtimeConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error(...args) {
        if (args.some(value => String(value).includes('storage-test-failure'))) return;
        console.error(...args);
    }
};

const context = vm.createContext({
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    crypto: webcrypto,
    console: runtimeConsole,
    setTimeout,
    clearTimeout,
    structuredClone,
    browser,
    fetch: async () => ({
        ok: true,
        text: async () => 'bet365.com\n'
    })
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
const contentSender = url => ({
    id: 'guardiao-test',
    url,
    frameId: 0,
    tab: { id: 7, url }
});

test('comandos privilegiados são recusados para content scripts', async () => {
    const response = await invoke({
        type: 'toggleProtection',
        payload: { enabled: false }
    }, contentSender('https://example.com/'));
    assert.equal(response.ok, false);
    assert.equal(response.code, 'FORBIDDEN');
});

test('whitelist mantém prioridade sobre blocklist personalizada', async () => {
    await invoke({
        type: 'addListEntry',
        payload: {
            list: 'whitelist',
            entry: { pattern: 'example.com', type: 'subdomain' }
        }
    }, extensionSender);
    await invoke({
        type: 'addListEntry',
        payload: {
            list: 'blocklist',
            entry: { pattern: 'example.com', type: 'subdomain' }
        }
    }, extensionSender);

    const response = await invoke({
        type: 'analyzePage',
        payload: baseSignals('https://sub.example.com/')
    }, contentSender('https://sub.example.com/'));
    assert.equal(response.action, 'allow');
    assert.equal(response.reason, 'whitelist');
    assert.equal(tabUpdates.length, 0);
});

test('blocklist personalizada é uma política explícita e bloqueia', async () => {
    await invoke({
        type: 'addListEntry',
        payload: {
            list: 'blocklist',
            entry: { pattern: 'blocked.example', type: 'subdomain' }
        }
    }, extensionSender);

    const response = await invoke({
        type: 'analyzePage',
        payload: baseSignals('https://blocked.example/')
    }, contentSender('https://blocked.example/'));
    assert.equal(response.action, 'block');
    assert.equal(response.policy, 'custom-blocklist');
    assert.equal(tabUpdates.at(-1).tabId, 7);
    assert.match(tabUpdates.at(-1).update.url, /blocked\.html/);
});

test('whitelist gera regras DNR de alta prioridade para destino e iniciador', async () => {
    const response = await invoke({
        type: 'addListEntry',
        payload: {
            list: 'whitelist',
            entry: { pattern: 'trusted-assets.example', type: 'subdomain' }
        }
    }, extensionSender);

    assert.equal(response.ok, true);
    const allowRules = dynamicRules.filter(rule => rule.action.type === 'allow');
    assert.ok(allowRules.some(rule =>
        rule.priority === 100
        && rule.condition.requestDomains?.includes('trusted-assets.example')
    ));
    assert.ok(allowRules.some(rule =>
        rule.priority === 100
        && rule.condition.initiatorDomains?.includes('trusted-assets.example')
    ));
});

test('importação local cria regras DNR e respeita pausa da fonte', async () => {
    const imported = await invoke({
        type: 'importFilterList',
        payload: {
            name: 'privacy-test.txt',
            category: 'privacy',
            text: '[Adblock Plus 2.0]\n||tracking-test.example^$script,third-party\n'
        }
    }, extensionSender);

    assert.equal(imported.ok, true);
    assert.equal(imported.report.imported, 1);
    assert.ok(dynamicRules.some(rule =>
        rule.id >= 100100
        && rule.condition.urlFilter === '||tracking-test.example^'
    ));

    const source = imported.state.filterSources.find(item => item.name === 'privacy-test.txt');
    assert.ok(source);
    const paused = await invoke({
        type: 'toggleFilterSource',
        payload: { id: source.id, enabled: false }
    }, extensionSender);
    assert.equal(paused.ok, true);
    assert.equal(
        dynamicRules.some(rule => rule.id >= 100100 && rule.condition.urlFilter === '||tracking-test.example^'),
        false
    );
});

test('falha de persistência restaura DNR e estado da whitelist', async () => {
    const before = structuredClone(dynamicRules);
    failNextStorageWrite = true;
    const response = await invoke({
        type: 'addListEntry',
        payload: {
            list: 'whitelist',
            entry: { pattern: 'rollback.example', type: 'subdomain' }
        }
    }, extensionSender);

    assert.equal(response.ok, false);
    assert.equal(response.code, 'INTERNAL_ERROR');
    assert.deepEqual(dynamicRules, before);

    const current = await invoke({ type: 'getState' }, extensionSender);
    assert.equal(
        current.state.whitelist.some(entry => entry.pattern === 'rollback.example'),
        false
    );
});
