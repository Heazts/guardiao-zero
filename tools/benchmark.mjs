import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import { loadRuntime } from '../tests/runtime-loader.mjs';
import { gamblingScenarios, generatedScenarios, safeScenarios } from '../tests/scenarios.mjs';

const runtime = await loadRuntime([
    'src/shared/detection/constants.js',
    'src/shared/detection/detection-engine.js',
    'src/background/blocklist-index.js'
]);
const detector = runtime.GuardiaoDetection;
const blocklistIndex = runtime.GuardiaoBlocklistIndex;

function legacyNormalize(text) {
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function legacyClassifier(rawText, sensitivity = 0.75) {
    const vocabulary = {
        aposta: 2,
        apostas: 2,
        bet: 2.5,
        bets: 2.5,
        cassino: 3,
        casino: 3,
        roleta: 2.2,
        poker: 2,
        blackjack: 2,
        bingo: 1.8,
        jackpot: 2.5,
        odd: 1.5,
        odds: 1.5,
        crash: 1.8,
        mines: 1.5,
        aviator: 2,
        tigrinho: 2.5
    };
    const ngrams = [
        'bonus de boas vindas',
        'aposte agora',
        'bônus de depósito',
        'depósito mínimo',
        'saque rápido',
        'jogue agora',
        'giros grátis',
        'multiplicador',
        'jogo responsável'
    ];
    const negative = [
        'notícia',
        'reportagem',
        'artigo',
        'jornal',
        'polícia',
        'governo',
        'projeto de lei',
        'regulamentação',
        'ministério da fazenda',
        'cpi das apostas',
        'economia',
        'investigação'
    ];
    const text = legacyNormalize(rawText || '');
    const currentThreshold = negative.some(item => text.includes(legacyNormalize(item)))
        ? sensitivity * 3
        : sensitivity;
    let score = 0;
    let matchedNgrams = 0;
    for (const ngram of ngrams) {
        if (text.includes(legacyNormalize(ngram))) {
            score += 5;
            matchedNgrams += 1;
        }
    }
    const tokens = text.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(word => word.length > 2);
    if (tokens.length < 10) return false;
    let matchedKeywords = 0;
    for (const token of tokens) {
        if (Object.hasOwn(vocabulary, token)) {
            score += vocabulary[token];
            matchedKeywords += 1;
        }
    }
    const normalizedScore = score / (tokens.length * 0.1);
    return normalizedScore > currentThreshold && (matchedKeywords >= 3 || matchedNgrams >= 1);
}

function legacyDecision(signals, systemMatch = false) {
    if (systemMatch) return true;
    const iframeHits = signals.iframes.filter(url =>
        ['slots', 'casino', 'bet', 'games'].some(term => url.toLowerCase().includes(term))
    ).length;
    return legacyClassifier(signals.text) || iframeHits >= 2;
}

function classificationMetrics(safe, gambling) {
    const result = {
        before: { truePositive: 0, falseNegative: 0, trueNegative: 0, falsePositive: 0 },
        after: { truePositive: 0, falseNegative: 0, trueNegative: 0, falsePositive: 0 }
    };
    for (const scenario of safe) {
        const legacyBlocked = legacyDecision(scenario, false);
        const newBlocked = detector.analyze(scenario, { threshold: 120 }).verdict === 'block';
        result.before[legacyBlocked ? 'falsePositive' : 'trueNegative'] += 1;
        result.after[newBlocked ? 'falsePositive' : 'trueNegative'] += 1;
    }
    for (const scenario of gambling) {
        const systemMatch = scenario.url.includes('bet365.com');
        const legacyBlocked = legacyDecision(scenario, systemMatch);
        const newBlocked = detector.analyze(scenario, {
            threshold: 120,
            systemBlockMatch: systemMatch ? 'bet365.com' : ''
        }).verdict === 'block';
        result.before[legacyBlocked ? 'truePositive' : 'falseNegative'] += 1;
        result.after[newBlocked ? 'truePositive' : 'falseNegative'] += 1;
    }
    return result;
}

function timeClassifiers(scenarios, iterations = 20) {
    let startedAt = performance.now();
    for (let iteration = 0; iteration < iterations; iteration += 1) {
        for (const scenario of scenarios) legacyDecision(scenario, false);
    }
    const legacyMs = performance.now() - startedAt;

    startedAt = performance.now();
    for (let iteration = 0; iteration < iterations; iteration += 1) {
        for (const scenario of scenarios) detector.analyze(scenario, { threshold: 120 });
    }
    const multifactorMs = performance.now() - startedAt;
    const operations = iterations * scenarios.length;
    return {
        operations,
        legacyTotalMs: Number(legacyMs.toFixed(2)),
        multifactorTotalMs: Number(multifactorMs.toFixed(2)),
        legacyMeanMs: Number((legacyMs / operations).toFixed(4)),
        multifactorMeanMs: Number((multifactorMs / operations).toFixed(4))
    };
}

async function measureBlocklist() {
    const text = await readFile(
        new URL('../src/filters/heazts-blocklist.txt', import.meta.url),
        'utf8'
    );
    global.gc?.();
    const beforeSet = process.memoryUsage().heapUsed;
    const set = new Set(text.trimEnd().split('\n'));
    global.gc?.();
    const afterSet = process.memoryUsage().heapUsed;

    const probes = ['bet365.com', 'alphabet.com', 'zzzzgame.com', '000000.com'];
    let startedAt = performance.now();
    for (let iteration = 0; iteration < 2500; iteration += 1) {
        for (const probe of probes) set.has(probe);
    }
    const setLookupMs = performance.now() - startedAt;

    startedAt = performance.now();
    for (let iteration = 0; iteration < 2500; iteration += 1) {
        for (const probe of probes) blocklistIndex.containsSortedDomain(text, probe);
    }
    const binaryLookupMs = performance.now() - startedAt;

    return {
        domains: set.size,
        compactTextUtf8Bytes: Buffer.byteLength(text),
        observedSetHeapDeltaBytes: Math.max(0, afterSet - beforeSet),
        setLookup10kMs: Number(setLookupMs.toFixed(2)),
        binaryLookup10kMs: Number(binaryLookupMs.toFixed(2))
    };
}

const generated = generatedScenarios();
const safe = [...safeScenarios, ...generated.safe];
const gambling = [...gamblingScenarios, ...generated.gambling];
const scenarios = [...safe, ...gambling];
const report = {
    corpus: {
        total: scenarios.length,
        safe: safe.length,
        gambling: gambling.length
    },
    accuracy: classificationMetrics(safe, gambling),
    classifierPerformance: timeClassifiers(scenarios),
    blocklist: await measureBlocklist()
};

console.log(JSON.stringify(report, null, 2));
