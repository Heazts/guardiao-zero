'use strict';

/**
 * Política de domínios de apostas mantida pelo Guardião Zero Pro.
 *
 * Este conjunto pequeno foi escrito manualmente pelos mantenedores e é
 * distribuído sob a licença MIT do projeto. Ele não foi copiado nem derivado
 * de uma blocklist de terceiros. A regra de sufixo `.bet.br` se apoia na
 * política pública brasileira indicada em `provenance.policySource`.
 */
globalThis.GuardiaoVerifiedBettingDomains = globalThis.GuardiaoVerifiedBettingDomains || (() => {
    const domains = Object.freeze([
        '1xbet.com',
        '888casino.com',
        '888sport.com',
        'bet365.com',
        'betano.com',
        'betfair.com',
        'betfred.com',
        'betmgm.com',
        'betnacional.com',
        'betsson.com',
        'betway.com',
        'blaze.com',
        'bodog.com',
        'bwin.com',
        'draftkings.com',
        'estrelabet.com',
        'fanduel.com',
        'ladbrokes.com',
        'leovegas.com',
        'novibet.com',
        'pixbet.com',
        'pokerstars.com',
        'rivalo.com',
        'sportingbet.com',
        'stake.com',
        'superbet.com',
        'unibet.com',
        'williamhill.com'
    ]);
    const suffixes = Object.freeze(['bet.br']);
    const exactDomains = new Set(domains);

    function normalizedHostname(value) {
        return typeof value === 'string'
            ? value.trim().toLowerCase().replace(/\.$/, '')
            : '';
    }

    function findDomain(value) {
        const hostname = normalizedHostname(value);
        if (!hostname || /[/\s@:]/.test(hostname)) return '';

        let candidate = hostname;
        for (;;) {
            if (exactDomains.has(candidate)) return candidate;
            const dot = candidate.indexOf('.');
            if (dot === -1) break;
            candidate = candidate.slice(dot + 1);
        }

        for (const suffix of suffixes) {
            if (hostname.endsWith(`.${suffix}`)) return suffix;
        }
        return '';
    }

    const provenance = Object.freeze({
        maintainedBy: 'Contribuidores do Guardião Zero Pro',
        license: 'MIT',
        method: 'Curadoria manual independente; sem cópia ou derivação de listas de terceiros.',
        verifiedAt: '2026-08-09',
        policySource: 'https://www.gov.br/fazenda/pt-br/composicao/orgaos/secretaria-de-premios-e-apostas/apostas-de-quota-fixa'
    });

    function status() {
        return Object.freeze({
            loaded: true,
            count: domains.length,
            suffixCount: suffixes.length,
            representation: 'project-maintained-static-policy'
        });
    }

    return Object.freeze({
        domains,
        suffixes,
        provenance,
        findDomain,
        status
    });
})();
