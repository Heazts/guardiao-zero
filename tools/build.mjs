import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateProject } from './validate.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = resolve(projectRoot, 'dist');

function assertSafeOutputPath() {
    if (outputRoot === projectRoot || !outputRoot.startsWith(`${projectRoot}${sep}`)) {
        throw new Error(`Diretório de saída inseguro: ${outputRoot}`);
    }
}

async function clean() {
    assertSafeOutputPath();
    await rm(outputRoot, { recursive: true, force: true });
}

async function build(target) {
    const validation = await validateProject({ quiet: true });
    if (!validation.ok) {
        throw new Error(`Validação falhou:\n${validation.errors.join('\n')}`);
    }

    await clean();
    await mkdir(outputRoot, { recursive: true });
    for (const source of ['manifest.json', 'assets', 'src']) {
        const absoluteSource = join(projectRoot, source);
        const absoluteDestination = join(outputRoot, source);
        await cp(absoluteSource, absoluteDestination, { recursive: true });
    }

    const manifestPath = join(outputRoot, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (target === 'firefox') {
        delete manifest.background.service_worker;
    } else if (target === 'chromium') {
        delete manifest.background.scripts;
        delete manifest.browser_specific_settings;
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    console.log(
        `Build ${target} reproduzível criado em ${relative(projectRoot, outputRoot)}.`
    );
}

if (process.argv.includes('--clean')) {
    await clean();
    console.log('Diretório dist removido.');
} else {
    const target = process.argv.includes('--chromium') ? 'chromium' : 'firefox';
    await build(target);
}
