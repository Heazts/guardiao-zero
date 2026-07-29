'use strict';

(() => {
    const platform = globalThis.GuardiaoPlatform;
    if (!platform?.isAvailable) return;

    function parameters() {
        const query = new URLSearchParams(location.search);
        return {
            url: query.get('url') || '',
            reason: query.get('reason') || '',
            score: query.get('score') || ''
        };
    }

    function safeHttpUrl(value) {
        try {
            const parsed = new URL(value);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
        } catch {
            return '';
        }
    }

    function displayHostname(value) {
        try {
            return new URL(value).hostname;
        } catch {
            return 'Destino inválido';
        }
    }

    function initialize() {
        const blocked = parameters();
        const url = safeHttpUrl(blocked.url);
        document.getElementById('blocked-url').textContent = displayHostname(url);
        if (blocked.reason) {
            document.getElementById('blocked-reason').textContent = blocked.reason;
        }

        const numericScore = Number(blocked.score);
        if (Number.isFinite(numericScore) && numericScore > 0) {
            const score = document.getElementById('blocked-score');
            score.hidden = false;
            document.getElementById('blocked-score-value').textContent = Math.trunc(numericScore);
        }

        document.getElementById('btn-back').addEventListener('click', () => {
            if (history.length > 2) history.go(-2);
            else window.close();
        });

        const allowButton = document.getElementById('btn-allow');
        if (!url) {
            allowButton.disabled = true;
            return;
        }
        allowButton.addEventListener('click', async () => {
            allowButton.disabled = true;
            document.getElementById('allow-label').textContent = 'Aplicando liberação…';
            const feedback = document.getElementById('blocked-feedback');
            feedback.hidden = true;
            try {
                const response = await platform.sendMessage('allowTemporary', {
                    url,
                    duration: 5 * 60 * 1000
                });
                if (!response?.ok) throw new Error(response?.error || 'Liberação recusada');
                location.replace(url);
            } catch {
                allowButton.disabled = false;
                document.getElementById('allow-label').textContent = 'Liberar este domínio por 5 minutos';
                feedback.textContent = 'Não foi possível aplicar a liberação. Tente novamente.';
                feedback.hidden = false;
            }
        });
    }

    initialize();
})();
