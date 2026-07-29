'use strict';

/**
 * Coletor somente-leitura. Não captura valores de formulários, cookies ou
 * storage; envia apenas nomes/estrutura. Todas as coleções têm limites fixos.
 */
globalThis.GuardiaoSignals = globalThis.GuardiaoSignals || (() => {
    const constants = globalThis.GuardiaoConstants;
    if (!constants) throw new Error('GuardiaoConstants precisa ser carregado antes do coletor');

    function cleanText(value, maximum) {
        return typeof value === 'string'
            ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
            : '';
    }

    function takeElements(selector, maximum, mapper) {
        const result = [];
        const elements = document.querySelectorAll(selector);
        const limit = Math.min(elements.length, maximum);
        for (let index = 0; index < limit; index += 1) {
            try {
                const value = mapper(elements[index]);
                if (value) result.push(value);
            } catch {
                // Um elemento malformado nunca interrompe a análise inteira.
            }
        }
        return result;
    }

    function collectVisibleText() {
        const root = document.body || document.documentElement;
        if (!root) return '';

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;
                if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|CANVAS)$/i.test(parent.tagName)) {
                    return NodeFilter.FILTER_REJECT;
                }
                if (parent.hidden || parent.getAttribute('aria-hidden') === 'true') {
                    return NodeFilter.FILTER_REJECT;
                }
                const text = node.nodeValue?.trim();
                return text && text.length > 1
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_REJECT;
            }
        });

        const chunks = [];
        let length = 0;
        let visited = 0;
        let node;
        while (
            (node = walker.nextNode())
            && length < constants.LIMITS.text
            && visited < 2500
        ) {
            const text = cleanText(node.nodeValue, 500);
            visited += 1;
            if (!text) continue;
            chunks.push(text);
            length += text.length + 1;
        }
        return chunks.join(' ').slice(0, constants.LIMITS.text);
    }

    function metaContent(selector) {
        return cleanText(document.querySelector(selector)?.getAttribute('content'), constants.LIMITS.metadata);
    }

    function collectOpenGraph() {
        return takeElements('meta[property^="og:"], meta[name^="twitter:"]', 12, element =>
            cleanText(element.getAttribute('content'), constants.LIMITS.metadata)
        );
    }

    function collectStructuredDataTypes() {
        const types = new Set();

        function visit(value, depth) {
            if (depth > 4 || value === null || value === undefined) return;
            if (Array.isArray(value)) {
                for (const item of value.slice(0, 20)) visit(item, depth + 1);
                return;
            }
            if (typeof value !== 'object') return;
            const type = value['@type'];
            if (typeof type === 'string') types.add(type.slice(0, 80));
            if (Array.isArray(type)) {
                for (const item of type.slice(0, 10)) {
                    if (typeof item === 'string') types.add(item.slice(0, 80));
                }
            }
            if (value['@graph']) visit(value['@graph'], depth + 1);
            if (value.mainEntity) visit(value.mainEntity, depth + 1);
        }

        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        const limit = Math.min(scripts.length, 10);
        for (let index = 0; index < limit; index += 1) {
            const raw = scripts[index].textContent || '';
            if (!raw || raw.length > 50000) continue;
            try {
                visit(JSON.parse(raw), 0);
            } catch {
                // JSON-LD inválido é comum e não é evidência.
            }
        }
        return Array.from(types).slice(0, 24);
    }

    function collectForms() {
        return takeElements('form', constants.LIMITS.forms, form => {
            const fields = takeFromRoot(
                form,
                'input, select, textarea, button',
                constants.LIMITS.formFields,
                field => {
                    const parts = [
                        field.getAttribute('name'),
                        field.getAttribute('id'),
                        field.getAttribute('type'),
                        field.getAttribute('placeholder'),
                        field.getAttribute('aria-label'),
                        field.getAttribute('autocomplete')
                    ];
                    if (/^(submit|button)$/i.test(field.getAttribute('type') || '')) {
                        parts.push(field.getAttribute('value'));
                    }
                    if (field.labels?.length) parts.push(field.labels[0]?.textContent);
                    return cleanText(parts.filter(Boolean).join(' '), 160);
                }
            );
            return {
                action: cleanText(form.action || form.getAttribute('action'), 1000),
                text: cleanText(form.textContent, 500),
                fields
            };
        });
    }

    function takeFromRoot(root, selector, maximum, mapper) {
        const result = [];
        const elements = root.querySelectorAll(selector);
        const limit = Math.min(elements.length, maximum);
        for (let index = 0; index < limit; index += 1) {
            const value = mapper(elements[index]);
            if (value) result.push(value);
        }
        return result;
    }

    function collectStorageKeys(storage) {
        const keys = [];
        try {
            const limit = Math.min(storage.length, constants.LIMITS.storageKeys);
            for (let index = 0; index < limit; index += 1) {
                const key = cleanText(storage.key(index), 120);
                if (key) keys.push(key);
            }
        } catch {
            // Storage bloqueado, sandboxed ou indisponível.
        }
        return keys;
    }

    function collectCookieNames() {
        try {
            return document.cookie
                .split(';')
                .slice(0, constants.LIMITS.storageKeys)
                .map(item => cleanText(item.split('=')[0], 120))
                .filter(Boolean);
        } catch {
            return [];
        }
    }

    function withTimeout(promise, timeoutMs, fallback) {
        return new Promise(resolve => {
            const timer = setTimeout(() => resolve(fallback), timeoutMs);
            Promise.resolve(promise).then(
                value => {
                    clearTimeout(timer);
                    resolve(value);
                },
                () => {
                    clearTimeout(timer);
                    resolve(fallback);
                }
            );
        });
    }

    function collectStorageByName(name) {
        try {
            return collectStorageKeys(window[name]);
        } catch {
            return [];
        }
    }

    async function collectIndexedDBNames() {
        try {
            if (typeof indexedDB?.databases !== 'function') return [];
            const databases = await withTimeout(indexedDB.databases(), 250, []);
            return Array.isArray(databases)
                ? databases.slice(0, constants.LIMITS.storageKeys)
                    .map(database => cleanText(database?.name, 120))
                    .filter(Boolean)
                : [];
        } catch {
            return [];
        }
    }

    async function collectServiceWorkerScopes() {
        try {
            if (!navigator.serviceWorker?.getRegistrations) return [];
            const registrations = await withTimeout(navigator.serviceWorker.getRegistrations(), 250, []);
            return Array.isArray(registrations)
                ? registrations.slice(0, 20).map(registration =>
                    cleanText(registration.scope, 1000)
                ).filter(Boolean)
                : [];
        } catch {
            return [];
        }
    }

    function collectResources() {
        try {
            const entries = performance.getEntriesByType('resource');
            const start = Math.max(0, entries.length - constants.LIMITS.resources);
            const resources = [];
            for (let index = start; index < entries.length; index += 1) {
                const entry = entries[index];
                const url = cleanText(entry.name, 1000);
                if (!url) continue;
                resources.push({
                    url,
                    type: cleanText(entry.initiatorType, 40)
                });
            }
            return resources;
        } catch {
            return [];
        }
    }

    function hostname(value) {
        try {
            return new URL(value, location.href).hostname.replace(/^www\./, '').toLowerCase();
        } catch {
            return '';
        }
    }

    function hostInList(value, domainList) {
        const host = hostname(value);
        return domainList.some(domain => host === domain || host.endsWith(`.${domain}`));
    }

    function privacyCounts(urls) {
        const uniqueAds = new Set();
        const uniqueTrackers = new Set();
        for (const url of urls) {
            if (hostInList(url, constants.AD_HOSTS)) uniqueAds.add(url);
            if (hostInList(url, constants.TRACKER_HOSTS)) uniqueTrackers.add(url);
        }
        return { adCount: uniqueAds.size, trackerCount: uniqueTrackers.size };
    }

    function fingerprint(parts) {
        const source = parts.join('|');
        let hash = 2166136261;
        for (let index = 0; index < source.length; index += 1) {
            hash ^= source.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    async function collect() {
        const text = collectVisibleText();
        const links = takeElements('a[href]', constants.LIMITS.links, link => ({
            url: cleanText(link.href, 1000),
            text: cleanText(link.textContent, 160),
            external: Boolean(link.hostname && link.hostname !== location.hostname)
        }));
        const images = takeElements('img[src]', constants.LIMITS.images, image => ({
            url: cleanText(image.currentSrc || image.src, 1000),
            alt: cleanText(image.alt || image.title, 160),
            width: Number(image.naturalWidth || image.width || 0),
            height: Number(image.naturalHeight || image.height || 0)
        }));
        const scripts = takeElements('script[src]', constants.LIMITS.scripts, script =>
            cleanText(script.src, 1000)
        );
        const iframes = takeElements('iframe[src]', constants.LIMITS.iframes, frame =>
            cleanText(frame.src, 1000)
        );
        const resources = collectResources();
        const resourceUrls = [
            ...scripts,
            ...iframes,
            ...images.map(image => image.url),
            ...resources.map(resource => resource.url)
        ];
        const counts = privacyCounts(resourceUrls);
        const pixelCount = images.filter(image =>
            image.width > 0
            && image.height > 0
            && image.width <= 2
            && image.height <= 2
            && hostname(image.url) !== location.hostname
        ).length;
        const [indexedDBNames, serviceWorkerScopes] = await Promise.all([
            collectIndexedDBNames(),
            collectServiceWorkerScopes()
        ]);

        const result = {
            url: location.href,
            title: cleanText(document.title, constants.LIMITS.title),
            metaDescription: metaContent('meta[name="description"], meta[property="description"]'),
            openGraph: collectOpenGraph(),
            structuredDataTypes: collectStructuredDataTypes(),
            favicons: takeElements(
                'link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]',
                12,
                link => cleanText(link.href, 1000)
            ),
            text,
            menus: takeElements(
                'nav, [role="navigation"], [role="menuitem"]',
                constants.LIMITS.menus,
                element => cleanText(element.textContent, 220)
            ),
            buttons: takeElements(
                'button, input[type="button"], input[type="submit"], [role="button"]',
                constants.LIMITS.buttons,
                element => cleanText(
                    element.textContent || element.getAttribute('value') || element.getAttribute('aria-label'),
                    220
                )
            ),
            forms: collectForms(),
            links,
            images,
            scripts,
            iframes,
            resources,
            storage: {
                local: collectStorageByName('localStorage'),
                session: collectStorageByName('sessionStorage'),
                indexedDB: indexedDBNames,
                cookies: collectCookieNames()
            },
            serviceWorkerScopes,
            websocketUrls: resources
                .map(resource => resource.url)
                .filter(url => /^wss?:/i.test(url))
                .slice(0, 20),
            trackerCount: counts.trackerCount,
            adCount: counts.adCount,
            pixelCount,
            articleCount: Math.min(
                50,
                document.querySelectorAll('article, [itemtype*="Article"], [role="article"]').length
            )
        };
        result.fingerprint = fingerprint([
            result.url,
            result.title,
            result.text.slice(0, 500),
            result.forms.length,
            result.scripts.length,
            result.iframes.length
        ]);
        return result;
    }

    return Object.freeze({ collect, cleanText, privacyCounts, fingerprint });
})();
