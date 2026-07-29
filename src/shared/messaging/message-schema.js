'use strict';

/**
 * Schemas defensivos para todas as mensagens recebidas pelo background.
 * O conteúdo da página é truncado novamente aqui; limites do coletor nunca
 * são tratados como uma fronteira de segurança.
 */
globalThis.GuardiaoMessages = globalThis.GuardiaoMessages || (() => {
    const constants = globalThis.GuardiaoConstants;
    const lists = globalThis.GuardiaoLists;
    const appearance = globalThis.GuardiaoAppearance;
    const filterParser = globalThis.GuardiaoFilterParser;
    if (!constants || !lists || !appearance || !filterParser) {
        throw new Error('Dependências de message-schema ausentes');
    }

    const NO_PAYLOAD_TYPES = new Set([
        'getState',
        'getDiagnostics',
        'ping',
        'resetStats',
        'runSelfTest',
        'exportState'
    ]);

    function plainObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function cleanString(value, maximum) {
        return typeof value === 'string'
            ? value.replace(/\0/g, '').trim().slice(0, maximum)
            : '';
    }

    function stringArray(value, maximumItems, maximumLength) {
        if (!Array.isArray(value)) return [];
        const result = [];
        for (const item of value.slice(0, maximumItems)) {
            const cleaned = cleanString(item, maximumLength);
            if (cleaned) result.push(cleaned);
        }
        return result;
    }

    function sanitizeLinks(value) {
        if (!Array.isArray(value)) return [];
        return value.slice(0, constants.LIMITS.links).map(link => ({
            url: cleanString(link?.url, 1000),
            text: cleanString(link?.text, 160),
            external: link?.external === true
        })).filter(link => link.url || link.text);
    }

    function sanitizeImages(value) {
        if (!Array.isArray(value)) return [];
        return value.slice(0, constants.LIMITS.images).map(image => ({
            url: cleanString(image?.url, 1000),
            alt: cleanString(image?.alt, 160),
            width: Number.isFinite(image?.width) ? Math.max(0, Math.min(10000, Math.trunc(image.width))) : 0,
            height: Number.isFinite(image?.height) ? Math.max(0, Math.min(10000, Math.trunc(image.height))) : 0
        })).filter(image => image.url || image.alt);
    }

    function sanitizeForms(value) {
        if (!Array.isArray(value)) return [];
        return value.slice(0, constants.LIMITS.forms).map(form => ({
            action: cleanString(form?.action, 1000),
            text: cleanString(form?.text, 500),
            fields: stringArray(form?.fields, constants.LIMITS.formFields, 160)
        }));
    }

    function sanitizeResources(value) {
        if (!Array.isArray(value)) return [];
        return value.slice(0, constants.LIMITS.resources).map(resource => ({
            url: cleanString(resource?.url, 1000),
            type: cleanString(resource?.type, 40)
        })).filter(resource => resource.url);
    }

    function sanitizeStorage(value) {
        const source = plainObject(value) ? value : {};
        return {
            local: stringArray(source.local, constants.LIMITS.storageKeys, 120),
            session: stringArray(source.session, constants.LIMITS.storageKeys, 120),
            indexedDB: stringArray(source.indexedDB, constants.LIMITS.storageKeys, 120),
            cookies: stringArray(source.cookies, constants.LIMITS.storageKeys, 120)
        };
    }

    function sanitizeSignals(value) {
        if (!plainObject(value)) return null;
        const url = lists.normalizeHttpUrl(value.url, true);
        if (!url) return null;

        return {
            url,
            title: cleanString(value.title, constants.LIMITS.title),
            metaDescription: cleanString(value.metaDescription, constants.LIMITS.metadata),
            openGraph: stringArray(value.openGraph, 12, constants.LIMITS.metadata),
            structuredDataTypes: stringArray(value.structuredDataTypes, 24, 80),
            favicons: stringArray(value.favicons, 12, 1000),
            text: cleanString(value.text, constants.LIMITS.text),
            menus: stringArray(value.menus, constants.LIMITS.menus, 220),
            buttons: stringArray(value.buttons, constants.LIMITS.buttons, 220),
            forms: sanitizeForms(value.forms),
            links: sanitizeLinks(value.links),
            images: sanitizeImages(value.images),
            scripts: stringArray(value.scripts, constants.LIMITS.scripts, 1000),
            iframes: stringArray(value.iframes, constants.LIMITS.iframes, 1000),
            resources: sanitizeResources(value.resources),
            storage: sanitizeStorage(value.storage),
            serviceWorkerScopes: stringArray(value.serviceWorkerScopes, 20, 1000),
            websocketUrls: stringArray(value.websocketUrls, 20, 1000),
            trackerCount: Number.isFinite(value.trackerCount)
                ? Math.max(0, Math.min(500, Math.trunc(value.trackerCount)))
                : 0,
            adCount: Number.isFinite(value.adCount)
                ? Math.max(0, Math.min(500, Math.trunc(value.adCount)))
                : 0,
            pixelCount: Number.isFinite(value.pixelCount)
                ? Math.max(0, Math.min(100, Math.trunc(value.pixelCount)))
                : 0,
            articleCount: Number.isFinite(value.articleCount)
                ? Math.max(0, Math.min(50, Math.trunc(value.articleCount)))
                : 0,
            fingerprint: cleanString(value.fingerprint, 64)
        };
    }

    function sanitizeSettings(value) {
        if (!plainObject(value)) return null;
        const patch = {};
        for (const key of ['blockBetting', 'blockAds', 'blockTrackers', 'aiDetection', 'extremeMode']) {
            if (typeof value[key] === 'boolean') patch[key] = value[key];
        }
        if (Number.isFinite(value.detectionThreshold)) {
            patch.detectionThreshold = Math.round(Math.min(
                constants.SCORE.thresholdMax,
                Math.max(constants.SCORE.thresholdMin, value.detectionThreshold)
            ));
        }
        return Object.keys(patch).length > 0 ? patch : null;
    }

    function sanitizeAppearance(value) {
        if (!plainObject(value)) return null;
        const allowed = {
            theme: new Set(['system', 'light', 'dark']),
            contrast: new Set(['normal', 'high']),
            density: new Set(['comfortable', 'compact']),
            motion: new Set(['system', 'reduced'])
        };
        for (const key of Object.keys(allowed)) {
            if (
                Object.prototype.hasOwnProperty.call(value, key)
                && !allowed[key].has(value[key])
            ) {
                return null;
            }
        }
        if (
            Object.prototype.hasOwnProperty.call(value, 'accent')
            && (typeof value.accent !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.accent))
        ) {
            return null;
        }
        const normalized = appearance.normalize(value);
        const patch = {};
        for (const key of ['theme', 'accent', 'contrast', 'density', 'motion']) {
            if (Object.prototype.hasOwnProperty.call(value, key)) patch[key] = normalized[key];
        }
        return Object.keys(patch).length > 0 ? patch : null;
    }

    function validate(type, payload) {
        if (NO_PAYLOAD_TYPES.has(type)) return { ok: true, payload: undefined };

        if (type === 'analyzePage') {
            try {
                if (JSON.stringify(payload).length > constants.LIMITS.messageBytes) {
                    return { ok: false, error: 'Amostra de página excede o limite' };
                }
            } catch {
                return { ok: false, error: 'Amostra de página inválida' };
            }
            const signals = sanitizeSignals(payload);
            return signals
                ? { ok: true, payload: signals }
                : { ok: false, error: 'Sinais de página inválidos' };
        }

        if (type === 'toggleProtection') {
            return typeof payload?.enabled === 'boolean'
                ? { ok: true, payload: { enabled: payload.enabled } }
                : { ok: false, error: 'Estado de proteção inválido' };
        }

        if (type === 'updateSettings') {
            const settings = sanitizeSettings(payload?.settings);
            return settings
                ? { ok: true, payload: { settings } }
                : { ok: false, error: 'Configurações inválidas' };
        }

        if (type === 'updateAppearance') {
            const appearancePatch = sanitizeAppearance(payload?.appearance);
            return appearancePatch
                ? { ok: true, payload: { appearance: appearancePatch } }
                : { ok: false, error: 'Aparência inválida' };
        }

        if (type === 'addListEntry') {
            const listName = payload?.list;
            if (listName !== 'whitelist' && listName !== 'blocklist') {
                return { ok: false, error: 'Lista inválida' };
            }
            const normalized = lists.normalizeEntry(payload.entry, listName);
            return normalized.ok
                ? { ok: true, payload: { list: listName, entry: normalized.entry } }
                : normalized;
        }

        if (type === 'removeListEntry') {
            const listName = payload?.list;
            const id = cleanString(payload?.id, 80);
            if ((listName !== 'whitelist' && listName !== 'blocklist') || !id) {
                return { ok: false, error: 'Remoção de lista inválida' };
            }
            return { ok: true, payload: { list: listName, id } };
        }

        if (type === 'allowTemporary') {
            const url = lists.normalizeHttpUrl(payload?.url, true);
            if (!url) return { ok: false, error: 'URL temporária inválida' };
            const duration = Number.isFinite(payload?.duration)
                ? Math.max(60000, Math.min(30 * 60 * 1000, Math.trunc(payload.duration)))
                : 5 * 60 * 1000;
            return { ok: true, payload: { url, duration } };
        }

        if (type === 'importFilterList') {
            const name = cleanString(payload?.name, 120);
            const category = cleanString(payload?.category, 24).toLowerCase();
            const text = typeof payload?.text === 'string' ? payload.text : '';
            if (!name || !['ads', 'privacy', 'gambling', 'custom'].includes(category)) {
                return { ok: false, error: 'Metadados da lista de filtros inválidos' };
            }
            if (!text || filterParser.utf8ByteLength(text) > filterParser.LIMITS.sourceBytes) {
                return { ok: false, error: 'Lista vazia ou maior que 4 MB' };
            }
            return { ok: true, payload: { name, category, text } };
        }

        if (type === 'toggleFilterSource') {
            const id = cleanString(payload?.id, 64).toLowerCase();
            return id && typeof payload?.enabled === 'boolean'
                ? { ok: true, payload: { id, enabled: payload.enabled } }
                : { ok: false, error: 'Alteração de fonte inválida' };
        }

        if (type === 'removeFilterSource') {
            const id = cleanString(payload?.id, 64).toLowerCase();
            return id
                ? { ok: true, payload: { id } }
                : { ok: false, error: 'Fonte inválida' };
        }

        if (type === 'importState') {
            try {
                if (!plainObject(payload?.data) || JSON.stringify(payload.data).length > 6 * 1024 * 1024) {
                    return { ok: false, error: 'Backup inválido ou muito grande' };
                }
                if (
                    !plainObject(payload.data.settings)
                    && !plainObject(payload.data.appearance)
                    && !Array.isArray(payload.data.whitelist)
                    && !Array.isArray(payload.data.blocklist)
                    && !Array.isArray(payload.data.filterSources)
                ) {
                    return { ok: false, error: 'O arquivo não contém configurações ou listas reconhecidas' };
                }
            } catch {
                return { ok: false, error: 'Backup inválido' };
            }
            return { ok: true, payload: { data: payload.data } };
        }

        return { ok: false, error: 'Tipo de mensagem desconhecido' };
    }

    function parse(message) {
        if (!plainObject(message)) return { ok: false, error: 'Mensagem inválida' };
        const type = cleanString(message.type, 64);
        if (!type) return { ok: false, error: 'Tipo ausente' };
        const result = validate(type, message.payload);
        return result.ok ? { ok: true, type, payload: result.payload } : result;
    }

    return Object.freeze({
        parse,
        validate,
        sanitizeSignals,
        sanitizeSettings,
        sanitizeAppearance,
        plainObject,
        cleanString
    });
})();
