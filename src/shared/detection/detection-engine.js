'use strict';

/**
 * Detector determinístico multifator. O score é limitado por grupo para que
 * repetições de uma palavra não dominem o resultado. Um bloqueio automático
 * exige limiar, diversidade e confirmação operacional/contextual.
 */
globalThis.GuardiaoDetection = globalThis.GuardiaoDetection || (() => {
    const constants = globalThis.GuardiaoConstants;
    if (!constants) throw new Error('GuardiaoConstants precisa ser carregado antes do detector');
    const normalizedPhraseCache = new Map();

    function normalizeText(value) {
        return typeof value === 'string'
            ? value
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]+/g, ' ')
                .trim()
                .replace(/\s+/g, ' ')
            : '';
    }

    function hostnameFromUrl(url) {
        try {
            return new URL(url).hostname.replace(/\.$/, '').toLowerCase();
        } catch {
            return '';
        }
    }

    function hostMatches(hostname, expected) {
        return hostname === expected || hostname.endsWith(`.${expected}`);
    }

    function isTrustedHostname(hostname) {
        if (!hostname) return false;
        if (constants.TRUSTED_DOMAINS.some(domain => hostMatches(hostname, domain))) return true;
        return constants.TRUSTED_HOST_PATTERNS.some(pattern => pattern.test(hostname));
    }

    function normalizedPhrase(phrase) {
        if (!normalizedPhraseCache.has(phrase)) {
            normalizedPhraseCache.set(phrase, normalizeText(phrase));
        }
        return normalizedPhraseCache.get(phrase);
    }

    function createTextView(text) {
        const normalized = normalizeText(text);
        return {
            normalized,
            tokens: new Set(normalized.split(' ').filter(Boolean))
        };
    }

    function hasPhrase(view, phrase) {
        const phraseValue = normalizedPhrase(phrase);
        const { normalized, tokens } = view;
        if (!phraseValue) return false;
        if (!phraseValue.includes(' ')) return tokens.has(phraseValue);
        return ` ${normalized} `.includes(` ${phraseValue} `);
    }

    function countMatchesInView(view, phrases) {
        let count = 0;
        const matches = [];

        for (const phrase of phrases) {
            if (hasPhrase(view, phrase)) {
                count += 1;
                matches.push(phrase);
            }
        }

        return { count, matches };
    }

    function countMatches(text, phrases) {
        return countMatchesInView(createTextView(text), phrases);
    }

    function safeArray(value) {
        return Array.isArray(value) ? value : [];
    }

    function safeString(value) {
        return typeof value === 'string' ? value : '';
    }

    function urlHostname(value) {
        try {
            return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
        } catch {
            return '';
        }
    }

    function createAccumulator() {
        const factors = [];
        const seen = new Set();
        const groupScores = Object.fromEntries(Object.keys(constants.SCORE.groupCaps).map(group => [group, 0]));

        function add(id, group, weight, evidence) {
            if (seen.has(id) || !Number.isFinite(weight) || weight === 0) return;
            if (!(group in constants.SCORE.groupCaps)) return;

            const cap = constants.SCORE.groupCaps[group];
            let appliedWeight;

            if (weight > 0) {
                const remaining = Math.max(0, cap - Math.max(0, groupScores[group]));
                appliedWeight = Math.min(weight, remaining);
            } else {
                const usedNegative = Math.max(0, -groupScores[group]);
                appliedWeight = -Math.min(Math.abs(weight), Math.max(0, cap - usedNegative));
            }

            if (appliedWeight === 0) return;
            seen.add(id);
            groupScores[group] += appliedWeight;
            factors.push({
                id,
                group,
                weight: appliedWeight,
                evidence: safeString(evidence).slice(0, 220)
            });
        }

        return { factors, groupScores, add };
    }

    function applyDomainSignals(context, accumulator) {
        const { hostname, url, systemBlockMatch } = context;

        if (systemBlockMatch) {
            accumulator.add(
                'system-blocklist',
                'domain',
                90,
                typeof systemBlockMatch === 'string' ? systemBlockMatch : hostname
            );
        }

        for (const rule of constants.DOMAIN_PATTERNS) {
            if (rule.regex.test(hostname)) {
                accumulator.add(rule.id, 'domain', rule.weight, hostname);
            }
        }

        for (const rule of constants.URL_RULES) {
            if (rule.regex.test(url)) accumulator.add(rule.id, 'url', rule.weight, url);
        }
    }

    function applyMetadataSignals(signals, accumulator) {
        const metadata = [
            safeString(signals.title),
            safeString(signals.metaDescription),
            ...safeArray(signals.openGraph)
        ].join(' ');
        const metadataView = createTextView(metadata);

        for (const rule of constants.METADATA_RULES) {
            const result = countMatchesInView(metadataView, rule.phrases);
            if (result.count > 0) {
                accumulator.add(rule.id, 'metadata', rule.weight, result.matches.slice(0, 3).join(', '));
            }
        }

        const faviconText = safeArray(signals.favicons).join(' ');
        const faviconMatch = countMatchesInView(createTextView(faviconText), [
            'sportsbook',
            'casino',
            'cassino',
            'betslip',
            'bet365',
            'poker',
            'slots'
        ]);
        if (faviconMatch.count > 0) {
            accumulator.add('favicon-gambling-path', 'metadata', 8, faviconMatch.matches.join(', '));
        }
    }

    function applyContentSignals(signals, accumulator) {
        const text = safeString(signals.text);
        const textView = createTextView(text);

        for (const rule of constants.CONTENT_RULES) {
            const result = countMatchesInView(textView, rule.phrases);
            if (result.count > 0) {
                accumulator.add(rule.id, 'content', rule.weight, result.matches.slice(0, 3).join(', '));
            }
        }

        const gameCluster = countMatchesInView(textView, [
            'roleta',
            'roulette',
            'blackjack',
            'baccarat',
            'bacara',
            'poker',
            'slots',
            'jackpot',
            'aviator',
            'plinko'
        ]);
        if (gameCluster.count >= 3) {
            accumulator.add('content-game-cluster', 'content', 30, gameCluster.matches.slice(0, 5).join(', '));
        }

        const actionText = [
            ...safeArray(signals.buttons),
            ...safeArray(signals.menus)
        ].join(' ');
        const actionView = createTextView(actionText);

        for (const rule of constants.TRANSACTION_RULES) {
            const result = countMatchesInView(actionView, rule.phrases);
            if (result.count > 0) {
                accumulator.add(rule.id, 'transaction', rule.weight, result.matches.slice(0, 3).join(', '));
            }
        }

        let bettingFormCount = 0;
        let paymentFormCount = 0;
        for (const form of safeArray(signals.forms)) {
            const formText = [
                safeString(form.action),
                safeString(form.text),
                ...safeArray(form.fields)
            ].join(' ');
            const formView = createTextView(formText);
            const betting = countMatchesInView(formView, [
                'stake',
                'bet amount',
                'valor da aposta',
                'odds',
                'cotacao',
                'betslip',
                'possivel retorno',
                'potential return',
                'wager'
            ]);
            const payment = countMatchesInView(formView, [
                'deposito',
                'deposit',
                'saque',
                'withdraw',
                'pix',
                'saldo',
                'balance',
                'valor'
            ]);
            if (betting.count >= 2) bettingFormCount += 1;
            if (payment.count >= 2) paymentFormCount += 1;
        }
        if (bettingFormCount > 0) {
            accumulator.add('betting-form', 'transaction', 55, `${bettingFormCount} formulário(s) de aposta`);
        }
        if (paymentFormCount > 0) {
            accumulator.add('payment-form', 'transaction', 15, `${paymentFormCount} formulário(s) financeiro(s)`);
        }

        let platformLinkCount = 0;
        for (const link of safeArray(signals.links)) {
            const target = `${safeString(link.url)} ${safeString(link.text)}`;
            if (/\/(?:sportsbook|casino|cassino|live-betting|apostas?-ao-vivo|betslip|slots?)(?:[/?#._-]|$)/i.test(target)) {
                platformLinkCount += 1;
            }
        }
        if (platformLinkCount >= 3) {
            accumulator.add('platform-link-cluster', 'content', 25, `${platformLinkCount} links de plataforma`);
        }

        const imageText = safeArray(signals.images)
            .map(image => `${safeString(image.url)} ${safeString(image.alt)}`)
            .join(' ');
        const imageMatches = countMatchesInView(createTextView(imageText), [
            'sportsbook',
            'live casino',
            'cassino',
            'roulette',
            'blackjack',
            'jackpot',
            'free spins',
            'betslip'
        ]);
        if (imageMatches.count >= 2) {
            accumulator.add('gambling-image-cluster', 'content', 15, imageMatches.matches.slice(0, 4).join(', '));
        }
    }

    function applyIntegrationSignals(signals, accumulator) {
        const sources = [
            ...safeArray(signals.scripts),
            ...safeArray(signals.iframes),
            ...safeArray(signals.serviceWorkerScopes),
            ...safeArray(signals.websocketUrls),
            ...safeArray(signals.resources).map(resource => safeString(resource.url)),
            ...safeArray(signals.links).filter(link => link.external).map(link => safeString(link.url))
        ].filter(Boolean);

        const providerMatches = new Set();
        const paymentMatches = new Set();
        const apiMatches = new Set();

        for (const source of sources) {
            const hostname = urlHostname(source);
            for (const provider of constants.GAMBLING_PROVIDER_HOSTS) {
                if (hostMatches(hostname, provider)) providerMatches.add(provider);
            }
            for (const payment of constants.PAYMENT_HOSTS) {
                if (hostMatches(hostname, payment)) paymentMatches.add(payment);
            }
            const normalizedSource = source.toLowerCase();
            for (const token of constants.BETTING_API_TOKENS) {
                if (normalizedSource.includes(token)) apiMatches.add(token);
            }
        }

        if (providerMatches.size > 0) {
            accumulator.add(
                'known-gambling-provider',
                'integration',
                65,
                Array.from(providerMatches).slice(0, 4).join(', ')
            );
        }
        if (apiMatches.size > 0) {
            accumulator.add(
                'known-betting-api',
                'integration',
                70,
                Array.from(apiMatches).slice(0, 4).join(', ')
            );
        }
        if (paymentMatches.size > 0) {
            accumulator.add(
                'payment-provider',
                'integration',
                10,
                Array.from(paymentMatches).slice(0, 3).join(', ')
            );
        }

        const websocketSignals = safeArray(signals.websocketUrls).filter(url => {
            const normalized = url.toLowerCase();
            return constants.BETTING_API_TOKENS.some(token => normalized.includes(token))
                || constants.GAMBLING_PROVIDER_HOSTS.some(host => hostMatches(urlHostname(url), host));
        });
        if (websocketSignals.length > 0) {
            accumulator.add('betting-websocket', 'integration', 35, websocketSignals[0]);
        }
    }

    function applyStorageAndNetworkSignals(signals, accumulator) {
        const storageKeys = [
            ...safeArray(signals.storage?.local),
            ...safeArray(signals.storage?.session),
            ...safeArray(signals.storage?.indexedDB)
        ];
        const matchedKeys = storageKeys.filter(key =>
            constants.STORAGE_PATTERNS.some(pattern => pattern.test(key))
        );
        if (matchedKeys.length >= 2) {
            accumulator.add('gambling-storage-keys', 'storage', 25, matchedKeys.slice(0, 5).join(', '));
        } else if (matchedKeys.length === 1) {
            accumulator.add('gambling-storage-key', 'storage', 12, matchedKeys[0]);
        }

        const trackerCount = Number.isFinite(signals.trackerCount) ? signals.trackerCount : 0;
        const pixelCount = Number.isFinite(signals.pixelCount) ? signals.pixelCount : 0;
        if (trackerCount >= 3) {
            accumulator.add('tracking-cluster', 'network', 5, `${trackerCount} rastreadores observados`);
        }
        if (pixelCount >= 2) {
            accumulator.add('tracking-pixels', 'network', 4, `${pixelCount} pixels observados`);
        }
    }

    function applyInformationalSignals(signals, accumulator) {
        const types = safeArray(signals.structuredDataTypes).map(normalizeText);
        const articleType = types.find(type => constants.ARTICLE_TYPES.includes(type));
        if (articleType) {
            accumulator.add('article-schema', 'informational', -45, articleType);
        }

        const combined = [
            safeString(signals.title),
            safeString(signals.metaDescription),
            safeString(signals.text)
        ].join(' ');
        const informational = countMatchesInView(
            createTextView(combined),
            constants.INFORMATIONAL_PHRASES
        );
        if (informational.count >= 3) {
            accumulator.add(
                'informational-context-strong',
                'informational',
                -45,
                informational.matches.slice(0, 5).join(', ')
            );
        } else if (informational.count >= 1 && Number(signals.articleCount) > 0) {
            accumulator.add(
                'informational-context',
                'informational',
                -30,
                informational.matches.slice(0, 3).join(', ')
            );
        }
    }

    function analyze(signals, options = {}) {
        const url = safeString(signals?.url);
        const hostname = hostnameFromUrl(url);
        const threshold = Math.round(Math.min(
            constants.SCORE.thresholdMax,
            Math.max(
                constants.SCORE.thresholdMin,
                Number(options.threshold) || constants.SCORE.thresholdDefault
            )
        ));

        if (!hostname || !/^https?:/i.test(url)) {
            return {
                verdict: 'allow',
                score: 0,
                threshold,
                confidence: 'high',
                factors: [],
                reasons: ['URL fora do escopo HTTP(S)'],
                groups: {}
            };
        }

        if (isTrustedHostname(hostname)) {
            return {
                verdict: 'allow',
                score: 0,
                threshold,
                confidence: 'high',
                factors: [{
                    id: 'trusted-domain',
                    group: 'informational',
                    weight: 0,
                    evidence: hostname
                }],
                reasons: ['Domínio protegido pela lista de permissão integrada'],
                groups: {}
            };
        }

        const accumulator = createAccumulator();
        const context = {
            hostname,
            url,
            systemBlockMatch: options.systemBlockMatch || false
        };

        applyDomainSignals(context, accumulator);
        applyMetadataSignals(signals, accumulator);
        applyContentSignals(signals, accumulator);
        applyIntegrationSignals(signals, accumulator);
        applyStorageAndNetworkSignals(signals, accumulator);
        applyInformationalSignals(signals, accumulator);

        const score = Math.round(accumulator.factors.reduce((sum, factor) => sum + factor.weight, 0));
        const strongGroups = new Set(
            Object.entries(accumulator.groupScores)
                .filter(([group, value]) => group !== 'informational' && value >= 20)
                .map(([group]) => group)
        );
        const operationalEvidence = accumulator.groupScores.transaction >= 25
            || accumulator.groupScores.integration >= 50;
        const informationalContext = accumulator.groupScores.informational <= -30;
        const systemConfirmed = Boolean(options.systemBlockMatch)
            && (
                accumulator.groupScores.metadata >= 20
                || accumulator.groupScores.content >= 25
                || operationalEvidence
            );
        const diverseEvidence = strongGroups.size >= 2;
        const contextualConfirmation = operationalEvidence || systemConfirmed || strongGroups.size >= 3;
        const passesInformationalGuard = !informationalContext || operationalEvidence;

        let verdict = 'allow';
        if (
            score >= threshold
            && diverseEvidence
            && contextualConfirmation
            && passesInformationalGuard
        ) {
            verdict = 'block';
        } else if (score >= Math.round(threshold * constants.SCORE.warnRatio) && diverseEvidence) {
            verdict = 'warn';
        }

        let confidence = 'low';
        if (verdict === 'block' && score >= threshold + 50 && strongGroups.size >= 3) confidence = 'high';
        else if (verdict === 'block' || verdict === 'warn') confidence = 'medium';
        else if (informationalContext || score < threshold * 0.35) confidence = 'high';

        const reasons = accumulator.factors
            .filter(factor => factor.weight > 0)
            .sort((left, right) => right.weight - left.weight)
            .slice(0, 6)
            .map(factor => `${factor.id} (+${factor.weight})`);

        return {
            verdict,
            score,
            threshold,
            confidence,
            factors: accumulator.factors,
            reasons,
            groups: accumulator.groupScores,
            safeguards: {
                diverseEvidence,
                contextualConfirmation,
                informationalContext,
                operationalEvidence,
                passesInformationalGuard
            }
        };
    }

    return Object.freeze({
        analyze,
        normalizeText,
        hostnameFromUrl,
        hostMatches,
        isTrustedHostname,
        countMatches
    });
})();
