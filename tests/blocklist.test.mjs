import assert from 'node:assert/strict';
import test from 'node:test';

import { loadRuntime } from './runtime-loader.mjs';

const runtime = await loadRuntime([
    'src/background/verified-betting-domains.js',
    'src/background/blocklist-index.js'
]);
const index = runtime.GuardiaoBlocklistIndex;

test('índice delega apenas para a política verificada empacotada', async () => {
    const loaded = await index.load();
    assert.equal(loaded.loaded, true);
    assert.equal(index.findDomain('bet365.com'), 'bet365.com');
    assert.equal(index.findDomain('www.bet365.com'), 'bet365.com');
    assert.equal(index.findDomain('operador.bet.br'), 'bet.br');
    assert.equal(index.findDomain('bet.br'), 'bet.br');
    assert.equal(index.findDomain('alphabet.com'), '');
});

test('diagnóstico expõe proveniência e representação auditável', () => {
    const status = index.status();
    assert.equal(status.loaded, true);
    assert.ok(status.count > 0);
    assert.equal(status.representation, 'project-maintained-static-policy');
    assert.equal(status.provenance.license, 'MIT');
    assert.match(status.provenance.method, /Curadoria manual/);
});

test('utilitários puros da API anterior permanecem compatíveis', () => {
    const sorted = 'alpha.example\nbet365.com\nzulu.example\n';
    assert.equal(index.containsSortedDomain(sorted, 'alpha.example'), true);
    assert.equal(index.containsSortedDomain(sorted, 'bet365.com'), true);
    assert.equal(index.containsSortedDomain(sorted, 'alphabet.com'), false);
    assert.equal(index.countLines(sorted), 3);
});
