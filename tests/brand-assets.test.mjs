import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    RASTER_TARGETS,
    VECTOR_TARGETS,
    brandAssetsAreCurrent,
    decodePng,
    renderVariant
} from '../tools/make-icons.mjs';

const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

function targetFor(path) {
    return RASTER_TARGETS.find(target => target.path === path);
}

test('os arquivos versionados correspondem à geometria do símbolo', async () => {
    const result = await brandAssetsAreCurrent();
    assert.deepEqual(result.drift, []);
});

test('todo ícone declarado no manifesto é gerado por build:icons', () => {
    const declared = new Set([
        ...Object.values(manifest.icons || {}),
        ...Object.values(manifest.action?.default_icon || {}),
        ...(manifest.action?.theme_icons || []).flatMap(entry => [entry.light, entry.dark])
    ]);
    for (const path of declared) {
        assert.ok(
            targetFor(path),
            `${path} está no manifesto mas não sai de tools/make-icons.mjs`
        );
    }
});

test('o manifesto declara cada ícone no tamanho em que ele foi rasterizado', () => {
    const sized = [
        ...Object.entries(manifest.icons || {}),
        ...Object.entries(manifest.action?.default_icon || {})
    ];
    for (const [size, path] of sized) {
        assert.equal(targetFor(path)?.size, Number(size), `${path} não tem ${size}px`);
    }
    for (const entry of manifest.action?.theme_icons || []) {
        assert.equal(targetFor(entry.light)?.size, entry.size, `${entry.light} não tem ${entry.size}px`);
        assert.equal(targetFor(entry.dark)?.size, entry.size, `${entry.dark} não tem ${entry.size}px`);
    }
});

test('as theme_icons usam o glifo na cor certa para cada barra', () => {
    for (const entry of manifest.action?.theme_icons || []) {
        // `light`/`dark` no manifesto nomeiam o tema da barra, não a cor da
        // arte: barra clara pede tinta escura. Trocar os dois deixa o ícone
        // invisível, e é um erro que só aparece olhando o navegador.
        assert.equal(targetFor(entry.light)?.variant, 'glyph-dark');
        assert.equal(targetFor(entry.dark)?.variant, 'glyph-light');
    }
});

test('o selo é opaco no centro e recortado nos cantos', async () => {
    const path = 'assets/icons/icon-128.png';
    const { size, rgba } = decodePng(await readFile(new URL(`../${path}`, import.meta.url)));
    assert.equal(size, 128);
    const alphaAt = (x, y) => rgba[(y * size + x) * 4 + 3];
    assert.equal(alphaAt(size / 2, size / 2), 255, 'o centro do selo deveria ser opaco');
    assert.equal(alphaAt(0, 0), 0, 'o canto deveria ficar fora do raio do selo');
});

test('o glifo não encosta na borda do quadro em 16 px', async () => {
    const { size, rgba } = decodePng(
        await readFile(new URL('../assets/icons/icon-dark-16.png', import.meta.url))
    );
    const alphaAt = (x, y) => rgba[(y * size + x) * 4 + 3];
    for (let index = 0; index < size; index += 1) {
        for (const [x, y] of [[index, 0], [index, size - 1], [0, index], [size - 1, index]]) {
            assert.equal(alphaAt(x, y), 0, `traço tocando a borda em ${x},${y}`);
        }
    }
});

test('o rasterizador é determinístico', () => {
    for (const target of VECTOR_TARGETS) {
        assert.equal(target.content(), target.content());
    }
    const first = renderVariant('badge', 32);
    assert.deepEqual([...renderVariant('badge', 32)], [...first]);
});
