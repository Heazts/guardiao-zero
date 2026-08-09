'use strict';

/**
 * Constantes imutáveis compartilhadas pelo detector e pelo coletor de sinais.
 * Regras usam frases ou tokens delimitados; nunca substrings como "bet" em
 * "alphabet", "beta" ou "betterstack".
 */
globalThis.GuardiaoConstants = globalThis.GuardiaoConstants || (() => {
    const DEFAULT_SETTINGS = Object.freeze({
        blockBetting: true,
        blockAds: true,
        blockTrackers: true,
        aiDetection: true,
        detectionThreshold: 120,
        extremeMode: false
    });

    /**
     * Contadores separados por natureza da evidência.
     *
     * `pagesBlocked` conta um evento real: uma navegação que a extensão de fato
     * interrompeu. É o único número que a extensão pode provar.
     *
     * `adsObserved` e `trackersObserved` contam recursos publicitários e de
     * rastreamento que chegaram a CARREGAR na página, lidos da resource timing.
     * São indicadores de vazamento — mostram onde as regras de rede têm lacuna
     * — e nunca devem ser apresentados como "bloqueados".
     *
     * Contar requisições realmente bloqueadas exigiria a permissão
     * `declarativeNetRequestFeedback` e a API de depuração de correspondência
     * de regra, que o Chrome só expõe em extensão descompactada — e que
     * tools/validate.mjs proíbe no src justamente para manter essa fronteira.
     * Enquanto isso for verdade, não existe contador honesto de "anúncios
     * bloqueados"; existe contador de anúncios que escaparam.
     */
    const DEFAULT_STATS = Object.freeze({
        pagesBlocked: 0,
        adsObserved: 0,
        trackersObserved: 0,
        lastReset: 0
    });

    const LIMITS = Object.freeze({
        text: 14000,
        title: 300,
        metadata: 900,
        buttons: 60,
        menus: 40,
        forms: 20,
        formFields: 30,
        links: 120,
        images: 80,
        scripts: 80,
        iframes: 40,
        resources: 160,
        storageKeys: 60,
        listEntries: 5000,
        messageBytes: 180000,
        cacheEntries: 128,
        mutationWindowMs: 20000,
        mutationDebounceMs: 2500,
        maxRescans: 2
    });

    const SCORE = Object.freeze({
        thresholdMin: 100,
        thresholdMax: 180,
        thresholdDefault: 120,
        warnRatio: 0.7,
        groupCaps: Object.freeze({
            domain: 95,
            url: 45,
            metadata: 60,
            content: 75,
            transaction: 80,
            integration: 90,
            storage: 30,
            network: 15,
            informational: 80
        })
    });

    const TRUSTED_DOMAINS = Object.freeze([
        'google.com',
        'googleapis.com',
        'gstatic.com',
        'youtube.com',
        'youtu.be',
        'github.com',
        'gitlab.com',
        'microsoft.com',
        'live.com',
        'office.com',
        'office365.com',
        'azure.com',
        'openai.com',
        'chatgpt.com',
        'anthropic.com',
        'claude.ai',
        'gemini.google.com',
        'wikipedia.org',
        'wikimedia.org',
        'stackoverflow.com',
        'stackexchange.com',
        'superuser.com',
        'serverfault.com',
        'askubuntu.com',
        'mozilla.org',
        'developer.mozilla.org',
        'chromium.org',
        'npmjs.com',
        'nodejs.org',
        'deno.land',
        'bun.sh',
        'docker.com',
        'kubernetes.io',
        'cloudflare.com',
        'vercel.com',
        'amazon.com',
        'amazon.com.br',
        'mercadolivre.com.br',
        'mercadopago.com.br',
        'alphabet.com',
        'betterstack.com',
        'betaflight.com',
        'gov.br',
        'usa.gov',
        'europa.eu',
        'who.int',
        'fiocruz.br',
        'sus.gov.br',
        'caixa.gov.br',
        'bb.com.br',
        'itau.com.br',
        'bradesco.com.br',
        'santander.com.br',
        'nubank.com.br',
        'inter.co',
        'c6bank.com.br'
    ]);

    const TRUSTED_HOST_PATTERNS = Object.freeze([
        /(?:^|\.)gov(?:\.[a-z]{2})?$/i,
        /(?:^|\.)edu(?:\.[a-z]{2})?$/i,
        /(?:^|\.)mil(?:\.[a-z]{2})?$/i,
        /(?:^|\.)ac\.uk$/i
    ]);

    const DOMAIN_PATTERNS = Object.freeze([
        Object.freeze({
            id: 'domain-gambling-token',
            regex: /(?:^|[.-])(?:apostas?|bets?|betting|casino|cassino|sportsbook|slots?|poker|bingo|jackpot|gambling)(?:[.-]|$)/i,
            weight: 35
        }),
        Object.freeze({
            id: 'domain-brand-number',
            regex: /(?:^|[.-])(?:bet|bets|casino|win|slot)\d{2,}(?:[.-]|$)/i,
            weight: 30
        }),
        Object.freeze({
            id: 'domain-betting-tld',
            regex: /\.(?:bet|casino|poker|bingo)$/i,
            weight: 35
        })
    ]);

    const URL_RULES = Object.freeze([
        Object.freeze({
            id: 'url-platform-route',
            regex: /\/(?:sportsbook|sports-betting|live-betting|apostas?-ao-vivo|cassino|casino|live-casino|slots?|poker|bet-?slip)(?:[/?#._-]|$)/i,
            weight: 30
        }),
        Object.freeze({
            id: 'url-transaction-route',
            regex: /\/(?:deposit|deposito|dep[oó]sito|withdraw|withdrawal|saque|cashout)(?:[/?#._-]|$)/i,
            weight: 15
        })
    ]);

    const METADATA_RULES = Object.freeze([
        Object.freeze({ id: 'meta-sportsbook', phrases: ['sportsbook', 'casa de apostas', 'apostas esportivas', 'sports betting'], weight: 35 }),
        Object.freeze({ id: 'meta-online-casino', phrases: ['cassino online', 'casino online', 'online casino'], weight: 40 }),
        Object.freeze({ id: 'meta-live-casino', phrases: ['cassino ao vivo', 'casino ao vivo', 'live casino', 'live dealer'], weight: 45 }),
        Object.freeze({ id: 'meta-live-odds', phrases: ['odds ao vivo', 'live odds', 'apostas ao vivo', 'live betting'], weight: 35 }),
        Object.freeze({ id: 'meta-slots', phrases: ['jogos de slot', 'slot games', 'caça níqueis', 'caca niquel'], weight: 30 })
    ]);

    const CONTENT_RULES = Object.freeze([
        Object.freeze({ id: 'content-sportsbook', phrases: ['sportsbook', 'casa de apostas', 'apostas esportivas', 'sports betting'], weight: 30 }),
        Object.freeze({ id: 'content-casino', phrases: ['cassino online', 'casino online', 'live casino', 'cassino ao vivo'], weight: 35 }),
        Object.freeze({ id: 'content-odds', phrases: ['odds ao vivo', 'live odds', 'mercado de apostas', 'betting market'], weight: 25 }),
        Object.freeze({ id: 'content-betslip', phrases: ['cupom de apostas', 'bilhete de aposta', 'bet slip', 'betslip'], weight: 35 }),
        Object.freeze({ id: 'content-cashout', phrases: ['cash out', 'encerrar aposta', 'fechar aposta'], weight: 25 }),
        Object.freeze({ id: 'content-games', phrases: ['roleta ao vivo', 'blackjack ao vivo', 'aviator crash', 'jogo do tigrinho', 'free spins', 'giros grátis'], weight: 25 }),
        Object.freeze({ id: 'content-wagering', phrases: ['requisitos de aposta', 'wagering requirements', 'rollover de bônus'], weight: 20 }),
        Object.freeze({ id: 'content-responsible', phrases: ['jogue com responsabilidade', 'gamble responsibly', 'jogo responsável'], weight: 5 })
    ]);

    const TRANSACTION_RULES = Object.freeze([
        Object.freeze({ id: 'action-bet-now', phrases: ['aposte agora', 'fazer aposta', 'confirmar aposta', 'place bet', 'bet now'], weight: 50 }),
        Object.freeze({ id: 'action-play-now', phrases: ['jogue agora', 'play now', 'começar a jogar'], weight: 35 }),
        Object.freeze({ id: 'action-deposit-play', phrases: ['depositar e jogar', 'faça seu depósito', 'make a deposit', 'deposit now'], weight: 35 }),
        Object.freeze({ id: 'action-bonus', phrases: ['bônus de boas vindas', 'bonus de boas vindas', 'welcome bonus', 'free bet', 'aposta grátis'], weight: 35 }),
        Object.freeze({ id: 'action-cashout', phrases: ['solicitar saque', 'withdraw funds', 'cash out bet'], weight: 25 })
    ]);

    const INFORMATIONAL_PHRASES = Object.freeze([
        'notícia',
        'noticia',
        'reportagem',
        'jornal',
        'análise',
        'analise',
        'review',
        'avaliação',
        'avaliacao',
        'comparativo',
        'guia informativo',
        'investigação',
        'investigacao',
        'regulamentação',
        'regulamentacao',
        'legislação',
        'legislacao',
        'projeto de lei',
        'ministério da fazenda',
        'ministerio da fazenda',
        'cpi das apostas',
        'vício em jogos',
        'vicio em jogos',
        'dependência em apostas',
        'dependencia em apostas',
        'como bloquear apostas',
        'prevenção ao jogo',
        'prevencao ao jogo'
    ]);

    const ARTICLE_TYPES = Object.freeze([
        'article',
        'newsarticle',
        'reportagenewsstory',
        'blogposting',
        'analysisnewsarticle',
        'opinionnewsarticle'
    ]);

    const GAMBLING_PROVIDER_HOSTS = Object.freeze([
        'evolution.com',
        'evolutiongaming.com',
        'pragmaticplay.com',
        'playtech.com',
        'netent.com',
        'microgaming.com',
        'playngo.com',
        'quickspin.com',
        'yggdrasilgaming.com',
        'redtiger.com',
        'blueprintgaming.com',
        'bigtimegaming.com',
        'hacksawgaming.com',
        'relax-gaming.com',
        'nolimitcity.com',
        'pushgaming.com',
        'spribe.co',
        'bgaming.com',
        'pgsoft.com'
    ]);

    const BETTING_API_TOKENS = Object.freeze([
        '/sportsbook-api/',
        '/betting-api/',
        '/betslip/',
        '/odds-feed/',
        '/live-odds/',
        '/casino-api/',
        'sportsbook-api.',
        'odds-api.'
    ]);

    const PAYMENT_HOSTS = Object.freeze([
        'stripe.com',
        'paypal.com',
        'mercadopago.com',
        'mercadopago.com.br',
        'pagseguro.com.br',
        'pagar.me',
        'pay4fun.com.br',
        'paybrokers.com.br',
        'payretailers.com'
    ]);

    const STORAGE_PATTERNS = Object.freeze([
        /(?:^|[_-])bets?lip(?:[_-]|$)/i,
        /(?:^|[_-])sportsbook(?:[_-]|$)/i,
        /(?:^|[_-])casino(?:[_-]|$)/i,
        /(?:^|[_-])gambling(?:[_-]|$)/i,
        /(?:^|[_-])live[_-]?odds(?:[_-]|$)/i,
        /(?:^|[_-])wager(?:[_-]|$)/i
    ]);

    const AD_HOSTS = Object.freeze([
        'doubleclick.net',
        'googleadservices.com',
        'googlesyndication.com',
        'amazon-adsystem.com',
        'adnxs.com',
        'adsrvr.org',
        'criteo.com',
        'criteo.net',
        'taboola.com',
        'outbrain.com',
        'pubmatic.com',
        'rubiconproject.com',
        'openx.net',
        'casalemedia.com',
        'adform.net',
        'smartadserver.com',
        'sharethrough.com',
        'teads.tv',
        '3lift.com',
        'media.net'
    ]);

    const TRACKER_HOSTS = Object.freeze([
        'google-analytics.com',
        'analytics.google.com',
        'hotjar.com',
        'mixpanel.com',
        'segment.io',
        'segment.com',
        'fullstory.com',
        'mouseflow.com',
        'crazyegg.com',
        'kissmetrics.io',
        'amplitude.com',
        'heapanalytics.com',
        'clarity.ms',
        'scorecardresearch.com',
        'quantserve.com',
        'appsflyer.com'
    ]);

    return Object.freeze({
        DEFAULT_SETTINGS,
        DEFAULT_STATS,
        LIMITS,
        SCORE,
        TRUSTED_DOMAINS,
        TRUSTED_HOST_PATTERNS,
        DOMAIN_PATTERNS,
        URL_RULES,
        METADATA_RULES,
        CONTENT_RULES,
        TRANSACTION_RULES,
        INFORMATIONAL_PHRASES,
        ARTICLE_TYPES,
        GAMBLING_PROVIDER_HOSTS,
        BETTING_API_TOKENS,
        PAYMENT_HOSTS,
        STORAGE_PATTERNS,
        AD_HOSTS,
        TRACKER_HOSTS
    });
})();
