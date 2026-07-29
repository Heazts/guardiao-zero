'use strict';

(() => {
    const platform = globalThis.GuardiaoPlatform;
    const appearanceService = globalThis.GuardiaoAppearance;
    if (!platform?.isAvailable || !appearanceService) return;

    const SETTINGS_MAP = Object.freeze({
        'toggle-betting': 'blockBetting',
        'toggle-ads': 'blockAds',
        'toggle-trackers': 'blockTrackers',
        'toggle-ai': 'aiDetection',
        'toggle-extreme': 'extremeMode'
    });
    const TYPE_LABELS = Object.freeze({
        domain: 'Domínio',
        subdomain: 'Domínio + subdomínios',
        url: 'URL',
        regex: 'Regex',
        hash: 'Hash',
        signature: 'Assinatura',
        tld: 'TLD',
        asn: 'ASN'
    });
    const PLACEHOLDERS = Object.freeze({
        domain: 'exemplo.com',
        subdomain: 'exemplo.com',
        url: 'https://exemplo.com/pagina',
        regex: '^https://docs\\.exemplo\\.com/',
        hash: '64 caracteres hexadecimais',
        signature: '64 caracteres hexadecimais',
        tld: 'casino',
        asn: 'AS64500'
    });
    const SECTION_META = Object.freeze({
        protection: ['Proteção', 'Defina as camadas que protegem sua navegação.'],
        detection: ['Detecção', 'Ajuste como as evidências são combinadas.'],
        lists: ['Regras pessoais', 'Controle exceções e bloqueios explícitos.'],
        'filter-lists': ['Listas de filtros', 'Gerencie filtros de rede importados localmente.'],
        appearance: ['Aparência', 'Personalize o Guardião sem enviar preferências.'],
        data: ['Dados locais', 'Faça backup ou limpe informações deste perfil.']
    });
    const CATEGORY_LABELS = Object.freeze({
        ads: 'Anúncios',
        privacy: 'Privacidade',
        gambling: 'Apostas',
        custom: 'Personalizada'
    });
    const FORMAT_LABELS = Object.freeze({
        easylist: 'EasyList',
        easyprivacy: 'EasyPrivacy',
        adguard: 'AdGuard',
        ublock: 'uBlock Origin',
        hosts: 'HOSTS',
        adblock: 'Adblock',
        custom: 'Personalizada',
        unknown: 'Desconhecido'
    });

    let currentState = null;
    let thresholdTimer = 0;
    let appearanceTimer = 0;

    function element(id) {
        return document.getElementById(id);
    }

    function setSaveStatus(message, status = '') {
        const target = element('save-status');
        target.textContent = message;
        target.className = `save-status${status ? ` ${status}` : ''}`;
    }

    function showToast(message, kind = 'success') {
        const container = element('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast${kind === 'error' ? ' toast-error' : ''}${kind === 'warning' ? ' toast-warning' : ''}`;
        toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
        toast.textContent = message;
        container.replaceChildren(toast);
        setTimeout(() => toast.remove(), kind === 'error' ? 6000 : 3600);
    }

    async function request(type, payload) {
        const response = await platform.sendMessage(type, payload);
        if (!response?.ok) throw new Error(response?.error || 'Operação recusada');
        return response;
    }

    async function confirmAction(message, label = 'Confirmar') {
        const dialog = element('confirm-dialog');
        element('confirm-message').textContent = message;
        element('confirm-action').textContent = label;
        dialog.showModal();
        return new Promise(resolve => {
            dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), {
                once: true
            });
        });
    }

    function setControlsEnabled(enabled) {
        for (const id of Object.keys(SETTINGS_MAP)) element(id).disabled = !enabled;
        element('slider-detection-threshold').disabled = !enabled;
        element('btn-add-whitelist').disabled = !enabled;
        element('btn-add-blocklist').disabled = !enabled;
    }

    function renderSettings(settings) {
        for (const [elementId, settingKey] of Object.entries(SETTINGS_MAP)) {
            element(elementId).checked = settings[settingKey] === true;
        }
        const threshold = Number(settings.detectionThreshold) || 120;
        const slider = element('slider-detection-threshold');
        slider.value = String(threshold);
        slider.style.setProperty('--range-progress', `${((threshold - 100) / 80) * 100}%`);
        element('threshold-value').value = String(threshold);
    }

    function iconButton(label, className, path) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.setAttribute('aria-label', label);
        button.setAttribute('data-tooltip', label);
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathElement.setAttribute('d', path);
        svg.appendChild(pathElement);
        button.appendChild(svg);
        return button;
    }

    function renderList(listName, entries) {
        const list = element(`list-${listName}`);
        list.replaceChildren();

        if (!entries.length) {
            const empty = document.createElement('li');
            empty.className = 'domain-empty';
            empty.textContent = listName === 'whitelist'
                ? 'Nenhuma exceção adicionada.'
                : 'Nenhum bloqueio pessoal adicionado.';
            list.appendChild(empty);
            return;
        }

        for (const entry of entries) {
            const item = document.createElement('li');
            item.className = 'domain-item';

            const content = document.createElement('span');
            content.className = 'domain-content';
            const badge = document.createElement('span');
            badge.className = 'list-type-badge';
            badge.textContent = TYPE_LABELS[entry.type] || entry.type;
            const pattern = document.createElement('code');
            pattern.textContent = entry.pattern;
            pattern.title = entry.pattern;
            content.append(badge, pattern);

            const actions = document.createElement('span');
            actions.className = 'domain-actions';
            const copy = iconButton(
                `Copiar ${entry.pattern}`,
                'btn-copy',
                'M8 8h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z M4 16H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v1'
            );
            copy.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(entry.pattern);
                    showToast('Padrão copiado');
                } catch {
                    showToast('Não foi possível copiar o padrão', 'error');
                }
            });
            const remove = iconButton(
                `Remover ${entry.pattern}`,
                'btn-remove',
                'M3 6h18 M8 6V4h8v2 M19 6l-1 15H6L5 6 M10 11v6 M14 11v6'
            );
            remove.addEventListener('click', async () => {
                const confirmed = await confirmAction(
                    `Remover “${entry.pattern}” desta lista?`,
                    'Remover'
                );
                if (confirmed) void removeEntry(listName, entry.id, remove);
            });
            actions.append(copy, remove);
            item.append(content, actions);
            list.appendChild(item);
        }
    }

    function formatNumber(value) {
        return new Intl.NumberFormat('pt-BR').format(Number(value) || 0);
    }

    function renderFilterSources(sources = []) {
        const container = element('filter-sources');
        const used = Number(currentState?.dynamicRuleCount) || 0;
        const limit = Number(currentState?.dynamicRuleLimit) || 4900;
        element('dynamic-rule-usage').textContent = `${formatNumber(used)} / ${formatNumber(limit)} regras`;
        container.replaceChildren();

        if (!sources.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-state card';
            const icon = document.createElement('span');
            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = '≡';
            const title = document.createElement('h3');
            title.textContent = 'Nenhuma lista importada';
            const description = document.createElement('p');
            description.textContent = 'As listas escolhidas aparecerão aqui e poderão ser pausadas ou removidas.';
            empty.append(icon, title, description);
            container.appendChild(empty);
            return;
        }

        for (const source of sources) {
            const card = document.createElement('article');
            card.className = 'filter-source card';

            const main = document.createElement('div');
            main.className = 'source-main';
            const titleLine = document.createElement('div');
            titleLine.className = 'source-title-line';
            const title = document.createElement('span');
            title.className = 'source-title';
            title.textContent = source.name;
            title.title = source.name;
            const category = document.createElement('span');
            category.className = 'source-category';
            category.textContent = CATEGORY_LABELS[source.category] || source.category;
            titleLine.append(title, category);
            const meta = document.createElement('span');
            meta.className = 'source-meta';
            meta.textContent = [
                FORMAT_LABELS[source.format] || source.format,
                `${formatNumber(source.ruleCount)} regras`,
                source.rejectedCount ? `${formatNumber(source.rejectedCount)} ignoradas` : '',
                source.enabled ? 'ativa' : 'pausada'
            ].filter(Boolean).join(' · ');
            main.append(titleLine, meta);

            const actions = document.createElement('div');
            actions.className = 'source-actions';
            const switchLabel = document.createElement('label');
            switchLabel.className = 'switch';
            const toggle = document.createElement('input');
            toggle.type = 'checkbox';
            toggle.className = 'sr-only';
            toggle.checked = source.enabled === true;
            toggle.setAttribute('aria-label', `${toggle.checked ? 'Pausar' : 'Ativar'} ${source.name}`);
            const track = document.createElement('span');
            track.className = 'switch-track';
            const thumb = document.createElement('span');
            thumb.className = 'switch-thumb';
            track.appendChild(thumb);
            switchLabel.append(toggle, track);
            toggle.addEventListener('change', () => void toggleFilterSource(source.id, toggle.checked, toggle));

            const remove = iconButton(
                `Remover ${source.name}`,
                'icon-button source-remove',
                'M3 6h18 M8 6V4h8v2 M19 6l-1 15H6L5 6 M10 11v6 M14 11v6'
            );
            remove.addEventListener('click', async () => {
                const confirmed = await confirmAction(
                    `Remover a lista “${source.name}” e suas ${formatNumber(source.ruleCount)} regras?`,
                    'Remover lista'
                );
                if (confirmed) void removeFilterSource(source.id, remove);
            });
            actions.append(switchLabel, remove);
            card.append(main, actions);
            container.appendChild(card);
        }
    }

    function renderAppearance(value) {
        const appearance = appearanceService.normalize(value);
        for (const [name, selected] of Object.entries({
            theme: appearance.theme,
            contrast: appearance.contrast,
            density: appearance.density
        })) {
            const control = document.querySelector(`input[name="${name}"][value="${selected}"]`);
            if (control) control.checked = true;
        }
        element('accent-color').value = appearance.accent;
        element('accent-value').textContent = appearance.accent;
        element('reduce-motion').checked = appearance.motion === 'reduced';
        for (const swatch of document.querySelectorAll('.accent-swatch')) {
            swatch.classList.toggle('active', swatch.dataset.accent === appearance.accent);
        }
        appearanceService.apply(appearance);
    }

    function renderState(state) {
        currentState = state;
        renderSettings(state.settings);
        renderList('whitelist', state.whitelist || []);
        renderList('blocklist', state.blocklist || []);
        renderAppearance(state.appearance);
        renderFilterSources(state.filterSources || []);
        setControlsEnabled(true);
    }

    async function loadState() {
        try {
            const response = await request('getState');
            renderState(response.state);
            setSaveStatus('Tudo salvo localmente');
        } catch {
            setSaveStatus('Configurações indisponíveis', 'error');
            showToast('Não foi possível carregar as configurações', 'error');
        }
    }

    async function updateSettings(patch) {
        setSaveStatus('Salvando…', 'saving');
        try {
            const response = await request('updateSettings', { settings: patch });
            renderState(response.state);
            setSaveStatus('Tudo salvo localmente');
        } catch (error) {
            showToast(error.message, 'error');
            setSaveStatus('Falha ao salvar', 'error');
            if (currentState) renderSettings(currentState.settings);
        }
    }

    async function updateAppearance(patch) {
        const optimistic = appearanceService.normalize({
            ...(currentState?.appearance || appearanceService.DEFAULT_APPEARANCE),
            ...patch
        });
        appearanceService.apply(optimistic);
        renderAppearance(optimistic);
        setSaveStatus('Salvando aparência…', 'saving');
        try {
            const response = await request('updateAppearance', { appearance: patch });
            renderState(response.state);
            setSaveStatus('Tudo salvo localmente');
        } catch (error) {
            showToast(error.message, 'error');
            setSaveStatus('Falha ao salvar', 'error');
            renderAppearance(currentState?.appearance);
        }
    }

    async function addEntry(listName) {
        const input = element(`input-${listName}`);
        const type = element(`type-${listName}`).value;
        const pattern = input.value.trim();
        if (!pattern) {
            showToast('Informe um padrão', 'error');
            input.focus();
            return;
        }

        const button = element(`btn-add-${listName}`);
        button.disabled = true;
        setSaveStatus('Salvando regra…', 'saving');
        try {
            const response = await request('addListEntry', {
                list: listName,
                entry: {
                    pattern,
                    type,
                    description: 'Entrada adicionada nas opções',
                    addedAt: Date.now(),
                    addedBy: 'user'
                }
            });
            input.value = '';
            renderState(response.state);
            setSaveStatus('Tudo salvo localmente');
            showToast('Regra adicionada');
        } catch (error) {
            showToast(error.message, 'error');
            setSaveStatus('Falha ao salvar', 'error');
        } finally {
            button.disabled = false;
        }
    }

    async function removeEntry(listName, id, button) {
        button.disabled = true;
        try {
            const response = await request('removeListEntry', { list: listName, id });
            renderState(response.state);
            showToast('Regra removida');
        } catch (error) {
            button.disabled = false;
            showToast(error.message, 'error');
        }
    }

    async function importFilterFile(file) {
        if (file.size > 4 * 1024 * 1024) {
            showToast('A lista excede o limite de 4 MB', 'error');
            return;
        }
        setSaveStatus('Convertendo lista…', 'saving');
        try {
            const response = await request('importFilterList', {
                name: file.name,
                category: element('filter-list-category').value,
                text: await file.text()
            });
            renderState(response.state);
            const report = response.report;
            const truncated = report.truncated ? ' O limite portátil foi atingido.' : '';
            showToast(`${formatNumber(report.imported)} regras importadas; ${formatNumber(report.rejected)} ignoradas.${truncated}`, report.imported ? 'success' : 'warning');
            setSaveStatus('Tudo salvo localmente');
        } catch (error) {
            showToast(error.message, 'error');
            setSaveStatus('Falha ao importar', 'error');
        }
    }

    async function toggleFilterSource(id, enabled, control) {
        control.disabled = true;
        try {
            const response = await request('toggleFilterSource', { id, enabled });
            renderState(response.state);
            showToast(enabled ? 'Lista ativada' : 'Lista pausada');
        } catch (error) {
            control.checked = !enabled;
            control.disabled = false;
            showToast(error.message, 'error');
        }
    }

    async function removeFilterSource(id, control) {
        control.disabled = true;
        try {
            const response = await request('removeFilterSource', { id });
            renderState(response.state);
            showToast('Lista removida');
        } catch (error) {
            control.disabled = false;
            showToast(error.message, 'error');
        }
    }

    function initializeControls() {
        for (const [elementId, settingKey] of Object.entries(SETTINGS_MAP)) {
            element(elementId).addEventListener('change', async event => {
                const input = event.target;
                if (settingKey === 'extremeMode' && input.checked) {
                    const confirmed = await confirmAction(
                        'O modo de foco extremo bloqueia toda navegação HTTP(S) fora da whitelist. Deseja ativar?',
                        'Ativar modo extremo'
                    );
                    if (!confirmed) {
                        input.checked = false;
                        return;
                    }
                }
                void updateSettings({ [settingKey]: input.checked });
            });
        }

        const threshold = element('slider-detection-threshold');
        threshold.addEventListener('input', event => {
            const value = Number(event.target.value);
            element('threshold-value').value = String(value);
            event.target.style.setProperty('--range-progress', `${((value - 100) / 80) * 100}%`);
            clearTimeout(thresholdTimer);
            thresholdTimer = setTimeout(() => {
                void updateSettings({ detectionThreshold: value });
            }, 420);
        });

        for (const listName of ['whitelist', 'blocklist']) {
            const type = element(`type-${listName}`);
            const input = element(`input-${listName}`);
            const button = element(`btn-add-${listName}`);
            type.addEventListener('change', () => {
                input.placeholder = PLACEHOLDERS[type.value] || 'Informe o padrão';
            });
            button.addEventListener('click', () => void addEntry(listName));
            input.addEventListener('keydown', event => {
                if (event.key === 'Enter') void addEntry(listName);
            });
        }

        for (const input of document.querySelectorAll('input.appearance-control[type="radio"]')) {
            input.addEventListener('change', event => {
                if (event.target.checked) void updateAppearance({ [event.target.name]: event.target.value });
            });
        }
        element('reduce-motion').addEventListener('change', event => {
            void updateAppearance({ motion: event.target.checked ? 'reduced' : 'system' });
        });
        element('accent-color').addEventListener('input', event => {
            const accent = event.target.value.toUpperCase();
            element('accent-value').textContent = accent;
            appearanceService.apply({
                ...(currentState?.appearance || appearanceService.DEFAULT_APPEARANCE),
                accent
            });
            clearTimeout(appearanceTimer);
            appearanceTimer = setTimeout(() => void updateAppearance({ accent }), 350);
        });
        for (const swatch of document.querySelectorAll('.accent-swatch')) {
            swatch.addEventListener('click', () => void updateAppearance({
                accent: swatch.dataset.accent
            }));
        }

        const filterInput = element('file-filter-list');
        element('btn-import-filter-list').addEventListener('click', () => filterInput.click());
        filterInput.addEventListener('change', () => {
            const file = filterInput.files?.[0];
            filterInput.value = '';
            if (file) void importFilterFile(file);
        });
    }

    function navigateTo(sectionId, updateHistory = false) {
        const safeId = SECTION_META[sectionId] ? sectionId : 'protection';
        const links = document.querySelectorAll('.sidebar-nav .nav-item[href^="#"]');
        const sections = document.querySelectorAll('.settings-section');
        for (const link of links) {
            const active = link.getAttribute('href') === `#${safeId}`;
            link.classList.toggle('active', active);
            if (active) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        }
        for (const section of sections) section.classList.toggle('active', section.id === safeId);
        const [title, description] = SECTION_META[safeId];
        element('page-title').textContent = title;
        element('page-description').textContent = description;
        document.title = `${title} — Guardião Zero Pro`;
        if (updateHistory) history.pushState(null, '', `#${safeId}`);
        document.querySelector('.main-content').scrollTo?.({ top: 0, behavior: 'smooth' });
    }

    function initializeNavigation() {
        const links = document.querySelectorAll('.sidebar-nav .nav-item[href^="#"]');
        for (const link of links) {
            link.addEventListener('click', event => {
                event.preventDefault();
                navigateTo(link.hash.slice(1), true);
            });
        }
        window.addEventListener('hashchange', () => navigateTo(location.hash.slice(1)));
        navigateTo(location.hash.slice(1));
    }

    function downloadJson(filename, data) {
        const blobUrl = URL.createObjectURL(new Blob(
            [JSON.stringify(data, null, 2)],
            { type: 'application/json' }
        ));
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    }

    function initializeDataActions() {
        element('btn-reset-stats').addEventListener('click', async event => {
            const confirmed = await confirmAction(
                'Zerar todos os contadores agregados? Esta ação não pode ser desfeita.',
                'Zerar contadores'
            );
            if (!confirmed) return;
            event.currentTarget.disabled = true;
            try {
                const response = await request('resetStats');
                renderState(response.state);
                showToast('Contadores zerados');
            } catch (error) {
                showToast(error.message, 'error');
            } finally {
                event.currentTarget.disabled = false;
            }
        });

        element('btn-export').addEventListener('click', async event => {
            event.currentTarget.disabled = true;
            try {
                const response = await request('exportState');
                downloadJson('guardiao-zero-pro-backup.json', response.data);
                showToast('Backup exportado');
            } catch (error) {
                showToast(error.message, 'error');
            } finally {
                event.currentTarget.disabled = false;
            }
        });

        const fileInput = element('file-import');
        element('btn-import').addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async () => {
            const file = fileInput.files?.[0];
            fileInput.value = '';
            if (!file) return;
            if (file.size > 6 * 1024 * 1024) {
                showToast('O backup excede 6 MB', 'error');
                return;
            }
            const confirmed = await confirmAction(
                'Restaurar este backup substituirá configurações e listas atuais.',
                'Restaurar backup'
            );
            if (!confirmed) return;
            try {
                const data = JSON.parse(await file.text());
                const response = await request('importState', { data });
                renderState(response.state);
                showToast('Backup restaurado');
            } catch (error) {
                showToast(error.message || 'Backup inválido', 'error');
            }
        });
    }

    initializeControls();
    initializeNavigation();
    initializeDataActions();
    void loadState();
})();
