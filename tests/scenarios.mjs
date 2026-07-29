import { baseSignals } from './runtime-loader.mjs';

const protectedHosts = [
    'chatgpt.com',
    'openai.com',
    'google.com',
    'youtube.com',
    'github.com',
    'gitlab.com',
    'microsoft.com',
    'claude.ai',
    'gemini.google.com',
    'wikipedia.org',
    'stackoverflow.com',
    'amazon.com.br',
    'mercadolivre.com.br',
    'itau.com.br',
    'caixa.gov.br',
    'usp.edu.br',
    'gov.br',
    'developer.mozilla.org',
    'betterstack.com',
    'betaflight.com',
    'alphabet.com'
];

export const safeScenarios = [
    ...protectedHosts.map(host => baseSignals(`https://${host}/`, {
        title: 'Documentação e serviços oficiais',
        metaDescription: 'Informações, ferramentas e atendimento',
        text: 'Conteúdo institucional, documentação, notícias e serviços para usuários.',
        buttons: ['Saiba mais'],
        articleCount: 1,
        structuredDataTypes: ['Article']
    })),
    baseSignals('https://betelgeuse.example/astronomy', {
        title: 'Betelgeuse: a red supergiant star',
        text: 'An astronomy article about Betelgeuse, stellar evolution and telescopes.',
        structuredDataTypes: ['Article'],
        articleCount: 1
    }),
    baseSignals('https://releases.example/beta-version', {
        title: 'Beta version 4.2 release notes',
        text: 'This beta release improves the alphabet sorting algorithm and developer APIs.',
        menus: ['Documentation', 'Git repository']
    }),
    baseSignals('https://bet365-analise.com/noticias/regulamentacao', {
        title: 'Análise da Bet365 e a nova regulamentação',
        metaDescription: 'Reportagem independente sobre o mercado de apostas',
        text: 'Esta notícia apresenta uma análise e investigação da regulamentação. O artigo cita cassino online, apostas esportivas, odds ao vivo, bônus e a frase aposte agora usada em campanhas.',
        structuredDataTypes: ['NewsArticle'],
        articleCount: 2,
        menus: ['Notícias', 'Política', 'Economia']
    }),
    baseSignals('https://hospital-exemplo.org/saude-mental', {
        title: 'Como prevenir o vício em jogos',
        metaDescription: 'Guia informativo de saúde',
        text: 'Artigo médico sobre dependência em apostas, prevenção ao jogo e como bloquear apostas.',
        structuredDataTypes: ['MedicalWebPage', 'Article'],
        articleCount: 1
    }),
    baseSignals('https://blog-financeiro.example/pix', {
        title: 'PIX, saldo e transferências',
        text: 'Guia informativo sobre depósito, saque, saldo, cartão de crédito e segurança bancária.',
        structuredDataTypes: ['BlogPosting'],
        articleCount: 1
    })
];

export const gamblingScenarios = [
    baseSignals('https://bet365.com/sportsbook', {
        title: 'Sportsbook — apostas esportivas',
        metaDescription: 'Odds ao vivo e apostas ao vivo',
        text: 'Casa de apostas com sportsbook, cupom de apostas, cash out e live odds.',
        menus: ['Sportsbook', 'Apostas ao vivo'],
        buttons: ['Aposte agora'],
        forms: [{ action: '/betslip', text: 'Confirmar aposta', fields: ['stake', 'odds', 'potential return'] }]
    }),
    baseSignals('https://royal-casino.example/live-casino', {
        title: 'Cassino online e live casino',
        metaDescription: 'Roleta ao vivo, blackjack ao vivo e jogos de slot',
        text: 'Cassino online com roleta ao vivo, blackjack, poker, slots, jackpot e free spins.',
        menus: ['Casino online', 'Live casino', 'Slots'],
        buttons: ['Jogue agora', 'Depositar e jogar']
    }),
    baseSignals('https://sports-platform.example/sports-betting', {
        title: 'Sports betting e live odds',
        metaDescription: 'Sportsbook completo',
        text: 'Apostas esportivas, mercado de apostas, bet slip e cash out.',
        buttons: ['Place bet'],
        forms: [{ action: '/betslip', text: 'Place bet', fields: ['bet amount', 'odds', 'potential return'] }]
    }),
    baseSignals('https://games-platform.example/casino', {
        title: 'Jogos online',
        metaDescription: 'Casino online',
        text: 'Roleta, blackjack, baccarat, poker, slots, aviator e jackpot.',
        buttons: ['Play now'],
        scripts: ['https://client.pragmaticplay.com/runtime.js']
    }),
    baseSignals('https://neutral-name.example/app', {
        title: 'Entretenimento ao vivo',
        metaDescription: 'Acesse os jogos',
        text: 'Live casino, sportsbook, cupom de apostas e odds ao vivo.',
        menus: ['Sportsbook', 'Live casino'],
        buttons: ['Aposte agora'],
        scripts: ['https://cdn.evolutiongaming.com/client.js'],
        resources: [{ url: 'https://odds-api.example/betting-api/live-odds/', type: 'fetch' }]
    })
];

export function generatedScenarios() {
    const safe = [];
    const gambling = [];
    const safeTerms = ['alphabet', 'beta', 'better', 'betelgeuse', 'betaflight'];

    for (let index = 0; index < 220; index += 1) {
        const term = safeTerms[index % safeTerms.length];
        safe.push(baseSignals(`https://docs-${index}.example/${term}`, {
            title: `${term} version ${index} documentation`,
            metaDescription: 'Technical article and release notes',
            text: `This article is a developer analysis of the ${term} release, API changes and source code.`,
            structuredDataTypes: [index % 2 ? 'TechArticle' : 'BlogPosting'],
            articleCount: 1,
            menus: ['Docs', 'GitHub', 'API']
        }));
    }

    for (let index = 0; index < 140; index += 1) {
        gambling.push(baseSignals(`https://platform-${index}.casino/sportsbook/live-betting`, {
            title: 'Casino online e apostas esportivas',
            metaDescription: 'Sportsbook com odds ao vivo',
            text: 'Cassino online, apostas esportivas, bet slip, live odds, cash out, roleta, blackjack e slots.',
            menus: ['Sportsbook', 'Live casino', 'Apostas ao vivo'],
            buttons: ['Aposte agora', 'Depositar e jogar'],
            forms: [{ action: '/betslip', text: 'Confirmar aposta', fields: ['stake', 'odds', 'potential return'] }],
            storage: {
                local: ['casino_betslip', 'live_odds'],
                session: [],
                indexedDB: [],
                cookies: []
            }
        }));
    }
    return { safe, gambling };
}
