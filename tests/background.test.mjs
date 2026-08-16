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
const tabMessages = [];
let dynamicRules = [];
let failNextStorageWrite = false;
let messageListener;
const blocklistFixture = [
    'bet365.com',
    ...Array.from({ length: 160 }, (_, index) =>
        `domain-${String(index).padStart(3, '0')}.example`
    )
].sort().join('\n');

/**
 * `requestDomains` é uma lista de hosts exatos, então a asserção compara item a
 * item. `Array.prototype.includes` daria o mesmo resultado aqui, mas é o mesmo
 * nome usado para busca de substring em string: quem lê — e a análise estática
 * — não consegue distinguir sem inferir o tipo do receptor.
 */
function listsDomain(domains, expected) {
    return Array.isArray(domains) && domains.some(domain => domain === expected);
}

const event = () => ({
    addListener(listener) {
        this.listener = listener;
    }
});
const browser = {
    runtime: {
        id: 'guardiao-test',
        getURL: path => `moz-extension://guardiao-test/${path}`,
        getManifest: () => ({ version: '3.1.1' }),
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
        async sendMessage(tabId, message) {
            tabMessages.push({ tabId, message: structuredClone(message) });
        },
        async update(tabId, update) {
            tabUpdates.push({ tabId, update });
            return { id: tabId, ...update };
        }
    },
    webNavigation: {
        onBeforeNavigate: event(),
        onHistoryStateUpdated: event(),
        onReferenceFragmentUpdated: event()
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
        text: async () => blocklistFixture
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

test('blocklist integrada bloqueia sem depender do conteúdo da página', async () => {
    const response = await invoke({
        type: 'analyzePage',
        payload: baseSignals('https://www.bet365.com/')
    }, contentSender('https://www.bet365.com/'));

    assert.equal(response.action, 'block');
    assert.equal(response.policy, 'system-blocklist');
    assert.equal(response.matchedDomain, 'bet365.com');
    assert.match(tabUpdates.at(-1).update.url, /blocked\.html/);
});

test('blocklist pessoal prevalece sobre confiança integrada', async () => {
    await invoke({
        type: 'addListEntry',
        payload: {
            list: 'blocklist',
            entry: { pattern: 'google.com', type: 'subdomain' }
        }
    }, extensionSender);

    const response = await invoke({
        type: 'analyzePage',
        payload: baseSignals('https://www.google.com/')
    }, contentSender('https://www.google.com/'));

    assert.equal(response.action, 'block');
    assert.equal(response.policy, 'custom-blocklist');
});

test('mudança de rota SPA solicita nova análise do content script', async () => {
    const listener = browser.webNavigation.onHistoryStateUpdated.listener;
    assert.equal(typeof listener, 'function');

    listener({
        tabId: 7,
        frameId: 0,
        url: 'https://spa.example/sportsbook'
    });
    await new Promise(resolveWait => setTimeout(resolveWait, 20));

    assert.ok(tabMessages.some(entry =>
        entry.tabId === 7 && entry.message.type === 'reanalyzePage'
    ));
});

test('mudança apenas no fragmento de SPA também solicita nova análise', async () => {
    const listener = browser.webNavigation.onReferenceFragmentUpdated.listener;
    assert.equal(typeof listener, 'function');
    const before = tabMessages.length;

    listener({
        tabId: 7,
        frameId: 0,
        url: 'https://spa.example/#/sportsbook'
    });
    await new Promise(resolveWait => setTimeout(resolveWait, 20));

    assert.ok(tabMessages.slice(before).some(entry =>
        entry.tabId === 7 && entry.message.type === 'reanalyzePage'
    ));
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

test('whitelist exata não libera subdomínios nas regras DNR', async () => {
    const response = await invoke({
        type: 'addListEntry',
        payload: {
            list: 'whitelist',
            entry: { pattern: 'somente-este.example', type: 'domain' }
        }
    }, extensionSender);

    assert.equal(response.ok, true);
    assert.equal(dynamicRules.some(rule =>
        listsDomain(rule.condition.requestDomains, 'somente-este.example')
        || listsDomain(rule.condition.initiatorDomains, 'somente-este.example')
    ), false);
    const exactRules = dynamicRules.filter(rule =>
        rule.condition.regexFilter?.includes('somente-este\\.example')
    );
    assert.ok(exactRules.some(rule => rule.action.type === 'allow'));
    assert.ok(exactRules.some(rule => rule.action.type === 'allowAllRequests'));
    const regex = new RegExp(exactRules[0].condition.regexFilter);
    assert.equal(regex.test('https://somente-este.example/path'), true);
    assert.equal(regex.test('https://sub.somente-este.example/path'), false);
});

test('política verificada bloqueia cedo domínios curados e o sufixo bet.br', async () => {
    const verifiedDomainRule = dynamicRules.find(rule =>
        rule.action.type === 'block'
        && rule.condition.resourceTypes?.includes('main_frame')
        && listsDomain(rule.condition.requestDomains, 'bet365.com')
    );
    const brazilianSuffixRule = dynamicRules.find(rule =>
        rule.action.type === 'block'
        && rule.condition.resourceTypes?.includes('main_frame')
        && rule.condition.urlFilter === '||bet.br^'
    );

    assert.ok(verifiedDomainRule);
    assert.ok(brazilianSuffixRule);
});

test('whitelist explícita tem prioridade sobre a regra antecipada bet.br', async () => {
    const response = await invoke({
        type: 'addListEntry',
        payload: {
            list: 'whitelist',
            entry: { pattern: 'licenciado.bet.br', type: 'subdomain' }
        }
    }, extensionSender);
    assert.equal(response.ok, true);

    const blockRule = dynamicRules.find(rule =>
        rule.action.type === 'block' && rule.condition.urlFilter === '||bet.br^'
    );
    const allowRule = dynamicRules.find(rule =>
        rule.action.type === 'allow'
        && listsDomain(rule.condition.requestDomains, 'licenciado.bet.br')
    );
    assert.ok(blockRule);
    assert.ok(allowRule);
    assert.ok(allowRule.priority > blockRule.priority);
});

test('pausa remove regras DNR antecipadas e reativação as restaura', async () => {
    const paused = await invoke({
        type: 'toggleProtection',
        payload: { enabled: false }
    }, extensionSender);
    assert.equal(paused.ok, true);
    assert.equal(dynamicRules.some(rule =>
        rule.action.type === 'block' && rule.condition.urlFilter === '||bet.br^'
    ), false);

    const resumed = await invoke({
        type: 'toggleProtection',
        payload: { enabled: true }
    }, extensionSender);
    assert.equal(resumed.ok, true);
    assert.equal(dynamicRules.some(rule =>
        rule.action.type === 'block' && rule.condition.urlFilter === '||bet.br^'
    ), true);

    await invoke({
        type: 'updateSettings',
        payload: { settings: { blockBetting: false } }
    }, extensionSender);
    assert.equal(dynamicRules.some(rule =>
        rule.action.type === 'block' && rule.condition.urlFilter === '||bet.br^'
    ), false);
    await invoke({
        type: 'updateSettings',
        payload: { settings: { blockBetting: true } }
    }, extensionSender);
});

test('liberação temporária vence o bloqueio DNR antecipado', async () => {
    const blockedUrl = 'https://www.bet365.com/sportsbook';
    const response = await invoke({
        type: 'allowTemporary',
        payload: { url: blockedUrl, duration: 5 * 60 * 1000 }
    }, {
        id: 'guardiao-test',
        url: `moz-extension://guardiao-test/src/blocked/blocked.html?url=${encodeURIComponent(blockedUrl)}`
    });
    assert.equal(response.ok, true);

    const blockPriority = Math.max(...dynamicRules
        .filter(rule => rule.action.type === 'block')
        .map(rule => rule.priority));
    const temporaryRule = dynamicRules.find(rule =>
        rule.action.type === 'allow'
        && rule.condition.resourceTypes?.includes('main_frame')
        && listsDomain(rule.condition.requestDomains, 'www.bet365.com')
    );
    assert.ok(temporaryRule);
    assert.ok(temporaryRule.priority > blockPriority);

    const analysis = await invoke({
        type: 'analyzePage',
        payload: baseSignals(blockedUrl)
    }, contentSender(blockedUrl));
    assert.equal(analysis.action, 'allow');
    assert.equal(analysis.reason, 'temporary-allowance');
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

test('atualizações simultâneas de configurações não perdem campos', async () => {
    const [ads, trackers] = await Promise.all([
        invoke({
            type: 'updateSettings',
            payload: { settings: { blockAds: false } }
        }, extensionSender),
        invoke({
            type: 'updateSettings',
            payload: { settings: { blockTrackers: false } }
        }, extensionSender)
    ]);
    assert.equal(ads.ok, true);
    assert.equal(trackers.ok, true);

    const current = await invoke({ type: 'getState' }, extensionSender);
    assert.equal(current.state.settings.blockAds, false);
    assert.equal(current.state.settings.blockTrackers, false);

    await invoke({
        type: 'updateSettings',
        payload: { settings: { blockAds: true, blockTrackers: true } }
    }, extensionSender);
});

test('adições simultâneas à lista são combinadas em vez de sobrescritas', async () => {
    const [first, second] = await Promise.all([
        invoke({
            type: 'addListEntry',
            payload: {
                list: 'blocklist',
                entry: { pattern: 'concorrente-a.example', type: 'subdomain' }
            }
        }, extensionSender),
        invoke({
            type: 'addListEntry',
            payload: {
                list: 'blocklist',
                entry: { pattern: 'concorrente-b.example', type: 'subdomain' }
            }
        }, extensionSender)
    ]);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);

    const current = await invoke({ type: 'getState' }, extensionSender);
    assert.ok(current.state.blocklist.some(entry => entry.pattern === 'concorrente-a.example'));
    assert.ok(current.state.blocklist.some(entry => entry.pattern === 'concorrente-b.example'));
});

test('entradas vencidas são purgadas do estado persistido e não geram DNR', async () => {
    const expiredDomain = 'expirada.example';
    const response = await invoke({
        type: 'importState',
        payload: {
            data: {
                whitelist: [{
                    pattern: expiredDomain,
                    type: 'subdomain',
                    addedAt: 1,
                    expiresAt: 2
                }]
            }
        }
    }, extensionSender);
    assert.equal(response.ok, true);
    assert.equal(response.state.whitelist.some(entry => entry.pattern === expiredDomain), false);
    assert.equal(storageData.whitelist.some(entry => entry.pattern === expiredDomain), false);
    assert.equal(dynamicRules.some(rule =>
        rule.condition.requestDomains?.includes(expiredDomain)
        || rule.condition.initiatorDomains?.includes(expiredDomain)
    ), false);
});
