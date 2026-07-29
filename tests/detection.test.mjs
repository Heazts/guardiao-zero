import assert from 'node:assert/strict';
import test from 'node:test';

import { loadRuntime, baseSignals } from './runtime-loader.mjs';
import { gamblingScenarios, generatedScenarios, safeScenarios } from './scenarios.mjs';

const runtime = await loadRuntime([
    'src/shared/detection/constants.js',
    'src/shared/detection/detection-engine.js'
]);
const detector = runtime.GuardiaoDetection;

test('domínios protegidos e termos ambíguos são permitidos', () => {
    for (const scenario of safeScenarios) {
        const result = detector.analyze(scenario, { threshold: 120 });
        assert.equal(result.verdict, 'allow', `${scenario.url} teve score ${result.score}`);
    }
});

test('plataformas com sinais independentes são bloqueadas', () => {
    for (const scenario of gamblingScenarios) {
        const systemMatch = scenario.url.includes('bet365.com') ? 'bet365.com' : '';
        const result = detector.analyze(scenario, { threshold: 120, systemBlockMatch: systemMatch });
        assert.equal(result.verdict, 'block', `${scenario.url} teve score ${result.score}`);
        assert.equal(result.safeguards.diverseEvidence, true);
    }
});

test('nenhum fator automático isolado bloqueia', () => {
    const cases = [
        {
            signals: baseSignals('https://unknown.example/'),
            options: { threshold: 120, systemBlockMatch: 'unknown.example' }
        },
        {
            signals: baseSignals('https://unknown.example/', {
                scripts: ['https://cdn.pragmaticplay.com/client.js']
            }),
            options: { threshold: 120 }
        },
        {
            signals: baseSignals('https://unknown.example/', {
                title: 'Cassino ao vivo'
            }),
            options: { threshold: 120 }
        },
        {
            signals: baseSignals('https://unknown.example/', {
                buttons: ['Aposte agora']
            }),
            options: { threshold: 120 }
        }
    ];

    for (const item of cases) {
        assert.notEqual(detector.analyze(item.signals, item.options).verdict, 'block');
    }
});

test('simulação em massa mantém zero falsos positivos no corpus', () => {
    const generated = generatedScenarios();
    let falsePositives = 0;
    let falseNegatives = 0;

    for (const scenario of generated.safe) {
        if (detector.analyze(scenario, { threshold: 120 }).verdict === 'block') falsePositives += 1;
    }
    for (const scenario of generated.gambling) {
        if (detector.analyze(scenario, { threshold: 120 }).verdict !== 'block') falseNegatives += 1;
    }

    assert.equal(falsePositives, 0);
    assert.equal(falseNegatives, 0);
});

test('limiar é configurável e limitado a uma faixa segura', () => {
    const signals = gamblingScenarios[1];
    assert.equal(detector.analyze(signals, { threshold: 1 }).threshold, 100);
    assert.equal(detector.analyze(signals, { threshold: 999 }).threshold, 180);
});
