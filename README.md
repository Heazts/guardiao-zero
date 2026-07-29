# Guardião Zero Pro

Extensão Manifest V3 para Firefox e Chromium que reduz a exposição a
plataformas de apostas, anúncios e rastreadores. A classificação é
determinística, multifator e executada localmente. Não há telemetria, conta,
servidor próprio ou envio de conteúdo de navegação.

## Recursos

- detecção contextual por score, grupos de evidência e safeguards;
- índice local com 272.868 domínios e busca binária de baixo consumo de heap;
- whitelist tipada com prioridade sobre classificação e regras de rede;
- blocklist tipada para domínio, subdomínio, regex, TLD, ASN condicional e
  assinatura;
- rulesets DNR independentes para anúncios e rastreadores;
- importação local do subconjunto seguro de EasyList, EasyPrivacy, AdGuard,
  uBlock Origin, HOSTS e listas personalizadas;
- gerenciamento, pausa, remoção, relatório de rejeições e quota portátil de
  4.900 regras importadas;
- temas claro, escuro ou sistema, accent color, alto contraste, densidade e
  redução de movimento;
- interface acessível e responsiva, com fonte Inter e ícones empacotados;
- backup e restauração locais;
- política de privacidade navegável dentro da extensão.

## Privacidade

O Guardião Zero Pro não coleta, compartilha nem transmite dados do usuário.
Preferências, listas e contadores agregados permanecem exclusivamente em
`storage.local`. Sinais públicos e limitados da página são transitórios e
usados somente para a decisão atual.

Leia a [Política de Privacidade](PRIVACY.md) e o
[modelo de segurança](docs/SECURITY.md).

## Detecção

O limiar padrão é 120, configurável entre 100 e 180. Cada categoria de
evidência tem um teto; repetir um termo não aumenta indefinidamente a
pontuação. Um bloqueio automático exige:

1. score igual ou superior ao limiar;
2. pelo menos dois grupos positivos independentes;
3. confirmação operacional, confirmação do índice por conteúdo, ou três
   grupos fortes;
4. aprovação do safeguard para contexto jornalístico, educacional ou
   documental.

Nenhuma palavra isolada — inclusive `bet`, `casino` ou `odds` — é suficiente.
Domínios integrados confiáveis, regras pessoais permitidas e liberações
temporárias são avaliados primeiro.

Detalhes: [docs/DETECTION.md](docs/DETECTION.md).

## Listas de filtros

A importação aceita arquivos locais de até 4 MiB. O parser nunca executa o
conteúdo importado e traduz apenas regras de rede representáveis com segurança
por `declarativeNetRequest`. Filtros cosméticos, scriptlets, HTML filtering,
redirect, CSP, alteração de headers e regex arbitrária são recusados e
contabilizados.

As categorias seguem os toggles da extensão:

- Anúncios → `blockAds`;
- Privacidade → `blockTrackers`;
- Apostas → `blockBetting`;
- Personalizada → ativa enquanto a proteção geral estiver ativa.

## Desenvolvimento

Requer Node.js 20 ou superior. Não existem dependências npm de runtime.

```text
npm run lint
npm test
npm run benchmark
npm run test:real
npm run build:firefox
npm run build:chromium
```

O projeto-fonte mantém as duas declarações de background necessárias à
portabilidade. Os builds são direcionados:

- `build:firefox` gera `dist/` com `background.scripts`;
- `build:chromium` gera `dist/` com `background.service_worker`.

Para validar e empacotar a submissão Firefox:

```text
npm run package:amo
```

O comando usa `web-ext` 10, exige zero warnings e grava o ZIP em
`web-ext-artifacts/`.

## Avaliação

`npm test` executa testes unitários, de integração e centenas de cenários de
regressão determinísticos. Eles não são apresentados como tráfego real.

`npm run test:real` acessa somente as URLs públicas declaradas em
`tests/real-world-corpus.json`, descarta respostas indisponíveis ou
intersticiais e registra hash, status e fatores sem salvar o HTML.

Na execução de 29 de julho de 2026:

- 47 URLs reais tentadas;
- 23 respostas utilizáveis e 24 indisponíveis;
- 5 TP, 1 FN, 17 TN e 0 FP;
- precisão positiva de 100%, recall de 83,33% e acurácia de 95,65% no
  subconjunto disponível.

Esses valores descrevem somente aquela execução e não são promessa sobre toda
a web. Consulte os [resultados completos](docs/reports/real-world-results.json)
e o [gráfico gerado](docs/assets/precision-real-world.svg).

## Estrutura

```text
assets/                  ícones, fonte Inter e licença OFL
src/background/          estado, políticas, DNR e índice local
src/content/             coleta limitada e orquestração da análise
src/shared/detection/    constantes, score e decisão multifator
src/shared/filters/      parser conservador de listas
src/shared/lists/        whitelist e blocklist tipadas
src/shared/messaging/    schemas e validação de mensagens
src/{popup,options}/     controles principais e personalização
src/{blocked,help}/      bloqueio e ajuda
src/{diagnostics,privacy}/ diagnóstico e política navegável
tests/                   unidade, integração, regressão e corpus real
tools/                   validação, benchmark, build, avaliação e pacote AMO
docs/                    arquitetura, segurança e relatórios
```

## Permissões

- `storage`: dados funcionais locais;
- `declarativeNetRequest`: bloqueio de rede;
- `webNavigation`: aplicação antecipada de políticas explícitas;
- hosts HTTP(S): coleta local de sinais públicos necessários à função
  principal.

A extensão não solicita `declarativeNetRequestFeedback`, cookies, histórico,
downloads, identidade ou acesso remoto a código.

## Licenças e publicação

O código original está sob MIT. Inter está sob OFL-1.1. Consulte
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) antes de redistribuir:
a proveniência e a licença de `src/filters/heazts-blocklist.txt` ainda precisam
ser confirmadas pelo mantenedor.

O checklist de submissão está em
[docs/AMO_SUBMISSION.md](docs/AMO_SUBMISSION.md).
