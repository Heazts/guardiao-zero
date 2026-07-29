'use strict';

(() => {
    const platform = globalThis.GuardiaoPlatform;
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
    let currentStats = { sitesBlocked: 0, adsBlocked: 0, trackersBlocked: 0 };

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
            sitesBlocked: Number.isFinite(state.stats?.sitesBlocked)
                ? state.stats.sitesBlocked
                : currentStats.sitesBlocked,
            adsBlocked: Number.isFinite(state.stats?.adsBlocked)
                ? state.stats.adsBlocked
                : currentStats.adsBlocked,
            trackersBlocked: Number.isFinite(state.stats?.trackersBlocked)
                ? state.stats.trackersBlocked
                : currentStats.trackersBlocked
        };

        elements.toggle.disabled = busy;
        elements.toggle.setAttribute('aria-pressed', String(protectionEnabled));
        elements.heroIcon.classList.toggle('paused', !protectionEnabled);
        elements.statusBadge.className = `status-badge ${protectionEnabled ? 'success' : 'warning'}`;
        elements.statusBadge.textContent = protectionEnabled ? 'Ativo' : 'Pausado';
        elements.statusText.textContent = protectionEnabled ? 'Proteção ativa' : 'Proteção pausada';
        elements.statusDescription.textContent = protectionEnabled
            ? 'Camadas locais em funcionamento'
            : 'Nenhuma requisição será filtrada';
        animateNumber(elements.blockedCount, currentStats.sitesBlocked);
        animateNumber(elements.adCount, currentStats.adsBlocked);
        animateNumber(elements.trackerCount, currentStats.trackersBlocked);
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
            if (!response?.ok) throw new Error(response?.error || 'Estado indisponível');
            busy = false;
            renderState(response.state);
        } catch {
            busy = true;
            elements.statusBadge.className = 'status-badge danger';
            elements.statusBadge.textContent = 'Indisponível';
            elements.statusText.textContent = 'Extensão indisponível';
            elements.statusDescription.textContent = 'Recarregue a extensão e tente novamente';
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
            if (!response?.ok) throw new Error(response?.error || 'Falha ao salvar');
            busy = false;
            renderState(response.state);
            showToast(requestedState ? 'Proteção reativada' : 'Proteção pausada');
        } catch {
            busy = false;
            renderState({ protectionEnabled, stats: currentStats });
            showToast('Não foi possível alterar a proteção', true);
        }
    }

    elements.toggle.addEventListener('click', () => void toggleProtection());
    platform.api.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.stats?.newValue) {
            currentStats = {
                sitesBlocked: changes.stats.newValue.sitesBlocked || 0,
                adsBlocked: changes.stats.newValue.adsBlocked || 0,
                trackersBlocked: changes.stats.newValue.trackersBlocked || 0
            };
            animateNumber(elements.blockedCount, currentStats.sitesBlocked);
            animateNumber(elements.adCount, currentStats.adsBlocked);
            animateNumber(elements.trackerCount, currentStats.trackersBlocked);
        }
        if (changes.protectionEnabled) {
            protectionEnabled = changes.protectionEnabled.newValue !== false;
            renderState({ protectionEnabled, stats: currentStats });
        }
    });

    void initialize();
})();
