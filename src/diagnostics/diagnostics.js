'use strict';

(() => {
    const platform = globalThis.GuardiaoPlatform;
    if (!platform?.isAvailable) return;

    let lastDiagnostics = null;

    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = String(value);
    }

    function engineName() {
        return typeof globalThis.browser !== 'undefined'
            ? 'Gecko (event page MV3)'
            : 'Chromium (service worker MV3)';
    }

    function terminalLine(message) {
        const output = document.getElementById('test-output');
        if (output.textContent.includes('Aguardando comando')) output.textContent = '';
        const timestamp = new Date().toISOString().slice(11, 23);
        output.textContent += `${output.textContent ? '\n' : ''}[${timestamp}] ${message}`;
        output.scrollTop = output.scrollHeight;
    }

    async function request(type) {
        const response = await platform.sendMessage(type);
        if (!response?.ok) throw new Error(response?.error || 'Operação recusada');
        return response;
    }

    async function loadDiagnostics() {
        try {
            const response = await request('getDiagnostics');
            const diagnostics = response.diagnostics;
            lastDiagnostics = diagnostics;
            setText('diag-version', diagnostics.version);
            setText('diag-engine', engineName());
            setText('diag-protection', diagnostics.protectionEnabled ? 'Ativa' : 'Pausada');
            setText('diag-ai', diagnostics.settings.aiDetection ? 'Multifator ativo' : 'Somente índice local');
            setText(
                'diag-rules',
                diagnostics.enabledRulesets.length
                    ? diagnostics.enabledRulesets.join(', ')
                    : 'Nenhum ativo'
            );
            setText(
                'diag-domains',
                diagnostics.blocklist.loaded
                    ? `${diagnostics.blocklist.count.toLocaleString('pt-BR')} domínios`
                    : `Falha: ${diagnostics.blocklist.error || 'não carregado'}`
            );
            setText('diag-filter-sources', diagnostics.filterSourceCount ?? 0);
            setText(
                'diag-dynamic-rules',
                `${diagnostics.dynamicRuleCount ?? 0}/${diagnostics.dynamicRuleLimit ?? 5000}`
            );
            const health = document.getElementById('diag-health');
            health.textContent = diagnostics.blocklist.loaded ? 'Operacional' : 'Atenção necessária';
            health.className = `status-badge ${diagnostics.blocklist.loaded ? 'success' : 'warning'}`;
        } catch (error) {
            terminalLine(`Falha no diagnóstico: ${error.message}`);
            const health = document.getElementById('diag-health');
            health.textContent = 'Falha na leitura';
            health.className = 'status-badge danger';
        }
    }

    async function runSelfTest(button) {
        button.disabled = true;
        document.getElementById('test-output').textContent = '';
        terminalLine('Iniciando autoteste local…');
        try {
            const response = await request('runSelfTest');
            for (const line of response.selfTest.lines) {
                terminalLine(`${line.ok ? '✓' : '✗'} ${line.label}`);
            }
            terminalLine(response.selfTest.ok ? 'Autoteste concluído com sucesso.' : 'Autoteste encontrou falhas.');
        } catch (error) {
            terminalLine(`✗ ${error.message}`);
        } finally {
            button.disabled = false;
            await loadDiagnostics();
        }
    }

    function reportText() {
        const diagnostics = lastDiagnostics || {};
        const terminal = document.getElementById('test-output').textContent;
        return [
            '=== Guardião Zero Pro — Diagnóstico ===',
            `Data: ${new Date().toISOString()}`,
            `Versão: ${diagnostics.version || 'N/A'}`,
            `Motor: ${engineName()}`,
            `Proteção: ${diagnostics.protectionEnabled ? 'Ativa' : 'Pausada'}`,
            `Limiar: ${diagnostics.settings?.detectionThreshold ?? 'N/A'}`,
            `Blocklist: ${diagnostics.blocklist?.count ?? 'N/A'}`,
            `Representação: ${diagnostics.blocklist?.representation ?? 'N/A'}`,
            `Rulesets: ${(diagnostics.enabledRulesets || []).join(', ') || 'nenhum'}`,
            '',
            '=== Último Autoteste ===',
            terminal
        ].join('\n');
    }

    document.getElementById('btn-run-test').addEventListener('click', event => {
        void runSelfTest(event.currentTarget);
    });
    document.getElementById('btn-copy-report').addEventListener('click', async event => {
        const button = event.currentTarget;
        try {
            await navigator.clipboard.writeText(reportText());
            document.getElementById('copy-report-label').textContent = 'Copiado';
            setTimeout(() => {
                document.getElementById('copy-report-label').textContent = 'Copiar relatório';
            }, 1600);
        } catch {
            terminalLine('Não foi possível copiar o relatório.');
        }
    });

    void loadDiagnostics();
})();
