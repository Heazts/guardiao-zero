'use strict';

/**
 * Pequena camada de compatibilidade para as APIs Promise-based atuais de
 * Firefox e Chromium. O arquivo é clássico de propósito: ele pode ser
 * carregado por content scripts, páginas da extensão, event pages e workers.
 */
globalThis.GuardiaoPlatform = globalThis.GuardiaoPlatform || (() => {
    const api = globalThis.browser || globalThis.chrome;

    if (!api?.runtime) {
        return Object.freeze({
            api: null,
            isAvailable: false,
            sendMessage: async () => {
                throw new Error('WebExtension API indisponível');
            }
        });
    }

    async function sendMessage(type, payload) {
        const message = payload === undefined ? { type } : { type, payload };
        return api.runtime.sendMessage(message);
    }

    function extensionOrigin() {
        try {
            return new URL(api.runtime.getURL('')).origin;
        } catch {
            return '';
        }
    }

    return Object.freeze({
        api,
        isAvailable: true,
        sendMessage,
        extensionOrigin
    });
})();
