import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/**
 * Escopo das regras DNR de allow.
 *
 * TRUSTED_DOMAINS existe para evitar falso positivo na classificação de
 * apostas. Ele nunca deve virar regra de rede: uma regra `allow` de
 * prioridade 100 sobre esses domínios desliga o bloqueio de anúncios e
 * rastreadores em todos eles, incluindo os que mais servem anúncios.
 */

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const storageData = {};
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

const TRUSTED_DOMAINS = context.GuardiaoConstants.TRUSTED_DOMAINS;

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

function allowRuleDomains() {
    const domains = new Set();
    for (const rule of dynamicRules) {
        if (rule.action?.type !== 'allow') continue;
        for (const domain of rule.condition?.requestDomains || []) domains.add(domain);
        for (const domain of rule.condition?.initiatorDomains || []) domains.add(domain);
    }
    return domains;
}

test('a lista de domínios confiáveis não vira regra de rede', async () => {
    // Sem nenhuma entrada de whitelist do usuário: tudo que aparecer aqui
    // veio de TRUSTED_DOMAINS.
    await invoke({ type: 'getState' }, extensionSender);

    const applied = allowRuleDomains();
    // O array precisa nascer neste realm: TRUSTED_DOMAINS vem do contexto vm e
    // `.filter()` devolveria um array com outro Array.prototype, o que faz
    // deepStrictEqual falhar mesmo quando o conteúdo é idêntico.
    const leaked = [];
    for (const domain of TRUSTED_DOMAINS) {
        if (applied.has(domain)) leaked.push(domain);
    }

    assert.deepEqual(
        leaked,
        [],
        `${leaked.length} domínio(s) de TRUSTED_DOMAINS viraram regra DNR "allow" de `
        + `prioridade 100, desligando o bloqueio de anúncios e rastreadores neles.\n`
        + `Amostra: ${leaked.slice(0, 8).join(', ')}`
    );
});

test('a whitelist do usuário continua gerando regra de rede', async () => {
    // Controle positivo: a correção não pode ser "parar de gerar regras".
    await invoke({
        type: 'addListEntry',
        payload: { list: 'whitelist', entry: { pattern: 'meu-site.example', type: 'subdomain' } }
    }, extensionSender);

    const applied = allowRuleDomains();
    assert.ok(
        applied.has('meu-site.example'),
        'Uma entrada explícita de whitelist deve continuar produzindo regra DNR "allow".'
    );
});
