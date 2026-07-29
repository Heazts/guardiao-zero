import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadRuntime } from './runtime-loader.mjs';

const runtime = await loadRuntime(['src/background/blocklist-index.js']);
const index = runtime.GuardiaoBlocklistIndex;
const blocklistText = await readFile(
    new URL('../src/filters/heazts-blocklist.txt', import.meta.url),
    'utf8'
);

test('busca binária encontra início, meio e fim da lista', () => {
    assert.equal(index.containsSortedDomain(blocklistText, '000000.com'), true);
    assert.equal(index.containsSortedDomain(blocklistText, 'bet365.com'), true);
    assert.equal(index.containsSortedDomain(blocklistText, 'zzzzgame.com'), true);
    assert.equal(index.containsSortedDomain(blocklistText, 'alphabet.com'), false);
});

test('contagem do índice corresponde à lista auditada', () => {
    assert.equal(index.countLines(blocklistText), 272868);
});
