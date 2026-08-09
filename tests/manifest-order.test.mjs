import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

test('Firefox carrega a política verificada antes do índice e do background', () => {
    const scripts = manifest.background?.scripts || [];
    const policy = scripts.indexOf('src/background/verified-betting-domains.js');
    const index = scripts.indexOf('src/background/blocklist-index.js');
    const worker = scripts.indexOf('src/background/service-worker.js');

    assert.ok(policy >= 0, 'política verificada ausente em background.scripts');
    assert.ok(policy < index, 'política deve carregar antes do índice');
    assert.ok(index < worker, 'índice deve carregar antes do service worker');
});

test('Chromium mantém o fallback importScripts para a mesma política', async () => {
    const worker = await readFile(
        new URL('../src/background/service-worker.js', import.meta.url),
        'utf8'
    );
    assert.match(worker, /importScripts\([\s\S]*verified-betting-domains\.js[\s\S]*blocklist-index\.js/);
});
