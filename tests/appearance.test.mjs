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
            motion: 'reduced'
        })),
        {
            theme: 'dark',
            accent: '#3366FF',
            contrast: 'high',
            density: 'compact',
            motion: 'reduced'
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

test('converte cores e calcula contraste WCAG', () => {
    assert.deepEqual(
        structuredClone(appearance.rgbFromHex('#111111')),
        [17, 17, 17]
    );
    assert.equal(appearance.contrastRatio([0, 0, 0], [255, 255, 255]), 21);
    assert.ok(appearance.contrastRatio([17, 17, 17], [255, 255, 255]) >= 4.5);
});
