import assert from 'node:assert/strict';
import test from 'node:test';

import { loadRuntime, baseSignals } from './runtime-loader.mjs';

const runtime = await loadRuntime([
    'src/shared/appearance.js',
    'src/shared/detection/constants.js',
    'src/shared/lists/list-matcher.js',
    'src/shared/filters/filter-list-parser.js',
    'src/shared/messaging/message-schema.js'
]);
const messages = runtime.GuardiaoMessages;

test('mensagens desconhecidas e configurações inválidas são recusadas', () => {
    assert.equal(messages.parse({ type: 'executeArbitraryCode' }).ok, false);
    assert.equal(messages.parse({
        type: 'updateSettings',
        payload: { settings: { detectionThreshold: 'baixo' } }
    }).ok, false);
});

test('sinais são truncados novamente na fronteira do background', () => {
    const signals = baseSignals('https://example.com/', {
        title: 'x'.repeat(2000),
        text: 'y'.repeat(50000),
        buttons: Array.from({ length: 200 }, (_, index) => `Button ${index}`)
    });
    const parsed = messages.parse({ type: 'analyzePage', payload: signals });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.payload.title.length, 300);
    assert.equal(parsed.payload.text.length, 14000);
    assert.equal(parsed.payload.buttons.length, 60);
});

test('duração temporária e limiar são limitados', () => {
    const allowance = messages.parse({
        type: 'allowTemporary',
        payload: { url: 'https://example.com/', duration: 999999999 }
    });
    assert.equal(allowance.payload.duration, 30 * 60 * 1000);

    const settings = messages.parse({
        type: 'updateSettings',
        payload: { settings: { detectionThreshold: -10 } }
    });
    assert.equal(settings.payload.settings.detectionThreshold, 100);
});

test('aparência e listas importadas são validadas na fronteira', () => {
    const appearance = messages.parse({
        type: 'updateAppearance',
        payload: {
            appearance: {
                theme: 'dark',
                accent: '#3366FF',
                contrast: 'high',
                density: 'compact',
                motion: 'reduced'
            }
        }
    });
    assert.equal(appearance.ok, true);
    assert.equal(appearance.payload.appearance.accent, '#3366FF');

    const invalidAppearance = messages.parse({
        type: 'updateAppearance',
        payload: { appearance: { theme: '<script>' } }
    });
    assert.equal(invalidAppearance.ok, false);

    const filter = messages.parse({
        type: 'importFilterList',
        payload: {
            name: 'EasyPrivacy.txt',
            category: 'privacy',
            text: '||tracker.example^'
        }
    });
    assert.equal(filter.ok, true);
    assert.equal(filter.payload.name, 'EasyPrivacy.txt');

    assert.equal(messages.parse({
        type: 'importFilterList',
        payload: { name: 'x.txt', category: 'unknown', text: '||x.example^' }
    }).ok, false);
});
