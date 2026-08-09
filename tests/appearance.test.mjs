import assert from 'node:assert/strict';
import test from 'node:test';

import { loadRuntime } from './runtime-loader.mjs';

const runtime = await loadRuntime(['src/shared/appearance.js']);
const appearance = runtime.GuardiaoAppearance;

test('normaliza preferências válidas e mantém defaults seguros', () => {
    assert.deepEqual(
        structuredClone(appearance.normalize({
            theme: 'dark',
            accent: '#3366ff',
            contrast: 'high',
            density: 'compact',
            motion: 'reduced',
            language: 'ja'
        })),
        {
            theme: 'dark',
            accent: '#3366FF',
            contrast: 'high',
            density: 'compact',
            motion: 'reduced',
            // Idioma fora dos doze publicados cai no automático em vez de
            // virar um código que nenhum catálogo atende.
            language: 'auto'
        }
    );
    assert.deepEqual(
        structuredClone(appearance.normalize({
            theme: '<script>',
            accent: 'red'
        })),
        structuredClone(appearance.DEFAULT_APPEARANCE)
    );
});

test('cada idioma publicado sobrevive à normalização', async () => {
    const { GuardiaoI18n } = await loadRuntime(['src/shared/i18n.js']);
    for (const locale of GuardiaoI18n.LOCALES) {
        assert.equal(
            appearance.normalize({ language: locale.code }).language,
            locale.code,
            `${locale.code} deveria ser aceito pela normalização`
        );
    }
    assert.equal(appearance.normalize({ language: 'auto' }).language, 'auto');
});

test('o registro de idiomas e o catálogo cobrem os mesmos códigos', async () => {
    const { readdir } = await import('node:fs/promises');
    const { GuardiaoI18n } = await loadRuntime(['src/shared/i18n.js']);
    const folders = new Set(
        await readdir(new URL('../_locales', import.meta.url))
    );
    for (const locale of GuardiaoI18n.LOCALES) {
        assert.ok(folders.has(locale.code), `_locales/${locale.code} ausente`);
    }
    assert.equal(folders.size, GuardiaoI18n.LOCALES.length);
    assert.ok(
        GuardiaoI18n.LOCALES.some(locale => locale.code === GuardiaoI18n.SOURCE_LOCALE),
        'o idioma de origem precisa estar no registro'
    );
});

test('converte cores e calcula contraste WCAG', () => {
    assert.deepEqual(
        structuredClone(appearance.rgbFromHex('#111111')),
        [17, 17, 17]
    );
    assert.equal(appearance.contrastRatio([0, 0, 0], [255, 255, 255]), 21);
    assert.ok(appearance.contrastRatio([17, 17, 17], [255, 255, 255]) >= 4.5);
});
