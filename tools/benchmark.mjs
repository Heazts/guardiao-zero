import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import { loadRuntime } from '../tests/runtime-loader.mjs';
import { gamblingScenarios, generatedScenarios, safeScenarios } from '../tests/scenarios.mjs';

const runtime = await loadRuntime([
    'src/shared/detection/constants.js',
    'src/shared/detection/detection-engine.js',
    'src/background/verified-betting-domains.js'
]);
const detector = runtime.GuardiaoDetection;
const bettingPolicy = runtime.GuardiaoVerifiedBettingDomains;
const REPORT_URL = new URL('../docs/reports/benchmark-results.json', import.meta.url);
let benchmarkSink = 0;

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
        let systemMatch = false;
        try {
            const { hostname } = new URL(scenario.url);
            const normalizedHost = hostname.toLowerCase();
            systemMatch = normalizedHost === 'bet365.com' || normalizedHost.endsWith('.bet365.com');
        } catch {
            systemMatch = false;
        }
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

function percentage(part, total) {
    return total === 0 ? 0 : Number(((part / total) * 100).toFixed(2));
}

function derivedAccuracy(confusionMatrix) {
    const total = Object.values(confusionMatrix).reduce((sum, value) => sum + value, 0);
    return percentage(
        confusionMatrix.truePositive + confusionMatrix.trueNegative,
        total
    );
}

function median(values) {
    const ordered = [...values].sort((left, right) => left - right);
    const midpoint = Math.floor(ordered.length / 2);
    return ordered.length % 2 === 0
        ? (ordered[midpoint - 1] + ordered[midpoint]) / 2
        : ordered[midpoint];
}

function measure(callback) {
    const startedAt = performance.now();
    const result = callback();
    const elapsed = performance.now() - startedAt;
    benchmarkSink = (benchmarkSink + Number(result || 0)) % 2147483647;
    return elapsed;
}

function timeClassifiers(scenarios, iterations = 20, repetitions = 5) {
    const runLegacy = () => {
        let blocked = 0;
        for (let iteration = 0; iteration < iterations; iteration += 1) {
            for (const scenario of scenarios) {
                if (legacyDecision(scenario, false)) blocked += 1;
            }
        }
        return blocked;
    };
    const runMultifactor = () => {
        let blocked = 0;
        for (let iteration = 0; iteration < iterations; iteration += 1) {
            for (const scenario of scenarios) {
                if (detector.analyze(scenario, { threshold: 120 }).verdict === 'block') {
                    blocked += 1;
                }
            }
        }
        return blocked;
    };

    for (let warmup = 0; warmup < 2; warmup += 1) {
        for (const scenario of scenarios) {
            if (legacyDecision(scenario, false)) benchmarkSink += 1;
            if (detector.analyze(scenario, { threshold: 120 }).verdict === 'block') {
                benchmarkSink += 1;
            }
        }
    }

    const legacySamples = [];
    const multifactorSamples = [];
    for (let sample = 0; sample < repetitions; sample += 1) {
        if (sample % 2 === 0) {
            legacySamples.push(measure(runLegacy));
            multifactorSamples.push(measure(runMultifactor));
        } else {
            multifactorSamples.push(measure(runMultifactor));
            legacySamples.push(measure(runLegacy));
        }
    }

    const legacyMs = median(legacySamples);
    const multifactorMs = median(multifactorSamples);
    const operations = iterations * scenarios.length;
    return {
        operations,
        repetitions,
        legacyTotalMs: Number(legacyMs.toFixed(2)),
        multifactorTotalMs: Number(multifactorMs.toFixed(2)),
        legacyMeanMs: Number((legacyMs / operations).toFixed(4)),
        multifactorMeanMs: Number((multifactorMs / operations).toFixed(4)),
        legacySamplesMs: legacySamples.map(value => Number(value.toFixed(2))),
        multifactorSamplesMs: multifactorSamples.map(value => Number(value.toFixed(2)))
    };
}

function measureBlocklist() {
    const compactPolicy = `${bettingPolicy.domains.join('\n')}\n${bettingPolicy.suffixes.join('\n')}\n`;
    global.gc?.();
    const beforeSet = process.memoryUsage().heapUsed;
    const set = new Set(bettingPolicy.domains);
    global.gc?.();
    const afterSet = process.memoryUsage().heapUsed;

    const probes = ['bet365.com', 'www.bet365.com', 'operadora.bet.br', 'alphabet.com'];
    const runSetLookups = () => {
        let hits = 0;
        for (let iteration = 0; iteration < 2500; iteration += 1) {
            for (const probe of probes) {
                let candidate = probe;
                for (;;) {
                    if (set.has(candidate)) {
                        hits += 1;
                        break;
                    }
                    const dot = candidate.indexOf('.');
                    if (dot === -1) break;
                    candidate = candidate.slice(dot + 1);
                }
            }
        }
        return hits;
    };
    const runPolicyLookups = () => {
        let hits = 0;
        for (let iteration = 0; iteration < 2500; iteration += 1) {
            for (const probe of probes) {
                if (bettingPolicy.findDomain(probe)) hits += 1;
            }
        }
        return hits;
    };
    for (let warmup = 0; warmup < 2; warmup += 1) {
        benchmarkSink += runSetLookups();
        benchmarkSink += runPolicyLookups();
    }
    const setSamples = [];
    const policySamples = [];
    for (let sample = 0; sample < 7; sample += 1) {
        if (sample % 2 === 0) {
            setSamples.push(measure(runSetLookups));
            policySamples.push(measure(runPolicyLookups));
        } else {
            policySamples.push(measure(runPolicyLookups));
            setSamples.push(measure(runSetLookups));
        }
    }
    const setLookupMs = median(setSamples);
    const policyLookupMs = median(policySamples);

    return {
        domains: bettingPolicy.domains.length,
        suffixes: bettingPolicy.suffixes.length,
        compactPolicyUtf8Bytes: Buffer.byteLength(compactPolicy),
        observedSetHeapDeltaBytes: Math.max(0, afterSet - beforeSet),
        repetitions: 7,
        setLookup10kMs: Number(setLookupMs.toFixed(2)),
        policyLookup10kMs: Number(policyLookupMs.toFixed(2)),
        setLookupSamplesMs: setSamples.map(value => Number(value.toFixed(2))),
        policyLookupSamplesMs: policySamples.map(value => Number(value.toFixed(2)))
    };
}

const generated = generatedScenarios();
const safe = [...safeScenarios, ...generated.safe];
const gambling = [...gamblingScenarios, ...generated.gambling];
const scenarios = [...safe, ...gambling];
const report = {
    generatedAt: new Date().toISOString(),
    methodology: {
        kind: 'deterministic-regression-corpus',
        classifierIterations: 20,
        classifierRepetitions: 5,
        blocklistLookups: 10000,
        blocklistRepetitions: 7,
        deadCodeEliminationGuard: 'result-checksum',
        runtime: process.version
    },
    corpus: {
        total: scenarios.length,
        safe: safe.length,
        gambling: gambling.length
    },
    accuracy: classificationMetrics(safe, gambling),
    classifierPerformance: timeClassifiers(scenarios),
    blocklist: measureBlocklist()
};

report.accuracy.before.accuracyPercent = derivedAccuracy(report.accuracy.before);
report.accuracy.after.accuracyPercent = derivedAccuracy(report.accuracy.after);
report.methodology.integrityChecksum = benchmarkSink;

await mkdir(new URL('../docs/reports/', import.meta.url), { recursive: true });
await writeFile(REPORT_URL, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(JSON.stringify(report, null, 2));
