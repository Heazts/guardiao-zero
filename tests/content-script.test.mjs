import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function flushMicrotasks() {
    return new Promise(resolvePromise => setImmediate(resolvePromise));
}

async function loadContentScriptHarness() {
    const runtimeListeners = [];
    const documentListeners = new Map();
    const timers = [];
    const styles = [];
    let selectors = ['.publicidade', '.banner-ad'];
    let cosmeticFailures = 0;

    function createStyle() {
        const style = {
            id: '',
            attributes: new Map(),
            isConnected: false,
            sheet: {
                cssRules: [],
                insertRule(rule, index) {
                    this.cssRules.splice(index, 0, rule);
                }
            },
            setAttribute(name, value) {
                this.attributes.set(name, value);
            },
            remove() {
                this.isConnected = false;
            }
        };
        styles.push(style);
        return style;
    }

    const root = {
        appendChild(element) {
            element.isConnected = true;
            return element;
        }
    };
    const document = {
        head: root,
        documentElement: root,
        readyState: 'complete',
        visibilityState: 'visible',
        createElement(tagName) {
            if (tagName === 'style') return createStyle();
            throw new Error(`Elemento inesperado no teste: ${tagName}`);
        },
        getElementById() {
            return null;
        },
        addEventListener(type, listener) {
            documentListeners.set(type, listener);
        }
    };

    function fakeSetTimeout(callback, delay) {
        const timer = { callback, delay, active: true };
        timers.push(timer);
        return timer;
    }

    const context = vm.createContext({
        console,
        document,
        MutationObserver: class {
            observe() {}
            disconnect() {}
        },
        Object,
        Set,
        clearTimeout(timer) {
            if (timer) timer.active = false;
        },
        requestIdleCallback() {},
        setTimeout: fakeSetTimeout,
        GuardiaoConstants: {
            DEFAULT_SETTINGS: {
                blockBetting: true,
                blockAds: true,
                blockTrackers: true
            },
            LIMITS: {
                maxRescans: 2,
                mutationDebounceMs: 10,
                mutationWindowMs: 100
            }
        },
        GuardiaoSignals: {
            async collect() {
                return { fingerprint: 'full' };
            },
            collectObservation() {
                return { fingerprint: 'observation' };
            }
        },
        GuardiaoPlatform: {
            isAvailable: true,
            api: {
                runtime: {
                    onMessage: {
                        addListener(listener) {
                            runtimeListeners.push(listener);
                        }
                    }
                }
            },
            async sendMessage(type) {
                if (type === 'getState') {
                    return {
                        ok: true,
                        state: {
                            protectionEnabled: true,
                            settings: { blockBetting: true, blockAds: true, blockTrackers: true }
                        }
                    };
                }
                if (type === 'getCosmeticFilters') {
                    if (cosmeticFailures > 0) {
                        cosmeticFailures -= 1;
                        throw new Error('worker suspenso');
                    }
                    return { ok: true, selectors };
                }
                if (type === 'analyzePage') return { ok: true, action: 'allow' };
                throw new Error(`Mensagem inesperada no teste: ${type}`);
            }
        }
    });

    const source = await readFile(join(projectRoot, 'src', 'content', 'content-script.js'), 'utf8');
    vm.runInContext(source, context, { filename: 'src/content/content-script.js' });
    await flushMicrotasks();

    return {
        activeStyles() {
            return styles.filter(style => style.isConnected);
        },
        emit(message) {
            assert.equal(runtimeListeners.length, 1);
            runtimeListeners[0](message);
        },
        failNextCosmeticRequest() {
            cosmeticFailures += 1;
        },
        runRetry() {
            const timer = timers.find(item => item.active && item.delay === 250);
            assert.ok(timer, 'retry cosmético de 250 ms não foi agendado');
            timer.active = false;
            timer.callback();
        },
        setSelectors(next) {
            selectors = next;
        },
        visibilityChange() {
            documentListeners.get('visibilitychange')?.();
        }
    };
}

test('CSS cosmético acompanha pausa, whitelist, mudanças e retry', async () => {
    const harness = await loadContentScriptHarness();
    assert.equal(harness.activeStyles().length, 1);
    assert.deepEqual(
        Array.from(harness.activeStyles()[0].sheet.cssRules),
        ['.publicidade{display:none!important}', '.banner-ad{display:none!important}']
    );

    harness.emit({
        type: 'stateUpdated',
        payload: {
            protectionEnabled: false,
            settings: { blockAds: true }
        }
    });
    assert.equal(harness.activeStyles().length, 0, 'pausa deve remover o CSS imediatamente');

    harness.setSelectors(['.novo-anuncio']);
    harness.emit({
        type: 'stateUpdated',
        payload: {
            protectionEnabled: true,
            settings: { blockAds: true }
        }
    });
    await flushMicrotasks();
    assert.equal(harness.activeStyles().length, 1);
    assert.deepEqual(
        Array.from(harness.activeStyles()[0].sheet.cssRules),
        ['.novo-anuncio{display:none!important}']
    );

    harness.setSelectors([]);
    harness.emit({
        type: 'stateUpdated',
        payload: { protectionEnabled: true, settings: { blockAds: true } }
    });
    await flushMicrotasks();
    assert.equal(harness.activeStyles().length, 0, 'whitelist deve remover os seletores');

    harness.setSelectors(['.apos-retry']);
    harness.failNextCosmeticRequest();
    harness.emit({
        type: 'stateUpdated',
        payload: { protectionEnabled: true, settings: { blockAds: true } }
    });
    await flushMicrotasks();
    assert.equal(harness.activeStyles().length, 0);
    harness.runRetry();
    await flushMicrotasks();
    assert.equal(harness.activeStyles().length, 1);

    const sameStyle = harness.activeStyles()[0];
    harness.visibilityChange();
    await flushMicrotasks();
    assert.equal(harness.activeStyles()[0], sameStyle, 'sincronização idempotente não recria CSS igual');
});
