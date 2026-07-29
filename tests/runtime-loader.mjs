import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

export async function loadRuntime(relativePaths) {
    const context = vm.createContext({
        URL,
        URLSearchParams,
        TextEncoder,
        TextDecoder,
        crypto: webcrypto,
        console,
        setTimeout,
        clearTimeout,
        structuredClone
    });
    for (const relativePath of relativePaths) {
        const source = await readFile(join(projectRoot, relativePath), 'utf8');
        vm.runInContext(source, context, { filename: relativePath });
    }
    return context;
}

export function baseSignals(url, overrides = {}) {
    return {
        url,
        title: '',
        metaDescription: '',
        openGraph: [],
        structuredDataTypes: [],
        favicons: [],
        text: '',
        menus: [],
        buttons: [],
        forms: [],
        links: [],
        images: [],
        scripts: [],
        iframes: [],
        resources: [],
        storage: {
            local: [],
            session: [],
            indexedDB: [],
            cookies: []
        },
        serviceWorkerScopes: [],
        websocketUrls: [],
        trackerCount: 0,
        adCount: 0,
        pixelCount: 0,
        articleCount: 0,
        fingerprint: 'test',
        ...overrides
    };
}
