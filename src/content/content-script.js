'use strict';

(() => {
    const platform = globalThis.GuardiaoPlatform;
    const constants = globalThis.GuardiaoConstants;
    const signalCollector = globalThis.GuardiaoSignals;
    if (!platform?.isAvailable || !constants || !signalCollector) return;

    let protectionEnabled = true;
    let settings = { ...constants.DEFAULT_SETTINGS };
    let scanInProgress = false;
    let scanPending = false;
    let lastFingerprint = '';
    let rescans = 0;
    let mutationObserver = null;
    let performanceObserver = null;
    let mutationTimer = 0;
    let observerStopTimer = 0;
    let cosmeticStyle = null;
    let cosmeticSignature = '';
    let cosmeticGeneration = 0;
    let cosmeticRetryIndex = 0;
    let cosmeticRetryTimer = 0;

    const COSMETIC_STYLE_ID = 'gzp-cosmetic';
    const COSMETIC_RETRY_DELAYS = Object.freeze([250, 1000, 3000]);

    /**
     * Anúncios e rastreadores são bloqueados pelo DNR antes do carregamento; a
     * varredura completa do DOM só é necessária para classificar apostas.
     *
     * Quando a classificação está desligada ainda vale reportar observação:
     * é o que revela quais anúncios escaparam das regras de rede. Isso usa a
     * coleta leve, que não toca no DOM.
     */
    function shouldClassify() {
        return protectionEnabled && settings.blockBetting;
    }

    function shouldObserve() {
        return protectionEnabled;
    }

    function scheduleIdle(callback, timeout = 800) {
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(callback, { timeout });
        } else {
            setTimeout(callback, Math.min(timeout, 250));
        }
    }

    async function analyzeCurrentPage() {
        if (!shouldObserve() || scanInProgress) {
            scanPending = scanInProgress;
            return;
        }
        scanInProgress = true;

        try {
            const signals = shouldClassify()
                ? await signalCollector.collect()
                : signalCollector.collectObservation();
            if (signals.fingerprint === lastFingerprint) return;
            const response = await platform.sendMessage('analyzePage', signals);
            if (response?.ok === false) return;
            lastFingerprint = signals.fingerprint;
            if (response?.action === 'block') stopObserving();
        } catch {
            // A navegação continua normalmente se o background estiver suspenso.
        } finally {
            scanInProgress = false;
            if (scanPending) {
                scanPending = false;
                scheduleIdle(() => void analyzeCurrentPage(), 500);
            }
        }
    }

    function stopObserving() {
        mutationObserver?.disconnect();
        mutationObserver = null;
        performanceObserver?.disconnect();
        performanceObserver = null;
        clearTimeout(mutationTimer);
        clearTimeout(observerStopTimer);
    }

    function scheduleRescan() {
        if (!shouldClassify() || rescans >= constants.LIMITS.maxRescans) {
            stopObserving();
            return;
        }

        clearTimeout(mutationTimer);
        mutationTimer = setTimeout(() => {
            rescans += 1;
            void analyzeCurrentPage();
            if (rescans >= constants.LIMITS.maxRescans) stopObserving();
        }, constants.LIMITS.mutationDebounceMs);
    }

    function startBoundedObserver() {
        if (mutationObserver || !shouldClassify() || rescans >= constants.LIMITS.maxRescans) return;

        mutationObserver = new MutationObserver(mutations => {
            if (!shouldClassify() || rescans >= constants.LIMITS.maxRescans) {
                stopObserving();
                return;
            }
            const hasContentChange = mutations.some(mutation => {
                if (mutation.type === 'characterData' || mutation.type === 'attributes') return true;
                return mutation.type === 'childList'
                    && (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0);
            });
            if (!hasContentChange) return;
            scheduleRescan();
        });
        mutationObserver.observe(document.documentElement, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: [
                'action',
                'aria-label',
                'autocomplete',
                'content',
                'href',
                'name',
                'placeholder',
                'role',
                'src',
                'type',
                'value'
            ]
        });

        if (typeof PerformanceObserver === 'function') {
            try {
                performanceObserver = new PerformanceObserver(entries => {
                    if (entries.getEntries().length > 0) scheduleRescan();
                });
                performanceObserver.observe({ type: 'resource', buffered: false });
            } catch {
                performanceObserver?.disconnect();
                performanceObserver = null;
            }
        }
        observerStopTimer = setTimeout(stopObserving, constants.LIMITS.mutationWindowMs);
    }

    /**
     * Ocultamento de elementos.
     *
     * Aplicado como CSS, não como manipulação de DOM. Isso resolve de graça o
     * caso mais difícil dos sites dinâmicos: uma regra CSS vale para elementos
     * que ainda nem existem, então infinite scroll, lazy loading e SPA são
     * cobertos sem nenhum MutationObserver e sem custo por mutação.
     *
     * As regras são inseridas uma a uma: um seletor que o navegador recuse não
     * pode derrubar as outras 51 — o que aconteceria numa lista separada por
     * vírgula, onde um único item inválido invalida a regra inteira.
     */
    function removeCosmeticStyle() {
        cosmeticStyle?.remove();
        cosmeticStyle = null;
        cosmeticSignature = '';
    }

    function scheduleCosmeticRetry(generation) {
        if (
            generation !== cosmeticGeneration
            || !protectionEnabled
            || !settings.blockAds
            || cosmeticRetryIndex >= COSMETIC_RETRY_DELAYS.length
        ) {
            return;
        }

        const delay = COSMETIC_RETRY_DELAYS[cosmeticRetryIndex];
        cosmeticRetryIndex += 1;
        clearTimeout(cosmeticRetryTimer);
        cosmeticRetryTimer = setTimeout(() => {
            void syncCosmeticFilters(generation);
        }, delay);
    }

    async function syncCosmeticFilters(generation) {
        if (generation !== cosmeticGeneration) return;
        if (!protectionEnabled || !settings.blockAds) {
            removeCosmeticStyle();
            return;
        }

        let response;
        try {
            response = await platform.sendMessage('getCosmeticFilters');
        } catch {
            scheduleCosmeticRetry(generation);
            return;
        }
        if (generation !== cosmeticGeneration) return;
        if (!response?.ok || !Array.isArray(response.selectors)) {
            scheduleCosmeticRetry(generation);
            return;
        }

        const selectors = Array.from(new Set(response.selectors.filter(selector =>
            typeof selector === 'string' && selector.length > 0
        )));
        if (selectors.length === 0) {
            removeCosmeticStyle();
            return;
        }

        const root = document.head || document.documentElement;
        if (!root) {
            scheduleCosmeticRetry(generation);
            return;
        }

        const signature = selectors.join('\n');
        if (signature === cosmeticSignature && cosmeticStyle?.isConnected) return;

        const nextStyle = document.createElement('style');
        nextStyle.id = COSMETIC_STYLE_ID;
        nextStyle.setAttribute('data-guardiao-zero', 'cosmetic');
        root.appendChild(nextStyle);

        const sheet = nextStyle.sheet;
        if (!sheet) {
            nextStyle.remove();
            scheduleCosmeticRetry(generation);
            return;
        }
        for (const selector of selectors) {
            try {
                sheet.insertRule(`${selector}{display:none!important}`, sheet.cssRules.length);
            } catch {
                // Seletor que este navegador não entende: ignorar só ele.
            }
        }

        if (generation !== cosmeticGeneration) {
            nextStyle.remove();
            return;
        }
        cosmeticStyle?.remove();
        cosmeticStyle = nextStyle;
        cosmeticSignature = signature;
        cosmeticRetryIndex = 0;
    }

    function requestCosmeticSync({ removeFirst = false, delay = 0 } = {}) {
        cosmeticGeneration += 1;
        cosmeticRetryIndex = 0;
        clearTimeout(cosmeticRetryTimer);
        if (removeFirst || !protectionEnabled || !settings.blockAds) removeCosmeticStyle();

        const generation = cosmeticGeneration;
        if (delay > 0) {
            cosmeticRetryTimer = setTimeout(() => {
                void syncCosmeticFilters(generation);
            }, delay);
        } else {
            void syncCosmeticFilters(generation);
        }
    }

    function showBlockOverlay(payload) {
        if (document.getElementById('gzp-block-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'gzp-block-overlay';
        overlay.setAttribute('role', 'alert');
        overlay.setAttribute('aria-live', 'assertive');

        const card = document.createElement('section');
        card.className = 'gzp-block-panel';
        const icon = document.createElement('div');
        icon.className = 'gzp-icon-container';
        icon.setAttribute('aria-hidden', 'true');

        const title = document.createElement('h1');
        title.textContent = 'Limiar atingido';
        const description = document.createElement('p');
        description.textContent = payload?.reason
            ? `O Guardião Zero Pro bloqueou esta página: ${payload.reason}.`
            : 'O Guardião Zero Pro bloqueou esta página com base em múltiplas evidências.';

        card.append(icon, title, description);
        overlay.appendChild(card);
        document.documentElement.appendChild(overlay);
        stopObserving();
    }

    async function initialize() {
        try {
            const response = await platform.sendMessage('getState');
            if (response?.ok && response.state) {
                protectionEnabled = response.state.protectionEnabled !== false;
                settings = { ...settings, ...response.state.settings };
            }
        } catch {
            return;
        }

        requestCosmeticSync({ removeFirst: true });

        scheduleIdle(() => {
            void analyzeCurrentPage();
            startBoundedObserver();
        });
    }

    platform.api.runtime.onMessage.addListener(message => {
        if (message?.type === 'showBlockOverlay') {
            showBlockOverlay(message.payload);
        }
        if (message?.type === 'reanalyzePage') {
            lastFingerprint = '';
            rescans = 0;
            stopObserving();
            requestCosmeticSync({ removeFirst: true });
            scheduleIdle(() => {
                void analyzeCurrentPage();
                startBoundedObserver();
            }, 250);
        }
        if (message?.type === 'stateUpdated') {
            protectionEnabled = message.payload?.protectionEnabled !== false;
            settings = { ...settings, ...message.payload?.settings };
            // A mesma notificação também é emitida quando whitelist e fontes
            // mudam; remover antes da consulta impede manter CSS num site que
            // acabou de ser liberado pelo usuário.
            requestCosmeticSync({ removeFirst: true });
            if (shouldObserve()) {
                lastFingerprint = '';
                rescans = 0;
                stopObserving();
                scheduleIdle(() => {
                    void analyzeCurrentPage();
                    startBoundedObserver();
                }, 500);
            } else {
                stopObserving();
            }
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && shouldObserve()) {
            // Revalida liberações temporárias que podem ter expirado enquanto
            // a aba estava em segundo plano.
            requestCosmeticSync();
            scheduleIdle(() => void analyzeCurrentPage(), 500);
        }
    }, { passive: true });

    // Sai na frente de tudo: o content script roda em document_start e quanto
    // antes o CSS entrar, menos chance de o contêiner do anúncio piscar.
    requestCosmeticSync();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => void initialize(), { once: true });
    } else {
        void initialize();
    }
})();
