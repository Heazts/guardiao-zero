import assert from 'node:assert/strict';
import test from 'node:test';

import { baseSignals, loadRuntime } from './runtime-loader.mjs';

async function loadSignals() {
    const context = await loadRuntime([
        'src/shared/detection/constants.js',
        'src/content/page-signals.js'
    ]);
    context.location = {
        href: 'https://pagina.example/area?session=segredo#saldo',
        hostname: 'pagina.example'
    };
    return context.GuardiaoSignals;
}

test('URLs auxiliares removem credenciais, query e fragmento', async () => {
    const signals = await loadSignals();

    assert.equal(
        signals.minimizeUrl(
            'https://usuario:senha@cdn.example/sportsbook-api/client.js?token=secreto#estado',
            'https://pagina.example/'
        ),
        'https://cdn.example/sportsbook-api/client.js'
    );
    assert.equal(
        signals.minimizeUrl('/betslip/confirmar?cpf=123#etapa', 'https://pagina.example/conta'),
        'https://pagina.example/betslip/confirmar'
    );
    assert.equal(signals.minimizeUrl('data:text/plain,segredo', 'https://pagina.example/'), '');
});

test('somente nomes de storage ligados a apostas atravessam a análise interna', async () => {
    const signals = await loadSignals();

    assert.deepEqual(
        Array.from(signals.relevantStorageKeys([
            'session_token',
            'customer_email',
            'casino_betslip',
            'live_odds',
            'sportsbook-state'
        ])),
        ['casino_betslip', 'live_odds', 'sportsbook-state']
    );
});

test('filtro de integrações preserva provedor e caminho relevantes', async () => {
    const signals = await loadSignals();

    assert.equal(signals.integrationUrlIsRelevant('https://cdn.example/betting-api/live?token=x'), true);
    assert.equal(signals.integrationUrlIsRelevant('https://client.pragmaticplay.com/runtime.js?uid=x'), true);
    assert.equal(signals.integrationUrlIsRelevant('https://cdn.example/app.js?uid=x'), false);
});

test('fingerprint muda com texto além de 500 caracteres e sinais estruturais', async () => {
    const signals = await loadSignals();
    const original = baseSignals('https://pagina.example/app', {
        text: `${'conteudo '.repeat(80)}fim-a`,
        menus: ['Início'],
        buttons: ['Entrar'],
        forms: [{ action: '/conta', text: 'Conta', fields: ['email'] }],
        links: [{ url: '/inicio', text: 'Início', external: false }],
        resources: [{ url: 'https://cdn.example/app.js', type: 'script' }]
    });
    const baseline = signals.signalFingerprint(original);

    const changes = [
        { text: `${'conteudo '.repeat(80)}fim-b` },
        { menus: ['Sportsbook'] },
        { buttons: ['Aposte agora'] },
        { forms: [{ action: '/betslip', text: 'Aposta', fields: ['stake', 'odds'] }] },
        { links: [{ url: '/casino', text: 'Casino', external: false }] },
        { resources: [{ url: 'https://cdn.example/live-odds/feed', type: 'fetch' }] }
    ];

    for (const change of changes) {
        assert.notEqual(
            signals.signalFingerprint({ ...original, ...change }),
            baseline,
            `mudança em ${Object.keys(change)[0]} precisa invalidar a deduplicação`
        );
    }
});
