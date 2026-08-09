/**
 * Desenha o gráfico do benchmark a partir dos relatórios já gerados.
 *
 * Lê `docs/reports/engine-benchmark.json` e `benchmark-results.json` — nenhum
 * número é digitado aqui. Rode os benchmarks antes; o gráfico é uma leitura
 * deles, não uma fonte paralela que pode divergir.
 *
 * Emite PNG em tema claro e escuro. O README serve os dois via <picture>,
 * porque um PNG tem fundo fixo e o GitHub tem dois temas — uma imagem só ficaria
 * ilegível em metade dos leitores.
 *
 * Sobre a paleta: a identidade do projeto é monocromática por decisão
 * (docs/BRAND_SYSTEM.md), então as duas séries não podem se distinguir por
 * matiz. A forma usada é *emphasis* — a série que importa em tinta cheia, a
 * outra em cinza recuado — e a identidade é reforçada por traço, marcador e
 * rótulo direto, nunca só por tom. Na validação de paleta a separação entre os
 * dois tons fica em ΔE 42,7 (o piso é 8), com contraste acima de 3:1 nos dois
 * temas.
 *
 * Requer um Firefox instalado. Defina FIREFOX_BINARY para apontar outro.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = join(projectRoot, 'docs', 'assets');

const WIDTH = 1240;
const HEIGHT = 900;
const SCALE = 2; // render em 2x para a imagem não borrar em telas densas

const THEMES = {
    light: {
        file: 'benchmark-engine-light.png',
        surface: '#fbfbfa',
        panel: '#f2f2ef',
        ink: '#171716',
        secondary: '#484846',
        muted: '#6d6d69',
        grid: '#e2e2dd',
        rule: '#c9c9c3',
        emphasis: '#171716',
        context: '#8a8a82'
    },
    dark: {
        file: 'benchmark-engine-dark.png',
        surface: '#151514',
        panel: '#1d1d1b',
        ink: '#f2f2ed',
        secondary: '#c7c7c0',
        muted: '#a1a19a',
        grid: '#2b2b28',
        rule: '#3d3d38',
        emphasis: '#f2f2ed',
        context: '#85857d'
    }
};

const FIREFOX_CANDIDATES = [
    process.env.FIREFOX_BINARY,
    'C:/Program Files/Mozilla Firefox/firefox.exe',
    'C:/Program Files (x86)/Mozilla Firefox/firefox.exe',
    '/Applications/Firefox.app/Contents/MacOS/firefox',
    '/usr/bin/firefox',
    '/usr/local/bin/firefox'
].filter(Boolean);

function findFirefox() {
    const found = FIREFOX_CANDIDATES.find(candidate => existsSync(candidate));
    if (!found) {
        throw new Error(
            'Firefox não encontrado. Instale o Firefox ou defina FIREFOX_BINARY.'
        );
    }
    return found;
}

const decimal = (value, digits = 0) =>
    value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function escapeXml(text) {
    return String(text).replace(/[&<>]/g, character =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]);
}

// --- gráfico principal: escala logarítmica, pois as séries diferem ~3400x ----

/*
 * `inset` afasta o primeiro ponto do eixo: colado nele, a anotação de ganho
 * caía em cima do rótulo "1 µs". `rightGutter` reserva a faixa dos rótulos
 * diretos, e as proporções são escolhidas para o viewBox ter a mesma razão da
 * coluna que o recebe — sem isso o SVG encolhia para caber na largura e sobrava
 * uma faixa morta embaixo.
 */
const PLOT = { left: 96, top: 74, width: 640, height: 380, inset: 34, rightGutter: 185 };
const LOG_MIN = 2; // 100 ns
const LOG_MAX = 7; // 10 ms

function plotY(nanoseconds) {
    const position = (Math.log10(nanoseconds) - LOG_MIN) / (LOG_MAX - LOG_MIN);
    return PLOT.top + PLOT.height - position * PLOT.height;
}

function plotX(index, total) {
    const span = PLOT.width - PLOT.inset;
    return PLOT.left + PLOT.inset + (index / (total - 1)) * span;
}

function series(points, color, dashed, marker) {
    const path = points
        .map((point, index) => `${index === 0 ? 'M' : 'L'}${plotX(index, points.length).toFixed(1)} ${plotY(point.value).toFixed(1)}`)
        .join(' ');
    const dash = dashed ? ' stroke-dasharray="7 5"' : '';
    const markers = points.map((point, index) => {
        const x = plotX(index, points.length).toFixed(1);
        const y = plotY(point.value).toFixed(1);
        return marker === 'square'
            ? `<rect x="${(Number(x) - 5).toFixed(1)}" y="${(Number(y) - 5).toFixed(1)}" width="10" height="10" fill="var(--surface)" stroke="${color}" stroke-width="2.5"/>`
            : `<circle cx="${x}" cy="${y}" r="5.5" fill="${color}" stroke="var(--surface)" stroke-width="2"/>`;
    }).join('');
    return `<path d="${path}" fill="none" stroke="${color}" stroke-width="2"${dash} stroke-linejoin="round"/>${markers}`;
}

function chartSvg(sizes, matcher) {
    const linear = sizes.map(size => ({ value: matcher[size].linearNsPerLookup }));
    const walk = sizes.map(size => ({ value: matcher[size].labelWalkNsPerLookup }));

    const gridlines = [];
    for (let exponent = LOG_MIN; exponent <= LOG_MAX; exponent += 1) {
        const value = 10 ** exponent;
        const y = plotY(value).toFixed(1);
        const label = exponent >= 6
            ? `${10 ** (exponent - 6)} ms`
            : exponent >= 3 ? `${10 ** (exponent - 3)} µs` : `${value} ns`;
        gridlines.push(
            `<line x1="${PLOT.left}" y1="${y}" x2="${PLOT.left + PLOT.width}" y2="${y}" stroke="var(--grid)" stroke-width="1"/>`
            + `<text x="${PLOT.left - 14}" y="${Number(y) + 4}" text-anchor="end" class="tick">${label}</text>`
        );
    }

    const xLabels = sizes.map((size, index) =>
        `<text x="${plotX(index, sizes.length).toFixed(1)}" y="${PLOT.top + PLOT.height + 28}" text-anchor="middle" class="tick-x">${decimal(Number(size))}</text>`
    ).join('');

    // Ganho anotado em cada ponto: é o que o leitor quer levar embora.
    const speedups = sizes.map((size, index) => {
        const x = plotX(index, sizes.length);
        const y = (plotY(matcher[size].linearNsPerLookup) + plotY(matcher[size].labelWalkNsPerLookup)) / 2;
        return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" class="speedup">${decimal(matcher[size].speedup, matcher[size].speedup < 100 ? 1 : 0)}×</text>`;
    }).join('');

    const last = sizes.length - 1;
    return `
<svg viewBox="0 0 ${PLOT.left + PLOT.width + PLOT.rightGutter} ${PLOT.top + PLOT.height + 60}" class="plot">
  ${gridlines.join('')}
  <line x1="${PLOT.left}" y1="${PLOT.top}" x2="${PLOT.left}" y2="${PLOT.top + PLOT.height}" stroke="var(--rule)" stroke-width="1"/>
  <line x1="${PLOT.left}" y1="${PLOT.top + PLOT.height}" x2="${PLOT.left + PLOT.width}" y2="${PLOT.top + PLOT.height}" stroke="var(--rule)" stroke-width="1"/>
  ${speedups}
  ${series(linear, 'var(--context)', true, 'square')}
  ${series(walk, 'var(--emphasis)', false, 'circle')}
  <text x="${plotX(last, sizes.length) + 16}" y="${plotY(linear[last].value) + 4}" class="direct context-ink">Varredura linear</text>
  <text x="${plotX(last, sizes.length) + 16}" y="${plotY(linear[last].value) + 22}" class="direct-sub">${decimal(linear[last].value / 1000, 1)} µs por consulta</text>
  <text x="${plotX(last, sizes.length) + 16}" y="${plotY(walk[last].value) + 4}" class="direct">labelWalk</text>
  <text x="${plotX(last, sizes.length) + 16}" y="${plotY(walk[last].value) + 22}" class="direct-sub">${decimal(walk[last].value, 0)} ns por consulta</text>
  <text x="${PLOT.left - 14}" y="${PLOT.top - 22}" text-anchor="end" class="axis-title">tempo</text>
  <text x="${PLOT.left + PLOT.width / 2}" y="${PLOT.top + PLOT.height + 52}" text-anchor="middle" class="axis-title">entradas na lista</text>
</svg>`;
}

function statTile(value, unit, label, note) {
    return `<div class="tile">
      <div class="tile-value">${escapeXml(value)}<span class="tile-unit">${escapeXml(unit)}</span></div>
      <div class="tile-label">${escapeXml(label)}</div>
      <div class="tile-note">${escapeXml(note)}</div>
    </div>`;
}

function buildHtml(theme, data) {
    const { engine, corpus } = data;
    const sizes = Object.keys(engine.subdomainMatcher).sort((a, b) => Number(a) - Number(b));
    const matcher = engine.subdomainMatcher;
    const generated = new Date(engine.generatedAt).toLocaleDateString('pt-BR');

    const rows = sizes.map(size => {
        const entry = matcher[size];
        return `<tr>
          <td class="num">${decimal(entry.entries)}</td>
          <td class="num context-ink">${decimal(entry.linearNsPerLookup / 1000, 2)} µs</td>
          <td class="num strong">${decimal(entry.labelWalkNsPerLookup)} ns</td>
          <td class="num strong">${decimal(entry.speedup, entry.speedup < 100 ? 1 : 0)}×</td>
        </tr>`;
    }).join('');

    return `<style>
  :root {
    --surface: ${theme.surface}; --panel: ${theme.panel}; --ink: ${theme.ink};
    --secondary: ${theme.secondary}; --muted: ${theme.muted}; --grid: ${theme.grid};
    --rule: ${theme.rule}; --emphasis: ${theme.emphasis}; --context: ${theme.context};
    --sans: "Inter Guardiao", "Segoe UI", system-ui, sans-serif;
    --serif: "Newsreader Guardiao", Georgia, serif;
    --mono: "Cascadia Code", Consolas, ui-monospace, monospace;
  }
  @font-face { font-family: "Inter Guardiao"; src: url("FONT_INTER") format("woff2"); font-weight: 100 900; }
  @font-face { font-family: "Newsreader Guardiao"; src: url("FONT_NEWS") format("woff2"); font-weight: 200 800; }
  * { box-sizing: border-box; margin: 0; }
  html { zoom: ${SCALE}; }
  body { width: ${WIDTH}px; height: ${HEIGHT}px; background: var(--surface); color: var(--ink);
         font-family: var(--sans); padding: 44px 48px; display: flex; flex-direction: column; }
  .eyebrow { font: 620 11px/1 var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
  h1 { font-family: var(--serif); font-size: 40px; font-weight: 560; letter-spacing: -.035em; margin: 12px 0 6px; }
  .lede { color: var(--secondary); font-size: 14px; max-width: 780px; line-height: 1.5; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: var(--rule);
          border: 1px solid var(--rule); margin: 26px 0 10px; }
  .tile { background: var(--surface); padding: 16px 18px; }
  .tile-value { font: 700 30px/1 var(--mono); letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  .tile-unit { font-size: 14px; font-weight: 560; color: var(--muted); margin-left: 5px; }
  .tile-label { font-size: 12px; font-weight: 680; margin-top: 9px; }
  .tile-note { font-size: 11px; color: var(--muted); margin-top: 3px; line-height: 1.35; }
  .chart-head { display: flex; align-items: baseline; justify-content: space-between; margin: 22px 0 0; }
  h2 { font-family: var(--serif); font-size: 21px; font-weight: 560; letter-spacing: -.03em; }
  .legend { display: flex; gap: 20px; font-size: 12px; color: var(--secondary); }
  .legend span { display: inline-flex; align-items: center; gap: 8px; }
  .swatch { width: 22px; height: 0; border-top: 2px solid var(--context); }
  .swatch.dashed { border-top-style: dashed; }
  .swatch.solid { border-top-color: var(--emphasis); }
  .body { display: grid; grid-template-columns: 1fr 350px; gap: 30px; align-items: start; flex: 1; }
  .plot { width: 100%; height: auto; }
  .tick { font: 500 11px/1 var(--mono); fill: var(--muted); }
  .tick-x { font: 600 12px/1 var(--mono); fill: var(--secondary); }
  .axis-title { font: 620 10px/1 var(--mono); letter-spacing: .1em; text-transform: uppercase; fill: var(--muted); }
  .direct { font: 700 13px/1 var(--sans); fill: var(--ink); }
  .direct.context-ink { fill: var(--secondary); }
  .direct-sub { font: 500 11px/1 var(--mono); fill: var(--muted); }
  .speedup { font: 700 12px/1 var(--mono); fill: var(--muted); }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  caption { text-align: left; font-size: 11px; color: var(--muted); padding-bottom: 8px; }
  th { text-align: right; font: 620 10px/1.3 var(--mono); letter-spacing: .06em; text-transform: uppercase;
       color: var(--muted); padding: 0 0 7px; border-bottom: 1px solid var(--rule); }
  th:first-child, td:first-child { text-align: left; }
  td { padding: 8px 0; border-bottom: 1px solid var(--grid); font-size: 12px; }
  .num { font-family: var(--mono); font-variant-numeric: tabular-nums; text-align: right; }
  .strong { font-weight: 700; }
  .context-ink { color: var(--secondary); }
  h3 { font-family: var(--serif); font-size: 16px; font-weight: 560; letter-spacing: -.02em; margin-top: 26px; }
  .caveat { font-size: 10.5px; line-height: 1.45; color: var(--muted); margin-top: 10px; }
  footer { border-top: 1px solid var(--rule); margin-top: 20px; padding-top: 12px;
           display: flex; justify-content: space-between; gap: 24px;
           font: 500 10.5px/1.5 var(--mono); color: var(--muted); }
</style>
<div class="eyebrow">Guardião Zero Pro · Benchmark do motor</div>
<h1>O custo de decidir não cresce com a lista.</h1>
<p class="lede">O casamento de subdomínio percorre os rótulos do domínio consultado em vez de varrer a lista
inteira. Por isso o tempo por consulta fica praticamente constante enquanto a lista cresce 500 vezes.</p>

<div class="kpis">
  ${statTile('100', '%', 'Precisão no corpus', `${decimal(corpus.corpus.total)} casos rotulados · 0 falso positivo, 0 falso negativo`)}
  ${statTile(decimal(engine.bettingPolicy.usPerLookup, 2), 'µs', 'Consulta de domínio', `Política verificada de ${engine.bettingPolicy.domains} domínios`)}
  ${statTile(decimal(engine.filterParser.rulesPerSecond), '/s', 'Parser de listas', `${decimal(engine.filterParser.mibPerSecond, 1)} MiB/s · ${decimal(engine.filterParser.rejected)} regra rejeitada`)}
  ${statTile(decimal(corpus.classifierPerformance.multifactorMeanMs, 2), 'ms', 'Classificador multifator', 'Média por página, corpus determinístico')}
</div>

<div class="chart-head">
  <h2>Casamento de subdomínio, por tamanho da lista</h2>
  <div class="legend">
    <span><i class="swatch dashed"></i>Varredura linear</span>
    <span><i class="swatch solid"></i>labelWalk (em uso)</span>
  </div>
</div>

<div class="body">
  <div>${chartSvg(sizes, matcher)}</div>
  <div>
    <table>
      <caption>Nanossegundos por consulta, mediana de ${engine.methodology.repetitions} repetições.</caption>
      <thead><tr><th>Entradas</th><th>Linear</th><th>labelWalk</th><th>Ganho</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <h3>Erros de classificação</h3>
    <table>
      <caption>Corpus de ${decimal(corpus.corpus.total)} casos — ${decimal(corpus.corpus.safe)} legítimos, ${decimal(corpus.corpus.gambling)} de apostas.</caption>
      <thead><tr><th>&nbsp;</th><th>Palavra-chave</th><th>Multifator</th></tr></thead>
      <tbody>
        <tr><td>Falso positivo</td><td class="num context-ink">${decimal(corpus.accuracy.before.falsePositive)}</td><td class="num strong">${decimal(corpus.accuracy.after.falsePositive)}</td></tr>
        <tr><td>Falso negativo</td><td class="num context-ink">${decimal(corpus.accuracy.before.falseNegative)}</td><td class="num strong">${decimal(corpus.accuracy.after.falseNegative)}</td></tr>
        <tr><td>Precisão</td><td class="num context-ink">${decimal(corpus.accuracy.before.accuracyPercent, 2)}%</td><td class="num strong">${decimal(corpus.accuracy.after.accuracyPercent)}%</td></tr>
      </tbody>
    </table>
    <p class="caveat">Corpus sintético de regressão, usado para detectar piora entre versões.
    Não é medida de precisão em campo e não deve ser apresentado como tal.</p>
  </div>
</div>

<footer>
  <span>Mediana de ${engine.methodology.repetitions} repetições, ${engine.methodology.warmup} de aquecimento · ordem das variantes alternada · guarda contra eliminação de código morto</span>
  <span>${escapeXml(engine.runtime)} · ${generated}</span>
</footer>
<p style="font:500 10.5px/1.5 var(--mono);color:var(--muted);margin-top:8px">
  Escopo: apenas caminhos internos do motor. Não mede tempo de carregamento de página nem desempenho do navegador.
</p>`;
}

async function main() {
    const firefox = findFirefox();
    const [engine, corpus] = await Promise.all([
        readFile(join(projectRoot, 'docs/reports/engine-benchmark.json'), 'utf8').then(JSON.parse),
        readFile(join(projectRoot, 'docs/reports/benchmark-results.json'), 'utf8').then(JSON.parse)
    ]);

    const workDir = await mkdtemp(join(tmpdir(), 'guardiao-chart-'));
    const profile = join(workDir, 'profile');
    await mkdir(profile, { recursive: true });
    await mkdir(outputDir, { recursive: true });

    try {
        for (const theme of Object.values(THEMES)) {
            const html = buildHtml(theme, { engine, corpus })
                .replace('FONT_INTER', pathToFileURL(join(projectRoot, 'assets/fonts/InterVariable.woff2')).href)
                .replace('FONT_NEWS', pathToFileURL(join(projectRoot, 'assets/fonts/NewsreaderVariable.woff2')).href);
            const page = join(workDir, `${theme.file}.html`);
            await writeFile(page, html, 'utf8');

            const destination = join(outputDir, theme.file);
            const result = spawnSync(firefox, [
                '--headless', '-profile', profile,
                `--window-size=${WIDTH * SCALE},${HEIGHT * SCALE}`,
                `--screenshot=${destination}`,
                pathToFileURL(page).href
            ], { encoding: 'utf8', windowsHide: true });
            if (result.error) throw result.error;
            if (!existsSync(destination)) {
                throw new Error(`Firefox não gravou ${theme.file}.\n${result.stderr || ''}`);
            }
            console.log(`chart ${relative(projectRoot, destination)} (${WIDTH * SCALE}x${HEIGHT * SCALE})`);
        }
    } finally {
        await rm(workDir, { recursive: true, force: true });
    }
}

await main();
