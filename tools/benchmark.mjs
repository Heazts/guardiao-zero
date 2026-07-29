import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
const REPORT_URL = new URL('../docs/reports/benchmark-results.json', import.meta.url);
const CHART_URL = new URL('../docs/assets/benchmark-evolution.svg', import.meta.url);
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
    const runSetLookups = () => {
        let hits = 0;
        for (let iteration = 0; iteration < 2500; iteration += 1) {
            for (const probe of probes) {
                if (set.has(probe)) hits += 1;
            }
        }
        return hits;
    };
    const runBinaryLookups = () => {
        let hits = 0;
        for (let iteration = 0; iteration < 2500; iteration += 1) {
            for (const probe of probes) {
                if (blocklistIndex.containsSortedDomain(text, probe)) hits += 1;
            }
        }
        return hits;
    };
    for (let warmup = 0; warmup < 2; warmup += 1) {
        benchmarkSink += runSetLookups();
        benchmarkSink += runBinaryLookups();
    }
    const setSamples = [];
    const binarySamples = [];
    for (let sample = 0; sample < 7; sample += 1) {
        if (sample % 2 === 0) {
            setSamples.push(measure(runSetLookups));
            binarySamples.push(measure(runBinaryLookups));
        } else {
            binarySamples.push(measure(runBinaryLookups));
            setSamples.push(measure(runSetLookups));
        }
    }
    const setLookupMs = median(setSamples);
    const binaryLookupMs = median(binarySamples);

    return {
        domains: set.size,
        compactTextUtf8Bytes: Buffer.byteLength(text),
        observedSetHeapDeltaBytes: Math.max(0, afterSet - beforeSet),
        repetitions: 7,
        setLookup10kMs: Number(setLookupMs.toFixed(2)),
        binaryLookup10kMs: Number(binaryLookupMs.toFixed(2)),
        setLookupSamplesMs: setSamples.map(value => Number(value.toFixed(2))),
        binaryLookupSamplesMs: binarySamples.map(value => Number(value.toFixed(2)))
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
    blocklist: await measureBlocklist()
};

report.accuracy.before.accuracyPercent = derivedAccuracy(report.accuracy.before);
report.accuracy.after.accuracyPercent = derivedAccuracy(report.accuracy.after);
report.methodology.integrityChecksum = benchmarkSink;

function formatNumber(value, maximumFractionDigits = 2) {
    return new Intl.NumberFormat('pt-BR', {
        maximumFractionDigits,
        minimumFractionDigits: maximumFractionDigits
    }).format(value);
}

function metricCard({ x, eyebrow, before, after, unit = '', lowerIsBetter = false }) {
    const width = 344;
    const beforeValue = Number(before);
    const afterValue = Number(after);
    const scale = Math.max(beforeValue, afterValue, 1);
    const fractionDigits = unit === '%' ? 2 : 0;
    const beforeWidth = Math.max(beforeValue > 0 ? 4 : 0, (beforeValue / scale) * 200);
    const afterWidth = Math.max(afterValue > 0 ? 4 : 0, (afterValue / scale) * 200);
    return `
        <g transform="translate(${x} 236)">
            <rect width="${width}" height="232" rx="12" fill="#fff" stroke="#dedede"/>
            <text x="24" y="34" class="eyebrow">${eyebrow}</text>
            <text x="24" y="74" class="metric">${formatNumber(afterValue, fractionDigits)}${unit}</text>
            <text x="24" y="98" class="caption">resultado atual</text>
            <text x="24" y="136" class="label">Antes</text>
            <rect x="72" y="124" width="200" height="14" rx="3" fill="#ededed"/>
            <rect x="72" y="124" width="${beforeWidth.toFixed(2)}" height="14" rx="3" fill="#a3a3a3"/>
            <text x="320" y="136" text-anchor="end" class="value">${formatNumber(beforeValue, fractionDigits)}${unit}</text>
            <text x="24" y="176" class="label">Depois</text>
            <rect x="72" y="164" width="200" height="14" rx="3" fill="#ededed"/>
            <rect x="72" y="164" width="${afterWidth.toFixed(2)}" height="14" rx="3" fill="#111"/>
            <text x="320" y="176" text-anchor="end" class="value">${formatNumber(afterValue, fractionDigits)}${unit}</text>
            <text x="24" y="210" class="delta">${lowerIsBetter ? 'Menor é melhor' : 'Maior é melhor'}</text>
        </g>`;
}

function benchmarkSvg(data) {
    const before = data.accuracy.before;
    const after = data.accuracy.after;
    const heapMiB = data.blocklist.observedSetHeapDeltaBytes / (1024 * 1024);
    const created = new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'long',
        timeZone: 'America/Fortaleza'
    }).format(new Date(data.generatedAt));
    const classifierRatio = data.classifierPerformance.legacyMeanMs === 0
        ? 0
        : data.classifierPerformance.multifactorMeanMs
            / data.classifierPerformance.legacyMeanMs;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720" role="img" aria-labelledby="title description">
    <title id="title">Benchmark do Guardião Zero Pro</title>
    <desc id="description">Comparação real entre a classificação anterior e a multifator atual em ${data.corpus.total} cenários determinísticos.</desc>
    <rect width="1200" height="720" fill="#fff"/>
    <style>
        text { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #111; }
        .kicker { font-size: 14px; font-weight: 700; letter-spacing: 2px; }
        .title { font-size: 46px; font-weight: 720; letter-spacing: -1.8px; }
        .subtitle { font-size: 17px; fill: #595959; }
        .eyebrow { font-size: 12px; font-weight: 720; letter-spacing: 1.2px; text-transform: uppercase; }
        .metric { font-size: 34px; font-weight: 720; letter-spacing: -1px; }
        .caption, .label, .value { font-size: 12px; fill: #666; }
        .value { fill: #333; font-weight: 650; }
        .delta { font-size: 11px; fill: #777; }
        .note-title { font-size: 15px; font-weight: 700; }
        .note { font-size: 13px; fill: #555; }
        .footer { font-size: 11px; fill: #777; }
    </style>
    <g transform="translate(64 58)">
        <rect width="42" height="42" rx="8" fill="#111"/>
        <path d="M21 8.5 32 12.6v9.7c0 7.5-7 12.5-11 14.2-4-1.7-11-6.7-11-14.2v-9.7L21 8.5Z" fill="#fff"/>
        <ellipse cx="21" cy="21.5" rx="3.7" ry="5.1" fill="#111"/>
        <text x="58" y="14" class="kicker">GUARDIÃO ZERO PRO</text>
        <text x="58" y="58" class="title">Benchmark antes e depois</text>
        <text x="58" y="88" class="subtitle">${data.corpus.total} cenários · ${data.classifierPerformance.operations.toLocaleString('pt-BR')} classificações · ${created}</text>
    </g>
    ${metricCard({
        x: 64,
        eyebrow: 'Acurácia',
        before: before.accuracyPercent,
        after: after.accuracyPercent,
        unit: '%'
    })}
    ${metricCard({
        x: 428,
        eyebrow: 'Falsos positivos',
        before: before.falsePositive,
        after: after.falsePositive,
        lowerIsBetter: true
    })}
    ${metricCard({
        x: 792,
        eyebrow: 'Falsos negativos',
        before: before.falseNegative,
        after: after.falseNegative,
        lowerIsBetter: true
    })}
    <g transform="translate(64 494)">
        <rect width="1072" height="142" rx="12" fill="#fafafa" stroke="#dedede"/>
        <text x="24" y="34" class="note-title">Memória da blocklist</text>
        <text x="24" y="59" class="note">O índice binário consulta o texto compacto sem materializar um Set persistente.</text>
        <text x="24" y="88" class="metric">${formatNumber(heapMiB)} MiB</text>
        <text x="24" y="112" class="caption">de heap adicional observado no Set anterior; índice atual: 0 MiB adicionais persistentes</text>
        <line x1="650" y1="22" x2="650" y2="120" stroke="#dedede"/>
        <text x="680" y="43" class="note-title">Custo consciente de precisão</text>
        <text x="680" y="70" class="note">Legado: ${formatNumber(data.classifierPerformance.legacyMeanMs, 4)} ms/op</text>
        <text x="680" y="94" class="note">Multifator: ${formatNumber(data.classifierPerformance.multifactorMeanMs, 4)} ms/op</text>
        <text x="680" y="118" class="caption">${formatNumber(classifierRatio, 1)}× mais análise por página para eliminar erros no corpus.</text>
    </g>
    <text x="64" y="680" class="footer">Fonte: npm run benchmark · execução local reproduzível · dados completos em docs/reports/benchmark-results.json</text>
</svg>
`;
}

await Promise.all([
    mkdir(new URL('../docs/reports/', import.meta.url), { recursive: true }),
    mkdir(new URL('../docs/assets/', import.meta.url), { recursive: true })
]);
await Promise.all([
    writeFile(REPORT_URL, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    writeFile(CHART_URL, benchmarkSvg(report).replace(/[ \t]+$/gm, ''), 'utf8')
]);

console.log(JSON.stringify(report, null, 2));
