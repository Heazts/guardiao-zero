import assert from 'node:assert/strict';
import test from 'node:test';

import { loadRuntime } from './runtime-loader.mjs';

const runtime = await loadRuntime(['src/background/verified-betting-domains.js']);
const policy = runtime.GuardiaoVerifiedBettingDomains;

test('política verificada é pequena, ordenada e imutável', () => {
    const domains = Array.from(policy.domains);
    assert.ok(domains.length >= 10 && domains.length <= 100);
    assert.deepEqual(domains, [...domains].sort());
    assert.equal(new Set(domains).size, domains.length);
    assert.equal(Object.isFrozen(policy), true);
    assert.equal(Object.isFrozen(policy.domains), true);
    assert.equal(Object.isFrozen(policy.suffixes), true);
    assert.equal(policy.provenance.license, 'MIT');
    assert.match(policy.provenance.policySource, /^https:\/\/www\.gov\.br\/fazenda\//);
});

test('encontra domínios mantidos, subdomínios e a política bet.br', () => {
    assert.equal(policy.findDomain('bet365.com'), 'bet365.com');
    assert.equal(policy.findDomain('WWW.BET365.COM.'), 'bet365.com');
    assert.equal(policy.findDomain('operadora.bet.br'), 'bet.br');
    assert.equal(policy.findDomain('login.operadora.bet.br'), 'bet.br');
});

test('não transforma termos parecidos em falsos positivos', () => {
    assert.equal(policy.findDomain('alphabet.com'), '');
    assert.equal(policy.findDomain('bet.br.example.com'), '');
    assert.equal(policy.findDomain('notbet.br'), '');
    assert.equal(policy.findDomain('https://bet365.com/'), '');
});
