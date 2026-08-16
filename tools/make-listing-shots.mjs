/**
 * Gera as capturas da listagem do AMO a partir das páginas reais da extensão.
 *
 * Antes elas eram feitas à mão e guardadas em `web-ext-artifacts/`, que o git
 * ignora: sumiam num clone novo e envelheciam em silêncio a cada mudança de
 * interface. A versão anterior ainda mostrava o ícone antigo e o indicador do
 * item ativo invisível, corrigido na 3.1.3.
 *
 * As páginas são abertas do próprio `src/`, com o tema fixado e sem barra de
 * rolagem, então a captura é a interface de verdade e não uma montagem.
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
const outputDir = join(projectRoot, 'docs', 'amo-listing');

const WIDTH = 1280;
const HEIGHT = 800;
const THEME = 'dark';

/** Cada captura conta uma coisa que a listagem precisa comunicar. */
const SHOTS = [
    { file: '01-configuracoes.png', page: 'src/options/options.html' },
    { file: '02-privacidade-local.png', page: 'src/privacy/privacy.html' },
    { file: '03-ajuda-e-transparencia.png', page: 'src/help/help.html' }
];

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
            'Firefox não encontrado. Instale o Firefox ou defina FIREFOX_BINARY '
            + `com o caminho do executável. Procurei em:\n  ${FIREFOX_CANDIDATES.join('\n  ')}`
        );
    }
    return found;
}

/**
 * Reescreve a página para rodar fora do contexto da extensão.
 *
 * Os caminhos relativos viram file:// absolutos, o tema é fixado (appearance.js
 * depende de browser.storage e não roda aqui) e os scripts de runtime saem —
 * eles abortam sozinhos sem a API, mas removê-los evita erro no console.
 */
async function prepare(page, workDir) {
    const source = join(projectRoot, page);
    const pageDir = dirname(source);
    let html = await readFile(source, 'utf8');

    html = html.replace(
        /\sclass="appearance-pending"/,
        ` data-theme="${THEME}" data-motion="reduced"`
    );
    html = html.replace(/(?:src|href)="([^"]+)"/g, (match, reference) => {
        if (/^(https?:|data:|#|mailto:)/.test(reference)) return match;
        const attribute = match.startsWith('src') ? 'src' : 'href';
        return `${attribute}="${pathToFileURL(resolve(pageDir, reference)).href}"`;
    });
    // A tag de fechamento também aceita atributos e maiúsculas, e um script
    // pode ter corpo: casar só `<script …></script>` deixava passar formas
    // válidas. O espaço no lugar da remoção impede que o texto ao redor se
    // junte e recrie uma tag que já tinha sido tirada.
    html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ');
    // Duas correções que só valem para a captura, nunca para o produto:
    // a barra de rolagem estreitava o viewport e aparecia nas imagens antigas;
    // e `animate-fade-in` parte de opacity 0 — o Firefox fotografa logo após o
    // load e pegava o quadro zero, gerando uma imagem inteiramente vazia.
    html = html.replace(
        '</head>',
        '<style>html{scrollbar-width:none}'
        + '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important}'
        + '</style></head>'
    );

    const target = join(workDir, page.replaceAll('/', '_'));
    await writeFile(target, html, 'utf8');
    return target;
}

async function main() {
    const firefox = findFirefox();
    const workDir = await mkdtemp(join(tmpdir(), 'guardiao-listing-'));
    const profile = join(workDir, 'profile');
    await mkdir(profile, { recursive: true });
    await mkdir(outputDir, { recursive: true });

    try {
        for (const shot of SHOTS) {
            const page = await prepare(shot.page, workDir);
            const destination = join(outputDir, shot.file);
            const result = spawnSync(firefox, [
                '--headless',
                '-profile', profile,
                `--window-size=${WIDTH},${HEIGHT}`,
                `--screenshot=${destination}`,
                pathToFileURL(page).href
            ], { encoding: 'utf8', windowsHide: true });
            if (result.error) throw result.error;
            if (!existsSync(destination)) {
                throw new Error(`Firefox não gravou ${shot.file}.\n${result.stderr || ''}`);
            }
            console.log(`shot ${relative(projectRoot, destination)} (${WIDTH}x${HEIGHT}, ${shot.page})`);
        }
    } finally {
        await rm(workDir, { recursive: true, force: true });
    }

    console.log(`\n${SHOTS.length} capturas em ${relative(projectRoot, outputDir)}.`);
    console.log('Reveja antes de enviar: a interface muda e a captura não avisa.');
}

await main();
