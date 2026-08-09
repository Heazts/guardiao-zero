/**
 * Gera toda a identidade Limiar Orbital — SVG e PNG — a partir de uma única
 * especificação geométrica.
 *
 * A órbita aberta reúne o zero e o G de Guardião. O braço central registra a
 * interceptação, enquanto a haste vertical representa o limiar local.
 *
 * Antes existiam duas descrições do mesmo desenho: o SVG escrito à mão e um
 * script Python que redesenhava a figura com arcos elípticos do Pillow. As duas
 * divergiam (o SVG usa curvas de Bézier; o Pillow usava um arco em caixa não
 * quadrada), então o ícone da barra não era o mesmo símbolo do cabeçalho. Aqui
 * a geometria existe uma vez: o SVG é emitido a partir dela e o PNG é
 * rasterizado a partir dela. Não há como um sair do outro.
 *
 * O rasterizador é próprio e sem dependências — campo de distância com
 * antisserrilhado analítico, mais um codificador PNG sobre o zlib do Node.
 * Isso mantém `npm run build:icons` reprodutível em qualquer máquina com
 * Node 22+, sem Pillow, Inkscape ou binários nativos.
 */

import { deflateSync, inflateSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Geometria canônica (espaço de 40 × 40 unidades)
// ---------------------------------------------------------------------------

const STROKE = 4;
const INK = [17, 17, 17];
const PAPER = [255, 255, 255];

/**
 * Selo: quadrado arredondado que emoldura o símbolo.
 *
 * O símbolo tem 29 unidades de altura, então `side` define quanto do ícone ele
 * ocupa: 29/47 ≈ 62 %. Num viewBox de 40 o símbolo ficaria em 72 % e, a 16 px,
 * o contraforma do C fechava e o ícone virava uma mancha. 62 % é a proporção
 * que a geração anterior já usava e que se mantém legível em 16 px.
 */
const BADGE = { side: 47, inset: 1.5, radius: 7 };

/** Órbita aberta, como dois cúbicos encadeados. */
const ORBIT = {
    start: [24.5, 9.4],
    cubics: [
        [[14.7, 6.1], [7.5, 10.8], [7.5, 20]],
        [[7.5, 29.2], [14.7, 33.9], [24.5, 30.6]]
    ]
};

/** Braço de interceptação e haste do limiar. */
const BARS = [
    [[20.5, 20], [29.5, 20]],
    [[29.5, 7.5], [29.5, 32.5]]
];

/**
 * Lado do viewBox quadrado usado pelo glifo sem selo.
 *
 * Ícones de barra de ferramentas não têm moldura dando respiro, então o
 * símbolo pode ocupar mais área que dentro do selo: 29/36 ≈ 81 %. A folga
 * restante equivale a ~1,5 px em 16 px, o suficiente para o traço não encostar
 * na borda em telas @1x.
 */
const GLYPH_SIDE = 36;

// ---------------------------------------------------------------------------
// Achatamento das curvas e construção das formas
// ---------------------------------------------------------------------------

const FLATTEN_STEPS = 96;

function cubicSamples(p0, p1, p2, p3, steps) {
    const points = [];
    for (let index = 1; index <= steps; index += 1) {
        const t = index / steps;
        const u = 1 - t;
        points.push([
            u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
        ]);
    }
    return points;
}

function orbitPolyline(steps = FLATTEN_STEPS) {
    let current = ORBIT.start;
    const points = [current];
    for (const [control1, control2, end] of ORBIT.cubics) {
        points.push(...cubicSamples(current, control1, control2, end, steps));
        current = end;
    }
    return points;
}

/**
 * Converte uma polilinha traçada em formas convexas com distância exata.
 *
 * Cada segmento vira uma caixa orientada; cada vértice interno vira um disco
 * (a junção). Numa curva amostrada densamente a junção redonda é
 * indistinguível da junção em meia-esquadria do SVG. As pontas recebem a
 * extensão de meio traço do `stroke-linecap="square"`.
 */
function strokeShapes(points, width, cap) {
    const half = width / 2;
    const shapes = [];
    const squareCap = cap === 'square';

    for (let index = 0; index < points.length - 1; index += 1) {
        const [ax, ay] = points[index];
        const [bx, by] = points[index + 1];
        const length = Math.hypot(bx - ax, by - ay);
        if (length === 0) continue;
        const ux = (bx - ax) / length;
        const uy = (by - ay) / length;
        const startCap = squareCap && index === 0 ? half : 0;
        const endCap = squareCap && index === points.length - 2 ? half : 0;
        const offset = (length + endCap - startCap) / 2;
        shapes.push({
            kind: 'box',
            cx: ax + ux * offset,
            cy: ay + uy * offset,
            ux,
            uy,
            hu: (length + startCap + endCap) / 2,
            hv: half
        });
    }

    for (let index = 1; index < points.length - 1; index += 1) {
        shapes.push({ kind: 'disc', cx: points[index][0], cy: points[index][1], r: half });
    }
    return shapes;
}

function markShapes() {
    return [
        ...strokeShapes(orbitPolyline(), STROKE, 'square'),
        ...BARS.flatMap(segment => strokeShapes(segment, STROKE, 'square'))
    ];
}

function badgeShape() {
    return {
        kind: 'roundrect',
        x0: BADGE.inset,
        y0: BADGE.inset,
        x1: BADGE.side - BADGE.inset,
        y1: BADGE.side - BADGE.inset,
        r: BADGE.radius
    };
}

function shapeBounds(shape) {
    if (shape.kind === 'disc') {
        return [shape.cx - shape.r, shape.cy - shape.r, shape.cx + shape.r, shape.cy + shape.r];
    }
    if (shape.kind === 'roundrect') {
        return [shape.x0, shape.y0, shape.x1, shape.y1];
    }
    // A perpendicular de (ux, uy) é (-uy, ux); daí a troca nos coeficientes.
    const extentX = Math.abs(shape.ux) * shape.hu + Math.abs(shape.uy) * shape.hv;
    const extentY = Math.abs(shape.uy) * shape.hu + Math.abs(shape.ux) * shape.hv;
    return [shape.cx - extentX, shape.cy - extentY, shape.cx + extentX, shape.cy + extentY];
}

function bounds(shapes) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const shape of shapes) {
        const [sx0, sy0, sx1, sy1] = shapeBounds(shape);
        if (sx0 < x0) x0 = sx0;
        if (sy0 < y0) y0 = sy0;
        if (sx1 > x1) x1 = sx1;
        if (sy1 > y1) y1 = sy1;
    }
    return [x0, y0, x1, y1];
}

/**
 * Deslocamento que centra o símbolo no quadrado do selo.
 *
 * O desenho original nascia 1,5 unidade à esquerda do centro — a haste do
 * limiar puxava a massa para a direita e a moldura ficava com margens
 * desiguais. Centrar aqui corrige isso em todas as saídas de uma vez.
 */
function markOffset() {
    const [x0, y0, x1, y1] = bounds(markShapes());
    return [
        round((BADGE.side - (x1 - x0)) / 2 - x0),
        round((BADGE.side - (y1 - y0)) / 2 - y0)
    ];
}

/** Canto superior esquerdo do viewBox quadrado e justo usado pelo glifo. */
function glyphOrigin() {
    const [x0, y0, x1, y1] = bounds(markShapes());
    return [
        round((x0 + x1) / 2 - GLYPH_SIDE / 2),
        round((y0 + y1) / 2 - GLYPH_SIDE / 2)
    ];
}

function round(value) {
    return Number(value.toFixed(3));
}

// ---------------------------------------------------------------------------
// Emissão de SVG
// ---------------------------------------------------------------------------

function point(coordinates) {
    return `${round(coordinates[0])} ${round(coordinates[1])}`;
}

function orbitPathData() {
    let data = `M${point(ORBIT.start)}`;
    for (const [control1, control2, end] of ORBIT.cubics) {
        data += `C${point(control1)} ${point(control2)} ${point(end)}`;
    }
    return data;
}

function barsPathData() {
    return BARS.map(([from, to]) => `M${point(from)}L${point(to)}`).join('');
}

function markMarkup(stroke, indent) {
    const [offsetX, offsetY] = markOffset();
    const transform = offsetX === 0 && offsetY === 0
        ? ''
        : ` transform="translate(${offsetX} ${offsetY})"`;
    const attributes = `fill="none" stroke="${stroke}" stroke-width="${STROKE}" stroke-linecap="square"`;
    return [
        `${indent}<g${transform} ${attributes}>`,
        `${indent}    <path d="${orbitPathData()}"/>`,
        `${indent}    <path d="${barsPathData()}"/>`,
        `${indent}</g>`
    ].join('\n');
}

function badgeSvg({ size, background, foreground, title }) {
    const dimensions = size ? ` width="${size}" height="${size}"` : '';
    const { side, inset, radius } = BADGE;
    return [
        `<svg xmlns="http://www.w3.org/2000/svg"${dimensions} viewBox="0 0 ${side} ${side}" role="img" aria-labelledby="title">`,
        `    <title id="title">${title}</title>`,
        `    <rect x="${inset}" y="${inset}" width="${side - inset * 2}" height="${side - inset * 2}" rx="${radius}" fill="${background}"/>`,
        markMarkup(foreground, '    '),
        '</svg>',
        ''
    ].join('\n');
}

/**
 * Glifo sem selo. O viewBox é recortado em volta do próprio símbolo, então o
 * desenho fica nas coordenadas originais — sem o translate de centragem, que
 * só existe para acomodar a moldura.
 */
function glyphSvg({ title, stroke }) {
    const [originX, originY] = glyphOrigin();
    const attributes = `fill="none" stroke="${stroke}" stroke-width="${STROKE}" stroke-linecap="square"`;
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${originX} ${originY} ${GLYPH_SIDE} ${GLYPH_SIDE}" role="img" aria-labelledby="title">`,
        `    <title id="title">${title}</title>`,
        `    <g ${attributes}>`,
        `        <path d="${orbitPathData()}"/>`,
        `        <path d="${barsPathData()}"/>`,
        '    </g>',
        '</svg>',
        ''
    ].join('\n');
}

// ---------------------------------------------------------------------------
// Rasterizador
// ---------------------------------------------------------------------------

function transformShape(shape, scale, dx, dy) {
    if (shape.kind === 'disc') {
        return { kind: 'disc', cx: shape.cx * scale + dx, cy: shape.cy * scale + dy, r: shape.r * scale };
    }
    if (shape.kind === 'roundrect') {
        return {
            kind: 'roundrect',
            x0: shape.x0 * scale + dx,
            y0: shape.y0 * scale + dy,
            x1: shape.x1 * scale + dx,
            y1: shape.y1 * scale + dy,
            r: shape.r * scale
        };
    }
    return {
        kind: 'box',
        cx: shape.cx * scale + dx,
        cy: shape.cy * scale + dy,
        ux: shape.ux,
        uy: shape.uy,
        hu: shape.hu * scale,
        hv: shape.hv * scale
    };
}

/** Distância com sinal do ponto até a forma, em pixels. */
function signedDistance(shape, px, py) {
    if (shape.kind === 'disc') {
        return Math.hypot(px - shape.cx, py - shape.cy) - shape.r;
    }
    if (shape.kind === 'roundrect') {
        const halfWidth = (shape.x1 - shape.x0) / 2;
        const halfHeight = (shape.y1 - shape.y0) / 2;
        const qx = Math.abs(px - (shape.x0 + halfWidth)) - (halfWidth - shape.r);
        const qy = Math.abs(py - (shape.y0 + halfHeight)) - (halfHeight - shape.r);
        return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - shape.r;
    }
    const rx = px - shape.cx;
    const ry = py - shape.cy;
    const du = Math.abs(rx * shape.ux + ry * shape.uy) - shape.hu;
    const dv = Math.abs(ry * shape.ux - rx * shape.uy) - shape.hv;
    return Math.hypot(Math.max(du, 0), Math.max(dv, 0)) + Math.min(Math.max(du, dv), 0);
}

/**
 * Cobertura por pixel da união das formas.
 *
 * A união de campos de distância é o mínimo deles, e o antisserrilhado sai da
 * própria distância: a rampa de um pixel em torno da borda dá a fração coberta
 * sem precisar de supersampling.
 */
function coverage(shapes, size) {
    const map = new Float64Array(size * size);
    const boxes = shapes.map(shapeBounds);

    // Uma curva achatada vira ~200 formas minúsculas, e testar todas em cada
    // pixel dominava o tempo do lint. Uma forma só influencia um pixel se ele
    // cair na caixa dela alargada pela rampa de meio pixel — indexar por linha
    // e recortar por coluna reduz o laço interno a um punhado de candidatas.
    const rows = Array.from({ length: size }, () => []);
    for (let index = 0; index < shapes.length; index += 1) {
        const first = Math.max(0, Math.floor(boxes[index][1] - 0.5));
        const last = Math.min(size - 1, Math.ceil(boxes[index][3] + 0.5));
        for (let y = first; y <= last; y += 1) rows[y].push(index);
    }

    for (let y = 0; y < size; y += 1) {
        const bucket = rows[y];
        if (bucket.length === 0) continue;
        const py = y + 0.5;
        for (let x = 0; x < size; x += 1) {
            const px = x + 0.5;
            let nearest = Infinity;
            for (const index of bucket) {
                const box = boxes[index];
                if (px < box[0] - 0.5 || px > box[2] + 0.5) continue;
                const distance = signedDistance(shapes[index], px, py);
                if (distance < nearest) {
                    nearest = distance;
                    if (nearest <= -0.5) break;
                }
            }
            map[y * size + x] = Math.min(1, Math.max(0, 0.5 - nearest));
        }
    }
    return map;
}

/** Compõe as camadas em RGBA não pré-multiplicado (source-over). */
function compose(size, layers) {
    const rgba = new Uint8Array(size * size * 4);
    for (const layer of layers) {
        const map = coverage(layer.shapes, size);
        for (let index = 0; index < map.length; index += 1) {
            const sourceAlpha = map[index];
            if (sourceAlpha <= 0) continue;
            const offset = index * 4;
            const destinationAlpha = rgba[offset + 3] / 255;
            const outAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
            for (let channel = 0; channel < 3; channel += 1) {
                const source = layer.color[channel] * sourceAlpha;
                const destination = rgba[offset + channel] * destinationAlpha * (1 - sourceAlpha);
                rgba[offset + channel] = Math.round((source + destination) / outAlpha);
            }
            rgba[offset + 3] = Math.round(outAlpha * 255);
        }
    }
    return rgba;
}

// ---------------------------------------------------------------------------
// PNG (RGBA 8 bits, filtro 0)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    return table;
})();

function crc32(buffer) {
    let crc = -1;
    for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(data.length, 0);
    header.write(type, 4, 'ascii');
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), data])), 0);
    return Buffer.concat([header, data, checksum]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function encodePng(size, rgba) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header[8] = 8; // profundidade
    header[9] = 6; // RGBA
    const stride = size * 4;
    const raw = Buffer.alloc(size * (stride + 1));
    for (let y = 0; y < size; y += 1) {
        raw[y * (stride + 1)] = 0; // filtro None
        raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
    }
    return Buffer.concat([
        PNG_SIGNATURE,
        pngChunk('IHDR', header),
        pngChunk('IDAT', deflateSync(raw, { level: 9 })),
        pngChunk('IEND', Buffer.alloc(0))
    ]);
}

/**
 * Decodifica apenas o que este arquivo escreve (RGBA 8 bits, filtro 0).
 *
 * Serve ao teste de deriva: comparar bytes do arquivo seria frágil, porque a
 * saída do deflate muda com a versão do zlib. Comparar pixels não muda.
 */
export function decodePng(buffer) {
    if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Assinatura PNG inválida');
    let offset = 8;
    const parts = [];
    let size = 0;
    while (offset < buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        const data = buffer.subarray(offset + 8, offset + 8 + length);
        if (type === 'IHDR') {
            size = data.readUInt32BE(0);
            if (data.readUInt32BE(4) !== size) throw new Error('PNG não quadrado');
            if (data[8] !== 8 || data[9] !== 6) throw new Error('PNG fora do formato RGBA de 8 bits');
        } else if (type === 'IDAT') {
            parts.push(data);
        } else if (type === 'IEND') {
            break;
        }
        offset += 12 + length;
    }
    const raw = inflateSync(Buffer.concat(parts));
    const stride = size * 4;
    const rgba = new Uint8Array(size * stride);
    for (let y = 0; y < size; y += 1) {
        if (raw[y * (stride + 1)] !== 0) throw new Error('Filtro PNG inesperado');
        rgba.set(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride), y * stride);
    }
    return { size, rgba };
}

// ---------------------------------------------------------------------------
// Variantes
// ---------------------------------------------------------------------------

/** Selo completo: fundo de tinta com o símbolo vazado. */
function renderBadge(size, background = INK, foreground = PAPER) {
    const scale = size / BADGE.side;
    const [offsetX, offsetY] = markOffset();
    return compose(size, [
        { shapes: [transformShape(badgeShape(), scale, 0, 0)], color: background },
        {
            shapes: markShapes().map(shape =>
                transformShape(shape, scale, offsetX * scale, offsetY * scale)),
            color: foreground
        }
    ]);
}

/** Glifo monocromático sem selo, para as `theme_icons` da barra. */
function renderGlyph(size, color) {
    const scale = size / GLYPH_SIDE;
    const [originX, originY] = glyphOrigin();
    return compose(size, [
        {
            shapes: markShapes().map(shape =>
                transformShape(shape, scale, -originX * scale, -originY * scale)),
            color
        }
    ]);
}

export function renderVariant(variant, size) {
    if (variant === 'badge') return renderBadge(size);
    if (variant === 'glyph-light') return renderGlyph(size, PAPER);
    if (variant === 'glyph-dark') return renderGlyph(size, INK);
    throw new Error(`Variante desconhecida: ${variant}`);
}

/** Tudo que o projeto publica, com a variante que cada alvo exige. */
export const RASTER_TARGETS = [
    { path: 'assets/icons/icon-16.png', size: 16, variant: 'badge' },
    { path: 'assets/icons/icon-32.png', size: 32, variant: 'badge' },
    { path: 'assets/icons/icon-48.png', size: 48, variant: 'badge' },
    { path: 'assets/icons/icon-128.png', size: 128, variant: 'badge' },
    { path: 'assets/icons/icon-light-16.png', size: 16, variant: 'glyph-light' },
    { path: 'assets/icons/icon-light-32.png', size: 32, variant: 'glyph-light' },
    { path: 'assets/icons/icon-light-48.png', size: 48, variant: 'glyph-light' },
    { path: 'assets/icons/icon-dark-16.png', size: 16, variant: 'glyph-dark' },
    { path: 'assets/icons/icon-dark-32.png', size: 32, variant: 'glyph-dark' },
    { path: 'assets/icons/icon-dark-48.png', size: 48, variant: 'glyph-dark' },
    // Kit de loja/imprensa: fora de assets/, para não entrar no pacote da extensão.
    { path: 'docs/assets/brand/limiar-orbital-128.png', size: 128, variant: 'badge' },
    { path: 'docs/assets/brand/limiar-orbital-512.png', size: 512, variant: 'badge' }
];

export const VECTOR_TARGETS = [
    {
        path: 'assets/brand/limiar-orbital.svg',
        content: () => badgeSvg({
            background: '#111111',
            foreground: '#ffffff',
            title: 'Símbolo Limiar Orbital'
        })
    },
    {
        // Enviado ao AMO e à imprensa: mesmas curvas, com tamanho declarado
        // para ferramentas que exigem width/height explícitos.
        path: 'docs/assets/brand/limiar-orbital-amo.svg',
        content: () => badgeSvg({
            size: 128,
            background: '#111111',
            foreground: '#ffffff',
            title: 'Guardião Zero Pro — Limiar Orbital'
        })
    },
    {
        // Para uso embutido em interface: herda a cor do texto ao redor.
        path: 'docs/assets/brand/limiar-orbital-glyph.svg',
        content: () => glyphSvg({
            stroke: 'currentColor',
            title: 'Símbolo Limiar Orbital'
        })
    }
];

// ---------------------------------------------------------------------------
// Escrita e verificação de deriva
// ---------------------------------------------------------------------------

function pixelsDiffer(a, b) {
    if (a.length !== b.length) return true;
    for (let index = 0; index < a.length; index += 1) {
        // Uma unidade de folga absorve arredondamento entre versões do Node.
        if (Math.abs(a[index] - b[index]) > 1) return true;
    }
    return false;
}

/**
 * Confere se os arquivos versionados ainda correspondem à geometria.
 * Usado por tools/validate.mjs — editar um SVG à mão passa a falhar o lint.
 */
export async function brandAssetsAreCurrent() {
    const drift = [];
    for (const target of VECTOR_TARGETS) {
        const absolute = join(projectRoot, target.path);
        const expected = target.content();
        const actual = await readFile(absolute, 'utf8').catch(() => null);
        if (actual === null) drift.push(`Ativo de marca ausente: ${target.path}`);
        else if (actual !== expected) drift.push(`${target.path} divergiu da geometria; rode npm run build:icons`);
    }
    for (const target of RASTER_TARGETS) {
        const absolute = join(projectRoot, target.path);
        const file = await readFile(absolute).catch(() => null);
        if (file === null) {
            drift.push(`Ativo de marca ausente: ${target.path}`);
            continue;
        }
        let decoded;
        try {
            decoded = decodePng(file);
        } catch (error) {
            drift.push(`${target.path} não é um PNG gerado por build:icons: ${error.message}`);
            continue;
        }
        if (decoded.size !== target.size
            || pixelsDiffer(decoded.rgba, renderVariant(target.variant, target.size))) {
            drift.push(`${target.path} divergiu da geometria; rode npm run build:icons`);
        }
    }
    return { ok: drift.length === 0, drift };
}

async function writeAll() {
    for (const target of VECTOR_TARGETS) {
        const absolute = join(projectRoot, target.path);
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, target.content(), 'utf8');
        console.log(`svg  ${relative(projectRoot, absolute)}`);
    }
    for (const target of RASTER_TARGETS) {
        const absolute = join(projectRoot, target.path);
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, encodePng(target.size, renderVariant(target.variant, target.size)));
        console.log(`png  ${relative(projectRoot, absolute)} (${target.size}px)`);
    }
}

const directExecution = process.argv[1]
    && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (directExecution) {
    if (process.argv.includes('--check')) {
        const result = await brandAssetsAreCurrent();
        if (!result.ok) console.error(result.drift.join('\n'));
        else console.log('Ativos de marca em dia com a geometria.');
        process.exitCode = result.ok ? 0 : 1;
    } else {
        await writeAll();
    }
}
