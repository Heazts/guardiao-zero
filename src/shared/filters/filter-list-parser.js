'use strict';

/**
 * Parser conservador de filtros de rede para importação local.
 *
 * O módulo aceita somente o subconjunto de EasyList/EasyPrivacy, AdGuard e
 * uBlock Origin que pode ser representado sem executar código nem aproximar
 * silenciosamente a semântica da regra:
 *
 * - regras de rede traduzíveis para `declarativeNetRequest`;
 * - ocultamento de elemento (`##seletor`, `dominio##seletor`, `dominio#@#seletor`),
 *   cujo efeito é sempre `display: none` e nunca uma declaração vinda da lista.
 *
 * Scriptlets, HTML filtering, seletores procedurais, injeção de estilo (`#$#`),
 * redirects, CSP, modificação de headers e regex arbitrária continuam recusados
 * e contabilizados.
 */
globalThis.GuardiaoFilterParser = globalThis.GuardiaoFilterParser || (() => {
    const LIMITS = Object.freeze({
        sourceBytes: 4 * 1024 * 1024,
        rulesPerSource: 12000,
        linesPerSource: 100000,
        lineLength: 8192,
        filterLength: 1024,
        domainsPerOption: 100,
        reportedErrors: 200,
        storedSources: 50
    });

    const ALL_RESOURCE_TYPES = Object.freeze([
        'main_frame',
        'sub_frame',
        'stylesheet',
        'script',
        'image',
        'font',
        'object',
        'xmlhttprequest',
        'ping',
        'media',
        'websocket',
        'other'
    ]);

    const RESOURCE_TYPE_ALIASES = Object.freeze({
        document: 'main_frame',
        doc: 'main_frame',
        subdocument: 'sub_frame',
        frame: 'sub_frame',
        stylesheet: 'stylesheet',
        css: 'stylesheet',
        script: 'script',
        image: 'image',
        font: 'font',
        object: 'object',
        object_subrequest: 'object',
        xmlhttprequest: 'xmlhttprequest',
        xhr: 'xmlhttprequest',
        ping: 'ping',
        beacon: 'ping',
        media: 'media',
        websocket: 'websocket',
        other: 'other'
    });

    const UNSUPPORTED_OPTIONS = Object.freeze({
        redirect: 'unsupported-redirect',
        'redirect-rule': 'unsupported-redirect',
        rewrite: 'unsupported-redirect',
        csp: 'unsupported-csp',
        removeparam: 'unsupported-removeparam',
        header: 'unsupported-header',
        removeheader: 'unsupported-header',
        setheader: 'unsupported-header',
        permissions: 'unsupported-header',
        replace: 'unsupported-rewrite',
        urlskip: 'unsupported-redirect'
    });

    const SOURCE_FORMATS = new Set([
        'auto',
        'easylist',
        'easyprivacy',
        'adguard',
        'ublock',
        'hosts',
        'custom'
    ]);
    const SOURCE_CATEGORIES = new Set(['ads', 'privacy', 'gambling', 'custom']);
    const SHA256_PATTERN = /^[a-f0-9]{64}$/;
    const SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
    const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
    const HOSTS_SINK_PATTERN = /^(?:0\.0\.0\.0|127(?:\.\d{1,3}){3}|::|::1)$/;

    function cleanString(value, maximum) {
        return typeof value === 'string'
            ? value.replace(/[\0\r\n]/g, '').trim().slice(0, maximum)
            : '';
    }

    function utf8ByteLength(value) {
        if (typeof TextEncoder === 'function') {
            return new TextEncoder().encode(value).byteLength;
        }

        let bytes = 0;
        for (let index = 0; index < value.length; index += 1) {
            const code = value.charCodeAt(index);
            if (code < 0x80) bytes += 1;
            else if (code < 0x800) bytes += 2;
            else if (code >= 0xD800 && code <= 0xDBFF && index + 1 < value.length) {
                const next = value.charCodeAt(index + 1);
                if (next >= 0xDC00 && next <= 0xDFFF) {
                    bytes += 4;
                    index += 1;
                } else {
                    bytes += 3;
                }
            } else {
                bytes += 3;
            }
        }
        return bytes;
    }

    // Pontuação ASCII que jamais aparece num hostname. Faixas permitidas:
    // `-` `.` dígitos, letras, e tudo acima de 0x7F (IDN segue para o caminho
    // lento, que converte para punycode).
    const NOT_HOSTNAME_ASCII = /[\x00-\x2c\x2f\x3a-\x40\x5b-\x60\x7b-\x7f]/;

    function normalizeDomain(value) {
        const input = cleanString(value, 512).replace(/\.$/, '').toLowerCase();
        if (!input) return '';

        // `hostRulesFromLine` chama esta função em TODA linha para descobrir se
        // é formato HOSTS. Sem esta guarda, cada linha em sintaxe Adblock —
        // `||dominio^$opcoes` — construía uma URL inválida só para vê-la lançar.
        // Numa lista de 20 mil linhas isso era a maior fatia isolada do parse.
        if (NOT_HOSTNAME_ASCII.test(input)) return '';

        // Caminho rápido: um hostname ASCII já canônico é exatamente o que
        // `new URL()` devolveria, sem o custo de construí-la.
        if (DOMAIN_PATTERN.test(input)) return input;

        try {
            const hostname = new URL(`http://${input}`).hostname.replace(/\.$/, '').toLowerCase();
            return DOMAIN_PATTERN.test(hostname) ? hostname : '';
        } catch {
            return '';
        }
    }

    function emptyStats(bytes = 0) {
        return {
            bytes,
            lines: 0,
            blank: 0,
            comments: 0,
            metadata: 0,
            accepted: 0,
            cosmeticAccepted: 0,
            rejected: 0,
            duplicates: 0,
            truncated: false,
            reasons: {}
        };
    }

    function recordReason(stats, reason) {
        stats.rejected += 1;
        stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
    }

    function reportRejection(result, lineNumber, reason, sourceLine, message = '') {
        recordReason(result.stats, reason);
        if (result.errors.length >= LIMITS.reportedErrors) return;
        result.errors.push({
            line: lineNumber,
            reason,
            message: cleanString(message, 180),
            source: cleanString(sourceLine, 240)
        });
    }

    function metadataKey(value) {
        const normalized = value.toLowerCase().replace(/\s+/g, ' ').trim();
        const aliases = {
            title: 'title',
            name: 'title',
            homepage: 'homepage',
            home: 'homepage',
            version: 'version',
            expires: 'expires',
            'last modified': 'lastModified',
            'last update': 'lastModified',
            description: 'description',
            license: 'license'
        };
        return aliases[normalized] || '';
    }

    function readMetadata(line, result) {
        const header = line.match(/^\[\s*(adblock(?:\s+plus)?[^\]]*)\]$/i);
        if (header) {
            result.metadata.header = cleanString(header[1], 120);
            result.stats.metadata += 1;
            return true;
        }

        const match = line.match(/^[!#]\s*([a-z][a-z -]{0,30})\s*:\s*(.+)$/i);
        if (!match) return false;
        const key = metadataKey(match[1]);
        if (!key) return false;
        result.metadata[key] = cleanString(match[2], key === 'description' ? 500 : 240);
        result.stats.metadata += 1;
        return true;
    }

    function stableSourceId(format, name, checksum) {
        const value = `${format}:${name}:${checksum}`;
        let hash = 2166136261;
        for (let index = 0; index < value.length; index += 1) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return `source-${(hash >>> 0).toString(16).padStart(8, '0')}`;
    }

    function boundedInteger(value, maximum) {
        return Number.isInteger(value) && value >= 0 && value <= maximum ? value : null;
    }

    /**
     * Normaliza o descritor persistido de uma fonte. Conteúdo remoto e URLs
     * não fazem parte do formato: a importação permanece explicitamente local.
     */
    function normalizeSource(rawSource) {
        if (!rawSource || typeof rawSource !== 'object' || Array.isArray(rawSource)) {
            return { ok: false, error: 'Descritor de fonte inválido' };
        }

        const name = cleanString(rawSource.name, 80);
        const format = cleanString(rawSource.format || rawSource.type || 'custom', 24).toLowerCase();
        const category = cleanString(rawSource.category || 'custom', 24).toLowerCase();
        const checksum = cleanString(rawSource.checksum, 64).toLowerCase();
        const filename = cleanString(rawSource.filename, 120);

        if (!name) return { ok: false, error: 'Nome da fonte ausente' };
        if (!SOURCE_FORMATS.has(format)) return { ok: false, error: 'Formato de fonte desconhecido' };
        if (!SOURCE_CATEGORIES.has(category)) return { ok: false, error: 'Categoria de fonte desconhecida' };
        if (checksum && !SHA256_PATTERN.test(checksum)) {
            return { ok: false, error: 'Checksum SHA-256 inválido' };
        }
        if (filename && /[\\/]/.test(filename)) {
            return { ok: false, error: 'Nome de arquivo inválido' };
        }
        if (rawSource.enabled !== undefined && typeof rawSource.enabled !== 'boolean') {
            return { ok: false, error: 'Estado da fonte inválido' };
        }

        const sizeBytes = boundedInteger(rawSource.sizeBytes ?? 0, LIMITS.sourceBytes);
        const ruleCount = boundedInteger(rawSource.ruleCount ?? 0, LIMITS.rulesPerSource);
        const acceptedCount = boundedInteger(rawSource.acceptedCount ?? ruleCount, LIMITS.rulesPerSource);
        const rejectedCount = boundedInteger(rawSource.rejectedCount ?? 0, 1000000);
        if ([sizeBytes, ruleCount, acceptedCount, rejectedCount].includes(null)) {
            return { ok: false, error: 'Contadores da fonte inválidos' };
        }

        const requestedId = cleanString(rawSource.id, 64).toLowerCase();
        const id = requestedId || stableSourceId(format, name, checksum);
        if (!SOURCE_ID_PATTERN.test(id)) return { ok: false, error: 'Identificador de fonte inválido' };

        const source = {
            id,
            name,
            format,
            category,
            enabled: rawSource.enabled !== false,
            checksum,
            sizeBytes,
            ruleCount,
            acceptedCount,
            rejectedCount
        };

        if (filename) source.filename = filename;
        for (const key of ['importedAt', 'updatedAt']) {
            const value = rawSource[key];
            if (value !== undefined) {
                if (!Number.isInteger(value) || value < 0) {
                    return { ok: false, error: `Timestamp ${key} inválido` };
                }
                source[key] = value;
            }
        }

        return { ok: true, source };
    }

    function normalizeSources(rawSources, maximum = LIMITS.storedSources) {
        const sources = [];
        const rejected = [];
        const ids = new Set();
        const limit = Number.isInteger(maximum)
            ? Math.max(0, Math.min(LIMITS.storedSources, maximum))
            : LIMITS.storedSources;
        const input = Array.isArray(rawSources) ? rawSources.slice(0, limit) : [];

        for (const rawSource of input) {
            const normalized = normalizeSource(rawSource);
            if (!normalized.ok) {
                rejected.push(normalized.error);
                continue;
            }
            if (ids.has(normalized.source.id)) {
                rejected.push(`Fonte duplicada: ${normalized.source.id}`);
                continue;
            }
            ids.add(normalized.source.id);
            sources.push(normalized.source);
        }
        return { sources, rejected };
    }

    function parseDomainOption(value) {
        const included = new Set();
        const excluded = new Set();
        const items = value.split('|');
        if (items.length === 0 || items.length > LIMITS.domainsPerOption) {
            return { ok: false };
        }

        for (const item of items) {
            const trimmed = item.trim();
            if (!trimmed) return { ok: false };
            const isExcluded = trimmed.startsWith('~');
            const domain = normalizeDomain(isExcluded ? trimmed.slice(1) : trimmed);
            if (!domain) return { ok: false };
            (isExcluded ? excluded : included).add(domain);
        }

        return {
            ok: true,
            included: Array.from(included).sort(),
            excluded: Array.from(excluded).sort()
        };
    }

    function optionName(rawOption) {
        const equals = rawOption.indexOf('=');
        return (equals === -1 ? rawOption : rawOption.slice(0, equals))
            .replace(/^~/, '')
            .trim()
            .toLowerCase();
    }

    function parseOptions(rawOptions) {
        const state = {
            positiveTypes: new Set(),
            negativeTypes: new Set(),
            includedDomains: new Set(),
            excludedDomains: new Set(),
            domainType: '',
            important: false,
            matchCase: false
        };

        if (!rawOptions) return { ok: true, state };
        const options = rawOptions.split(',');
        for (const original of options) {
            const option = original.trim();
            if (!option) return { ok: false, reason: 'invalid-option' };

            const equals = option.indexOf('=');
            const rawName = equals === -1 ? option : option.slice(0, equals);
            const value = equals === -1 ? '' : option.slice(equals + 1).trim();
            const negated = rawName.startsWith('~');
            const name = rawName.replace(/^~/, '').toLowerCase();

            if (UNSUPPORTED_OPTIONS[name]) {
                return { ok: false, reason: UNSUPPORTED_OPTIONS[name] };
            }

            if (name === 'domain' || name === 'from') {
                if (negated || !value) return { ok: false, reason: 'invalid-domain-option' };
                const domains = parseDomainOption(value);
                if (!domains.ok) return { ok: false, reason: 'invalid-domain-option' };
                for (const domain of domains.included) state.includedDomains.add(domain);
                for (const domain of domains.excluded) state.excludedDomains.add(domain);
                continue;
            }

            if (name === 'third-party' || name === '3p') {
                if (value) return { ok: false, reason: 'invalid-party-option' };
                const wanted = negated ? 'firstParty' : 'thirdParty';
                if (state.domainType && state.domainType !== wanted) {
                    return { ok: false, reason: 'conflicting-party-options' };
                }
                state.domainType = wanted;
                continue;
            }

            if (name === 'first-party' || name === '1p') {
                if (value) return { ok: false, reason: 'invalid-party-option' };
                const wanted = negated ? 'thirdParty' : 'firstParty';
                if (state.domainType && state.domainType !== wanted) {
                    return { ok: false, reason: 'conflicting-party-options' };
                }
                state.domainType = wanted;
                continue;
            }

            if (name === 'important') {
                if (negated || value) return { ok: false, reason: 'invalid-important-option' };
                state.important = true;
                continue;
            }

            if (name === 'match-case') {
                if (value) return { ok: false, reason: 'invalid-match-case-option' };
                state.matchCase = !negated;
                continue;
            }

            const resourceType = RESOURCE_TYPE_ALIASES[name];
            if (resourceType) {
                if (value) return { ok: false, reason: 'invalid-resource-option' };
                (negated ? state.negativeTypes : state.positiveTypes).add(resourceType);
                continue;
            }

            return {
                ok: false,
                reason: 'unsupported-option',
                detail: optionName(option)
            };
        }

        return { ok: true, state };
    }

    function selectedResourceTypes(optionState) {
        const selected = optionState.positiveTypes.size > 0
            ? ALL_RESOURCE_TYPES.filter(type => optionState.positiveTypes.has(type))
            : Array.from(ALL_RESOURCE_TYPES);
        return selected.filter(type => !optionState.negativeTypes.has(type));
    }

    function unsupportedSyntaxReason(line) {
        if (/(?:##\+js\(|#@#\+js\(|#%#|#@%#)/i.test(line)) return 'unsupported-scriptlet';
        if (/(?:##\^|#@#\^)/.test(line)) return 'unsupported-html-filter';
        // `#$#` e `#$?#` injetam declarações de estilo arbitrárias; `#?#` é
        // cosmético procedural. Os dois vão além de ocultar um elemento e
        // continuam recusados.
        if (/(?:#\$\??#|#@\$\??#|#\?#|#@\?#)/.test(line)) return 'unsupported-cosmetic-filter';
        return '';
    }

    // ------------------------------------------------------------------
    // Ocultamento de elemento
    //
    // Suportamos apenas `##seletor` e `dominio##seletor`, com a exceção
    // `dominio#@#seletor`. O resultado é sempre `display: none` — nunca uma
    // declaração vinda da lista. Um seletor não executa código, mas pode
    // apagar a página inteira, então a validação abaixo é a fronteira real.
    // ------------------------------------------------------------------

    const COSMETIC_LIMITS = Object.freeze({
        selectorLength: 240,
        selectorsPerSource: 20000,
        domainsPerRule: 50
    });

    /**
     * Seletores que atingiriam estrutura da página em vez de um anúncio.
     * Recusar aqui é mais barato — e mais confiável — do que descobrir num
     * relatório de site quebrado.
     */
    const DANGEROUS_TYPE_SELECTOR = /(?:^|[^a-z0-9_.#:-])(?:html|body|head|main|article)(?=$|[^a-z0-9_-])/i;
    const PROCEDURAL_TOKEN = /:(?:has-text|matches-css|matches-path|xpath|upward|nth-ancestor|watch-attr|min-text-length|others|shadow|remove)\b/i;

    /**
     * Mascara strings e seletores de atributo antes de procurar elementos
     * estruturais. Assim `[data-target="body"]` continua legítimo, enquanto
     * `body:not(...)`, `html#page` e `:is(body)` não escapam pela pontuação.
     */
    function selectorCodeOnly(selector) {
        let code = '';
        let quote = '';
        let attributeDepth = 0;
        let parenthesisDepth = 0;

        for (const token of selector) {
            if (quote) {
                code += ' ';
                if (token === quote) quote = '';
                continue;
            }
            if (token === '"' || token === "'") {
                quote = token;
                code += ' ';
                continue;
            }
            if (token === '[') {
                if (attributeDepth > 0) return { ok: false, code: '' };
                attributeDepth = 1;
                code += ' ';
                continue;
            }
            if (token === ']') {
                if (attributeDepth === 0) return { ok: false, code: '' };
                attributeDepth = 0;
                code += ' ';
                continue;
            }
            if (attributeDepth > 0) {
                code += ' ';
                continue;
            }
            if (token === '(') parenthesisDepth += 1;
            if (token === ')') {
                parenthesisDepth -= 1;
                if (parenthesisDepth < 0) return { ok: false, code: '' };
            }
            code += token;
        }

        return {
            ok: !quote && attributeDepth === 0 && parenthesisDepth === 0,
            code
        };
    }

    function targetsPageStructure(selector) {
        const inspected = selectorCodeOnly(selector);
        if (!inspected.ok) return { ok: false, dangerous: false };
        const dangerous = /:root\b/i.test(inspected.code)
            || inspected.code.includes('*')
            || DANGEROUS_TYPE_SELECTOR.test(inspected.code);
        return { ok: true, dangerous };
    }

    function validateSelector(rawSelector) {
        const selector = cleanString(rawSelector, COSMETIC_LIMITS.selectorLength + 1);
        if (!selector) return { ok: false, reason: 'empty-selector' };
        if (selector.length > COSMETIC_LIMITS.selectorLength) {
            return { ok: false, reason: 'selector-too-long' };
        }
        if (PROCEDURAL_TOKEN.test(selector)) {
            return { ok: false, reason: 'unsupported-procedural-selector' };
        }
        // `{` e `}` significariam declaração de estilo; `\` escaparia a saída.
        if (/[{}\\]/.test(selector)) return { ok: false, reason: 'invalid-selector-syntax' };
        const structure = targetsPageStructure(selector);
        if (!structure.ok) return { ok: false, reason: 'invalid-selector-syntax' };
        if (structure.dangerous) {
            return { ok: false, reason: 'selector-targets-page-structure' };
        }
        if (selector === '*' || /^[a-z]+$/i.test(selector) === false && /^[\s,]*$/.test(selector)) {
            return { ok: false, reason: 'invalid-selector-syntax' };
        }
        return { ok: true, selector };
    }

    function parseCosmeticLine(line) {
        const separator = line.match(/#@?#/);
        if (!separator) return null;

        const index = separator.index;
        const exception = separator[0] === '#@#';
        const rawDomains = line.slice(0, index).trim();
        const rawSelector = line.slice(index + separator[0].length);

        const validation = validateSelector(rawSelector);
        if (!validation.ok) return { ok: false, reason: validation.reason };

        const domains = [];
        if (rawDomains) {
            const parts = rawDomains.split(',');
            if (parts.length > COSMETIC_LIMITS.domainsPerRule) {
                return { ok: false, reason: 'too-many-domains' };
            }
            for (const part of parts) {
                const trimmed = part.trim();
                if (!trimmed) return { ok: false, reason: 'invalid-domain-option' };
                // `~dominio` exclui; sem suporte a exclusão aqui, recusamos em
                // vez de aplicar mais amplamente do que a lista pediu.
                if (trimmed.startsWith('~')) return { ok: false, reason: 'unsupported-domain-exclusion' };
                const domain = normalizeDomain(trimmed);
                if (!domain) return { ok: false, reason: 'invalid-domain-option' };
                domains.push(domain);
            }
        }

        return {
            ok: true,
            cosmetic: {
                selector: validation.selector,
                domains: Array.from(new Set(domains)).sort(),
                exception
            }
        };
    }

    function hostRulesFromLine(line) {
        const withoutComment = line.replace(/\s+#.*$/, '').trim();
        const tokens = withoutComment.split(/\s+/);

        if (tokens.length >= 2 && HOSTS_SINK_PATTERN.test(tokens[0])) {
            const filters = [];
            for (const token of tokens.slice(1)) {
                const domain = normalizeDomain(token);
                if (!domain) return { matched: true, ok: false };
                filters.push(`||${domain}^`);
            }
            return { matched: true, ok: filters.length > 0, filters };
        }

        if (tokens.length === 1) {
            const domain = normalizeDomain(tokens[0]);
            if (domain) return { matched: true, ok: true, filters: [`||${domain}^`] };
        }

        return { matched: false };
    }

    function buildRule(filter, exception, optionState) {
        const resourceTypes = selectedResourceTypes(optionState);
        if (resourceTypes.length === 0) {
            return { ok: false, reason: 'empty-resource-selection' };
        }

        const condition = {
            urlFilter: filter,
            resourceTypes
        };
        if (optionState.domainType) condition.domainType = optionState.domainType;

        const includedDomains = Array.from(optionState.includedDomains).sort();
        const excludedDomains = Array.from(optionState.excludedDomains).sort();
        if (includedDomains.length > 0) condition.initiatorDomains = includedDomains;
        if (excludedDomains.length > 0) condition.excludedInitiatorDomains = excludedDomains;
        if (optionState.matchCase) condition.isUrlFilterCaseSensitive = true;

        return {
            ok: true,
            rule: {
                priority: exception
                    ? (optionState.important ? 4 : 2)
                    : (optionState.important ? 3 : 1),
                action: { type: exception ? 'allow' : 'block' },
                condition
            }
        };
    }

    function normalizeUrlFilter(rawFilter) {
        const filter = rawFilter.trim();
        if (!filter || filter.length > LIMITS.filterLength) return '';
        if (/[^\x20-\x7E]/.test(filter) || /\s/.test(filter)) return '';
        if (filter.startsWith('||*')) return '';

        const domainAnchor = filter.match(/^\|\|([^/*^|]+)\^$/);
        if (domainAnchor) {
            const domain = normalizeDomain(domainAnchor[1]);
            return domain ? `||${domain}^` : '';
        }
        return filter;
    }

    function parseNetworkLine(line) {
        let source = line;
        let exception = false;
        if (source.startsWith('@@')) {
            exception = true;
            source = source.slice(2);
        }

        if (source.startsWith('/')) {
            const closingSlash = source.lastIndexOf('/');
            if (
                closingSlash > 0
                && (closingSlash === source.length - 1 || source[closingSlash + 1] === '$')
            ) {
                return { ok: false, reason: 'unsupported-regex' };
            }
        }

        const optionIndex = source.indexOf('$');
        const rawFilter = optionIndex === -1 ? source : source.slice(0, optionIndex);
        const rawOptions = optionIndex === -1 ? '' : source.slice(optionIndex + 1);

        if (/^\/.*\/$/.test(rawFilter.trim())) {
            return { ok: false, reason: 'unsupported-regex' };
        }

        const filter = normalizeUrlFilter(rawFilter);
        if (!filter) return { ok: false, reason: 'invalid-url-filter' };

        const parsedOptions = parseOptions(rawOptions);
        if (!parsedOptions.ok) return parsedOptions;
        return buildRule(filter, exception, parsedOptions.state);
    }

    function detectFormat(result, sawHosts, sawNetwork) {
        if (result.metadata.header) return 'easylist';
        if (sawHosts && !sawNetwork) return 'hosts';
        if (sawNetwork) return 'adblock';
        return 'unknown';
    }

    function parse(sourceText) {
        if (typeof sourceText !== 'string') {
            return {
                ok: false,
                format: 'unknown',
                metadata: {},
                rules: [],
                cosmetic: [],
                stats: emptyStats(),
                errors: [{
                    line: 0,
                    reason: 'invalid-source',
                    message: 'A fonte deve ser texto',
                    source: ''
                }]
            };
        }

        // Cada code unit UTF-16 ocupa ao menos um byte em UTF-8. Esta guarda
        // evita uma alocação adicional enorme no TextEncoder para entradas
        // que já excedem inequivocamente o limite.
        const bytes = sourceText.length > LIMITS.sourceBytes
            ? sourceText.length
            : utf8ByteLength(sourceText);
        const result = {
            ok: true,
            format: 'unknown',
            metadata: {},
            rules: [],
            cosmetic: [],
            stats: emptyStats(bytes),
            errors: []
        };
        if (bytes > LIMITS.sourceBytes) {
            result.ok = false;
            reportRejection(result, 0, 'source-too-large', '', 'A fonte excede 4 MB');
            return result;
        }

        const uniqueRules = new Set();
        const uniqueCosmetic = new Set();
        let sawHosts = false;
        let sawNetwork = false;
        let lineStart = 0;
        let lineNumber = 0;

        while (lineStart <= sourceText.length) {
            if (lineNumber >= LIMITS.linesPerSource) {
                result.stats.truncated = true;
                reportRejection(result, lineNumber, 'line-limit', '', 'A fonte excede o limite de linhas');
                break;
            }

            let lineEnd = sourceText.indexOf('\n', lineStart);
            if (lineEnd === -1) lineEnd = sourceText.length;
            let line = sourceText.slice(lineStart, lineEnd);
            if (line.endsWith('\r')) line = line.slice(0, -1);
            lineNumber += 1;
            result.stats.lines = lineNumber;
            lineStart = lineEnd < sourceText.length ? lineEnd + 1 : sourceText.length + 1;

            const trimmed = line.trim();
            if (!trimmed) {
                result.stats.blank += 1;
                continue;
            }
            if (trimmed.length > LIMITS.lineLength) {
                reportRejection(result, lineNumber, 'line-too-long', trimmed);
                continue;
            }

            if (readMetadata(trimmed, result)) continue;
            const syntaxReason = unsupportedSyntaxReason(trimmed);
            if (syntaxReason) {
                reportRejection(result, lineNumber, syntaxReason, trimmed);
                continue;
            }
            // `!` é sempre comentário. `##` é filtro cosmético e precisa ser
            // testado ANTES da regra de comentário por `#`, senão todo
            // ocultamento genérico seria descartado como comentário.
            if (trimmed.startsWith('!')) {
                result.stats.comments += 1;
                continue;
            }
            if (/#@?#/.test(trimmed)) {
                const cosmetic = parseCosmeticLine(trimmed);
                if (cosmetic && !cosmetic.ok) {
                    reportRejection(result, lineNumber, cosmetic.reason, trimmed);
                    continue;
                }
                if (cosmetic?.ok) {
                    if (result.cosmetic.length >= COSMETIC_LIMITS.selectorsPerSource) {
                        result.stats.truncated = true;
                        reportRejection(result, lineNumber, 'cosmetic-limit', trimmed);
                        continue;
                    }
                    const key = `${cosmetic.cosmetic.exception ? '@' : ''}${cosmetic.cosmetic.domains.join(',')}##${cosmetic.cosmetic.selector}`;
                    if (uniqueCosmetic.has(key)) {
                        result.stats.duplicates += 1;
                        continue;
                    }
                    uniqueCosmetic.add(key);
                    result.cosmetic.push(cosmetic.cosmetic);
                    result.stats.cosmeticAccepted += 1;
                    continue;
                }
            }
            if (trimmed.startsWith('#')) {
                result.stats.comments += 1;
                continue;
            }

            const hosts = hostRulesFromLine(trimmed);
            const candidateFilters = hosts.matched && hosts.ok ? hosts.filters : [trimmed];
            if (hosts.matched && !hosts.ok) {
                reportRejection(result, lineNumber, 'invalid-hosts-entry', trimmed);
                continue;
            }
            if (hosts.matched) sawHosts = true;
            else sawNetwork = true;

            for (const candidate of candidateFilters) {
                const parsed = parseNetworkLine(candidate);
                if (!parsed.ok) {
                    reportRejection(
                        result,
                        lineNumber,
                        parsed.reason || 'invalid-filter',
                        trimmed,
                        parsed.detail || ''
                    );
                    continue;
                }

                const key = JSON.stringify(parsed.rule);
                if (uniqueRules.has(key)) {
                    result.stats.duplicates += 1;
                    continue;
                }
                uniqueRules.add(key);

                if (result.rules.length >= LIMITS.rulesPerSource) {
                    result.stats.truncated = true;
                    reportRejection(result, lineNumber, 'rule-limit', trimmed);
                    continue;
                }
                result.rules.push(parsed.rule);
                result.stats.accepted += 1;
            }
        }

        result.format = detectFormat(result, sawHosts, sawNetwork);
        return result;
    }

    return Object.freeze({
        LIMITS,
        ALL_RESOURCE_TYPES,
        parse,
        normalizeSource,
        normalizeSources,
        normalizeDomain,
        utf8ByteLength,
        validateSelector,
        COSMETIC_LIMITS
    });
})();
