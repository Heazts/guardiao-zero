# Changelog

## 3.1.3 — 2026-08-09

Correções de interface e unificação da identidade visual.

### Popup

- corrige as duas barras de rolagem do popup. O conteúdo media 616,5 px contra o
  teto de 600 px do Firefox; a barra vertical resultante estreitava o viewport e,
  contra um corpo de largura fixa, disparava também a barra horizontal. O ritmo
  vertical passou a fechar em 541 px e o documento ganhou teto explícito — se o
  texto crescer (tradução, fonte mínima do usuário), quem rola é apenas
  `.popup-main`, dentro da moldura, sem nunca reintroduzir barra horizontal;
- fecha o lockup da marca na altura exata do símbolo: as duas linhas são de linha
  única e herdavam `line-height` 1,55, o que inflava o cabeçalho sem motivo.

### Configurações

- corrige "Zerar contadores", que não funcionava. O handler lia
  `event.currentTarget` depois de `await confirmAction(...)`, e nessa altura ele
  já é null — o TypeError acontecia antes da chamada, então confirmar o diálogo
  não zerava nada;
- corrige "Exportar backup", que deixava o próprio botão desabilitado até
  recarregar a página, pelo mesmo motivo no `finally`;
- `npm run lint` passa a recusar acesso a propriedade de `.currentTarget`, para o
  padrão não voltar.

### Idiomas

- a interface passa a existir em doze idiomas — português, inglês, chinês
  simplificado, hindi, espanhol, árabe, francês, bengali, russo, urdu, indonésio
  e alemão — com seletor próprio em Configurações → Aparência, além do modo
  automático que segue o navegador;
- `browser.i18n` não resolve sozinha, porque deriva o idioma da interface do
  navegador e não pode ser trocada em tempo de execução. O catálogo é lido de
  `_locales/<code>/messages.json`, os mesmos arquivos que o manifesto usa para
  nome e descrição na loja, então não existem duas fontes que possam divergir;
- árabe e urdu são RTL: trinta propriedades físicas do CSS viraram lógicas e o
  polegar do toggle ganhou regra `:dir(rtl)`, já que `translateX` é geométrico e
  não tem equivalente lógico;
- `npm run lint` recusa catálogo com chave faltando, sobrando ou sem texto.

Nesta versão apenas o popup, a navegação e os metadados de loja estão
traduzidos. As demais telas continuam em português e serão convertidas em
seguida; até lá o texto de origem aparece como fallback, sem quebrar a página.

### Tema escuro

- corrige o contraste de tudo que é pintado com a cor de acento. `--accent` é a
  cor crua escolhida pelo usuário e o padrão `#111` ficava invisível sobre
  `--surface` (`#151514`): o trilho ligado do toggle, o botão primário, o filete
  do índice `01`, a régua do diagnóstico e o slider sumiam no tema escuro. A
  pintura passa a usar `--accent-surface`, já ajustado ao fundo do tema com 4,5:1
  garantido, e `--accent-surface-ink` por cima.

### Identidade

- unifica todos os ícones no símbolo Limiar Orbital. O SVG do cabeçalho e os PNG
  do manifesto vinham de duas descrições diferentes do mesmo desenho — curvas de
  Bézier no SVG, arco elíptico do Pillow no script Python — e o ícone da barra
  não era o mesmo símbolo da interface;
- `tools/make-icons.mjs` passa a ser a origem única: uma geometria produz o SVG e
  cada PNG, com rasterizador e codificador PNG próprios, sem dependências e sem
  Python. `npm run build:icons` regenera tudo; `npm run lint` falha se algum
  arquivo versionado divergir da geometria;
- corrige a centragem do símbolo dentro do selo, que nascia 1,5 unidade à
  esquerda, e ajusta a proporção do selo para 62 % — a 72 % o contraforma do `C`
  fechava e o ícone virava uma mancha em 16 px;
- adiciona o kit de loja em `docs/assets/brand/`: vetor de 128 px para o AMO,
  glifo em `currentColor` e raster de 128 e 512 px. Fica fora de `assets/` para
  não entrar no pacote da extensão;
- remove `tools/make_icons.py`, que exigia Pillow sem declarar a dependência.

### Ativos da listagem

- as capturas do AMO passam a ser geradas por `npm run build:shots`, a partir das
  páginas reais em Firefox headless, e a viver em `docs/amo-listing/`. Antes eram
  manuais e ficavam em `web-ext-artifacts/`, ignorada pelo git: sumiam num clone
  novo e envelheciam em silêncio — as da 3.1.2 ainda mostravam o ícone antigo e o
  indicador do item ativo invisível;
- o ícone da listagem deixa de ter cópia própria e passa a sair do mesmo desenho
  do manifesto, em `docs/assets/brand/`.

### Benchmark

- `npm run build:chart` desenha o gráfico do motor a partir dos relatórios de
  `bench:engine` e `benchmark`, em PNG claro e escuro para os dois temas do
  GitHub. Nenhum número é digitado no gerador;
- remove `docs/assets/benchmark-evolution.svg` e o gerador dele dentro de
  `tools/benchmark.mjs`: não era mais referenciado e contava a mesma história de
  precisão a partir de um segundo desenho.

### Limpeza

- remove `src/filters/heazts-blocklist.txt` do repositório. A lista já estava
  fora de todo artefato público desde a 3.1.2; as travas de build e de pacote
  continuam no lugar para impedir que volte;
- remove os relatórios históricos das versões 3.0.0 e 3.1.0, órfãos e com
  referências a arquivos que já não existem. O histórico permanece no git;
- corrige o README, que pedia Node.js 20 enquanto `package.json` e
  `tools/package-amo.mjs` exigem 22.

## 3.1.2 — 2026-08-09

Atualização de confiabilidade, bloqueio antecipado e preparação reproduzível
para o AMO.

### Bloqueio e navegação

- substitui a lista legada sem licença por uma política original e auditável de
  28 domínios inequívocos, mais o sufixo regulado `.bet.br`;
- adiciona regras DNR `main_frame` para impedir que destinos confirmados
  comecem a carregar antes do redirecionamento para a tela de bloqueio;
- preserva a precedência de pausa, whitelist e liberações temporárias sobre o
  bloqueio antecipado;
- reanalisa SPAs que navegam por fragmento (`#/rota`) com
  `onReferenceFragmentUpdated`, além da History API já coberta;
- separa no DNR domínio exato de domínio com subdomínios e remove entradas
  vencidas de forma transacional.

### Estado e conteúdo dinâmico

- serializa mutações de configurações, listas e contadores numa fila única,
  eliminando perda de alterações quando dois controles salvam ao mesmo tempo;
- torna o CSS cosmético idempotente: pausa, whitelist e toggle de anúncios
  removem imediatamente o estilo, e falhas transitórias recebem retry limitado;
- amplia o fingerprint para todos os sinais limitados usados pelo detector e
  observa mudanças relevantes em texto, formulários, atributos e recursos.

### Segurança e privacidade

- restringe regex pessoais a uma gramática linear segura e rejeita grupos,
  alternâncias sobrepostas e quantificadores de custo imprevisível;
- rejeita seletores cosméticos que atinjam a estrutura da página mesmo dentro
  de pseudo-funções e seletores compostos;
- remove credenciais, query e fragmento de URLs auxiliares e encaminha apenas
  nomes de storage/IndexedDB relevantes, nunca valores;
- alinha as políticas de privacidade textual e navegável com o processamento
  local que também pode ocorrer em páginas autenticadas.

### Release

- fixa `web-ext` 10.6.0 e Node.js 22+, adiciona lockfile e CI;
- `package:amo` passa por lint, 110 testes, builds Firefox/Chromium e lint AMO,
  verifica o conteúdo do ZIP e gera SHA-256 e manifesto de release;
- adiciona smoke test opcional em Firefox real e uma regressão para a ordem dos
  scripts de background no manifesto.

## 3.1.1 — 2026-08-09

Auditoria de segurança, privacidade, precisão de bloqueio e performance.

### Corrigido — crítico

- domínios presentes na blocklist integrada passam a bloquear diretamente no
  modo normal, sem depender de pontuação ou do conteúdo carregado pela página;
- bloqueios pessoais passam a prevalecer sobre a confiança integrada, enquanto
  exceções explícitas do usuário continuam tendo a prioridade máxima;
- `github.io`, `githubusercontent.com`, `vercel.app` e `netlify.app` deixam de
  ser confiáveis por sufixo, pois hospedam conteúdo controlado por terceiros;
- mudanças de rota em SPAs reiniciam a coleta e a classificação, mesmo depois
  da janela inicial de observação;
- as regras DNR de allow deixam de incluir `TRUSTED_DOMAINS`. A lista existe
  para evitar falso positivo do classificador de apostas e estava virando
  `allow` de prioridade 100, o que desligava por completo o bloqueio de
  anúncios e rastreadores em 60 domínios — entre eles YouTube, Google, Amazon,
  Mercado Livre e Microsoft. Coberto por `tests/dnr-scope.test.mjs`;
- desligar "Sites de apostas" não congela mais os contadores: a coleta deixou
  de ser condicionada a `blockBetting`.

### Bloqueio de anúncios

- rulesets estáticos passam a ser gerados por `tools/build-rules.mjs` a partir
  de seed lists em `src/filters/sources/`, usando o mesmo parser validado da
  importação local;
- cobertura embarcada vai de 28 para 202 regras de anúncio e de 17 para 132 de
  rastreamento;
- cada regra cobre 11 tipos de recurso em vez de 4 — `ping`, `media`,
  `websocket`, `font`, `stylesheet` e `object` de domínio publicitário deixam
  de passar;
- `main_frame` fica fora de propósito, para não quebrar click-through;
- `npm run lint` falha se o JSON gerado divergir das seed lists.

### Ocultamento de elementos (novo)

- o parser passa a aceitar ocultamento — `##seletor`, `dominio##seletor` e a
  exceção `dominio#@#seletor`. O efeito é sempre `display: none`, nunca uma
  declaração vinda da lista;
- 52 seletores embarcados, curados por marcador definido pela própria
  plataforma de anúncio. Nada de heurística por nome genérico como `.banner`
  ou `.promo`, que têm uso legítimo;
- aplicado como **CSS, não manipulação de DOM**: uma regra CSS vale para
  elementos que ainda não existem, então infinite scroll, lazy loading e SPA
  ficam cobertos sem nenhum `MutationObserver` e sem custo por mutação;
- regras inseridas uma a uma, para que um seletor recusado pelo navegador não
  derrube os outros — o que aconteceria numa lista separada por vírgula;
- o parser recusa seletor que atinja `html`, `body`, `head`, `main`, `article`,
  `:root` ou `*`, além de procedural (`:has-text`, `:xpath`, `:upward`…),
  injeção de estilo (`#$#`) e scriptlet;
- precedência: whitelist do usuário, liberação temporária, toggle de anúncios e
  pausa geral desligam o ocultamento, igual às outras camadas;
- scriptlets, HTML filtering, `$redirect`, `$csp` e `$removeparam` continuam
  recusados.

### Estatísticas

- `sitesBlocked` → `pagesBlocked`, `adsBlocked` → `adsObserved`,
  `trackersBlocked` → `trackersObserved`; `totalBlocked` foi removido por somar
  um evento real com duas estimativas;
- os contadores de anúncio e rastreador mediam recursos que *carregaram*.
  Passam a ser apresentados como indicador de lacuna, não de proteção;
- migração v4 → v5 preserva o acumulado, coberta por testes.

### Privacidade

- a coleta de nomes de cookie em toda página foi removida. Alimentava apenas
  padrões que `localStorage` e `sessionStorage` já cobrem, e era o sinal de
  maior custo num add-on que declara `data_collection_permissions: none`;
- a fronteira de mensagens deixou de aceitar o campo, então um content script
  comprometido não consegue reintroduzi-lo.

### Detecção

- navegação SPA passa a ser reavaliada via `webNavigation.onHistoryStateUpdated`;
  antes uma rota alcançada por push de histórico escapava.

### Performance — medido, com equivalência de saída verificada

- matcher de subdomínio deixa de percorrer todas as entradas e passa a caminhar
  os rótulos do host consultando um hash. `match()` real sobre whitelist de
  5.000 entradas: **18,06 ms → 1,00 ms em 101 URLs (18,0x)**;
- `normalizeDomain` deixa de construir uma URL inválida por linha de filtro só
  para vê-la lançar. Parse de 12.000 regras: **1.639 ms → 270 ms (6,08x)**;
- despertar do service worker sem mudança deixa de reescrever ~1,5 MiB no
  storage e de republicar até 4.900 regras dinâmicas idênticas;
- `compile` deixa de renormalizar entradas já normalizadas: **1,32x**, 54 ms por
  despertar no perfil máximo. Novo `compileEntries` para quem já normalizou.

### Build

- `build:firefox` e `build:chromium` gravam em `dist/firefox/` e
  `dist/chromium/` e param de se sobrescrever;
- o manifesto-fonte passa a ser válido para Firefox; somente o build Chromium
  adiciona `background.service_worker`;
- `package:amo` gera um ZIP com `firefox` no nome e imprime seu SHA-256 para
  impedir o envio acidental da raiz do repositório;
- coleta leve sem acesso ao DOM quando só a observação é necessária;
- `npm run bench:engine` mede os caminhos quentes; metodologia e limites de
  plataforma documentados em `docs/BENCHMARK.md`.

## 3.1.0

- cria a identidade Limiar Orbital, com símbolo autoral que reúne zero, Guardião
  e barreira local, marca vetorial, família de ícones e regras documentadas;
- combina Newsreader local para voz editorial, Inter para controles e
  numeração monoespaçada para estados e metadados;
- reformula popup, opções, bloqueio, ajuda, diagnóstico, privacidade e overlay
  de conteúdo como registros operacionais, sem escudos, mosaicos de cards ou
  iconografia decorativa genérica;
- adiciona página e política de privacidade;
- adiciona tema claro/escuro/sistema, accent color, alto contraste, densidade
  e redução de movimento em `storage.local`;
- corrige foco, contraste, tooltips, rótulos, hash navigation, responsividade e
  feedback assíncrono;
- importa e gerencia filtros EasyList/EasyPrivacy/AdGuard/uBlock/HOSTS;
- adiciona allow rules DNR prioritárias e rollback de rede/persistência;
- corrige a semântica de hostname exato ao preservar `www`;
- evita varredura DOM quando apenas anúncios/rastreadores estão ativos;
- separa builds Firefox e Chromium;
- adiciona licença MIT, OFL, avisos de terceiros e checklist AMO;
- adiciona corpus real reproduzível, resultados com hashes e gráficos
  derivados;
- publica no README um benchmark em SVG com fundo branco, gerado diretamente
  das métricas locais e acompanhado dos dados JSON completos;
- valida o pacote Firefox com `web-ext` 10 sem erros, notices ou warnings.

## 3.0.0

- substitui decisão por palavra única por classificação multifator;
- adiciona score configurável e safeguard informativo;
- implementa whitelist/blocklist tipadas;
- reduz memória da blocklist com busca binária;
- valida mensagens e origens;
- limita coleta DOM e MutationObserver;
- separa rulesets de anúncios/rastreadores;
- unifica compatibilidade Firefox/Chromium MV3;
- remove código morto, artefatos de assinatura e cache acidental;
- adiciona build, validação, benchmark e testes sem dependências npm.
