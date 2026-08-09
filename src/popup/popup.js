'use strict';

(() => {
    const platform = globalThis.GuardiaoPlatform;
    const i18n = globalThis.GuardiaoI18n;
    const t = (key, subs) => (i18n ? i18n.t(key, subs) : key);
    if (!platform?.isAvailable) return;

    const elements = {
        toggle: document.getElementById('toggle-protection'),
        statusBadge: document.getElementById('status-badge'),
        heroIcon: document.getElementById('hero-icon'),
        statusText: document.getElementById('status-text'),
        statusDescription: document.getElementById('status-description'),
        blockedCount: document.getElementById('blocked-count'),
        adCount: document.getElementById('ad-count'),
        trackerCount: document.getElementById('tracker-count'),
        toastContainer: document.getElementById('toast-container')
    };

    const animations = new WeakMap();
    let protectionEnabled = true;
    let busy = true;
    let currentStats = { pagesBlocked: 0, adsObserved: 0, trackersObserved: 0 };

    function formatNumber(value) {
        const number = Number.isFinite(value) ? Math.max(0, value) : 0;
        if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M`;
        if (number >= 1000) return `${(number / 1000).toFixed(1)}K`;
        return String(Math.trunc(number));
    }

    function animateNumber(target, value) {
        if (!target) return;
        const previousFrame = animations.get(target);
        if (previousFrame) cancelAnimationFrame(previousFrame);

        target.classList.remove('skeleton');
        const next = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
        const start = Number.parseInt(target.dataset.value || '0', 10) || 0;
        target.dataset.value = String(next);
        if (
            next > 1000
            || start === next
            || matchMedia('(prefers-reduced-motion: reduce)').matches
            || document.documentElement.dataset.motion === 'reduced'
        ) {
            target.textContent = formatNumber(next);
            return;
        }

        const startedAt = performance.now();
        const update = now => {
            const progress = Math.min(1, (now - startedAt) / 320);
            const eased = 1 - Math.pow(1 - progress, 3);
            target.textContent = String(Math.round(start + (next - start) * eased));
            if (progress < 1) {
                animations.set(target, requestAnimationFrame(update));
            } else {
                animations.delete(target);
                target.textContent = formatNumber(next);
            }
        };
        animations.set(target, requestAnimationFrame(update));
    }

    function renderState(state) {
        protectionEnabled = state.protectionEnabled !== false;
        currentStats = {
            pagesBlocked: Number.isFinite(state.stats?.pagesBlocked)
                ? state.stats.pagesBlocked
                : currentStats.pagesBlocked,
            adsObserved: Number.isFinite(state.stats?.adsObserved)
                ? state.stats.adsObserved
                : currentStats.adsObserved,
            trackersObserved: Number.isFinite(state.stats?.trackersObserved)
                ? state.stats.trackersObserved
                : currentStats.trackersObserved
        };

        elements.toggle.disabled = busy;
        elements.toggle.setAttribute('aria-pressed', String(protectionEnabled));
        elements.heroIcon.classList.toggle('paused', !protectionEnabled);
        elements.statusBadge.className = `status-badge ${protectionEnabled ? 'success' : 'warning'}`;
        elements.statusBadge.textContent = t(protectionEnabled ? 'statusActive' : 'statusPaused');
        elements.statusText.textContent = t(protectionEnabled ? 'protectionOn' : 'protectionOff');
        elements.statusDescription.textContent = protectionEnabled
            ? t('protectionOnHint')
            : t('protectionOffHint');
        animateNumber(elements.blockedCount, currentStats.pagesBlocked);
        animateNumber(elements.adCount, currentStats.adsObserved);
        animateNumber(elements.trackerCount, currentStats.trackersObserved);
    }

    function showToast(message, error = false) {
        const toast = document.createElement('div');
        toast.className = error ? 'toast toast-error' : 'toast';
        toast.setAttribute('role', error ? 'alert' : 'status');
        toast.textContent = message;
        elements.toastContainer.replaceChildren(toast);
        setTimeout(() => toast.remove(), error ? 5000 : 2800);
    }

    async function initialize() {
        try {
            const response = await platform.sendMessage('getState');
            if (!response?.ok) throw new Error(response?.error || t('stateUnavailable'));
            busy = false;
            renderState(response.state);
        } catch {
            busy = true;
            elements.statusBadge.className = 'status-badge danger';
            elements.statusBadge.textContent = t('statusUnavailable');
            elements.statusText.textContent = t('extensionUnavailable');
            elements.statusDescription.textContent = t('extensionUnavailableHint');
            elements.toggle.disabled = true;
            for (const target of [elements.blockedCount, elements.adCount, elements.trackerCount]) {
                target.classList.remove('skeleton');
                target.textContent = '—';
            }
        }
    }

    async function toggleProtection() {
        if (busy) return;
        busy = true;
        elements.toggle.disabled = true;
        const requestedState = !protectionEnabled;

        try {
            const response = await platform.sendMessage('toggleProtection', {
                enabled: requestedState
            });
            if (!response?.ok) throw new Error(response?.error || t('saveFailed'));
            busy = false;
            renderState(response.state);
            showToast(t(requestedState ? 'toastProtectionOn' : 'toastProtectionOff'));
        } catch {
            busy = false;
            renderState({ protectionEnabled, stats: currentStats });
            showToast(t('toastToggleFailed'), true);
        }
    }

    elements.toggle.addEventListener('click', () => void toggleProtection());
    platform.api.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.stats?.newValue) {
            currentStats = {
                pagesBlocked: changes.stats.newValue.pagesBlocked || 0,
                adsObserved: changes.stats.newValue.adsObserved || 0,
                trackersObserved: changes.stats.newValue.trackersObserved || 0
            };
            animateNumber(elements.blockedCount, currentStats.pagesBlocked);
            animateNumber(elements.adCount, currentStats.adsObserved);
            animateNumber(elements.trackerCount, currentStats.trackersObserved);
        }
        if (changes.protectionEnabled) {
            protectionEnabled = changes.protectionEnabled.newValue !== false;
            renderState({ protectionEnabled, stats: currentStats });
        }
    });

    void initialize();
})();
