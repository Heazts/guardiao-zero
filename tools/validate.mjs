import { readFile, readdir } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

async function walk(directory) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (['.git', 'dist', 'node_modules'].includes(entry.name)) continue;
        const absolute = join(directory, entry.name);
        if (entry.isDirectory()) files.push(...await walk(absolute));
        else files.push(absolute);
    }
    return files;
}

function localReferencesFromManifest(manifest) {
    const references = [
        ...(manifest.background?.scripts || []),
        manifest.background?.service_worker,
        manifest.action?.default_popup,
        manifest.options_ui?.page,
        ...Object.values(manifest.action?.default_icon || {}),
        ...Object.values(manifest.icons || {}),
        ...(manifest.content_scripts || []).flatMap(item => [...(item.js || []), ...(item.css || [])]),
        ...(manifest.declarative_net_request?.rule_resources || []).map(item => item.path)
    ];
    for (const themeIcon of manifest.action?.theme_icons || []) {
        references.push(themeIcon.light, themeIcon.dark);
    }
    return references.filter(Boolean);
}

async function validateBlocklist(path, errors) {
    const input = createReadStream(path, { encoding: 'utf8' });
    const lines = createInterface({ input, crlfDelay: Infinity });
    let count = 0;
    let previous = '';
    for await (const rawLine of lines) {
        const line = rawLine.trim().toLowerCase();
        count += 1;
        if (!DOMAIN_PATTERN.test(line)) {
            errors.push(`Blocklist: domínio inválido na linha ${count}: ${line.slice(0, 100)}`);
            if (errors.length > 30) break;
        }
        if (previous && line <= previous) {
            errors.push(`Blocklist: ordem/duplicidade inválida na linha ${count}: ${line}`);
            if (errors.length > 30) break;
        }
        previous = line;
    }
    if (count < 200000) errors.push(`Blocklist inesperadamente pequena: ${count} linhas`);
    return count;
}

function validateDnrRules(rules, label, errors) {
    const ids = new Set();
    for (const rule of rules) {
        if (!Number.isInteger(rule.id) || ids.has(rule.id)) {
            errors.push(`${label}: id de regra inválido/duplicado (${rule.id})`);
        }
        ids.add(rule.id);
        if (rule.action?.type !== 'block') errors.push(`${label}: somente regras block são aceitas`);
        if (typeof rule.condition?.urlFilter !== 'string') errors.push(`${label}: urlFilter ausente`);
    }
}

async function validateHtmlReferences(path, source, errors) {
    const attributePattern = /<(?:script|link|img)\b[^>]*(?:src|href)="([^"]+)"/gi;
    let match;
    while ((match = attributePattern.exec(source))) {
        const reference = match[1];
        if (/^(?:https?:|data:|#)/i.test(reference)) continue;
        const absolute = resolve(dirname(path), reference);
        if (!existsSync(absolute)) {
            errors.push(`${relative(projectRoot, path)} referencia arquivo ausente: ${reference}`);
        }
    }
    if (/\son[a-z]+\s*=/i.test(source)) {
        errors.push(`${relative(projectRoot, path)} contém event handler inline`);
    }
    if (/\sstyle\s*=/i.test(source)) {
        errors.push(`${relative(projectRoot, path)} contém estilo inline`);
    }
    const ids = new Set();
    for (const match of source.matchAll(/\bid="([^"]+)"/gi)) {
        if (ids.has(match[1])) {
            errors.push(`${relative(projectRoot, path)} contém id duplicado: ${match[1]}`);
        }
        ids.add(match[1]);
    }
    for (const match of source.matchAll(/<a\b[^>]*\btarget="_blank"[^>]*>/gi)) {
        if (!/\brel="[^"]*\bnoopener\b/i.test(match[0])) {
            errors.push(`${relative(projectRoot, path)} abre nova aba sem rel="noopener"`);
        }
    }
    return ids;
}

async function validateScriptDomReferences(path, source, htmlIds, errors) {
    const referencedIds = new Set();
    const patterns = [
        /\bgetElementById\(\s*['"]([^'"]+)['"]\s*\)/g,
        /\belement\(\s*['"]([^'"]+)['"]\s*\)/g
    ];
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) referencedIds.add(match[1]);
    }
    for (const id of referencedIds) {
        if (!htmlIds.has(id)) {
            errors.push(`${relative(projectRoot, path)} referencia id ausente no HTML irmão: ${id}`);
        }
    }
}

export async function validateProject(options = {}) {
    const errors = [];
    const manifestPath = join(projectRoot, 'manifest.json');
    const packagePath = join(projectRoot, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));

    if (manifest.manifest_version !== 3) errors.push('manifest_version deve ser 3');
    if (manifest.version !== packageJson.version) errors.push('Versões de manifest e package divergem');
    if (manifest.content_scripts?.some(item => item.all_frames !== false)) {
        errors.push('Content script deve executar apenas no frame principal');
    }
    const allowedPermissions = new Set(['storage', 'declarativeNetRequest', 'webNavigation']);
    for (const permission of manifest.permissions || []) {
        if (!allowedPermissions.has(permission)) errors.push(`Permissão não justificada: ${permission}`);
    }
    if (manifest.content_security_policy?.extension_pages?.includes('unsafe-inline')) {
        errors.push('CSP não pode permitir unsafe-inline');
    }

    for (const reference of localReferencesFromManifest(manifest)) {
        if (!existsSync(join(projectRoot, reference))) {
            errors.push(`Manifest referencia arquivo ausente: ${reference}`);
        }
    }

    const files = await walk(projectRoot);
    const htmlIdsByDirectory = new Map();
    for (const path of files) {
        const extension = extname(path).toLowerCase();
        if (extension === '.json') {
            try {
                const parsed = JSON.parse(await readFile(path, 'utf8'));
                if (path.endsWith(`${join('rules', 'ads.json')}`)) {
                    validateDnrRules(parsed, 'ads.json', errors);
                }
                if (path.endsWith(`${join('rules', 'trackers.json')}`)) {
                    validateDnrRules(parsed, 'trackers.json', errors);
                }
            } catch (error) {
                errors.push(`${relative(projectRoot, path)}: JSON inválido (${error.message})`);
            }
        }
        if (extension === '.html') {
            const source = await readFile(path, 'utf8');
            const htmlIds = await validateHtmlReferences(path, source, errors);
            htmlIdsByDirectory.set(dirname(path), new Set([
                ...(htmlIdsByDirectory.get(dirname(path)) || []),
                ...htmlIds
            ]));
        }
        if (extension === '.js' || extension === '.mjs') {
            const syntax = spawnSync(process.execPath, ['--check', path], {
                encoding: 'utf8',
                windowsHide: true
            });
            if (syntax.status !== 0) {
                errors.push(`${relative(projectRoot, path)}: ${syntax.stderr.trim()}`);
            }
            if (relative(projectRoot, path).startsWith('src')) {
                const source = await readFile(path, 'utf8');
                const forbidden = [
                    ['innerHTML', /\binnerHTML\b/],
                    ['eval', /\beval\s*\(/],
                    ['Function constructor', /\bnew\s+Function\b/],
                    ['debug DNR API', /onRuleMatchedDebug/]
                ];
                for (const [label, pattern] of forbidden) {
                    if (pattern.test(source)) errors.push(`${relative(projectRoot, path)} usa ${label}`);
                }
            }
        }
    }

    for (const path of files) {
        if (extname(path).toLowerCase() !== '.js') continue;
        const htmlIds = htmlIdsByDirectory.get(dirname(path));
        if (!htmlIds) continue;
        await validateScriptDomReferences(
            path,
            await readFile(path, 'utf8'),
            htmlIds,
            errors
        );
    }

    for (const required of [
        join('assets', 'fonts', 'InterVariable.woff2'),
        join('assets', 'fonts', 'OFL.txt'),
        join('assets', 'fonts', 'NewsreaderVariable.woff2'),
        join('assets', 'fonts', 'NEWSREADER-OFL.txt'),
        join('assets', 'brand', 'limiar-zero.svg'),
        join('src', 'privacy', 'privacy.html'),
        join('docs', 'BRAND_SYSTEM.md'),
        'PRIVACY.md',
        'LICENSE',
        'THIRD_PARTY_NOTICES.md'
    ]) {
        if (!existsSync(join(projectRoot, required))) {
            errors.push(`Arquivo obrigatório ausente: ${required}`);
        }
    }

    if (existsSync(join(projectRoot, 'META-INF'))) errors.push('META-INF assinado não deve permanecer no código-fonte modificado');
    if (existsSync(join(projectRoot, 'Microsoft'))) errors.push('Cache do PowerShell não deve permanecer no projeto');

    const blocklistCount = await validateBlocklist(
        join(projectRoot, 'src', 'filters', 'heazts-blocklist.txt'),
        errors
    );
    const result = { ok: errors.length === 0, errors, blocklistCount };
    if (!options.quiet) {
        if (result.ok) {
            console.log(`Validação concluída: ${blocklistCount.toLocaleString('pt-BR')} domínios, nenhum erro.`);
        } else {
            console.error(errors.join('\n'));
        }
    }
    return result;
}

const directExecution = process.argv[1]
    && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (directExecution) {
    const result = await validateProject();
    process.exitCode = result.ok ? 0 : 1;
}
