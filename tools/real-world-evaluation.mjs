import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { baseSignals, loadRuntime } from '../tests/runtime-loader.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const corpusPath = join(projectRoot, 'tests', 'real-world-corpus.json');
const resultPath = join(projectRoot, 'docs', 'reports', 'real-world-results.json');
const graphPath = join(projectRoot, 'docs', 'assets', 'precision-real-world.svg');
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 12000;
const CONCURRENCY = 4;

function decodeEntities(value) {
    const named = new Map([
        ['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'],
        ['apos', "'"], ['nbsp', ' ']
    ]);
    return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
        if (entity[0] === '#') {
            const hexadecimal = entity[1]?.toLowerCase() === 'x';
            const parsed = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
            return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : match;
        }
        return named.get(entity.toLowerCase()) ?? match;
    });
}

function plainText(value, maximum = 12000) {
    return decodeEntities(value)
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, ' ')
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\b[^>]*>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maximum);
}

function firstMatch(source, expression, maximum = 1000) {
    const match = expression.exec(source);
    return match ? plainText(match[1] || '', maximum) : '';
}

function attribute(tag, name) {
    const match = new RegExp(`\\b${name}\\s*=\\s*(?:["']([^"']*)["']|([^\\s>]+))`, 'i').exec(tag);
    return (match?.[1] || match?.[2] || '').slice(0, 1000);
}

function tags(source, tagName, maximum = 80) {
    const values = [];
    const expression = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
    let match;
    while ((match = expression.exec(source)) && values.length < maximum) values.push(match[0]);
    return values;
}

function pairedTags(source, tagName, maximum = 40) {
    const values = [];
    const expression = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
    let match;
    while ((match = expression.exec(source)) && values.length < maximum) {
        values.push({ attributes: match[1], content: match[2] });
    }
    return values;
}

function absoluteUrl(value, base) {
    try {
        return new URL(value, base).href;
    } catch {
        return '';
    }
}

function signalsFromHtml(url, html) {
    const metadata = tags(html, 'meta', 60);
    const metaDescription = metadata.find(tag =>
        /(?:name|property)\s*=\s*["'](?:description|og:description)["']/i.test(tag)
    );
    const openGraph = metadata
        .filter(tag => /(?:property|name)\s*=\s*["'](?:og:|twitter:)/i.test(tag))
        .map(tag => attribute(tag, 'content'))
        .filter(Boolean)
        .slice(0, 12);
    const links = pairedTags(html, 'a', 80).map(item => {
        const target = absoluteUrl(attribute(item.attributes, 'href'), url);
        let external = false;
        try {
            external = new URL(target).hostname !== new URL(url).hostname;
        } catch {
            external = false;
        }
        return { url: target, text: plainText(item.content, 160), external };
    }).filter(item => item.url);
    const scripts = tags(html, 'script', 60)
        .map(tag => absoluteUrl(attribute(tag, 'src'), url))
        .filter(Boolean);
    const iframes = tags(html, 'iframe', 30)
        .map(tag => absoluteUrl(attribute(tag, 'src'), url))
        .filter(Boolean);
    const images = tags(html, 'img', 60).map(tag => ({
        url: absoluteUrl(attribute(tag, 'src'), url),
        alt: attribute(tag, 'alt'),
        width: Number(attribute(tag, 'width')) || 0,
        height: Number(attribute(tag, 'height')) || 0
    })).filter(item => item.url);
    const buttons = [
        ...pairedTags(html, 'button', 40).map(item => plainText(item.content, 220)),
        ...tags(html, 'input', 40)
            .filter(tag => /type\s*=\s*["'](?:button|submit)["']/i.test(tag))
            .map(tag => attribute(tag, 'value') || attribute(tag, 'aria-label'))
    ].filter(Boolean);
    const forms = pairedTags(html, 'form', 20).map(item => ({
        action: absoluteUrl(attribute(item.attributes, 'action'), url),
        text: plainText(item.content, 500),
        fields: tags(item.content, '(?:input|select|textarea|button)', 30).map(tag => [
            attribute(tag, 'name'),
            attribute(tag, 'id'),
            attribute(tag, 'type'),
            attribute(tag, 'placeholder'),
            attribute(tag, 'aria-label')
        ].filter(Boolean).join(' ')).filter(Boolean)
    }));
    const structuredDataTypes = Array.from(
        html.matchAll(/"@type"\s*:\s*"([^"]{1,80})"/gi),
        match => match[1]
    ).slice(0, 24);

    return baseSignals(url, {
        title: firstMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i, 300),
        metaDescription: metaDescription ? attribute(metaDescription, 'content') : '',
        openGraph,
        structuredDataTypes,
        favicons: tags(html, 'link', 30)
            .filter(tag => /\brel\s*=\s*["'][^"']*\bicon\b/i.test(tag))
            .map(tag => absoluteUrl(attribute(tag, 'href'), url))
            .filter(Boolean),
        text: plainText(html),
        menus: pairedTags(html, 'nav', 20).map(item => plainText(item.content, 220)).filter(Boolean),
        buttons,
        forms,
        links,
        images,
        scripts,
        iframes,
        resources: [...scripts, ...iframes, ...images.map(image => image.url)]
            .map(resourceUrl => ({ url: resourceUrl, type: 'html-source' })),
        articleCount: Math.min(50, (html.match(/<article\b/gi) || []).length)
    });
}

async function readLimitedBody(response) {
    if (!response.body?.getReader) {
        const text = await response.text();
        if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error('response-too-large');
        return text;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new Error('response-too-large');
        }
        chunks.push(value);
    }
    return new TextDecoder().decode(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))));
}

async function fetchPage(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                accept: 'text/html,application/xhtml+xml',
                'accept-language': 'pt-BR,pt;q=0.9,en;q=0.7',
                'user-agent': 'Guardiao-Zero-Real-World-Evaluation/3.1 (+local reproducible test)'
            }
        });
        if (!response.ok) throw new Error(`http-${response.status}`);
        const contentType = response.headers.get('content-type') || '';
        if (!/html|xhtml/i.test(contentType)) throw new Error(`unsupported-content-type:${contentType}`);
        const html = await readLimitedBody(response);
        const readablePreview = plainText(html, 4000);
        if (readablePreview.length < 40) throw new Error('empty-or-non-content-page');
        if (
            /(?:just a moment|checking your browser|verify you are human|enable javascript and cookies to continue|access denied|attention required.*cloudflare)/i
                .test(readablePreview)
        ) {
            throw new Error('interstitial-or-anti-bot-page');
        }
        return {
            finalUrl: response.url,
            status: response.status,
            contentType,
            html
        };
    } finally {
        clearTimeout(timer);
    }
}

function calculateMetrics(results) {
    const available = results.filter(result => result.available);
    const counts = { tp: 0, fp: 0, tn: 0, fn: 0 };
    for (const result of available) {
        if (result.label === 'gambling' && result.predicted === 'block') counts.tp += 1;
        else if (result.label === 'gambling') counts.fn += 1;
        else if (result.predicted === 'block') counts.fp += 1;
        else counts.tn += 1;
    }
    const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;
    return {
        ...counts,
        evaluated: available.length,
        unavailable: results.length - available.length,
        accuracy: ratio(counts.tp + counts.tn, available.length),
        precision: ratio(counts.tp, counts.tp + counts.fp),
        recall: ratio(counts.tp, counts.tp + counts.fn),
        specificity: ratio(counts.tn, counts.tn + counts.fp),
        falsePositiveRate: ratio(counts.fp, counts.fp + counts.tn)
    };
}

function percentage(value) {
    return value === null ? 'N/D' : `${(value * 100).toFixed(2)}%`;
}

function svgGraph(metrics, generatedAt) {
    const series = [
        ['Precisão', metrics.precision, '#111111'],
        ['Recall', metrics.recall, '#3F3F3F'],
        ['Especificidade', metrics.specificity, '#737373'],
        ['Acurácia', metrics.accuracy, '#A3A3A3']
    ];
    const bars = series.map(([label, value, color], index) => {
        const y = 102 + index * 58;
        const width = value === null ? 0 : Math.round(value * 430);
        return `<text x="32" y="${y + 16}" class="label">${label}</text>
        <rect x="168" y="${y}" width="430" height="24" rx="4" fill="#EDEDED"/>
        <rect x="168" y="${y}" width="${width}" height="24" rx="4" fill="${color}"/>
        <text x="614" y="${y + 17}" class="value">${percentage(value)}</text>`;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="390" viewBox="0 0 760 390" role="img" aria-labelledby="title desc">
    <title id="title">Métricas reais do bloqueio</title>
    <desc id="desc">Resultados de ${metrics.evaluated} URLs reais disponíveis; ${metrics.unavailable} indisponíveis e excluídas.</desc>
    <style>
        text { font-family: Inter, "Segoe UI", sans-serif; fill: #111111; }
        .title { font-family: Newsreader, Georgia, serif; font-size: 27px; font-weight: 560; }
        .subtitle { font-size: 12px; fill: #666666; }
        .label { font-size: 13px; font-weight: 650; }
        .value { font-size: 12px; font-weight: 700; text-anchor: start; }
        .foot { font-size: 11px; fill: #666666; }
    </style>
    <rect width="760" height="390" fill="#FFFFFF"/>
    <rect x="32" y="24" width="34" height="34" rx="5" fill="#111111"/>
    <path d="M51.6 32.8C43.3 30 37.2 34 37.2 41.3s6.1 11.3 14.4 8.5" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="square"/>
    <path d="M48.2 41.3h7.6M55.8 30.8v21" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="square"/>
    <text x="82" y="45" class="title">Avaliação em URLs reais</text>
    <text x="82" y="65" class="subtitle">Somente respostas HTTP utilizáveis • execução ${generatedAt.slice(0, 10)}</text>
    ${bars}
    <text x="32" y="348" class="foot">Matriz: TP ${metrics.tp} · FP ${metrics.fp} · TN ${metrics.tn} · FN ${metrics.fn}</text>
    <text x="32" y="369" class="foot">Indisponíveis (${metrics.unavailable}) não entram nas métricas. Resultados não representam toda a web.</text>
</svg>`;
}

async function mapConcurrent(items, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    async function consume() {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await worker(items[index], index);
        }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, consume));
    return results;
}

async function main() {
    const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));
    const ids = new Set();
    for (const item of corpus.cases || []) {
        if (!item.id || ids.has(item.id)) throw new Error(`ID inválido ou duplicado: ${item.id}`);
        if (!['gambling', 'benign'].includes(item.label)) throw new Error(`Rótulo inválido: ${item.id}`);
        const url = new URL(item.url);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`URL fora do escopo: ${item.id}`);
        ids.add(item.id);
    }

    const context = await loadRuntime([
        'src/shared/detection/constants.js',
        'src/shared/detection/detection-engine.js',
        'src/background/verified-betting-domains.js'
    ]);
    const generatedAt = new Date().toISOString();
    const results = await mapConcurrent(corpus.cases, async item => {
        try {
            const page = await fetchPage(item.url);
            const signals = signalsFromHtml(page.finalUrl || item.url, page.html);
            const systemBlockMatch = context.GuardiaoVerifiedBettingDomains.findDomain(
                new URL(page.finalUrl || item.url).hostname
            );
            const decision = context.GuardiaoDetection.analyze(signals, {
                systemBlockMatch,
                threshold: context.GuardiaoConstants.SCORE.thresholdDefault
            });
            return {
                id: item.id,
                label: item.label,
                requestedUrl: item.url,
                finalUrl: page.finalUrl,
                available: true,
                httpStatus: page.status,
                contentType: page.contentType,
                contentSha256: createHash('sha256').update(page.html).digest('hex'),
                contentBytes: Buffer.byteLength(page.html),
                systemBlockMatch: systemBlockMatch || null,
                predicted: decision.verdict,
                score: decision.score,
                threshold: decision.threshold,
                confidence: decision.confidence,
                factors: decision.factors.map(factor => ({
                    id: factor.id,
                    group: factor.group,
                    weight: factor.weight
                }))
            };
        } catch (error) {
            const reason = error?.name === 'AbortError' ? 'timeout' : String(error?.message || error);
            return {
                id: item.id,
                label: item.label,
                requestedUrl: item.url,
                available: false,
                error: reason
            };
        }
    });

    const metrics = calculateMetrics(results);
    for (const result of results) {
        console.log(
            `• ${result.id}: ${result.available
                ? `${result.predicted} (${result.score})`
                : `indisponível (${result.error})`}`
        );
    }
    const report = {
        schemaVersion: 1,
        generatedAt,
        methodology: {
            corpus: 'tests/real-world-corpus.json',
            classifierVersion: '3.1.0',
            timeoutMs: TIMEOUT_MS,
            maxResponseBytes: MAX_RESPONSE_BYTES,
            unavailablePolicy: 'excluded-from-metrics',
            predictionPolicy: 'only-verdict-block-counts-as-blocked',
            storedContentPolicy: 'metadata-and-sha256-only-no-html-body'
        },
        sources: corpus.sources,
        metrics,
        results
    };

    await mkdir(dirname(resultPath), { recursive: true });
    await mkdir(dirname(graphPath), { recursive: true });
    await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await writeFile(graphPath, svgGraph(metrics, generatedAt), 'utf8');
    console.log(`\nAvaliadas: ${metrics.evaluated}; indisponíveis: ${metrics.unavailable}`);
    console.log(`Precisão: ${percentage(metrics.precision)}; recall: ${percentage(metrics.recall)}; FPR: ${percentage(metrics.falsePositiveRate)}`);
    console.log(`Resultados: ${resultPath}`);
    console.log(`Gráfico: ${graphPath}`);
}

await main();
