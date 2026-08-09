# Segurança e Privacidade

## Fronteiras de confiança

O background é a autoridade sobre configurações, listas e bloqueios. Páginas
da extensão não escrevem estado diretamente; enviam comandos tipados.
Content scripts podem enviar somente amostras de página, e o background:

- confirma `sender.id`;
- exige frame principal e `sender.tab`;
- compara a origem da URL analisada com a origem do remetente;
- limita tamanho da mensagem;
- trunca strings/arrays novamente;
- rejeita tipos e padrões desconhecidos.

Comandos privilegiados são aceitos apenas de páginas cuja origem coincide com
`runtime.getURL('')`. A liberação temporária só é aceita da página de bloqueio
e para a mesma URL presente nela.

## Proteções implementadas

- CSP de páginas da extensão sem `unsafe-inline`, código remoto ou objetos;
- renderização somente com `textContent`/DOM seguro;
- URLs permitidas restritas a HTTP(S);
- regex com limite de tamanho e rejeição de backreferences, lookarounds e
  quantificadores aninhados;
- hashes somente SHA-256 hexadecimal;
- duração temporária entre 1 e 30 minutos;
- listas de filtro limitadas a 4 MiB, backups a 6 MiB e regras pessoais a
  5.000 entradas por lista;
- parser de filtros restrito a regras DNR declarativas, sem scriptlets,
  redirects, alteração de headers ou execução de conteúdo;
- atualizações de DNR e storage com rollback em caso de falha;
- allow rules de whitelist com prioridade 100;
- deduplicação de bloqueios e estatísticas;
- sem `eval`, `new Function`, `innerHTML` ou código remoto;
- leitura de tradução restrita ao próprio pacote: o único `fetch` da extensão
  recebe sempre `runtime.getURL('_locales/…')`, nunca uma URL de origem externa
  nem um valor derivado de conteúdo de página;
- sem `declarativeNetRequestFeedback`, API exclusiva de debug.

## Dados não coletados

- valores de inputs;
- valores de cookies;
- valores de localStorage/sessionStorage;
- conteúdo de IndexedDB;
- histórico completo;
- corpos de requests/responses;
- identificadores enviados a serviços externos.

O conteúdo transitório analisado permanece entre content script e background
local e não é persistido.

## Publicação

O build não inclui `META-INF`. Depois de qualquer alteração, gere `dist/`,
revise o pacote e assine novamente pelas lojas oficiais. Nunca reutilize uma
assinatura cujo manifest de hashes corresponda a uma versão anterior.
