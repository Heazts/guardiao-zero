'use strict';

/**
 * Tradução das páginas da extensão, com idioma escolhido pelo usuário.
 *
 * A API `browser.i18n` do navegador não serve sozinha aqui: ela resolve o
 * idioma pela interface do navegador e não pode ser trocada em tempo de
 * execução. Como a extensão oferece um seletor próprio, o catálogo é lido
 * diretamente de `_locales/<code>/messages.json` — o mesmo formato e os mesmos
 * arquivos que o manifesto usa para o nome e a descrição na loja, de modo que
 * não existem dois catálogos podendo divergir.
 *
 * A leitura usa `fetch` sobre uma URL `moz-extension://` do próprio pacote.
 * Nenhuma requisição sai do navegador: o argumento é sempre
 * `runtime.getURL('_locales/…')`, e é o único `fetch` da extensão.
 */
globalThis.GuardiaoI18n = globalThis.GuardiaoI18n || (() => {
    /**
     * Os doze idiomas mais falados do mundo, com o nome escrito na própria
     * língua — quem precisa trocar o idioma normalmente não lê o idioma atual.
     */
    const LOCALES = Object.freeze([
        { code: 'pt_BR', label: 'Português (Brasil)', dir: 'ltr' },
        { code: 'en', label: 'English', dir: 'ltr' },
        { code: 'zh_CN', label: '简体中文', dir: 'ltr' },
        { code: 'hi', label: 'हिन्दी', dir: 'ltr' },
        { code: 'es', label: 'Español', dir: 'ltr' },
        { code: 'ar', label: 'العربية', dir: 'rtl' },
        { code: 'fr', label: 'Français', dir: 'ltr' },
        { code: 'bn', label: 'বাংলা', dir: 'ltr' },
        { code: 'ru', label: 'Русский', dir: 'ltr' },
        { code: 'ur', label: 'اردو', dir: 'rtl' },
        { code: 'id', label: 'Bahasa Indonesia', dir: 'ltr' },
        { code: 'de', label: 'Deutsch', dir: 'ltr' }
    ]);

    const SOURCE_LOCALE = 'pt_BR';
    const CODES = new Set(LOCALES.map(locale => locale.code));
    const BY_CODE = new Map(LOCALES.map(locale => [locale.code, locale]));

    const catalogs = new Map();
    let active = SOURCE_LOCALE;
    let messages = {};
    let fallback = {};

    function api() {
        return globalThis.browser || globalThis.chrome;
    }

    /** `auto` segue o navegador; qualquer valor desconhecido cai na origem. */
    function resolve(preference) {
        if (CODES.has(preference)) return preference;
        const ui = api()?.i18n?.getUILanguage?.() || globalThis.navigator?.language || '';
        const normalized = ui.replace('-', '_');
        if (CODES.has(normalized)) return normalized;
        const base = normalized.split('_')[0];
        const match = LOCALES.find(locale => locale.code.split('_')[0] === base);
        return match ? match.code : 'en';
    }

    async function loadCatalog(code) {
        if (catalogs.has(code)) return catalogs.get(code);
        const runtime = api()?.runtime;
        if (!runtime?.getURL) return {};
        try {
            const response = await fetch(runtime.getURL(`_locales/${code}/messages.json`));
            if (!response.ok) throw new Error(String(response.status));
            const raw = await response.json();
            // Formato WebExtension: { chave: { message: "texto" } }.
            const catalog = {};
            for (const [key, entry] of Object.entries(raw)) {
                if (entry && typeof entry.message === 'string') catalog[key] = entry.message;
            }
            catalogs.set(code, catalog);
            return catalog;
        } catch {
            catalogs.set(code, {});
            return {};
        }
    }

    /**
     * Devolve a mensagem, com a chave como último recurso.
     *
     * Mostrar a chave é proposital: uma tradução faltando vira um defeito
     * visível em vez de um espaço em branco que ninguém relata.
     */
    function translate(key, substitutions) {
        const template = messages[key] ?? fallback[key] ?? key;
        if (!substitutions) return template;
        return template.replace(/\$([A-Z_]+)\$/g, (match, name) => {
            const value = substitutions[name.toLowerCase()] ?? substitutions[name];
            return value === undefined ? match : String(value);
        });
    }

    function applyAttributes(element) {
        // Formato: data-i18n-attr="aria-label:chave;title:outra".
        for (const pair of element.dataset.i18nAttr.split(';')) {
            const separator = pair.indexOf(':');
            if (separator < 0) continue;
            const attribute = pair.slice(0, separator).trim();
            const key = pair.slice(separator + 1).trim();
            if (attribute && key) element.setAttribute(attribute, translate(key));
        }
    }

    function apply(root = globalThis.document) {
        if (!root) return;
        for (const element of root.querySelectorAll('[data-i18n]')) {
            element.textContent = translate(element.dataset.i18n);
        }
        for (const element of root.querySelectorAll('[data-i18n-attr]')) {
            applyAttributes(element);
        }
        const title = root.querySelector?.('title[data-i18n-title]');
        if (title) title.textContent = translate(title.dataset.i18nTitle);
    }

    /**
     * Carrega o idioma pedido e reescreve o documento.
     *
     * O catálogo de origem entra como fallback para que uma tradução
     * incompleta apareça parcialmente traduzida, e não quebrada.
     */
    async function activate(preference, root = globalThis.document) {
        const code = resolve(preference);
        const [catalog, source] = await Promise.all([
            loadCatalog(code),
            code === SOURCE_LOCALE ? Promise.resolve(null) : loadCatalog(SOURCE_LOCALE)
        ]);
        active = code;
        messages = catalog;
        fallback = source || catalog;

        const element = root?.documentElement;
        if (element) {
            element.lang = code.replace('_', '-');
            element.dir = BY_CODE.get(code)?.dir || 'ltr';
        }
        apply(root);
        return code;
    }

    function reveal() {
        globalThis.document?.documentElement?.classList.remove('appearance-pending');
    }

    /**
     * Aplica o idioma guardado e revela a página.
     *
     * A classe `appearance-pending` fica sob responsabilidade deste módulo
     * justamente para que a primeira pintura já saia traduzida. Se algo falhar,
     * a animação de segurança do CSS revela a página de qualquer forma.
     */
    function domReady() {
        const document = globalThis.document;
        if (document.readyState !== 'loading') return Promise.resolve();
        return new Promise(resolve => {
            document.addEventListener('DOMContentLoaded', resolve, { once: true });
        });
    }

    async function boot() {
        if (!globalThis.document) return;
        let preference = 'auto';
        try {
            const stored = await api()?.storage?.local?.get('appearance');
            if (stored?.appearance?.language) preference = stored.appearance.language;
        } catch {
            // Sem storage o idioma do navegador já é um padrão razoável.
        }
        try {
            // O catálogo é buscado em paralelo com a análise do documento, mas
            // só é aplicado depois que o corpo existe. Este módulo carrega no
            // <head>, e o storage pode responder num microtask: aplicar antes
            // fazia querySelectorAll não encontrar nada e a página ficava no
            // idioma de origem, sem erro nenhum no console.
            await Promise.all([loadCatalog(resolve(preference)), domReady()]);
            await activate(preference);
        } finally {
            reveal();
        }

        // Trocar o idioma numa aba precisa reescrever as demais já abertas.
        api()?.storage?.onChanged?.addListener((changes, area) => {
            if (area !== 'local' || !changes.appearance) return;
            const next = changes.appearance.newValue?.language || 'auto';
            if (resolve(next) !== active) void activate(next);
        });
    }

    if (globalThis.document) void boot();

    return Object.freeze({
        LOCALES,
        SOURCE_LOCALE,
        resolve,
        activate,
        apply,
        t: translate,
        get active() {
            return active;
        }
    });
})();
