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

    /**
     * URLs auxiliares não precisam carregar credenciais, query string ou
     * fragmento para o classificador. Origem e caminho preservam os sinais de
     * domínio/provedor/API sem encaminhar tokens presentes nesses componentes.
     */
    function minimizeUrl(value, baseUrl = location.href) {
        try {
            const parsed = new URL(value, baseUrl);
            if (!/^(?:https?|wss?):$/.test(parsed.protocol)) return '';
            parsed.username = '';
            parsed.password = '';
            parsed.search = '';
            parsed.hash = '';
            return cleanText(parsed.href, 1000);
        } catch {
            return '';
        }
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
                action: minimizeUrl(form.getAttribute('action') || ''),
                text: cleanText(form.textContent, 500),
                fields
            };
        }).filter(form => formIsRelevant(form));
    }

    function formIsRelevant(form) {
        const text = [form.action, form.text, ...form.fields].join(' ');
        return /(?:\bstake\b|bet amount|valor da aposta|\bodds?\b|cota[cç][aã]o|betslip|poss[ií]vel retorno|potential return|\bwager\b|dep[oó]sito|\bdeposit\b|\bsaque\b|\bwithdraw\b|\bpix\b|\bsaldo\b|\bbalance\b)/i.test(text);
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
                if (key && storageKeyIsRelevant(key)) keys.push(key);
            }
        } catch {
            // Storage bloqueado, sandboxed ou indisponível.
        }
        return keys;
    }

    function storageKeyIsRelevant(key) {
        return constants.STORAGE_PATTERNS.some(pattern => pattern.test(key));
    }

    function relevantStorageKeys(values) {
        return Array.isArray(values)
            ? values.map(value => cleanText(value, 120)).filter(value =>
                value && storageKeyIsRelevant(value)
            ).slice(0, constants.LIMITS.storageKeys)
            : [];
    }

    // A coleta de nomes de cookie foi removida deliberadamente. Ela alimentava
    // apenas STORAGE_PATTERNS, que localStorage e sessionStorage já cobrem, e
    // era o sinal de maior custo de privacidade num add-on que declara
    // `data_collection_permissions: none`. Ler document.cookie em toda página
    // não se justifica pelo ganho de detecção.

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
                    .filter(name => name && storageKeyIsRelevant(name))
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
                    minimizeUrl(registration.scope)
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
                const url = minimizeUrl(entry.name);
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

    function integrationUrlIsRelevant(value) {
        const url = minimizeUrl(value);
        if (!url) return false;
        const host = hostname(url);
        return constants.GAMBLING_PROVIDER_HOSTS.some(domain =>
            host === domain || host.endsWith(`.${domain}`)
        ) || constants.PAYMENT_HOSTS.some(domain =>
            host === domain || host.endsWith(`.${domain}`)
        ) || constants.BETTING_API_TOKENS.some(token => url.toLowerCase().includes(token));
    }

    function linkIsRelevant(link) {
        const source = `${link.url} ${link.text}`;
        return /\b(?:sportsbook|casino|cassino|betslip|slots?)\b|live[- ]betting|apostas?[- ]ao[- ]vivo/i.test(source)
            || integrationUrlIsRelevant(link.url);
    }

    /**
     * A impressão representa todos os sinais limitados entregues ao detector.
     * Assim, uma alteração no fim do texto ou em ações, formulários, links e
     * rede não é confundida com uma amostra já analisada.
     */
    function signalFingerprint(signals) {
        return fingerprint([JSON.stringify([
            signals.url,
            signals.title,
            signals.metaDescription,
            signals.openGraph,
            signals.structuredDataTypes,
            signals.favicons,
            signals.text,
            signals.menus,
            signals.buttons,
            signals.forms,
            signals.links,
            signals.images,
            signals.scripts,
            signals.iframes,
            signals.resources,
            signals.storage,
            signals.serviceWorkerScopes,
            signals.websocketUrls,
            signals.trackerCount,
            signals.adCount,
            signals.pixelCount,
            signals.articleCount
        ])]);
    }

    /**
     * Coleta mínima para contabilizar anúncios e rastreadores que chegaram a
     * carregar. Não toca no DOM, não extrai texto e não lê storage: percorre
     * apenas a resource timing, que já cobre script, iframe, imagem e XHR —
     * inclusive os carregados dinamicamente, que as consultas por seletor
     * perderiam.
     *
     * Usada quando a proteção está ativa mas a classificação de apostas está
     * desligada; nesse caso não existe motivo para pagar a varredura completa.
     */
    function collectObservation() {
        const uniqueAds = new Set();
        const uniqueTrackers = new Set();
        let entries = [];
        try {
            entries = performance.getEntriesByType('resource');
        } catch {
            entries = [];
        }

        const limit = Math.min(entries.length, 1200);
        for (let index = 0; index < limit; index += 1) {
            const url = entries[index]?.name;
            if (typeof url !== 'string' || !url) continue;
            if (hostInList(url, constants.AD_HOSTS)) uniqueAds.add(url);
            else if (hostInList(url, constants.TRACKER_HOSTS)) uniqueTrackers.add(url);
        }

        const adCount = uniqueAds.size;
        const trackerCount = uniqueTrackers.size;
        return {
            url: location.href,
            adCount,
            trackerCount,
            pixelCount: 0,
            fingerprint: fingerprint([location.href, adCount, trackerCount])
        };
    }

    async function collect() {
        const text = collectVisibleText();
        const links = takeElements('a[href]', constants.LIMITS.links, link => ({
            url: minimizeUrl(link.href),
            text: cleanText(link.textContent, 160),
            external: Boolean(link.hostname && link.hostname !== location.hostname)
        })).filter(link => link.url && linkIsRelevant(link));
        const images = takeElements('img[src]', constants.LIMITS.images, image => ({
            url: minimizeUrl(image.currentSrc || image.src),
            alt: cleanText(image.alt || image.title, 160),
            width: Number(image.naturalWidth || image.width || 0),
            height: Number(image.naturalHeight || image.height || 0)
        }));
        const scripts = takeElements('script[src]', constants.LIMITS.scripts, script =>
            minimizeUrl(script.src)
        );
        const iframes = takeElements('iframe[src]', constants.LIMITS.iframes, frame =>
            minimizeUrl(frame.src)
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
                link => minimizeUrl(link.href)
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
            scripts: scripts.filter(integrationUrlIsRelevant),
            iframes: iframes.filter(integrationUrlIsRelevant),
            resources: resources.filter(resource => integrationUrlIsRelevant(resource.url)),
            storage: {
                local: collectStorageByName('localStorage'),
                session: collectStorageByName('sessionStorage'),
                indexedDB: indexedDBNames
            },
            serviceWorkerScopes,
            websocketUrls: resources
                .map(resource => resource.url)
                .filter(url => /^wss?:/i.test(url) && integrationUrlIsRelevant(url))
                .slice(0, 20),
            trackerCount: counts.trackerCount,
            adCount: counts.adCount,
            pixelCount,
            articleCount: Math.min(
                50,
                document.querySelectorAll('article, [itemtype*="Article"], [role="article"]').length
            )
        };
        result.fingerprint = signalFingerprint(result);
        return result;
    }

    return Object.freeze({
        collect,
        collectObservation,
        cleanText,
        fingerprint,
        integrationUrlIsRelevant,
        minimizeUrl,
        privacyCounts,
        relevantStorageKeys,
        signalFingerprint
    });
})();
