'use strict';

/**
 * Adaptador compatível para a política curada de domínios de apostas.
 *
 * A versão anterior buscava em runtime uma lista sem proveniência comprovada.
 * O índice agora só consulta dados empacotados e auditáveis fornecidos por
 * `GuardiaoVerifiedBettingDomains`; não há I/O, download ou fallback remoto.
 */
globalThis.GuardiaoBlocklistIndex = globalThis.GuardiaoBlocklistIndex || (() => {
    function readLineAt(text, start) {
        let end = text.indexOf('\n', start);
        if (end === -1) end = text.length;
        let valueEnd = end;
        if (valueEnd > start && text.charCodeAt(valueEnd - 1) === 13) valueEnd -= 1;
        return { value: text.slice(start, valueEnd), next: end < text.length ? end + 1 : end };
    }

    // Mantidos como utilitários puros para benchmarks e compatibilidade com a
    // API anterior. Nenhum deles carrega ou seleciona uma fonte de dados.
    function containsSortedDomain(text, target) {
        if (!text || !target) return false;
        let low = 0;
        let high = text.length;

        while (low < high) {
            const middle = low + Math.floor((high - low) / 2);
            const start = middle === 0 ? 0 : text.lastIndexOf('\n', middle - 1) + 1;
            const line = readLineAt(text, start);
            if (line.value === target) return true;
            if (line.value < target) {
                if (line.next <= low) return false;
                low = line.next;
            } else {
                if (start >= high) return false;
                high = start;
            }
        }
        return false;
    }

    function countLines(text) {
        if (!text) return 0;
        let count = 1;
        for (let index = 0; index < text.length; index += 1) {
            if (text.charCodeAt(index) === 10 && index < text.length - 1) count += 1;
        }
        return count;
    }

    function provider() {
        const candidate = globalThis.GuardiaoVerifiedBettingDomains;
        return candidate && typeof candidate === 'object' ? candidate : null;
    }

    function normalizeHostname(value) {
        if (typeof value !== 'string') return '';
        const hostname = value.trim().replace(/\.$/, '').toLowerCase();
        return hostname && !/[/\s@]/.test(hostname) ? hostname : '';
    }

    function fallbackFindDomain(source, hostname) {
        const domains = Array.isArray(source?.domains) ? source.domains : [];
        const suffixes = Array.isArray(source?.suffixes) ? source.suffixes : [];
        for (const candidate of [...domains, ...suffixes]) {
            const normalized = normalizeHostname(candidate);
            if (normalized && (hostname === normalized || hostname.endsWith(`.${normalized}`))) {
                return normalized;
            }
        }
        return '';
    }

    function findDomain(rawHostname) {
        const source = provider();
        const hostname = normalizeHostname(rawHostname);
        if (!source || !hostname) return '';
        if (typeof source.findDomain === 'function') {
            try {
                const match = normalizeHostname(source.findDomain(hostname));
                if (match) return match;
            } catch {
                // A representação declarativa abaixo mantém o índice disponível.
            }
        }
        return fallbackFindDomain(source, hostname);
    }

    function status() {
        const source = provider();
        if (!source) {
            return {
                loaded: false,
                count: 0,
                bytes: 0,
                representation: 'verified-domain-policy',
                provenance: null
            };
        }

        let upstream = {};
        if (typeof source.status === 'function') {
            try {
                const value = source.status();
                if (value && typeof value === 'object' && !Array.isArray(value)) upstream = value;
            } catch {
                // O diagnóstico abaixo continua utilizável com os dados básicos.
            }
        }
        const domains = Array.isArray(source.domains) ? source.domains.length : 0;
        const suffixes = Array.isArray(source.suffixes) ? source.suffixes.length : 0;
        return {
            ...upstream,
            loaded: true,
            count: Number.isFinite(upstream.count) ? upstream.count : domains + suffixes,
            bytes: Number.isFinite(upstream.bytes) ? upstream.bytes : 0,
            representation: upstream.representation || 'verified-domain-policy',
            provenance: upstream.provenance || source.provenance || null
        };
    }

    async function load() {
        return status();
    }

    return Object.freeze({
        load,
        findDomain,
        containsSortedDomain,
        countLines,
        status
    });
})();
