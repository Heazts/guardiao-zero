'use strict';

// Chromium carrega somente este worker. Firefox carrega os mesmos arquivos
// previamente por background.scripts, por isso o import é condicional.
if (!globalThis.GuardiaoBlocklistIndex && typeof importScripts === 'function') {
    importScripts(
        '../shared/platform.js',
        '../shared/appearance.js',
        '../shared/detection/constants.js',
        '../shared/lists/list-matcher.js',
        '../shared/filters/filter-list-parser.js',
        '../shared/detection/detection-engine.js',
        '../shared/messaging/message-schema.js',
        './blocklist-index.js'
    );
}

const platform = globalThis.GuardiaoPlatform;
const appearanceService = globalThis.GuardiaoAppearance;
const constants = globalThis.GuardiaoConstants;
const lists = globalThis.GuardiaoLists;
const filterParser = globalThis.GuardiaoFilterParser;
const detector = globalThis.GuardiaoDetection;
const messages = globalThis.GuardiaoMessages;
const blocklistIndex = globalThis.GuardiaoBlocklistIndex;
const api = platform?.api;

if (
    !api
    || !appearanceService
    || !constants
    || !lists
    || !filterParser
    || !detector
    || !messages
    || !blocklistIndex
) {
    throw new Error('Falha ao carregar os módulos centrais do Guardião Zero Pro');
}

const STORAGE_KEYS = Object.freeze({
    protectionEnabled: 'protectionEnabled',
    settings: 'settings',
    appearance: 'appearance',
    stats: 'stats',
    whitelist: 'whitelist',
    blocklist: 'blocklist',
    filterSources: 'filterSources',
    temporaryAllowed: 'temporaryAllowed',
    schemaVersion: 'schemaVersion'
});

const PRIVILEGED_MESSAGES = new Set([
    'toggleProtection',
    'updateSettings',
    'updateAppearance',
    'addListEntry',
    'removeListEntry',
    'importFilterList',
    'toggleFilterSource',
    'removeFilterSource',
    'exportState',
    'resetStats',
    'getDiagnostics',
    'runSelfTest',
    'importState'
]);

const state = {
    protectionEnabled: true,
    settings: { ...constants.DEFAULT_SETTINGS },
    appearance: { ...appearanceService.DEFAULT_APPEARANCE },
    stats: { ...constants.DEFAULT_STATS, lastReset: Date.now() },
    whitelist: [],
    blocklist: [],
    compiledWhitelist: lists.compile([], 'whitelist'),
    compiledBlocklist: lists.compile([], 'blocklist'),
    filterSources: [],
    dynamicRuleCount: 0,
    temporaryAllowed: [],
    analysisCache: new Map(),
    privacyObservations: new Map(),
    recentBlocks: new Map(),
    initialized: false
};

let readyPromise;

const DYNAMIC_RULE_LIMIT = 5000;
const WHITELIST_RULE_LIMIT = 100;
const IMPORTED_RULE_LIMIT = DYNAMIC_RULE_LIMIT - WHITELIST_RULE_LIMIT;
const DYNAMIC_RULE_BASE = 100000;
const IMPORTED_RULE_BASE = DYNAMIC_RULE_BASE + WHITELIST_RULE_LIMIT;

function errorResponse(error, code = 'INVALID_REQUEST') {
    return {
        ok: false,
        error: typeof error === 'string' ? error : 'Falha interna',
        code
    };
}

function safeErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

function normalizeSettings(rawSettings) {
    const source = messages.plainObject(rawSettings) ? rawSettings : {};
    const patch = messages.sanitizeSettings(source) || {};
    return { ...constants.DEFAULT_SETTINGS, ...patch };
}

function normalizeStats(rawStats) {
    const source = messages.plainObject(rawStats) ? rawStats : {};
    const result = { ...constants.DEFAULT_STATS };
    for (const key of ['totalBlocked', 'trackersBlocked', 'sitesBlocked', 'adsBlocked', 'lastReset']) {
        if (Number.isFinite(source[key]) && source[key] >= 0) result[key] = Math.trunc(source[key]);
    }
    if (!result.lastReset) result.lastReset = Date.now();
    return result;
}

function normalizeTemporaryAllowances(rawAllowances) {
    if (!Array.isArray(rawAllowances)) return [];
    const now = Date.now();
    return rawAllowances
        .slice(0, 100)
        .map(item => ({
            domain: lists.normalizeHostname(item?.domain),
            expiresAt: Number.isFinite(item?.expiresAt) ? Math.trunc(item.expiresAt) : 0
        }))
        .filter(item => item.domain && item.expiresAt > now);
}

function sanitizeDomainArray(value) {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value
        .slice(0, 100)
        .map(item => lists.normalizeHostname(item))
        .filter(Boolean)))
        .sort();
}

function normalizeImportedRule(rawRule) {
    if (!messages.plainObject(rawRule) || !messages.plainObject(rawRule.condition)) return null;
    const actionType = rawRule.action?.type;
    if (actionType !== 'block' && actionType !== 'allow') return null;
    const priority = Number.isInteger(rawRule.priority)
        ? Math.max(1, Math.min(4, rawRule.priority))
        : 1;
    const urlFilter = messages.cleanString(rawRule.condition.urlFilter, 1024);
    if (!urlFilter || /[^\x20-\x7e]/.test(urlFilter)) return null;

    const allowedResourceTypes = new Set(filterParser.ALL_RESOURCE_TYPES);
    const resourceTypes = Array.isArray(rawRule.condition.resourceTypes)
        ? Array.from(new Set(rawRule.condition.resourceTypes.filter(type =>
            allowedResourceTypes.has(type)
        )))
        : [];
    if (resourceTypes.length === 0) return null;

    const condition = { urlFilter, resourceTypes };
    const initiatorDomains = sanitizeDomainArray(rawRule.condition.initiatorDomains);
    const excludedInitiatorDomains = sanitizeDomainArray(rawRule.condition.excludedInitiatorDomains);
    if (initiatorDomains.length) condition.initiatorDomains = initiatorDomains;
    if (excludedInitiatorDomains.length) {
        condition.excludedInitiatorDomains = excludedInitiatorDomains;
    }
    if (rawRule.condition.domainType === 'firstParty' || rawRule.condition.domainType === 'thirdParty') {
        condition.domainType = rawRule.condition.domainType;
    }
    if (rawRule.condition.isUrlFilterCaseSensitive === true) {
        condition.isUrlFilterCaseSensitive = true;
    }
    return { priority, action: { type: actionType }, condition };
}

function normalizeFilterSources(rawSources) {
    if (!Array.isArray(rawSources)) return [];
    const sources = [];
    const ids = new Set();
    let remaining = IMPORTED_RULE_LIMIT;

    for (const rawSource of rawSources.slice(0, 20)) {
        if (!messages.plainObject(rawSource) || remaining <= 0) break;
        const rules = [];
        for (const rawRule of Array.isArray(rawSource.rules) ? rawSource.rules : []) {
            if (rules.length >= remaining) break;
            const normalized = normalizeImportedRule(rawRule);
            if (normalized) rules.push(normalized);
        }
        const descriptor = filterParser.normalizeSource({
            ...rawSource,
            ruleCount: rules.length,
            acceptedCount: Math.max(rules.length, Number(rawSource.acceptedCount) || 0)
        });
        if (!descriptor.ok || ids.has(descriptor.source.id) || rules.length === 0) continue;
        ids.add(descriptor.source.id);
        sources.push({ ...descriptor.source, rules });
        remaining -= rules.length;
    }
    return sources;
}

function publicFilterSource(source) {
    const { rules, ...metadata } = source;
    return { ...metadata, ruleCount: rules.length };
}

function sourceIsEffective(source, context) {
    if (!context.protectionEnabled || source.enabled === false) return false;
    if (source.category === 'ads') return context.settings.blockAds;
    if (source.category === 'privacy') return context.settings.blockTrackers;
    if (source.category === 'gambling') return context.settings.blockBetting;
    return true;
}

function buildWhitelistDynamicRules(whitelist) {
    const rules = [];
    const domains = Array.from(new Set([
        ...constants.TRUSTED_DOMAINS,
        ...whitelist
        .filter(entry => entry.type === 'domain' || entry.type === 'subdomain')
        .map(entry => entry.pattern)
        .filter(Boolean)
    ]))
        .sort();

    for (let offset = 0; offset < domains.length && rules.length < WHITELIST_RULE_LIMIT; offset += 500) {
        const domainBatch = domains.slice(offset, offset + 500);
        rules.push({
            id: DYNAMIC_RULE_BASE + rules.length,
            priority: 100,
            action: { type: 'allow' },
            condition: {
                requestDomains: domainBatch,
                resourceTypes: [...filterParser.ALL_RESOURCE_TYPES]
            }
        });
        if (rules.length >= WHITELIST_RULE_LIMIT) break;
        rules.push({
            id: DYNAMIC_RULE_BASE + rules.length,
            priority: 100,
            action: { type: 'allow' },
            condition: {
                initiatorDomains: domainBatch,
                resourceTypes: [...filterParser.ALL_RESOURCE_TYPES]
            }
        });
    }

    for (const entry of whitelist) {
        if (rules.length >= WHITELIST_RULE_LIMIT) break;
        if (entry.type !== 'url') continue;
        rules.push({
            id: DYNAMIC_RULE_BASE + rules.length,
            priority: 100,
            action: { type: 'allow' },
            condition: {
                urlFilter: `|${entry.pattern}|`,
                resourceTypes: [...filterParser.ALL_RESOURCE_TYPES]
            }
        });
    }
    return rules;
}

function buildImportedDynamicRules(filterSources, context) {
    const rules = [];
    for (const source of filterSources) {
        if (!sourceIsEffective(source, context)) continue;
        for (const storedRule of source.rules) {
            if (rules.length >= IMPORTED_RULE_LIMIT) return rules;
            rules.push({
                id: IMPORTED_RULE_BASE + rules.length,
                priority: storedRule.priority,
                action: { ...storedRule.action },
                condition: {
                    ...storedRule.condition,
                    resourceTypes: [...storedRule.condition.resourceTypes],
                    ...(storedRule.condition.initiatorDomains
                        ? { initiatorDomains: [...storedRule.condition.initiatorDomains] }
                        : {}),
                    ...(storedRule.condition.excludedInitiatorDomains
                        ? { excludedInitiatorDomains: [...storedRule.condition.excludedInitiatorDomains] }
                        : {})
                }
            });
        }
    }
    return rules;
}

async function syncDynamicRules(overrides = {}) {
    const context = {
        protectionEnabled: overrides.protectionEnabled ?? state.protectionEnabled,
        settings: overrides.settings || state.settings
    };
    const whitelist = overrides.whitelist || state.whitelist;
    const filterSources = overrides.filterSources || state.filterSources;
    const expected = context.protectionEnabled
        ? [
            ...buildWhitelistDynamicRules(whitelist),
            ...buildImportedDynamicRules(filterSources, context)
        ]
        : [];
    const current = await api.declarativeNetRequest.getDynamicRules();
    const managedIds = current
        .map(rule => rule.id)
        .filter(id => Number.isInteger(id) && id >= DYNAMIC_RULE_BASE && id < DYNAMIC_RULE_BASE + DYNAMIC_RULE_LIMIT);
    await api.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: managedIds,
        addRules: expected
    });
    state.dynamicRuleCount = expected.filter(rule => rule.id >= IMPORTED_RULE_BASE).length;
    return expected;
}

async function persist(values) {
    await api.storage.local.set(values);
}

async function initialize() {
    const stored = await api.storage.local.get(Object.values(STORAGE_KEYS));
    state.protectionEnabled = stored.protectionEnabled !== false;
    state.settings = normalizeSettings(stored.settings);
    state.appearance = appearanceService.normalize(stored.appearance);
    state.stats = normalizeStats(stored.stats);

    const whitelistResult = lists.normalizeEntries(
        stored.whitelist,
        'whitelist',
        constants.LIMITS.listEntries
    );
    const blocklistResult = lists.normalizeEntries(
        stored.blocklist,
        'blocklist',
        constants.LIMITS.listEntries
    );
    state.whitelist = whitelistResult.entries;
    state.blocklist = blocklistResult.entries;
    state.compiledWhitelist = lists.compile(state.whitelist, 'whitelist');
    state.compiledBlocklist = lists.compile(state.blocklist, 'blocklist');
    state.filterSources = normalizeFilterSources(stored.filterSources);
    state.temporaryAllowed = normalizeTemporaryAllowances(stored.temporaryAllowed);

    await persist({
        protectionEnabled: state.protectionEnabled,
        settings: state.settings,
        appearance: state.appearance,
        stats: state.stats,
        whitelist: state.whitelist,
        blocklist: state.blocklist,
        filterSources: state.filterSources,
        temporaryAllowed: state.temporaryAllowed,
        schemaVersion: 4
    });
    await updateNetworkRules();
    state.initialized = true;
}

function ensureReady() {
    if (!readyPromise) {
        readyPromise = initialize().catch(error => {
            readyPromise = null;
            console.error('[Guardião Zero Pro] Falha na inicialização:', safeErrorMessage(error));
            throw error;
        });
    }
    return readyPromise;
}

async function updateNetworkRules(overrides = {}) {
    async function apply(snapshot) {
        const enabled = [];
        const disabled = [];
        (snapshot.protectionEnabled && snapshot.settings.blockAds ? enabled : disabled).push('ads_rules');
        (snapshot.protectionEnabled && snapshot.settings.blockTrackers ? enabled : disabled).push('tracker_rules');
        await api.declarativeNetRequest.updateEnabledRulesets({
            enableRulesetIds: enabled,
            disableRulesetIds: disabled
        });
        await syncDynamicRules(snapshot);
    }

    const target = {
        protectionEnabled: overrides.protectionEnabled ?? state.protectionEnabled,
        settings: overrides.settings || state.settings,
        whitelist: overrides.whitelist || state.whitelist,
        filterSources: overrides.filterSources || state.filterSources
    };
    const previous = {
        protectionEnabled: state.protectionEnabled,
        settings: state.settings,
        whitelist: state.whitelist,
        filterSources: state.filterSources
    };

    try {
        await apply(target);
    } catch (error) {
        await apply(previous).catch(rollbackError => {
            console.error(
                '[Guardião Zero Pro] Falha ao restaurar regras de rede:',
                safeErrorMessage(rollbackError)
            );
        });
        throw error;
    }
}

function extensionOrigin() {
    return platform.extensionOrigin();
}

function isOwnSender(sender) {
    return sender?.id === api.runtime.id;
}

function isExtensionPageSender(sender) {
    if (!isOwnSender(sender) || typeof sender.url !== 'string') return false;
    try {
        return new URL(sender.url).origin === extensionOrigin();
    } catch {
        return false;
    }
}

function isContentSender(sender) {
    return isOwnSender(sender)
        && Number.isInteger(sender?.tab?.id)
        && (sender.frameId === 0 || sender.frameId === undefined);
}

function isBlockedPageSender(sender) {
    if (!isExtensionPageSender(sender)) return false;
    try {
        return new URL(sender.url).pathname.endsWith('/src/blocked/blocked.html');
    } catch {
        return false;
    }
}

function hostnameFromUrl(url) {
    return detector.hostnameFromUrl(url);
}

function urlsHaveSameOrigin(left, right) {
    try {
        return new URL(left).origin === new URL(right).origin;
    } catch {
        return false;
    }
}

function cleanExpiredAllowances() {
    const before = state.temporaryAllowed.length;
    state.temporaryAllowed = state.temporaryAllowed.filter(item => item.expiresAt > Date.now());
    if (state.temporaryAllowed.length !== before) {
        void persist({ temporaryAllowed: state.temporaryAllowed });
    }
}

function isTemporarilyAllowed(hostname) {
    cleanExpiredAllowances();
    return state.temporaryAllowed.some(item => lists.domainMatches(hostname, item.domain, true));
}

async function whitelistMatch(url, hostname) {
    if (detector.isTrustedHostname(hostname)) {
        return { type: 'built-in', pattern: hostname };
    }
    return lists.match(state.compiledWhitelist, { url, hostname });
}

async function customBlockMatch(url, hostname) {
    return lists.match(state.compiledBlocklist, { url, hostname });
}

function publicState(includePrivateLists) {
    const result = {
        protectionEnabled: state.protectionEnabled,
        settings: { ...state.settings },
        appearance: { ...state.appearance },
        stats: { ...state.stats }
    };
    if (includePrivateLists) {
        result.whitelist = state.whitelist.map(entry => ({ ...entry }));
        result.blocklist = state.blocklist.map(entry => ({ ...entry }));
        result.filterSources = state.filterSources.map(publicFilterSource);
        result.dynamicRuleCount = state.dynamicRuleCount;
        result.dynamicRuleLimit = IMPORTED_RULE_LIMIT;
    }
    return result;
}

async function broadcastState() {
    const tabs = await api.tabs.query({});
    await Promise.allSettled(tabs
        .filter(tab => Number.isInteger(tab.id))
        .map(tab => api.tabs.sendMessage(tab.id, {
            type: 'stateUpdated',
            payload: {
                protectionEnabled: state.protectionEnabled,
                settings: state.settings
            }
        })));
}

function trimMap(map, maximum) {
    while (map.size > maximum) {
        map.delete(map.keys().next().value);
    }
}

async function updatePrivacyStats(tabId, signals) {
    if (!state.protectionEnabled) return;
    const key = `${tabId}:${signals.url}`;
    const previous = state.privacyObservations.get(key) || { trackers: 0, ads: 0 };
    const next = {
        trackers: state.settings.blockTrackers ? signals.trackerCount : 0,
        ads: state.settings.blockAds ? signals.adCount : 0
    };
    const trackerDelta = Math.max(0, next.trackers - previous.trackers);
    const adDelta = Math.max(0, next.ads - previous.ads);
    if (trackerDelta === 0 && adDelta === 0) return;

    const nextStats = {
        ...state.stats,
        trackersBlocked: state.stats.trackersBlocked + trackerDelta,
        adsBlocked: state.stats.adsBlocked + adDelta,
        totalBlocked: state.stats.totalBlocked + trackerDelta + adDelta
    };
    await persist({ stats: nextStats });
    state.privacyObservations.set(key, next);
    trimMap(state.privacyObservations, constants.LIMITS.cacheEntries);
    state.stats = nextStats;
}

async function incrementBlockedSite() {
    const nextStats = {
        ...state.stats,
        sitesBlocked: state.stats.sitesBlocked + 1,
        totalBlocked: state.stats.totalBlocked + 1
    };
    await persist({ stats: nextStats });
    state.stats = nextStats;
}

async function executeBlock(tabId, originalUrl, reason, result) {
    const dedupeKey = `${tabId}:${originalUrl}`;
    const lastBlocked = state.recentBlocks.get(dedupeKey) || 0;
    if (Date.now() - lastBlocked < 5000) return;
    state.recentBlocks.set(dedupeKey, Date.now());
    trimMap(state.recentBlocks, 64);

    void api.tabs.sendMessage(tabId, {
        type: 'showBlockOverlay',
        payload: { reason }
    }).catch(() => {});

    const params = new URLSearchParams({
        url: originalUrl,
        reason: reason.slice(0, 120)
    });
    if (result?.score !== undefined) params.set('score', String(result.score));
    await api.tabs.update(tabId, {
        url: api.runtime.getURL(`src/blocked/blocked.html?${params.toString()}`)
    });
    await incrementBlockedSite().catch(error => {
        console.warn('[Guardião Zero Pro] Não foi possível atualizar o contador:', safeErrorMessage(error));
    });
}

function analysisCacheKey(signals, systemMatch) {
    return [
        signals.url,
        signals.fingerprint,
        state.settings.detectionThreshold,
        systemMatch || ''
    ].join('|');
}

async function handleAnalysis(signals, sender) {
    if (!isContentSender(sender)) return errorResponse('Origem de análise inválida', 'FORBIDDEN');
    if (!urlsHaveSameOrigin(signals.url, sender.url || sender.tab.url || '')) {
        return errorResponse('A URL analisada não corresponde ao remetente', 'URL_MISMATCH');
    }

    await updatePrivacyStats(sender.tab.id, signals);
    if (!state.protectionEnabled) return { ok: true, action: 'allow', reason: 'protection-disabled' };

    const hostname = hostnameFromUrl(signals.url);
    if (!hostname) return errorResponse('Hostname inválido');
    if (await whitelistMatch(signals.url, hostname)) {
        return { ok: true, action: 'allow', reason: 'whitelist' };
    }
    if (isTemporarilyAllowed(hostname)) {
        return { ok: true, action: 'allow', reason: 'temporary-allowance' };
    }

    const manualBlock = await customBlockMatch(signals.url, hostname);
    if (manualBlock) {
        await executeBlock(sender.tab.id, signals.url, 'Bloqueio definido pelo usuário', {
            score: constants.SCORE.thresholdMax
        });
        return { ok: true, action: 'block', policy: 'custom-blocklist' };
    }

    if (state.settings.extremeMode) {
        await executeBlock(sender.tab.id, signals.url, 'Modo de bloqueio extremo', {
            score: constants.SCORE.thresholdMax
        });
        return { ok: true, action: 'block', policy: 'extreme-mode' };
    }
    if (!state.settings.blockBetting) {
        return { ok: true, action: 'allow', reason: 'betting-filter-disabled' };
    }

    let systemMatch = '';
    try {
        await blocklistIndex.load();
        systemMatch = blocklistIndex.findDomain(hostname);
    } catch (error) {
        console.warn('[Guardião Zero Pro] Blocklist indisponível:', safeErrorMessage(error));
    }

    if (!state.settings.aiDetection && !systemMatch) {
        return { ok: true, action: 'allow', reason: 'advanced-detection-disabled' };
    }

    const cacheKey = analysisCacheKey(signals, systemMatch);
    let result = state.analysisCache.get(cacheKey);
    if (!result) {
        result = detector.analyze(signals, {
            threshold: state.settings.detectionThreshold,
            systemBlockMatch: systemMatch
        });
        state.analysisCache.set(cacheKey, result);
        trimMap(state.analysisCache, constants.LIMITS.cacheEntries);
    }

    if (result.verdict === 'block') {
        await executeBlock(sender.tab.id, signals.url, 'Classificação multifator de apostas', result);
    }

    return {
        ok: true,
        action: result.verdict,
        result
    };
}

async function handleNavigation(details) {
    try {
        await ensureReady();
        if (details.frameId !== 0 || !state.protectionEnabled) return;
        const url = lists.normalizeHttpUrl(details.url, true);
        const hostname = hostnameFromUrl(url);
        if (!hostname) return;
        if (await whitelistMatch(url, hostname) || isTemporarilyAllowed(hostname)) return;

        if (await customBlockMatch(url, hostname)) {
            await executeBlock(details.tabId, url, 'Bloqueio definido pelo usuário');
        } else if (state.settings.extremeMode) {
            await executeBlock(details.tabId, url, 'Modo de bloqueio extremo');
        }
    } catch (error) {
        console.error('[Guardião Zero Pro] Falha ao avaliar navegação:', safeErrorMessage(error));
    }
}

async function addListEntry(payload) {
    const key = payload.list;
    const current = key === 'whitelist' ? state.whitelist : state.blocklist;
    const duplicate = current.some(entry =>
        entry.type === payload.entry.type && entry.pattern === payload.entry.pattern
    );
    if (duplicate) return publicState(true);
    if (current.length >= constants.LIMITS.listEntries) {
        throw new Error(`A lista atingiu o limite de ${constants.LIMITS.listEntries} entradas`);
    }
    const next = [...current, payload.entry];

    if (key === 'whitelist') {
        await syncDynamicRules({ whitelist: next });
        try {
            await persist({ whitelist: next });
        } catch (error) {
            await syncDynamicRules({ whitelist: state.whitelist }).catch(() => {});
            throw error;
        }
        state.whitelist = next;
        state.compiledWhitelist = lists.compile(next, key);
    } else {
        await persist({ blocklist: next });
        state.blocklist = next;
        state.compiledBlocklist = lists.compile(next, key);
    }
    state.analysisCache.clear();
    return publicState(true);
}

async function removeListEntry(payload) {
    const key = payload.list;
    if (key === 'whitelist') {
        const next = state.whitelist.filter(entry => entry.id !== payload.id);
        await syncDynamicRules({ whitelist: next });
        try {
            await persist({ whitelist: next });
        } catch (error) {
            await syncDynamicRules({ whitelist: state.whitelist }).catch(() => {});
            throw error;
        }
        state.whitelist = next;
        state.compiledWhitelist = lists.compile(next, key);
    } else {
        const next = state.blocklist.filter(entry => entry.id !== payload.id);
        await persist({ blocklist: next });
        state.blocklist = next;
        state.compiledBlocklist = lists.compile(next, key);
    }
    state.analysisCache.clear();
    return publicState(true);
}

function stableFilterSourceId(name, category) {
    const source = `${category}:${name.toLowerCase()}`;
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `source-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function detectedFilterFormat(name, parsed) {
    const label = `${name} ${parsed.metadata?.title || ''}`.toLowerCase();
    if (label.includes('easyprivacy')) return 'easyprivacy';
    if (label.includes('easylist')) return 'easylist';
    if (label.includes('adguard')) return 'adguard';
    if (label.includes('ublock') || label.includes('ubo')) return 'ublock';
    if (parsed.format === 'hosts') return 'hosts';
    return 'custom';
}

async function importFilterList(payload) {
    const parsed = filterParser.parse(payload.text);
    if (!parsed.ok || parsed.rules.length === 0) {
        throw new Error(parsed.errors[0]?.message || 'Nenhuma regra de rede compatível foi encontrada');
    }

    const id = stableFilterSourceId(payload.name, payload.category);
    const existingSources = state.filterSources.filter(source => source.id !== id);
    const used = existingSources.reduce((total, source) => total + source.rules.length, 0);
    const available = Math.max(0, IMPORTED_RULE_LIMIT - used);
    if (available === 0) {
        throw new Error(`O limite portátil de ${IMPORTED_RULE_LIMIT} regras dinâmicas foi atingido`);
    }

    const acceptedRules = parsed.rules.slice(0, available);
    const checksum = await lists.sha256Hex(payload.text);
    const descriptor = filterParser.normalizeSource({
        id,
        name: parsed.metadata?.title || payload.name,
        filename: payload.name,
        format: detectedFilterFormat(payload.name, parsed),
        category: payload.category,
        enabled: true,
        checksum,
        sizeBytes: parsed.stats.bytes,
        ruleCount: acceptedRules.length,
        acceptedCount: parsed.stats.accepted,
        rejectedCount: parsed.stats.rejected + Math.max(0, parsed.rules.length - acceptedRules.length),
        importedAt: Date.now(),
        updatedAt: Date.now()
    });
    if (!descriptor.ok) throw new Error(descriptor.error);

    const source = { ...descriptor.source, rules: acceptedRules };
    const next = [...existingSources, source];
    await syncDynamicRules({ filterSources: next });
    try {
        await persist({ filterSources: next });
    } catch (error) {
        await syncDynamicRules({ filterSources: state.filterSources }).catch(() => {});
        throw error;
    }
    state.filterSources = next;

    const reasonCounts = {};
    for (const error of parsed.errors) {
        reasonCounts[error.reason] = (reasonCounts[error.reason] || 0) + 1;
    }
    return {
        state: publicState(true),
        report: {
            imported: acceptedRules.length,
            rejected: descriptor.source.rejectedCount,
            truncated: parsed.stats.truncated || acceptedRules.length < parsed.rules.length,
            format: descriptor.source.format,
            reasons: reasonCounts
        }
    };
}

async function toggleFilterSource(payload) {
    const index = state.filterSources.findIndex(source => source.id === payload.id);
    if (index === -1) throw new Error('Lista de filtros não encontrada');
    const next = state.filterSources.map((source, sourceIndex) =>
        sourceIndex === index
            ? { ...source, enabled: payload.enabled, updatedAt: Date.now() }
            : source
    );
    await syncDynamicRules({ filterSources: next });
    try {
        await persist({ filterSources: next });
    } catch (error) {
        await syncDynamicRules({ filterSources: state.filterSources }).catch(() => {});
        throw error;
    }
    state.filterSources = next;
    return publicState(true);
}

async function removeFilterSource(payload) {
    const next = state.filterSources.filter(source => source.id !== payload.id);
    if (next.length === state.filterSources.length) throw new Error('Lista de filtros não encontrada');
    await syncDynamicRules({ filterSources: next });
    try {
        await persist({ filterSources: next });
    } catch (error) {
        await syncDynamicRules({ filterSources: state.filterSources }).catch(() => {});
        throw error;
    }
    state.filterSources = next;
    return publicState(true);
}

function exportState() {
    return {
        schemaVersion: 4,
        exportedAt: new Date().toISOString(),
        extensionVersion: api.runtime.getManifest().version,
        protectionEnabled: state.protectionEnabled,
        settings: { ...state.settings },
        appearance: { ...state.appearance },
        stats: { ...state.stats },
        whitelist: state.whitelist.map(entry => ({ ...entry })),
        blocklist: state.blocklist.map(entry => ({ ...entry })),
        filterSources: state.filterSources.map(source => ({
            ...source,
            rules: source.rules.map(rule => ({
                priority: rule.priority,
                action: { ...rule.action },
                condition: {
                    ...rule.condition,
                    resourceTypes: [...rule.condition.resourceTypes],
                    ...(rule.condition.initiatorDomains
                        ? { initiatorDomains: [...rule.condition.initiatorDomains] }
                        : {}),
                    ...(rule.condition.excludedInitiatorDomains
                        ? { excludedInitiatorDomains: [...rule.condition.excludedInitiatorDomains] }
                        : {})
                }
            }))
        }))
    };
}

async function importState(data) {
    const next = {
        protectionEnabled: typeof data.protectionEnabled === 'boolean'
            ? data.protectionEnabled
            : state.protectionEnabled,
        settings: messages.plainObject(data.settings)
            ? normalizeSettings(data.settings)
            : state.settings,
        appearance: messages.plainObject(data.appearance)
            ? appearanceService.normalize(data.appearance)
            : state.appearance,
        stats: messages.plainObject(data.stats) ? normalizeStats(data.stats) : state.stats,
        whitelist: Array.isArray(data.whitelist)
            ? lists.normalizeEntries(
            data.whitelist,
            'whitelist',
            constants.LIMITS.listEntries
        ).entries.map(entry => ({ ...entry, addedBy: 'import' }))
            : state.whitelist,
        blocklist: Array.isArray(data.blocklist)
            ? lists.normalizeEntries(
            data.blocklist,
            'blocklist',
            constants.LIMITS.listEntries
        ).entries.map(entry => ({ ...entry, addedBy: 'import' }))
            : state.blocklist,
        filterSources: Array.isArray(data.filterSources)
            ? normalizeFilterSources(data.filterSources)
            : state.filterSources
    };

    await updateNetworkRules(next);
    try {
        await persist({
        protectionEnabled: next.protectionEnabled,
        settings: next.settings,
        appearance: next.appearance,
        stats: next.stats,
        whitelist: next.whitelist,
        blocklist: next.blocklist,
        filterSources: next.filterSources,
        schemaVersion: 4
        });
    } catch (error) {
        await updateNetworkRules().catch(() => {});
        throw error;
    }
    state.protectionEnabled = next.protectionEnabled;
    state.settings = next.settings;
    state.appearance = next.appearance;
    state.stats = next.stats;
    state.whitelist = next.whitelist;
    state.blocklist = next.blocklist;
    state.filterSources = next.filterSources;
    state.compiledWhitelist = lists.compile(next.whitelist, 'whitelist');
    state.compiledBlocklist = lists.compile(next.blocklist, 'blocklist');
    state.analysisCache.clear();
    await broadcastState();
    return publicState(true);
}

async function getDiagnostics() {
    let blocklistError = '';
    try {
        await blocklistIndex.load();
    } catch (error) {
        blocklistError = safeErrorMessage(error);
    }

    let enabledRulesets = [];
    try {
        enabledRulesets = await api.declarativeNetRequest.getEnabledRulesets();
    } catch {
        // Compatibilidade defensiva: a ausência é exibida no diagnóstico.
    }

    return {
        version: api.runtime.getManifest().version,
        protectionEnabled: state.protectionEnabled,
        settings: { ...state.settings },
        blocklist: { ...blocklistIndex.status(), error: blocklistError },
        whitelistCount: state.whitelist.length,
        customBlocklistCount: state.blocklist.length,
        filterSourceCount: state.filterSources.length,
        dynamicRuleCount: state.dynamicRuleCount,
        dynamicRuleLimit: IMPORTED_RULE_LIMIT,
        enabledRulesets,
        analysisCacheSize: state.analysisCache.size,
        stats: { ...state.stats }
    };
}

async function runSelfTest() {
    const lines = [];
    const testKey = `_gzp_selftest_${Date.now()}`;

    await api.storage.local.set({ [testKey]: true });
    const stored = await api.storage.local.get(testKey);
    await api.storage.local.remove(testKey);
    lines.push({
        ok: stored[testKey] === true,
        label: 'Storage local'
    });

    await blocklistIndex.load();
    lines.push({
        ok: blocklistIndex.findDomain('www.bet365.com') === 'bet365.com',
        label: 'Índice binário da blocklist'
    });

    const safeResult = detector.analyze({
        url: 'https://alphabet.com/beta-release',
        title: 'Beta release documentation',
        metaDescription: 'Developer documentation and release notes',
        text: 'This article documents a beta software release for developers.',
        openGraph: [],
        favicons: [],
        menus: ['Documentation'],
        buttons: ['Download'],
        forms: [],
        links: [],
        images: [],
        scripts: [],
        iframes: [],
        resources: [],
        storage: {},
        structuredDataTypes: ['TechArticle'],
        articleCount: 1
    }, { threshold: state.settings.detectionThreshold });
    lines.push({ ok: safeResult.verdict === 'allow', label: 'Controle de falso positivo' });

    const gamblingResult = detector.analyze({
        url: 'https://example-casino.test/sportsbook',
        title: 'Casino online e apostas esportivas',
        metaDescription: 'Sportsbook com odds ao vivo',
        text: 'Cassino online com apostas esportivas, bet slip, cash out e live odds.',
        openGraph: ['Live casino'],
        favicons: [],
        menus: ['Sportsbook', 'Casino online', 'Live betting'],
        buttons: ['Aposte agora', 'Depositar e jogar'],
        forms: [{ action: '/betslip', text: 'Confirmar aposta', fields: ['stake', 'odds', 'potential return'] }],
        links: [],
        images: [],
        scripts: ['https://cdn.pragmaticplay.com/client.js'],
        iframes: [],
        resources: [],
        storage: { local: ['casino_betslip', 'live_odds'], session: [], indexedDB: [], cookies: [] },
        structuredDataTypes: [],
        articleCount: 0
    }, { threshold: state.settings.detectionThreshold });
    lines.push({ ok: gamblingResult.verdict === 'block', label: 'Cenário multifator de regressão' });

    return {
        ok: lines.every(line => line.ok),
        lines
    };
}

async function handleMessage(parsed, sender) {
    await ensureReady();
    const { type, payload } = parsed;

    if (!isOwnSender(sender)) return errorResponse('Remetente não autorizado', 'FORBIDDEN');
    if (PRIVILEGED_MESSAGES.has(type) && !isExtensionPageSender(sender)) {
        return errorResponse('Ação disponível apenas nas páginas da extensão', 'FORBIDDEN');
    }

    if (type === 'ping') return { ok: true, pong: true };
    if (type === 'getState') return { ok: true, state: publicState(isExtensionPageSender(sender)) };
    if (type === 'analyzePage') return handleAnalysis(payload, sender);

    if (type === 'toggleProtection') {
        const previous = state.protectionEnabled;
        await updateNetworkRules({ protectionEnabled: payload.enabled });
        try {
            await persist({ protectionEnabled: payload.enabled });
        } catch (error) {
            await updateNetworkRules({ protectionEnabled: previous }).catch(() => {});
            throw error;
        }
        state.protectionEnabled = payload.enabled;
        await broadcastState();
        return { ok: true, state: publicState(true) };
    }

    if (type === 'updateSettings') {
        const previous = state.settings;
        const next = { ...state.settings, ...payload.settings };
        await updateNetworkRules({ settings: next });
        try {
            await persist({ settings: next });
        } catch (error) {
            await updateNetworkRules({ settings: previous }).catch(() => {});
            throw error;
        }
        state.settings = next;
        state.analysisCache.clear();
        await broadcastState();
        return { ok: true, state: publicState(true) };
    }

    if (type === 'updateAppearance') {
        const next = appearanceService.normalize({
            ...state.appearance,
            ...payload.appearance
        });
        await persist({ appearance: next });
        state.appearance = next;
        return { ok: true, state: publicState(true) };
    }

    if (type === 'addListEntry') return { ok: true, state: await addListEntry(payload) };
    if (type === 'removeListEntry') return { ok: true, state: await removeListEntry(payload) };
    if (type === 'importFilterList') {
        const result = await importFilterList(payload);
        return { ok: true, ...result };
    }
    if (type === 'toggleFilterSource') {
        return { ok: true, state: await toggleFilterSource(payload) };
    }
    if (type === 'removeFilterSource') {
        return { ok: true, state: await removeFilterSource(payload) };
    }
    if (type === 'exportState') return { ok: true, data: exportState() };

    if (type === 'resetStats') {
        const nextStats = { ...constants.DEFAULT_STATS, lastReset: Date.now() };
        await persist({ stats: nextStats });
        state.stats = nextStats;
        state.privacyObservations.clear();
        return { ok: true, state: publicState(true) };
    }

    if (type === 'allowTemporary') {
        if (!isBlockedPageSender(sender)) return errorResponse('Origem de liberação inválida', 'FORBIDDEN');
        const blockedPageUrl = new URL(sender.url).searchParams.get('url') || '';
        if (lists.normalizeHttpUrl(blockedPageUrl, true) !== payload.url) {
            return errorResponse('URL não corresponde ao bloqueio atual', 'URL_MISMATCH');
        }
        const domain = hostnameFromUrl(payload.url);
        const next = state.temporaryAllowed.filter(item => item.domain !== domain);
        next.push({ domain, expiresAt: Date.now() + payload.duration });
        await persist({ temporaryAllowed: next });
        state.temporaryAllowed = next;
        return { ok: true };
    }

    if (type === 'getDiagnostics') return { ok: true, diagnostics: await getDiagnostics() };
    if (type === 'runSelfTest') return { ok: true, selfTest: await runSelfTest() };
    if (type === 'importState') return { ok: true, state: await importState(payload.data) };

    return errorResponse('Mensagem não implementada');
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const parsed = messages.parse(message);
    if (!parsed.ok) {
        sendResponse(errorResponse(parsed.error));
        return false;
    }

    handleMessage(parsed, sender)
        .then(sendResponse)
        .catch(error => {
            console.error('[Guardião Zero Pro] Erro de mensagem:', safeErrorMessage(error));
            sendResponse(errorResponse('Falha interna', 'INTERNAL_ERROR'));
        });
    return true;
});

api.webNavigation.onBeforeNavigate.addListener(details => {
    void handleNavigation(details);
});

api.runtime.onInstalled.addListener(() => {
    void ensureReady();
});

void ensureReady();
