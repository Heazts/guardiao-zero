# Preparação e Submissão ao Firefox Add-ons (AMO)

Documento de release para o Guardião Zero Pro. Ele não substitui a validação
do pacote pelo AMO nem as políticas vigentes da Mozilla.

## Proveniência da política de apostas

O release usa somente `src/background/verified-betting-domains.js`, uma
política pequena, manual e licenciada sob MIT, mais o sufixo regulado `.bet.br`.
A lista legada `src/filters/heazts-blocklist.txt`, sem licença comprovada, foi
removida da árvore. O build também impede que esse caminho seja reintroduzido no
ZIP. Consulte `THIRD_PARTY_NOTICES.md`. Nunca envie um ZIP manual da raiz do
repositório.

## Metadados propostos

- **Nome:** Guardião Zero Pro
- **Versão:** usar exatamente a versão de `manifest.json`
- **ID Gecko:** `guardiao-zero-pro@guardiaozero.app`
- **Categoria principal:** Privacidade e Segurança
- **Licença do código:** MIT
- **Idioma principal:** Português do Brasil (`pt-BR`)
- **Homepage:** `https://github.com/Heazts/guardiao-zero`
- **Política de privacidade:**
  `https://github.com/Heazts/guardiao-zero/blob/main/PRIVACY.md`

### Resumo em português

Proteção local multifator contra plataformas de apostas, anúncios,
rastreadores e redirecionamentos, sem telemetria ou envio de dados.

### Summary in English

Local multi-factor protection against gambling platforms, ads, trackers, and
redirects, with no telemetry or data transmission.

### Descrição recomendada

O Guardião Zero Pro analisa localmente múltiplos sinais contextuais para
identificar plataformas de apostas e reduzir falsos positivos. Também utiliza
regras locais do navegador para bloquear anúncios, rastreadores e
redirecionamentos. Configurações, contadores e listas permanecem em
`storage.local`; sinais de página usados na classificação são transitórios.
Nenhum dado é enviado ao desenvolvedor ou a terceiros.

Não descreva o detector como machine learning ou inteligência artificial sem
uma implementação e evidências técnicas correspondentes. Prefira
“classificação multifator determinística” ou “detecção heurística
contextual”.

## Ativos da listagem

Tudo que a listagem publica é versionado e regenerável. Nada aqui é feito à mão.

### Capturas

As três capturas ficam em `docs/amo-listing/` e saem de `npm run build:shots`,
que abre as páginas reais de `src/` num Firefox headless, em tema escuro e
1280 × 800. Até a 3.1.2 elas eram manuais e moravam em `web-ext-artifacts/`, que
o git ignora — sumiam num clone novo e envelheciam sem aviso: as da 3.1.2 ainda
mostravam o ícone antigo e o indicador do item ativo invisível.

| Arquivo | Página |
| --- | --- |
| `01-configuracoes.png` | `src/options/options.html` |
| `02-privacidade-local.png` | `src/privacy/privacy.html` |
| `03-ajuda-e-transparencia.png` | `src/help/help.html` |

Regenere a cada mudança de interface e confira as imagens antes de enviar — o
comando não sabe se a captura ainda conta a história certa.

### Ícone

O ícone exibido na listagem vem do `icons` do manifesto; não é preciso enviar
imagem separada. Se o formulário do AMO pedir um arquivo, use:

- **vetor:** `docs/assets/brand/limiar-orbital-amo.svg` (128 px declarados);
- **raster:** `docs/assets/brand/limiar-orbital-128.png` ou `-512.png`, caso o
  campo recuse SVG.

Todos saem de `npm run build:icons`, do mesmo desenho dos ícones do manifesto.
Não recorte, recolora nem reexporte à mão: a validação compara os arquivos com a
geometria e falha se algum divergir.

`web-ext lint` (addons-linter 10.6.0) aceita SVG em `icons` e `action.default_icon`
sem erro, aviso ou notice — verificado nesta árvore. Ainda assim o manifesto
distribuído usa PNG, por dois motivos: o alvo Chromium não suporta ícone vetorial
no manifesto, e os tamanhos publicados (16–128 px) já cobrem as superfícies onde
Firefox e AMO desenham o ícone. Adotar SVG no manifesto seria uma mudança
deliberada, só para o alvo Firefox, e não um efeito colateral do build.

## Declaração de coleta de dados

No manifesto:

```json
{
  "browser_specific_settings": {
    "gecko": {
      "data_collection_permissions": {
        "required": ["none"]
      }
    }
  }
}
```

Essa declaração é válida somente enquanto nenhuma informação for transmitida
para fora da extensão ou do navegador local. A política completa está em
`PRIVACY.md`.

## Justificativas de permissões

### `storage`

Armazena localmente configurações, tema e aparência, contadores agregados,
listas de permissão/bloqueio/filtros e liberações temporárias. A extensão não
usa `storage.sync` nem transmite esse conteúdo.

### `declarativeNetRequest`

Permite que o próprio Firefox aplique rulesets locais para bloquear anúncios,
rastreadores, filtros e redirecionamentos antes que os recursos sejam
carregados. A extensão não recebe corpos das requisições.

### `webNavigation`

Permite aplicar, no frame principal, políticas locais explícitas — como
blocklist personalizada e modo extremo — no início de uma navegação.

### Hosts HTTP(S)

A função principal precisa operar nos sites visitados. O content script coleta
somente sinais públicos e limitados da página para a classificação local. Não
lê valores digitados, senhas, dados de pagamento, valores de cookies nem
valores de storage.

## Ambiente de build

- Node.js 22 ou mais recente;
- npm e o lockfile versionado;
- `web-ext` 10.6.0 fixado como dependência de desenvolvimento;
- nenhuma dependência de runtime;
- fonte não minificada e não ofuscada.

As dependências npm existem somente para validação e empacotamento e não entram
na extensão. Em 9 de agosto de 2026, `npm audit --omit=dev` reportou zero
vulnerabilidades de produção. O `addons-linter` usado pelo `web-ext` ainda
carrega alertas de negação de serviço em `image-size`; esse código roda apenas
no build sobre os assets locais e confiáveis do projeto, nunca no navegador.

## Validação e build

Execute na raiz:

```text
npm ci
npm run package:amo
```

O ZIP deve conter `manifest.json` e os demais arquivos da extensão na raiz do
arquivo compactado; não compacte a pasta `dist` como um diretório superior.
Não envie a raiz do repositório nem um ZIP criado manualmente: isso inclui
`.git/hooks` e usa arquivos que não pertencem ao artefato já validado.

O fluxo executa lint do projeto, todos os testes, builds Firefox e Chromium,
`web-ext lint --warnings-as-errors` e empacotamento. No final grava três
artefatos em `web-ext-artifacts/`:

- `guardiao-zero-pro-{version}-firefox.zip`;
- o checksum `.zip.sha256`;
- `guardiao-zero-pro-{version}-firefox.release.json`, com versões das
  ferramentas, commit, estado da árvore, tamanho e SHA-256.

O mesmo fluxo roda em `.github/workflows/ci.yml` com Node.js 22.

`npm run benchmark` é um benchmark de regressão local. Resultados de corpus
sintético não devem ser apresentados como teste real nem usados para prometer
precisão de campo.

## Testes manuais obrigatórios

1. Carregar `dist/firefox/` temporariamente em uma versão suportada do Firefox.
2. Abrir popup, opções, ajuda, diagnóstico e página de bloqueio.
3. Verificar temas claro, escuro e sistema, contraste e personalização.
4. Confirmar persistência local após reiniciar o navegador.
5. Testar whitelist, blocklist, importação e remoção de listas.
6. Confirmar os toggles independentes de apostas, anúncios e rastreadores.
7. Testar revogação e restauração da permissão para sites.
8. Inspecionar o console da extensão e das páginas: zero erros ou exceções não
   tratadas.
9. Executar casos reais rotulados de plataformas e páginas legítimas,
   registrando data, URL, resultado esperado e resultado observado.
10. Confirmar que a versão mínima publicada é Firefox 142, necessária para a
    declaração de coleta usada neste release.

## Pacote de fontes para revisão

Se o AMO solicitar fontes, forneça um arquivo separado que inclua:

- `manifest.json`, `package.json`, README, licença e documentação;
- `package-lock.json`;
- `assets/`, `src/`, `tests/` e `tools/`;
- licenças OFL completas das fontes Inter e Newsreader em `assets/fonts/`;
- instruções deste documento;
- qualquer aviso e licença de terceiro aplicável.

Exclua `.git/`, `dist/`, `web-ext-artifacts/`, `node_modules/`, caches e
credenciais. O revisor pode reconstruir o release com
`npm ci && npm run package:amo`.

A lista legada `src/filters/heazts-blocklist.txt` foi removida do repositório na
3.1.3. As travas continuam em `tools/build.mjs` e `tools/package-amo.mjs`, de
modo que o caminho não pode ser reintroduzido num artefato público sem falhar o
build.

## Notas sugeridas ao revisor

> Guardião Zero Pro é uma extensão Manifest V3 sem telemetria e sem
> comunicação com servidores do desenvolvedor. A análise de página ocorre
> localmente e de forma transitória. Configurações, contadores e listas são
> mantidos apenas em storage.local. A permissão para hosts HTTP(S) é necessária
> para a função principal de classificação contextual; valores de inputs,
> cookies e storages não são lidos. declarativeNetRequest aplica rulesets
> locais para anúncios, rastreadores e redirecionamentos. O código distribuído
> não é minificado nem ofuscado e pode ser reproduzido com os comandos
> documentados.

Antes de usar essas notas, confirme que elas continuam correspondendo
exatamente ao código do release.

## Checklist final

- [x] Lista sem licença substituída e excluída automaticamente do release.
- [x] `LICENSE`, `PRIVACY.md` e avisos de terceiros revisados.
- [x] Versão consistente em manifesto e pacote.
- [ ] ID Gecko confirmado como único ou igual ao da listagem existente.
- [ ] Homepage e URL da política publicadas e acessíveis.
- [x] Testes automatizados aprovados.
- [ ] Cenários manuais completos do checklist aprovados.
- [ ] Testes reais documentados sem dados fictícios.
- [x] `web-ext lint --warnings-as-errors` aprovado para a nova versão.
- [x] ZIP final inspecionado e sem arquivos de desenvolvimento.
- [ ] Capturas, categoria, licença, suporte e política preenchidos no AMO.
- [ ] Nenhuma chave do GitHub ou credencial AMO incluída no repositório.

## Evidência desta versão

Release `3.1.3`, gerado em 09.08.2026:

- artefato: `guardiao-zero-pro-3.1.3-firefox.zip`;
- tamanho: 675.878 bytes;
- SHA-256: `8468F80B433088B5230A565370EA57DF993EA34DA398A93D7BD91B86487F10EE`;
- commit: `97120c9d9c8b36c7d6649477dbfbc57c283e5beb`, com `sourceDirty: false`;
- suíte: 119 de 119 testes aprovados;
- `web-ext 10.6.0`: 0 erros, 0 avisos e 0 notices;
- smoke test: instalação temporária e recarga aprovadas no Firefox 153.0.3
  headless;
- inspeção independente: 68 entradas, raiz com apenas `manifest.json`, `assets/`
  e `src/`; manifesto `3.1.3`, sem `background.service_worker`, lista legada,
  `src/filters`, `.git`, `node_modules` ou `.env`.

O artefato é reproduzível a partir do commit acima com
`npm ci && npm run package:amo`. Esta seção é escrita depois do build, então o
commit que a contém é posterior ao commit empacotado — um documento não pode
conter o próprio hash.

O smoke test prova que o pacote instala e recarrega no Firefox. Ele não substitui
os cenários manuais de navegação e bloqueio listados acima.
