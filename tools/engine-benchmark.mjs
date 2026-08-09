import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import { loadRuntime } from '../tests/runtime-loader.mjs';

/**
 * Benchmark dos caminhos quentes do motor.
 *
 * Mede apenas o que roda por navegação ou por requisição. Métricas que exigem
 * navegador real (CPU da página, RAM do processo, tempo de carregamento,
 * requisições bloqueadas) NÃO são estimadas aqui — ver docs/BENCHMARK.md.
 *
 * Metodologia: aquecimento, repetições alternadas para diluir efeito de ordem,
 * mediana como estatística principal, mínimo e máximo reportados, e um
 * acumulador de resultado que impede o motor de eliminar o trabalho medido.
 */

const REPORT_URL = new URL('../docs/reports/engine-benchmark.json', import.meta.url);
const REPETITIONS = 9;
const WARMUP = 3;

let sink = 0;

const runtime = await loadRuntime([
    'src/shared/detection/constants.js',
    'src/shared/lists/list-matcher.js',
    'src/shared/filters/filter-list-parser.js',
    'src/background/verified-betting-domains.js'
]);
const lists = runtime.GuardiaoLists;
const parser = runtime.GuardiaoFilterParser;
const bettingPolicy = runtime.GuardiaoVerifiedBettingDomains;

function stats(samples) {
    const ordered = [...samples].sort((left, right) => left - right);
    const middle = Math.floor(ordered.length / 2);
    return {
        medianMs: Number((ordered.length % 2 === 0
            ? (ordered[middle - 1] + ordered[middle]) / 2
            : ordered[middle]).toFixed(4)),
        minMs: Number(ordered[0].toFixed(4)),
        maxMs: Number(ordered[ordered.length - 1].toFixed(4)),
        samplesMs: ordered.map(value => Number(value.toFixed(4)))
    };
}

function measure(callback) {
    const startedAt = performance.now();
    const result = callback();
    const elapsed = performance.now() - startedAt;
    sink = (sink + Number(result || 0)) % 2147483647;
    return elapsed;
}

/** Executa duas variantes alternando a ordem, para diluir efeito de aquecimento. */
function compare(variants) {
    const samples = Object.fromEntries(Object.keys(variants).map(name => [name, []]));
    const names = Object.keys(variants);

    for (let warmup = 0; warmup < WARMUP; warmup += 1) {
        for (const name of names) sink += Number(variants[name]() || 0);
    }
    for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
        const order = repetition % 2 === 0 ? names : [...names].reverse();
        for (const name of order) samples[name].push(measure(variants[name]));
    }
    return Object.fromEntries(names.map(name => [name, stats(samples[name])]));
}

// ---------------------------------------------------------------------------
// 1. Matcher de subdomínio: scan linear (atual) vs caminhada por rótulos
// ---------------------------------------------------------------------------

/** Réplica exata do laço que hoje roda em GuardiaoLists.match. */
function linearScan(entries, hostname) {
    for (const entry of entries) {
        if (hostname === entry.pattern || hostname.endsWith(`.${entry.pattern}`)) return entry;
    }
    return null;
}

/**
 * Estratégia de uBlock/AdGuard: caminhar os rótulos do host da direita para a
 * esquerda consultando um hash. Custo O(rótulos) em vez de O(entradas).
 */
function labelWalk(map, hostname) {
    let candidate = hostname;
    for (;;) {
        const hit = map.get(candidate);
        if (hit) return hit;
        const dot = candidate.indexOf('.');
        if (dot === -1) return null;
        candidate = candidate.slice(dot + 1);
    }
}

function syntheticEntries(count) {
    const entries = [];
    for (let index = 0; index < count; index += 1) {
        entries.push({ pattern: `dominio-${index}.example`, id: `e${index}` });
    }
    return entries;
}

/**
 * Tráfego realista: a esmagadora maioria das navegações NÃO está na whitelist,
 * e o miss é justamente o pior caso do scan linear — percorre tudo.
 */
function probeHosts(entries) {
    const hosts = [];
    for (let index = 0; index < 200; index += 1) {
        hosts.push(`www.site-comum-${index}.com.br`);
    }
    if (entries.length > 0) {
        hosts.push(entries[0].pattern);
        hosts.push(`sub.${entries[entries.length - 1].pattern}`);
    }
    return hosts;
}

function benchmarkSubdomainMatcher() {
    const results = {};

    for (const size of [10, 100, 1000, 5000]) {
        const entries = syntheticEntries(size);
        const map = new Map(entries.map(entry => [entry.pattern, entry]));
        const hosts = probeHosts(entries);

        // Correção antes de velocidade: as duas estratégias precisam concordar.
        for (const host of hosts) {
            const linear = linearScan(entries, host);
            const walk = labelWalk(map, host);
            if ((linear?.id ?? null) !== (walk?.id ?? null)) {
                throw new Error(`Divergência de resultado em ${host} com ${size} entradas`);
            }
        }

        // O scan linear custa O(entradas) por consulta. Mantemos o trabalho
        // total aproximadamente constante entre tamanhos para que a bateria
        // termine em tempo razoável também em máquinas sem JIT aquecido — o
        // custo POR CONSULTA continua comparável e cada tamanho mantém ao menos
        // duas passagens completas.
        const iterations = Math.max(2, Math.floor(10000 / size));

        const timings = compare({
            linear: () => {
                let hits = 0;
                for (let iteration = 0; iteration < iterations; iteration += 1) {
                    for (const host of hosts) if (linearScan(entries, host)) hits += 1;
                }
                return hits;
            },
            labelWalk: () => {
                let hits = 0;
                for (let iteration = 0; iteration < iterations; iteration += 1) {
                    for (const host of hosts) if (labelWalk(map, host)) hits += 1;
                }
                return hits;
            }
        });

        const lookups = iterations * hosts.length;
        results[size] = {
            entries: size,
            lookups,
            linear: timings.linear,
            labelWalk: timings.labelWalk,
            speedup: Number((timings.linear.medianMs / timings.labelWalk.medianMs).toFixed(1)),
            linearNsPerLookup: Number(((timings.linear.medianMs * 1e6) / lookups).toFixed(1)),
            labelWalkNsPerLookup: Number(((timings.labelWalk.medianMs * 1e6) / lookups).toFixed(1))
        };
    }
    return results;
}

// ---------------------------------------------------------------------------
// 2. Política verificada: domínios mantidos e sufixo regulado
// ---------------------------------------------------------------------------

function benchmarkBettingPolicy() {
    // Hosts profundos custam mais: findDomain testa cada sufixo até achar.
    const hosts = [
        'bet365.com',
        'www.bet365.com',
        'login.operadora.bet.br',
        'a.b.c.d.site-que-nao-existe.com.br',
        'exemplo-limpo.org',
        'cdn.assets.exemplo-limpo.org'
    ];

    const timings = compare({
        findDomain: () => {
            let hits = 0;
            for (let iteration = 0; iteration < 2000; iteration += 1) {
                for (const host of hosts) {
                    if (bettingPolicy.findDomain(host)) hits += 1;
                }
            }
            return hits;
        }
    });

    const lookups = 2000 * hosts.length;
    const serialized = JSON.stringify({
        domains: bettingPolicy.domains,
        suffixes: bettingPolicy.suffixes
    });
    return {
        domains: bettingPolicy.domains.length,
        suffixes: bettingPolicy.suffixes.length,
        policyUtf8Bytes: Buffer.byteLength(serialized),
        lookups,
        findDomain: timings.findDomain,
        usPerLookup: Number(((timings.findDomain.medianMs * 1000) / lookups).toFixed(2))
    };
}

// ---------------------------------------------------------------------------
// 3. Throughput do parser de filtros
// ---------------------------------------------------------------------------

function benchmarkParser() {
    const lines = [];
    for (let index = 0; index < 12000; index += 1) {
        lines.push(`||ad-servidor-${index}.example^$~document`);
    }
    const source = `[Adblock Plus 2.0]\n${lines.join('\n')}\n`;
    const bytes = Buffer.byteLength(source);

    const timings = compare({
        parse: () => parser.parse(source).rules.length
    });

    const parsed = parser.parse(source);
    return {
        inputLines: lines.length,
        inputBytes: bytes,
        acceptedRules: parsed.rules.length,
        rejected: parsed.stats.rejected,
        parse: timings.parse,
        rulesPerSecond: Math.round(parsed.rules.length / (timings.parse.medianMs / 1000)),
        mibPerSecond: Number(((bytes / 1048576) / (timings.parse.medianMs / 1000)).toFixed(1))
    };
}

// ---------------------------------------------------------------------------

const report = {
    generatedAt: new Date().toISOString(),
    runtime: process.version,
    methodology: {
        repetitions: REPETITIONS,
        warmup: WARMUP,
        statistic: 'mediana; mínimo e máximo reportados',
        orderMitigation: 'ordem das variantes alternada entre repetições',
        deadCodeGuard: 'acumulador de resultado',
        scope: 'apenas caminhos internos do motor; métricas de navegador não são medidas aqui'
    },
    subdomainMatcher: benchmarkSubdomainMatcher(),
    bettingPolicy: benchmarkBettingPolicy(),
    filterParser: benchmarkParser()
};
report.methodology.integrityChecksum = sink;

await mkdir(new URL('../docs/reports/', import.meta.url), { recursive: true });
await writeFile(REPORT_URL, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log('=== Matcher de subdomínio (miss dominante, ns por consulta) ===');
for (const [size, data] of Object.entries(report.subdomainMatcher)) {
    console.log(
        `${String(size).padStart(5)} entradas  linear ${String(data.linearNsPerLookup).padStart(8)} ns  `
        + `labelWalk ${String(data.labelWalkNsPerLookup).padStart(6)} ns  →  ${data.speedup}x`
    );
}
console.log('\n=== Política de domínios verificados ===');
console.log(
    `${report.bettingPolicy.domains.toLocaleString('pt-BR')} domínios + `
    + `${report.bettingPolicy.suffixes} sufixo(s), `
    + `${report.bettingPolicy.usPerLookup} µs por consulta`
);
console.log('\n=== Parser de filtros ===');
console.log(
    `${report.filterParser.acceptedRules.toLocaleString('pt-BR')} regras em `
    + `${report.filterParser.parse.medianMs} ms  →  `
    + `${report.filterParser.rulesPerSecond.toLocaleString('pt-BR')} regras/s, `
    + `${report.filterParser.mibPerSecond} MiB/s`
);
console.log(`\nRelatório completo: docs/reports/engine-benchmark.json`);
