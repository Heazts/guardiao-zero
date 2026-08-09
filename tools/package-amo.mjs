import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = join(projectRoot, 'web-ext-artifacts');
const firefoxDist = join(projectRoot, 'dist', 'firefox');
const packagePath = join(projectRoot, 'package.json');
const webExtPackagePath = join(projectRoot, 'node_modules', 'web-ext', 'package.json');

function run(command, args) {
    const result = spawnSync(command, args, {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: 'inherit',
        env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
        windowsHide: true
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} terminou com código ${result.status}`);
    }
}

function capture(command, args) {
    const result = spawnSync(command, args, {
        cwd: projectRoot,
        encoding: 'utf8',
        env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
        windowsHide: true
    });
    return result.status === 0 ? result.stdout.trim() : '';
}

function runNpm(args) {
    if (process.platform === 'win32') {
        run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd', ...args]);
    } else {
        run('npm', args);
    }
}

async function loadPinnedWebExt() {
    if (!existsSync(webExtPackagePath)) {
        throw new Error('Dependências ausentes. Execute `npm ci` antes de empacotar.');
    }
    const [projectPackage, webExtPackage] = await Promise.all([
        readFile(packagePath, 'utf8').then(JSON.parse),
        readFile(webExtPackagePath, 'utf8').then(JSON.parse)
    ]);
    const declaredVersion = projectPackage.devDependencies?.['web-ext'];
    if (!/^\d+\.\d+\.\d+$/.test(declaredVersion || '')) {
        throw new Error('web-ext deve estar fixado numa versão exata em devDependencies');
    }
    if (declaredVersion !== webExtPackage.version) {
        throw new Error(
            `web-ext instalado (${webExtPackage.version}) diverge do package.json (${declaredVersion}); rode npm ci`
        );
    }
    const relativeBin = typeof webExtPackage.bin === 'string'
        ? webExtPackage.bin
        : webExtPackage.bin?.['web-ext'];
    if (!relativeBin) throw new Error('Executável web-ext não encontrado no pacote fixado');
    return {
        version: webExtPackage.version,
        bin: resolve(dirname(webExtPackagePath), relativeBin)
    };
}

async function assertFirefoxManifest() {
    const manifest = JSON.parse(await readFile(join(firefoxDist, 'manifest.json'), 'utf8'));
    if (manifest.background?.service_worker) {
        throw new Error('Build Firefox inválido: background.service_worker ainda está presente');
    }
    if (!Array.isArray(manifest.background?.scripts) || manifest.background.scripts.length === 0) {
        throw new Error('Build Firefox inválido: background.scripts está ausente');
    }
    const legacyBlocklist = join(firefoxDist, 'src', 'filters', 'heazts-blocklist.txt');
    if (existsSync(legacyBlocklist)) {
        throw new Error('Build Firefox contém a blocklist legada sem licença');
    }
    return manifest;
}

async function sha256(path) {
    return createHash('sha256').update(await readFile(path)).digest('hex').toUpperCase();
}

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 22) throw new Error(`Node.js 22+ é obrigatório; encontrado ${process.version}`);

const webExt = await loadPinnedWebExt();
await mkdir(artifacts, { recursive: true });

// Gates de release: o ZIP nunca é criado a partir de uma árvore não testada.
runNpm(['run', 'lint']);
runNpm(['test']);
runNpm(['run', 'build:firefox']);
runNpm(['run', 'build:chromium']);

const manifest = await assertFirefoxManifest();
run(process.execPath, [
    webExt.bin,
    'lint',
    '--source-dir',
    'dist/firefox',
    '--warnings-as-errors'
]);
run(process.execPath, [
    webExt.bin,
    'build',
    '--source-dir',
    'dist/firefox',
    '--artifacts-dir',
    'web-ext-artifacts',
    '--filename',
    'guardiao-zero-pro-{version}-firefox.zip',
    '--overwrite-dest'
]);

const artifact = join(artifacts, `guardiao-zero-pro-${manifest.version}-firefox.zip`);
const digest = await sha256(artifact);
const artifactInfo = await stat(artifact);
const sourceCommit = capture('git', ['rev-parse', 'HEAD']) || null;
const sourceDirty = Boolean(capture('git', ['status', '--porcelain']));
const releaseManifest = {
    schemaVersion: 1,
    extension: {
        name: manifest.name,
        version: manifest.version,
        geckoId: manifest.browser_specific_settings?.gecko?.id || null
    },
    artifact: {
        file: basename(artifact),
        bytes: artifactInfo.size,
        sha256: digest
    },
    build: {
        generatedAt: new Date().toISOString(),
        node: process.version,
        webExt: webExt.version,
        sourceCommit,
        sourceDirty,
        legacyUnlicensedBlocklistIncluded: false
    },
    gates: [
        'npm run lint',
        'npm test',
        'npm run build:firefox',
        'npm run build:chromium',
        `web-ext ${webExt.version} lint --warnings-as-errors`
    ]
};
const releaseManifestPath = join(
    artifacts,
    `guardiao-zero-pro-${manifest.version}-firefox.release.json`
);
const checksumPath = `${artifact}.sha256`;
await Promise.all([
    writeFile(releaseManifestPath, `${JSON.stringify(releaseManifest, null, 2)}\n`, 'utf8'),
    writeFile(checksumPath, `${digest}  ${basename(artifact)}\n`, 'utf8')
]);

console.log(`Pacote AMO validado: ${artifact}`);
console.log(`SHA-256: ${digest}`);
console.log(`Manifesto de release: ${releaseManifestPath}`);
console.log(`Checksum: ${checksumPath}`);
console.log('Envie ao AMO somente o ZIP acima; nunca compacte a raiz do repositório.');
