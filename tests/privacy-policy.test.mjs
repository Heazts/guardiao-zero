import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('política visível descreve as mesmas fronteiras de processamento local', async () => {
    const html = await readFile(resolve(projectRoot, 'src/privacy/privacy.html'), 'utf8');

    for (const disclosure of [
        'texto visível',
        'páginas autenticadas',
        'parâmetros de consulta e fragmentos são removidos',
        'não lê valores digitados',
        'Nomes de chaves de storage e de bancos IndexedDB',
        'padrões de apostas',
        'Última atualização / 09.08.2026'
    ]) {
        assert.ok(html.includes(disclosure), `divulgação ausente: ${disclosure}`);
    }

    assert.equal(html.includes('texto público limitado'), false);
    assert.equal(html.includes('valores de cookies'), false);
});
