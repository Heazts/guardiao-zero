'use strict';

/**
 * Sistema de aparência compartilhado pelas páginas da extensão.
 *
 * A configuração é validada em duas fronteiras: aqui, para aplicação visual
 * imediata, e novamente no background antes de ser persistida. Nenhum valor é
 * enviado para fora do navegador.
 */
globalThis.GuardiaoAppearance = globalThis.GuardiaoAppearance || (() => {
    const DEFAULT_APPEARANCE = Object.freeze({
        theme: 'system',
        accent: '#111111',
        contrast: 'normal',
        density: 'comfortable',
        motion: 'system'
    });
    const OPTIONS = Object.freeze({
        theme: new Set(['system', 'light', 'dark']),
        contrast: new Set(['normal', 'high']),
        density: new Set(['comfortable', 'compact']),
        motion: new Set(['system', 'reduced'])
    });
    const HEX_COLOR = /^#[0-9a-f]{6}$/i;

    function normalize(value) {
        const source = value && typeof value === 'object' && !Array.isArray(value)
            ? value
            : {};
        return {
            theme: OPTIONS.theme.has(source.theme) ? source.theme : DEFAULT_APPEARANCE.theme,
            accent: HEX_COLOR.test(source.accent || '')
                ? source.accent.toUpperCase()
                : DEFAULT_APPEARANCE.accent,
            contrast: OPTIONS.contrast.has(source.contrast)
                ? source.contrast
                : DEFAULT_APPEARANCE.contrast,
            density: OPTIONS.density.has(source.density)
                ? source.density
                : DEFAULT_APPEARANCE.density,
            motion: OPTIONS.motion.has(source.motion)
                ? source.motion
                : DEFAULT_APPEARANCE.motion
        };
    }

    function rgbFromHex(hex) {
        return [
            Number.parseInt(hex.slice(1, 3), 16),
            Number.parseInt(hex.slice(3, 5), 16),
            Number.parseInt(hex.slice(5, 7), 16)
        ];
    }

    function channelLuminance(channel) {
        const value = channel / 255;
        return value <= 0.04045
            ? value / 12.92
            : Math.pow((value + 0.055) / 1.055, 2.4);
    }

    function luminance(rgb) {
        return (
            channelLuminance(rgb[0]) * 0.2126
            + channelLuminance(rgb[1]) * 0.7152
            + channelLuminance(rgb[2]) * 0.0722
        );
    }

    function contrastRatio(left, right) {
        const lighter = Math.max(luminance(left), luminance(right));
        const darker = Math.min(luminance(left), luminance(right));
        return (lighter + 0.05) / (darker + 0.05);
    }

    function mix(left, right, amount) {
        return left.map((channel, index) =>
            Math.round(channel + (right[index] - channel) * amount)
        );
    }

    function rgbCss(rgb) {
        return `rgb(${rgb.join(' ')})`;
    }

    function readableAccent(accent, background) {
        if (contrastRatio(accent, background) >= 4.5) return accent;
        const target = luminance(background) > 0.5 ? [0, 0, 0] : [255, 255, 255];
        for (let step = 1; step <= 20; step += 1) {
            const candidate = mix(accent, target, step / 20);
            if (contrastRatio(candidate, background) >= 4.5) return candidate;
        }
        return target;
    }

    function apply(value, root = globalThis.document?.documentElement) {
        const appearance = normalize(value);
        if (!root) return appearance;

        const accent = rgbFromHex(appearance.accent);
        const accentForeground = contrastRatio(accent, [255, 255, 255]) >= 4.5
            ? [255, 255, 255]
            : [10, 10, 10];

        root.dataset.theme = appearance.theme;
        root.dataset.contrast = appearance.contrast;
        root.dataset.density = appearance.density;
        root.dataset.motion = appearance.motion;
        root.style.setProperty('--accent', rgbCss(accent));
        root.style.setProperty('--accent-rgb', accent.join(' '));
        root.style.setProperty('--accent-foreground', rgbCss(accentForeground));
        root.style.setProperty('--accent-on-light', rgbCss(readableAccent(accent, [255, 255, 255])));
        root.style.setProperty('--accent-on-dark', rgbCss(readableAccent(accent, [10, 10, 10])));
        root.style.colorScheme = appearance.theme === 'system'
            ? 'light dark'
            : appearance.theme;
        root.classList.remove('appearance-pending');
        root.dispatchEvent(new CustomEvent('guardiao:appearance', {
            detail: appearance
        }));
        return appearance;
    }

    async function load() {
        const api = globalThis.browser || globalThis.chrome;
        if (!api?.storage?.local) return apply(DEFAULT_APPEARANCE);
        try {
            const stored = await api.storage.local.get('appearance');
            return apply(stored.appearance);
        } catch {
            return apply(DEFAULT_APPEARANCE);
        }
    }

    if (globalThis.document) {
        apply(DEFAULT_APPEARANCE);
        void load();
        const api = globalThis.browser || globalThis.chrome;
        api?.storage?.onChanged?.addListener((changes, area) => {
            if (area === 'local' && changes.appearance) {
                apply(changes.appearance.newValue);
            }
        });
    }

    return Object.freeze({
        DEFAULT_APPEARANCE,
        normalize,
        apply,
        load,
        rgbFromHex,
        contrastRatio
    });
})();
