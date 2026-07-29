import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = join(projectRoot, 'web-ext-artifacts');

function run(command, args) {
    const result = spawnSync(command, args, {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: 'inherit',
        windowsHide: true
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} terminou com código ${result.status}`);
    }
}

function runNpx(args) {
    if (process.platform === 'win32') {
        run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npx.cmd', ...args]);
    } else {
        run('npx', args);
    }
}

await mkdir(artifacts, { recursive: true });
run(process.execPath, ['tools/build.mjs', '--firefox']);
runNpx([
    '--yes',
    'web-ext@10',
    'lint',
    '--source-dir',
    'dist',
    '--warnings-as-errors'
]);
runNpx([
    '--yes',
    'web-ext@10',
    'build',
    '--source-dir',
    'dist',
    '--artifacts-dir',
    'web-ext-artifacts',
    '--overwrite-dest'
]);

console.log(`Pacote AMO validado em ${artifacts}.`);
