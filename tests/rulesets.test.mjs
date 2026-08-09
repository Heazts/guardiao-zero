import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildAllRulesets, rulesetsAreCurrent } from '../tools/build-rules.mjs';

/**
 * Propriedades de segurança dos rulesets estáticos.
 *
 * Um bloqueador agressivo demais também é um bloqueador ruim: estas asserções
 * são a trava contra regras que quebrariam navegação, login, pagamento ou
 * CAPTCHA. Elas valem para o JSON gerado, que é o que de fato é embarcado.
 */

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function loadRuleset(name) {
    return JSON.parse(
        await readFile(resolve(projectRoot, 'src', 'background', 'rules', `${name}.json`), 'utf8')
    );
}

const RULESETS = ['ads', 'trackers'];

/**
 * Domínios cujo bloqueio quebraria função de site. Nenhuma regra pode casar
 * com eles, nem exatamente nem como sufixo de domínio.
 */
const MUST_NOT_BLOCK = Object.freeze([
    'google.com',
    'gstatic.com',
    'googleapis.com',
    'recaptcha.net',
    'hcaptcha.com',
    'cloudflare.com',
    'stripe.com',
    'paypal.com',
    'jsdelivr.net',
    'unpkg.com',
    'accounts.google.com',
    'connect.facebook.net',
    'github.com'
]);

function domainFromFilter(urlFilter) {
    const match = urlFilter.match(/^\|\|([^/^*|]+)/);
    return match ? match[1].toLowerCase() : '';
}

for (const name of RULESETS) {
    test(`${name}: nenhuma regra bloqueia navegação de nível superior`, async () => {
        const rules = await loadRuleset(name);
        const offenders = rules
            .filter(rule => rule.condition.resourceTypes.includes('main_frame'))
            .map(rule => rule.condition.urlFilter);

        assert.deepEqual(
            offenders,
            [],
            'main_frame bloqueado quebraria click-through e navegação iniciada pelo usuário'
        );
    });

    test(`${name}: nenhuma regra atinge infraestrutura funcional de sites`, async () => {
        const rules = await loadRuleset(name);
        const offenders = [];

        for (const rule of rules) {
            const domain = domainFromFilter(rule.condition.urlFilter);
            if (!domain) continue;
            for (const protectedDomain of MUST_NOT_BLOCK) {
                // `||X^` cobre X e todos os seus subdomínios. O risco existe
                // quando a regra é o domínio protegido ou um ancestral dele.
                // Um subdomínio publicitário específico — adservice.google.com,
                // imasdk.googleapis.com — não alcança o pai e é seguro.
                const coversProtected = protectedDomain === domain
                    || protectedDomain.endsWith(`.${domain}`);
                if (coversProtected) {
                    offenders.push(`${rule.condition.urlFilter} cobriria ${protectedDomain}`);
                }
            }
        }

        assert.deepEqual(offenders, [], 'regra atinge domínio necessário ao funcionamento de sites');
    });

    test(`${name}: toda regra é block, com id único e urlFilter válido`, async () => {
        const rules = await loadRuleset(name);
        const ids = new Set();

        assert.ok(rules.length > 0, 'ruleset não pode estar vazio');
        for (const rule of rules) {
            assert.equal(rule.action.type, 'block');
            assert.ok(Number.isInteger(rule.id) && rule.id > 0, `id inválido: ${rule.id}`);
            assert.equal(ids.has(rule.id), false, `id duplicado: ${rule.id}`);
            ids.add(rule.id);
            assert.equal(typeof rule.condition.urlFilter, 'string');
            assert.ok(rule.condition.urlFilter.length > 0);
            assert.ok(
                rule.condition.resourceTypes.length > 0,
                'regra sem resourceTypes nunca casaria'
            );
        }
    });
}

test('o JSON embarcado corresponde exatamente às seed lists', async () => {
    const status = await rulesetsAreCurrent();
    assert.deepEqual(
        status.drift.length === 0 ? [] : status.drift.map(String),
        [],
        'rode npm run build:rules após editar src/filters/sources/'
    );
});

test('as seed lists não produzem recusas silenciosas', async () => {
    for (const result of await buildAllRulesets()) {
        assert.deepEqual(
            result.rejections.length === 0 ? [] : result.rejections.map(String),
            [],
            `${result.label}: linha recusada pelo parser deve ser corrigida, não ignorada`
        );
    }
});

test('a cobertura embarcada não regride abaixo do patamar atual', async () => {
    // Guarda contra apagar cobertura sem perceber. Ajuste conscientemente ao
    // reduzir uma lista de propósito.
    const ads = await loadRuleset('ads');
    const trackers = await loadRuleset('trackers');

    assert.ok(ads.length >= 190, `ads.json caiu para ${ads.length} regras`);
    assert.ok(trackers.length >= 120, `trackers.json caiu para ${trackers.length} regras`);
});
