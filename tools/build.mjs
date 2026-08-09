import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateProject } from './validate.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = resolve(projectRoot, 'dist');
const chromiumServiceWorker = 'src/background/service-worker.js';

// Cada alvo tem seu próprio diretório. Antes os dois escreviam em dist/ e se
// sobrescreviam, o que impedia manter as duas versões carregadas ao mesmo
// tempo — e fazia carregar o build de Firefox no Chrome silenciosamente, onde
// a ausência de service_worker impede a extensão inteira de carregar.
function outputFor(target) {
    return resolve(distRoot, target);
}

/**
 * Entradas que só existem para gerar código e não fazem parte do pacote.
 *
 * As seed lists já foram convertidas em `src/background/rules/*.json` e
 * `src/background/cosmetic-filters.js` por tools/build-rules.mjs. Enviá-las
 * junto adiciona peso morto e dá ao revisor da loja um segundo lugar onde
 * procurar a mesma informação.
 */
const BUILD_ONLY = [
    // O diretório inteiro é entrada de build, nunca saída. Excluir só
    // `filters/sources` deixava um `src/filters/` vazio dentro do pacote depois
    // que a lista legada saiu do repositório. Barrar a pasta toda também impede
    // que uma lista sem proveniência comprovada volte a um artefato público por
    // descuido — a trava de `package-amo.mjs` continua como segunda linha.
    join('src', 'filters')
];

function isBuildOnly(path) {
    const relativePath = relative(projectRoot, path);
    return BUILD_ONLY.some(
        excluded => relativePath === excluded || relativePath.startsWith(`${excluded}${sep}`)
    );
}

function assertSafeOutputPath(outputRoot) {
    if (outputRoot === projectRoot || !outputRoot.startsWith(`${projectRoot}${sep}`)) {
        throw new Error(`Diretório de saída inseguro: ${outputRoot}`);
    }
}

async function clean(outputRoot = distRoot) {
    assertSafeOutputPath(outputRoot);
    await rm(outputRoot, { recursive: true, force: true });
}

async function build(target) {
    const outputRoot = outputFor(target);
    const validation = await validateProject({ quiet: true });
    if (!validation.ok) {
        throw new Error(`Validação falhou:\n${validation.errors.join('\n')}`);
    }

    await clean(outputRoot);
    await mkdir(outputRoot, { recursive: true });
    for (const source of ['manifest.json', 'assets', 'src']) {
        const absoluteSource = join(projectRoot, source);
        const absoluteDestination = join(outputRoot, source);
        await cp(absoluteSource, absoluteDestination, {
            recursive: true,
            filter: path => !isBuildOnly(path)
        });
    }

    const manifestPath = join(outputRoot, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (target === 'firefox') {
        delete manifest.background.service_worker;
    } else if (target === 'chromium') {
        manifest.background.service_worker = chromiumServiceWorker;
        delete manifest.background.scripts;
        delete manifest.browser_specific_settings;
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    console.log(
        `Build ${target} reproduzível criado em ${relative(projectRoot, outputRoot)}.`
    );
    console.log(`Carregue esta pasta no navegador: ${relative(projectRoot, outputRoot)}`);
}

if (process.argv.includes('--clean')) {
    await clean();
    console.log('Diretório dist removido.');
} else {
    const target = process.argv.includes('--chromium') ? 'chromium' : 'firefox';
    await build(target);
}
