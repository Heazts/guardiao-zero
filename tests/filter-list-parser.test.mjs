import assert from 'node:assert/strict';
import test from 'node:test';

import { loadRuntime } from './runtime-loader.mjs';

const runtime = await loadRuntime(['src/shared/filters/filter-list-parser.js']);
const parser = runtime.GuardiaoFilterParser;
const plain = value => JSON.parse(JSON.stringify(value));

test('converte metadados, comentários, HOSTS e domínios sem gerar IDs', () => {
    const result = plain(parser.parse([
        '[Adblock Plus 2.0]',
        '! Title: Lista de teste',
        '! Homepage: https://example.test/list',
        '! comentário',
        '# comentário hosts',
        '0.0.0.0 ads.example',
        '127.0.0.1 tracker.example metrics.example',
        'plain.example',
        ''
    ].join('\n')));

    assert.equal(result.ok, true);
    assert.equal(result.format, 'easylist');
    assert.equal(result.metadata.title, 'Lista de teste');
    assert.equal(result.metadata.homepage, 'https://example.test/list');
    assert.equal(result.stats.metadata, 3);
    assert.equal(result.stats.comments, 2);
    assert.equal(result.stats.accepted, 4);
    assert.deepEqual(
        result.rules.map(rule => rule.condition.urlFilter),
        ['||ads.example^', '||tracker.example^', '||metrics.example^', '||plain.example^']
    );
    assert.ok(result.rules.every(rule => !Object.hasOwn(rule, 'id')));
});

test('mapeia tipos, domain, third-party, important e match-case para DNR', () => {
    const result = plain(parser.parse(
        '||ads.example^$script,image,domain=site.example|~safe.example,third-party,important,match-case'
    ));
    assert.equal(result.stats.accepted, 1);

    const rule = result.rules[0];
    assert.equal(rule.priority, 3);
    assert.deepEqual(rule.action, { type: 'block' });
    assert.deepEqual(rule.condition, {
        urlFilter: '||ads.example^',
        resourceTypes: ['script', 'image'],
        domainType: 'thirdParty',
        initiatorDomains: ['site.example'],
        excludedInitiatorDomains: ['safe.example'],
        isUrlFilterCaseSensitive: true
    });
});

test('suporta exceções, from, first-party e aliases de resource type', () => {
    const result = plain(parser.parse(
        '@@||cdn.example^$css,xhr,frame,from=app.example,1p'
    ));
    assert.equal(result.stats.accepted, 1);
    assert.deepEqual(result.rules[0], {
        priority: 2,
        action: { type: 'allow' },
        condition: {
            urlFilter: '||cdn.example^',
            resourceTypes: ['sub_frame', 'stylesheet', 'xmlhttprequest'],
            domainType: 'firstParty',
            initiatorDomains: ['app.example']
        }
    });
});

test('preserva urlFilter ancorado e wildcard ASCII', () => {
    const result = plain(parser.parse(
        '|https://cdn.example/ads/*|$media,match-case'
    ));
    assert.equal(result.stats.accepted, 1);
    assert.deepEqual(result.rules[0].condition, {
        urlFilter: '|https://cdn.example/ads/*|',
        resourceTypes: ['media'],
        isUrlFilterCaseSensitive: true
    });
});

test('opções negativas removem tipos do conjunto portátil completo', () => {
    const result = plain(parser.parse('||assets.example^$~image,~media'));
    assert.equal(result.stats.accepted, 1);
    assert.equal(result.rules[0].condition.resourceTypes.includes('image'), false);
    assert.equal(result.rules[0].condition.resourceTypes.includes('media'), false);
    assert.equal(result.rules[0].condition.resourceTypes.includes('script'), true);
    assert.equal(result.rules[0].condition.resourceTypes.includes('main_frame'), true);
});

test('rejeita sintaxes não portáteis e informa cada motivo', () => {
    const result = plain(parser.parse([
        'example.com##.advert',
        '##.generic-advert',
        'example.com##+js(abort-current-script, foo)',
        'example.com##^script',
        '||one.example^$redirect=noopjs',
        '||two.example^$csp=script-src none',
        '||three.example^$removeparam=utm_source',
        '||four.example^$header=x-test',
        '/tracker\\d+$/',
        '||five.example^$popup'
    ].join('\n')));

    assert.equal(result.rules.length, 0);

    // Ocultamento de elemento passou a ser suportado: as duas primeiras linhas
    // viram regra cosmética em vez de recusa. Tudo que executa código, injeta
    // estilo, reescreve resposta ou altera header continua fora.
    assert.equal(result.cosmetic.length, 2);
    assert.deepEqual(
        result.cosmetic.map(rule => rule.selector).sort(),
        ['.advert', '.generic-advert']
    );

    assert.equal(result.stats.rejected, 8);
    assert.deepEqual(result.stats.reasons, {
        'unsupported-scriptlet': 1,
        'unsupported-html-filter': 1,
        'unsupported-redirect': 1,
        'unsupported-csp': 1,
        'unsupported-removeparam': 1,
        'unsupported-header': 1,
        'unsupported-regex': 1,
        'unsupported-option': 1
    });
});

test('deduplica regras normalizadas e rejeita combinações ambíguas', () => {
    const result = plain(parser.parse([
        '||ADS.EXAMPLE^',
        'ads.example',
        '||ads.example^',
        '||conflict.example^$first-party,third-party',
        '0.0.0.0 domínio inválido'
    ].join('\n')));

    assert.equal(result.stats.accepted, 1);
    assert.equal(result.stats.duplicates, 2);
    assert.equal(result.stats.reasons['conflicting-party-options'], 1);
    assert.equal(result.stats.reasons['invalid-hosts-entry'], 1);
});

test('aplica limite exato de 4 MB medido em UTF-8', () => {
    const ascii = parser.parse('a'.repeat(parser.LIMITS.sourceBytes + 1));
    assert.equal(ascii.ok, false);
    assert.equal(ascii.stats.reasons['source-too-large'], 1);

    const unicode = parser.parse('á'.repeat((parser.LIMITS.sourceBytes / 2) + 1));
    assert.equal(unicode.ok, false);
    assert.equal(unicode.stats.bytes, parser.LIMITS.sourceBytes + 2);
});

test('limita cada fonte a 12 mil regras sem truncamento silencioso', () => {
    const source = Array.from(
        { length: parser.LIMITS.rulesPerSource + 1 },
        (_, index) => `||host-${index}.example^`
    ).join('\n');
    const result = parser.parse(source);

    assert.equal(result.rules.length, parser.LIMITS.rulesPerSource);
    assert.equal(result.stats.accepted, parser.LIMITS.rulesPerSource);
    assert.equal(result.stats.reasons['rule-limit'], 1);
    assert.equal(result.stats.truncated, true);
});

test('normaliza descritores locais de fonte e deriva ID determinístico', () => {
    const input = {
        name: 'EasyPrivacy local',
        format: 'easyprivacy',
        category: 'privacy',
        enabled: false,
        checksum: 'a'.repeat(64),
        filename: 'easyprivacy.txt',
        sizeBytes: 1234,
        ruleCount: 50,
        acceptedCount: 50,
        rejectedCount: 3,
        importedAt: 100,
        updatedAt: 200
    };
    const first = plain(parser.normalizeSource(input));
    const second = plain(parser.normalizeSource(input));

    assert.equal(first.ok, true);
    assert.match(first.source.id, /^source-[a-f0-9]{8}$/);
    assert.equal(first.source.id, second.source.id);
    assert.equal(first.source.enabled, false);
    assert.equal(first.source.filename, 'easyprivacy.txt');
});

test('recusa descritores inseguros, limites inválidos e IDs duplicados', () => {
    assert.equal(parser.normalizeSource(null).ok, false);
    assert.equal(parser.normalizeSource({ name: 'x', format: 'javascript' }).ok, false);
    assert.equal(parser.normalizeSource({
        name: 'x',
        checksum: 'não-é-hash'
    }).ok, false);
    assert.equal(parser.normalizeSource({
        name: 'x',
        filename: '../lista.txt'
    }).ok, false);
    assert.equal(parser.normalizeSource({
        name: 'x',
        enabled: 'yes'
    }).ok, false);
    assert.equal(parser.normalizeSource({
        name: 'x',
        sizeBytes: parser.LIMITS.sourceBytes + 1
    }).ok, false);

    const normalized = plain(parser.normalizeSources([
        { id: 'same', name: 'Primeira' },
        { id: 'same', name: 'Segunda' },
        { id: 'bad id', name: 'Inválida' }
    ]));
    assert.equal(normalized.sources.length, 1);
    assert.equal(normalized.rejected.length, 2);
});

test('a saída é determinística para a mesma entrada', () => {
    const source = [
        '! Title: Determinística',
        '@@||allow.example^$document,important',
        '||block.example^$script,3p',
        '0.0.0.0 hosts.example'
    ].join('\n');
    assert.deepEqual(plain(parser.parse(source)), plain(parser.parse(source)));
});
