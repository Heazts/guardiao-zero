'use strict';

/**
 * Normalização, validação e compilação das listas do usuário. Expressões
 * regulares são compiladas uma única vez e passam por limites conservadores
 * para reduzir risco de ReDoS no processo da extensão.
 */
globalThis.GuardiaoLists = globalThis.GuardiaoLists || (() => {
    const MAX_PATTERN_LENGTH = 256;
    const HASH_PATTERN = /^[a-f0-9]{64}$/i;
    const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
    const VALID_TYPES = Object.freeze({
        whitelist: new Set(['domain', 'subdomain', 'regex', 'hash', 'signature', 'url']),
        blocklist: new Set(['domain', 'subdomain', 'regex', 'tld', 'asn', 'signature'])
    });

    function boundedString(value, maximum = MAX_PATTERN_LENGTH) {
        return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
    }

    function normalizeHostname(value) {
        const input = boundedString(value, 512).replace(/\.$/, '').toLowerCase();
        if (!input || /[/\s@]/.test(input)) return '';

        try {
            const hostname = new URL(`http://${input}`).hostname.replace(/\.$/, '').toLowerCase();
            return DOMAIN_PATTERN.test(hostname) ? hostname : '';
        } catch {
            return '';
        }
    }

    function normalizeHttpUrl(value, includeQuery = true) {
        const input = boundedString(value, 2048);
        if (!input) return '';

        try {
            const parsed = new URL(input);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
            parsed.hostname = parsed.hostname.toLowerCase();
            parsed.hash = '';
            if (!includeQuery) parsed.search = '';
            return parsed.href;
        } catch {
            return '';
        }
    }

    function domainMatches(hostname, pattern, includeChildren) {
        if (!hostname || !pattern) return false;
        if (hostname === pattern) return true;
        return includeChildren && hostname.endsWith(`.${pattern}`);
    }

    function normalizeHash(value) {
        const candidate = boundedString(value, 80).replace(/^sha256:/i, '').toLowerCase();
        return HASH_PATTERN.test(candidate) ? candidate : '';
    }

    function validateRegex(pattern) {
        const value = boundedString(pattern);
        if (!value) return { ok: false, error: 'Expressão regular vazia' };
        if (value.length > MAX_PATTERN_LENGTH) return { ok: false, error: 'Expressão regular muito longa' };
        if (/\\[1-9]/.test(value)) return { ok: false, error: 'Backreferences não são permitidas' };
        if (/\(\?<|(\(\?[:=!<])/.test(value)) return { ok: false, error: 'Lookarounds e grupos especiais não são permitidos' };
        if (/\([^)]*[+*][^)]*\)[+*{]/.test(value)) return { ok: false, error: 'Quantificadores aninhados não são permitidos' };
        if (/(?:\.\*|\.\+){2,}/.test(value)) return { ok: false, error: 'Padrão ambíguo não permitido' };

        try {
            return { ok: true, regex: new RegExp(value, 'iu') };
        } catch {
            return { ok: false, error: 'Expressão regular inválida' };
        }
    }

    function stableId(listName, type, pattern) {
        const source = `${listName}:${type}:${pattern}`;
        let hash = 2166136261;
        for (let index = 0; index < source.length; index += 1) {
            hash ^= source.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return `${listName}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
    }

    function normalizePattern(type, pattern) {
        if (type === 'domain' || type === 'subdomain') return normalizeHostname(pattern);
        if (type === 'url') return normalizeHttpUrl(pattern, true);
        if (type === 'hash' || type === 'signature') return normalizeHash(pattern);
        if (type === 'tld') {
            const tld = boundedString(pattern, 64).replace(/^\./, '').toLowerCase();
            return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(tld) ? tld : '';
        }
        if (type === 'asn') {
            const asn = boundedString(pattern, 24).replace(/^as/i, '');
            return /^\d{1,10}$/.test(asn) ? `AS${asn}` : '';
        }
        if (type === 'regex') {
            const validation = validateRegex(pattern);
            return validation.ok ? boundedString(pattern) : '';
        }
        return '';
    }

    function normalizeEntry(rawEntry, listName, legacyType = 'subdomain') {
        const validTypes = VALID_TYPES[listName];
        if (!validTypes) return { ok: false, error: 'Lista desconhecida' };

        const source = typeof rawEntry === 'string'
            ? { pattern: rawEntry, type: legacyType, addedBy: 'user' }
            : rawEntry;

        if (!source || typeof source !== 'object' || Array.isArray(source)) {
            return { ok: false, error: 'Entrada inválida' };
        }

        if (source.type !== undefined && !validTypes.has(source.type)) {
            return { ok: false, error: `Tipo de entrada não permitido: ${boundedString(source.type, 40)}` };
        }
        const type = validTypes.has(source.type) ? source.type : legacyType;
        const pattern = normalizePattern(type, source.pattern);
        if (!pattern) return { ok: false, error: `Padrão inválido para o tipo ${type}` };

        const addedAt = Number.isFinite(source.addedAt) && source.addedAt > 0
            ? Math.trunc(source.addedAt)
            : Date.now();
        const expiresAt = Number.isFinite(source.expiresAt) && source.expiresAt > addedAt
            ? Math.trunc(source.expiresAt)
            : undefined;

        const entry = {
            id: boundedString(source.id, 80) || stableId(listName, type, pattern),
            pattern,
            type,
            description: boundedString(source.description, 160),
            addedAt,
            addedBy: ['user', 'system', 'import'].includes(source.addedBy) ? source.addedBy : 'user'
        };

        if (expiresAt !== undefined) entry.expiresAt = expiresAt;
        if (listName === 'blocklist') {
            entry.severity = ['low', 'medium', 'high', 'critical'].includes(source.severity)
                ? source.severity
                : 'critical';
        }

        return { ok: true, entry };
    }

    function normalizeEntries(entries, listName, maximum = 5000) {
        const normalized = [];
        const rejected = [];
        const unique = new Set();
        const source = Array.isArray(entries) ? entries.slice(0, maximum) : [];

        for (const rawEntry of source) {
            const result = normalizeEntry(rawEntry, listName);
            if (!result.ok) {
                rejected.push(result.error);
                continue;
            }

            const key = `${result.entry.type}:${result.entry.pattern}`;
            if (unique.has(key)) continue;
            unique.add(key);
            normalized.push(result.entry);
        }

        return { entries: normalized, rejected };
    }

    function compile(entries, listName) {
        const normalized = normalizeEntries(entries, listName);
        const compiled = {
            listName,
            entries: normalized.entries,
            exactDomains: new Map(),
            subdomains: [],
            urls: new Map(),
            regexes: [],
            hashes: new Map(),
            signatures: new Map(),
            tlds: new Map(),
            asns: new Map()
        };

        for (const entry of normalized.entries) {
            if (entry.expiresAt && entry.expiresAt <= Date.now()) continue;

            if (entry.type === 'domain') compiled.exactDomains.set(entry.pattern, entry);
            if (entry.type === 'subdomain') compiled.subdomains.push(entry);
            if (entry.type === 'url') compiled.urls.set(entry.pattern, entry);
            if (entry.type === 'hash') compiled.hashes.set(entry.pattern, entry);
            if (entry.type === 'signature') compiled.signatures.set(entry.pattern, entry);
            if (entry.type === 'tld') compiled.tlds.set(entry.pattern, entry);
            if (entry.type === 'asn') compiled.asns.set(entry.pattern, entry);
            if (entry.type === 'regex') {
                const validation = validateRegex(entry.pattern);
                if (validation.ok) compiled.regexes.push({ entry, regex: validation.regex });
            }
        }

        compiled.subdomains.sort((left, right) => right.pattern.length - left.pattern.length);
        return compiled;
    }

    async function sha256Hex(value) {
        if (!globalThis.crypto?.subtle) return '';
        const data = new TextEncoder().encode(value);
        const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }

    function signatureSource(url) {
        const canonical = normalizeHttpUrl(url, false);
        if (!canonical) return '';
        const parsed = new URL(canonical);
        const path = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
        return `${parsed.hostname}${path}`;
    }

    async function match(compiled, context) {
        if (!compiled || !context) return null;

        const url = normalizeHttpUrl(context.url, true);
        const hostname = normalizeHostname(context.hostname || (url ? new URL(url).hostname : ''));
        if (!hostname) return null;

        const exact = compiled.exactDomains.get(hostname);
        if (exact) return exact;

        for (const entry of compiled.subdomains) {
            if (domainMatches(hostname, entry.pattern, true)) return entry;
        }

        const tld = hostname.slice(hostname.lastIndexOf('.') + 1);
        if (compiled.tlds.has(tld)) return compiled.tlds.get(tld);

        if (context.asn) {
            const asn = String(context.asn).toUpperCase().replace(/^AS/, '');
            if (compiled.asns.has(`AS${asn}`)) return compiled.asns.get(`AS${asn}`);
        }

        if (url && compiled.urls.has(url)) return compiled.urls.get(url);

        for (const item of compiled.regexes) {
            item.regex.lastIndex = 0;
            if (item.regex.test(url || hostname) || item.regex.test(hostname)) return item.entry;
        }

        if (compiled.hashes.size > 0) {
            const [urlHash, domainHash] = await Promise.all([
                sha256Hex(url),
                sha256Hex(hostname)
            ]);
            if (compiled.hashes.has(urlHash)) return compiled.hashes.get(urlHash);
            if (compiled.hashes.has(domainHash)) return compiled.hashes.get(domainHash);
        }

        if (compiled.signatures.size > 0) {
            const signature = await sha256Hex(signatureSource(url));
            if (compiled.signatures.has(signature)) return compiled.signatures.get(signature);
        }

        return null;
    }

    return Object.freeze({
        normalizeHostname,
        normalizeHttpUrl,
        normalizeHash,
        normalizeEntry,
        normalizeEntries,
        normalizePattern,
        validateRegex,
        domainMatches,
        compile,
        match,
        sha256Hex,
        signatureSource
    });
})();
