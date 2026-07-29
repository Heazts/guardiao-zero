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
    let mutationTimer = 0;
    let observerStopTimer = 0;

    function shouldAnalyze() {
        // Anúncios e rastreadores são tratados pelo DNR antes do carregamento.
        // A varredura DOM só é necessária para a classificação de apostas.
        return protectionEnabled && settings.blockBetting;
    }

    function scheduleIdle(callback, timeout = 800) {
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(callback, { timeout });
        } else {
            setTimeout(callback, Math.min(timeout, 250));
        }
    }

    async function analyzeCurrentPage() {
        if (!shouldAnalyze() || scanInProgress) {
            scanPending = scanInProgress;
            return;
        }
        scanInProgress = true;

        try {
            const signals = await signalCollector.collect();
            if (signals.fingerprint === lastFingerprint) return;
            lastFingerprint = signals.fingerprint;
            const response = await platform.sendMessage('analyzePage', signals);
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
        clearTimeout(mutationTimer);
        clearTimeout(observerStopTimer);
    }

    function startBoundedObserver() {
        if (mutationObserver || !shouldAnalyze() || rescans >= constants.LIMITS.maxRescans) return;

        mutationObserver = new MutationObserver(mutations => {
            if (!shouldAnalyze() || rescans >= constants.LIMITS.maxRescans) {
                stopObserving();
                return;
            }
            const hasContentChange = mutations.some(mutation =>
                mutation.type === 'childList' && mutation.addedNodes.length > 0
            );
            if (!hasContentChange) return;

            clearTimeout(mutationTimer);
            mutationTimer = setTimeout(() => {
                rescans += 1;
                void analyzeCurrentPage();
                if (rescans >= constants.LIMITS.maxRescans) stopObserving();
            }, constants.LIMITS.mutationDebounceMs);
        });
        mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
        observerStopTimer = setTimeout(stopObserving, constants.LIMITS.mutationWindowMs);
    }

    function showBlockOverlay(payload) {
        if (document.getElementById('gzp-block-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'gzp-block-overlay';
        overlay.setAttribute('role', 'alert');
        overlay.setAttribute('aria-live', 'assertive');

        const card = document.createElement('section');
        card.className = 'gzp-block-card';
        const icon = document.createElement('div');
        icon.className = 'gzp-icon-container';
        icon.textContent = '!';
        icon.setAttribute('aria-hidden', 'true');

        const title = document.createElement('h1');
        title.textContent = 'Conteúdo restrito';
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

        scheduleIdle(() => {
            void analyzeCurrentPage();
            startBoundedObserver();
        });
    }

    platform.api.runtime.onMessage.addListener(message => {
        if (message?.type === 'showBlockOverlay') {
            showBlockOverlay(message.payload);
        }
        if (message?.type === 'stateUpdated') {
            protectionEnabled = message.payload?.protectionEnabled !== false;
            settings = { ...settings, ...message.payload?.settings };
            if (shouldAnalyze()) {
                scheduleIdle(() => void analyzeCurrentPage(), 500);
                startBoundedObserver();
            } else {
                stopObserving();
            }
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && shouldAnalyze()) {
            scheduleIdle(() => void analyzeCurrentPage(), 500);
        }
    }, { passive: true });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => void initialize(), { once: true });
    } else {
        void initialize();
    }
})();
