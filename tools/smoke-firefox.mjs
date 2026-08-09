import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import webExt from 'web-ext';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(projectRoot, 'dist', 'firefox');
if (!existsSync(join(sourceDir, 'manifest.json'))) {
    throw new Error('Build Firefox ausente. Execute `npm run build:firefox` primeiro.');
}

let runner;
try {
    runner = await webExt.cmd.run({
        sourceDir,
        firefox: process.env.FIREFOX_BINARY || undefined,
        args: ['-headless'],
        noInput: true,
        noReload: true,
        startUrl: ['about:blank']
    }, {
        shouldExitProgram: false
    });

    // Recarregar pela conexão de depuração prova que o Firefox iniciou,
    // instalou a extensão temporária e está respondendo ao web-ext.
    await runner.reloadAllExtensions();
    console.log('Smoke Firefox aprovado: extensão instalada e worker recarregado em headless.');
} finally {
    await runner?.exit();
}
