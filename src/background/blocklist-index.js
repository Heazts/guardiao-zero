'use strict';

/**
 * Índice de domínio com memória previsível. A lista já é única e ordenada;
 * mantemos um único texto e fazemos busca binária por linha, evitando um Set
 * com centenas de milhares de strings/objetos.
 */
globalThis.GuardiaoBlocklistIndex = globalThis.GuardiaoBlocklistIndex || (() => {
    let listText = '';
    let domainCount = 0;
    let loadPromise = null;

    function readLineAt(text, start) {
        let end = text.indexOf('\n', start);
        if (end === -1) end = text.length;
        let valueEnd = end;
        if (valueEnd > start && text.charCodeAt(valueEnd - 1) === 13) valueEnd -= 1;
        return { value: text.slice(start, valueEnd), next: end < text.length ? end + 1 : end };
    }

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

    function findDomain(hostname) {
        if (!listText || !hostname) return '';
        const parts = hostname.toLowerCase().split('.');
        for (let index = 0; index <= parts.length - 2; index += 1) {
            const candidate = parts.slice(index).join('.');
            if (containsSortedDomain(listText, candidate)) return candidate;
        }
        return '';
    }

    function countLines(text) {
        if (!text) return 0;
        let count = 1;
        for (let index = 0; index < text.length; index += 1) {
            if (text.charCodeAt(index) === 10 && index < text.length - 1) count += 1;
        }
        return count;
    }

    async function load() {
        if (listText) return { loaded: true, count: domainCount };
        if (loadPromise) return loadPromise;

        loadPromise = (async () => {
            const api = globalThis.GuardiaoPlatform?.api;
            if (!api) throw new Error('WebExtension API indisponível');

            const response = await fetch(api.runtime.getURL('src/filters/heazts-blocklist.txt'));
            if (!response.ok) throw new Error(`Falha ao carregar blocklist: HTTP ${response.status}`);
            const text = await response.text();
            if (!text || text.length < 1000) throw new Error('Blocklist vazia ou corrompida');

            listText = text;
            domainCount = countLines(text);
            return { loaded: true, count: domainCount };
        })().catch(error => {
            loadPromise = null;
            throw error;
        });

        return loadPromise;
    }

    function status() {
        return {
            loaded: Boolean(listText),
            count: domainCount,
            bytes: listText.length,
            representation: 'sorted-text-binary-search'
        };
    }

    return Object.freeze({
        load,
        findDomain,
        containsSortedDomain,
        countLines,
        status
    });
})();
