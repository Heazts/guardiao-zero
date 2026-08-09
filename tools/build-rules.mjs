import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

/**
 * Gera os rulesets estáticos de declarativeNetRequest a partir das seed lists
 * em sintaxe Adblock.
 *
 * A conversão usa exatamente o mesmo parser que valida listas importadas pelo
 * usuário em tempo de execução (src/shared/filters/filter-list-parser.js). Isso
 * garante que regra embarcada e regra importada passem pelo mesmo conjunto de
 * recusas de segurança — nada de cosmético, scriptlet, redirect, CSP, header
 * ou regex arbitrária entra no pacote.
 *
 * As listas de domínio deixam de ser JSON escrito à mão: editar cobertura passa
 * a ser editar um .txt legível, e a validação é automática.
 */

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const RULESETS = Object.freeze([
    {
        source: join('src', 'filters', 'sources', 'ads.txt'),
        output: join('src', 'background', 'rules', 'ads.json'),
        label: 'ads'
    },
    {
        source: join('src', 'filters', 'sources', 'trackers.txt'),
        output: join('src', 'background', 'rules', 'trackers.json'),
        label: 'trackers'
    }
]);

async function loadParser() {
    const context = vm.createContext({ URL, TextEncoder, TextDecoder, console });
    const source = await readFile(
        join(projectRoot, 'src', 'shared', 'filters', 'filter-list-parser.js'),
        'utf8'
    );
    vm.runInContext(source, context, { filename: 'filter-list-parser.js' });
    if (!context.GuardiaoFilterParser) throw new Error('Parser de filtros não carregou');
    return context.GuardiaoFilterParser;
}

/**
 * O parser vive em outro realm; os objetos que ele devolve carregam os
 * protótipos daquele contexto. Reconstruir aqui evita que JSON.stringify e as
 * comparações do validador tropecem nisso.
 */
function plainRule(rule, id) {
    const condition = {
        urlFilter: String(rule.condition.urlFilter),
        resourceTypes: Array.from(rule.condition.resourceTypes, String)
    };
    if (rule.condition.domainType) condition.domainType = String(rule.condition.domainType);
    if (rule.condition.initiatorDomains) {
        condition.initiatorDomains = Array.from(rule.condition.initiatorDomains, String);
    }
    if (rule.condition.excludedInitiatorDomains) {
        condition.excludedInitiatorDomains = Array.from(
            rule.condition.excludedInitiatorDomains,
            String
        );
    }
    if (rule.condition.isUrlFilterCaseSensitive) condition.isUrlFilterCaseSensitive = true;

    return {
        id,
        priority: Number(rule.priority),
        action: { type: String(rule.action.type) },
        condition
    };
}

export async function buildRuleset(parser, descriptor) {
    const text = await readFile(join(projectRoot, descriptor.source), 'utf8');
    const parsed = parser.parse(text);

    const rejections = [];
    for (const error of parsed.errors) {
        rejections.push(`  linha ${error.line} [${error.reason}] ${error.source}`);
    }

    const rules = [];
    let id = 1;
    for (const rule of parsed.rules) {
        if (rule.action.type !== 'block') {
            rejections.push(`  regra não-block descartada: ${rule.condition.urlFilter}`);
            continue;
        }
        rules.push(plainRule(rule, id));
        id += 1;
    }

    return {
        label: descriptor.label,
        output: descriptor.output,
        rules,
        rejections,
        stats: {
            lines: parsed.stats.lines,
            accepted: parsed.stats.accepted,
            rejected: parsed.stats.rejected,
            duplicates: parsed.stats.duplicates
        }
    };
}

export async function buildAllRulesets() {
    const parser = await loadParser();
    const results = [];
    for (const descriptor of RULESETS) {
        results.push(await buildRuleset(parser, descriptor));
    }
    return results;
}

const COSMETIC_SOURCE = join('src', 'filters', 'sources', 'cosmetic.txt');
const COSMETIC_OUTPUT = join('src', 'background', 'cosmetic-filters.js');

/**
 * O ocultamento embarcado vira um módulo clássico carregado junto do worker,
 * em vez de um JSON buscado em runtime: evita um fetch no caminho de cada
 * página e mantém o dado imutável.
 */
export async function buildCosmetic() {
    const parser = await loadParser();
    const text = await readFile(join(projectRoot, COSMETIC_SOURCE), 'utf8');
    const parsed = parser.parse(text);

    const rejections = parsed.errors.map(
        error => `  linha ${error.line} [${error.reason}] ${error.source}`
    );

    const generic = [];
    const specific = {};
    const exceptions = {};

    for (const rule of parsed.cosmetic) {
        const selector = String(rule.selector);
        const domains = Array.from(rule.domains, String);
        if (rule.exception) {
            for (const domain of domains) {
                (exceptions[domain] ||= []).push(selector);
            }
            continue;
        }
        if (domains.length === 0) {
            generic.push(selector);
            continue;
        }
        for (const domain of domains) {
            (specific[domain] ||= []).push(selector);
        }
    }

    const sortedSpecific = {};
    for (const domain of Object.keys(specific).sort()) {
        sortedSpecific[domain] = specific[domain].sort();
    }
    const sortedExceptions = {};
    for (const domain of Object.keys(exceptions).sort()) {
        sortedExceptions[domain] = exceptions[domain].sort();
    }

    return {
        label: 'cosmetic',
        source: COSMETIC_SOURCE,
        output: COSMETIC_OUTPUT,
        rejections,
        data: {
            generic: generic.sort(),
            specific: sortedSpecific,
            exceptions: sortedExceptions
        },
        stats: {
            lines: parsed.stats.lines,
            accepted: parsed.stats.cosmeticAccepted,
            rejected: parsed.stats.rejected,
            duplicates: parsed.stats.duplicates
        }
    };
}

function serializeCosmetic(data) {
    return `'use strict';\n\n`
        + `// GERADO POR tools/build-rules.mjs A PARTIR DE ${COSMETIC_SOURCE.replace(/\\/g, '/')}\n`
        + `// Não edite à mão: npm run lint falha se este arquivo divergir da fonte.\n\n`
        + `globalThis.GuardiaoCosmeticData = Object.freeze(${JSON.stringify(data, null, 4)});\n`;
}

function serialize(rules) {
    return `${JSON.stringify(rules, null, 2)}\n`;
}

export async function rulesetsAreCurrent() {
    const drift = [];

    const cosmetic = await buildCosmetic();
    const cosmeticPath = join(projectRoot, cosmetic.output);
    let currentCosmetic = '';
    try {
        currentCosmetic = await readFile(cosmeticPath, 'utf8');
    } catch {
        drift.push(`${cosmetic.output} não existe; rode npm run build:rules`);
    }
    if (currentCosmetic && currentCosmetic !== serializeCosmetic(cosmetic.data)) {
        drift.push(`${cosmetic.output} está dessincronizado de ${cosmetic.source}; rode npm run build:rules`);
    }
    if (cosmetic.rejections.length > 0) {
        drift.push(`cosmetic: ${cosmetic.rejections.length} linha(s) recusada(s) na seed list`);
    }

    for (const result of await buildAllRulesets()) {
        const path = join(projectRoot, result.output);
        let current = '';
        try {
            current = await readFile(path, 'utf8');
        } catch {
            drift.push(`${result.output} não existe; rode npm run build:rules`);
            continue;
        }
        if (current !== serialize(result.rules)) {
            drift.push(`${result.output} está dessincronizado de ${result.source ?? 'sua seed list'}; rode npm run build:rules`);
        }
        if (result.rejections.length > 0) {
            drift.push(`${result.label}: ${result.rejections.length} linha(s) recusada(s) na seed list`);
        }
    }
    return { ok: drift.length === 0, drift };
}

async function main() {
    const results = await buildAllRulesets();
    let failed = false;

    const cosmetic = await buildCosmetic();
    await writeFile(
        join(projectRoot, cosmetic.output),
        serializeCosmetic(cosmetic.data),
        'utf8'
    );
    const specificCount = Object.values(cosmetic.data.specific)
        .reduce((total, list) => total + list.length, 0);
    console.log(
        `cosmetic: ${cosmetic.data.generic.length} genéricos + ${specificCount} por domínio `
        + `de ${cosmetic.stats.lines} linhas (${cosmetic.stats.rejected} recusadas) `
        + `→ ${cosmetic.output}`
    );
    if (cosmetic.rejections.length > 0) {
        failed = true;
        console.error('\ncosmetic: linhas recusadas — corrija a seed list:');
        console.error(cosmetic.rejections.slice(0, 40).join('\n'));
    }

    for (const result of results) {
        await writeFile(join(projectRoot, result.output), serialize(result.rules), 'utf8');
        console.log(
            `${result.label}: ${result.rules.length} regras de ${result.stats.lines} linhas `
            + `(${result.stats.duplicates} duplicadas, ${result.stats.rejected} recusadas) `
            + `→ ${relative(projectRoot, join(projectRoot, result.output))}`
        );
        if (result.rejections.length > 0) {
            failed = true;
            console.error(`\n${result.label}: linhas recusadas — corrija a seed list:`);
            console.error(result.rejections.slice(0, 40).join('\n'));
            if (result.rejections.length > 40) {
                console.error(`  … e mais ${result.rejections.length - 40}`);
            }
        }
    }

    if (failed) {
        console.error('\nGeração concluída com recusas. Nenhuma linha deve ser recusada silenciosamente.');
        process.exitCode = 1;
    }
}

const directExecution = process.argv[1]
    && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (directExecution) await main();
