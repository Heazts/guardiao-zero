# Preparação e Submissão ao Firefox Add-ons (AMO)

Documento de release para o Guardião Zero Pro. Ele não substitui a validação
do pacote pelo AMO nem as políticas vigentes da Mozilla.

## Bloqueador anterior à submissão

Não publique o pacote enquanto a origem e a licença de
`src/filters/heazts-blocklist.txt` não forem confirmadas. Consulte
`THIRD_PARTY_NOTICES.md`. Se os direitos de redistribuição não puderem ser
demonstrados, remova ou substitua a lista antes de gerar o release.

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

- Node.js 22 ou mais recente para usar `web-ext` 10;
- npm;
- nenhuma dependência de runtime;
- fonte não minificada e não ofuscada.

O build do projeto aceita Node.js 20 ou mais recente, mas o fluxo de release
adota Node.js 22+ por ser o requisito da linha atual do `web-ext`.

## Validação e build

Execute na raiz:

```text
npm run lint
npm test
npm run build:firefox
npx --yes web-ext@10 lint --source-dir dist --warnings-as-errors
npx --yes web-ext@10 build --source-dir dist --artifacts-dir web-ext-artifacts --overwrite-dest
```

O ZIP deve conter `manifest.json` e os demais arquivos da extensão na raiz do
arquivo compactado; não compacte a pasta `dist` como um diretório superior.

`npm run benchmark` é um benchmark de regressão local. Resultados de corpus
sintético não devem ser apresentados como teste real nem usados para prometer
precisão de campo.

## Testes manuais obrigatórios

1. Carregar `dist/` temporariamente em uma versão suportada do Firefox.
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
- `assets/`, `src/`, `tests/` e `tools/`;
- instruções deste documento;
- qualquer aviso e licença de terceiro aplicável.

Exclua `.git/`, `dist/`, `web-ext-artifacts/`, caches e credenciais. Como não
há dependências npm, não é necessário criar um lockfile vazio.

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

- [ ] Proveniência e licença da blocklist confirmadas ou lista substituída.
- [ ] `LICENSE`, `PRIVACY.md` e avisos de terceiros revisados.
- [ ] Versão consistente em manifesto e pacote.
- [ ] ID Gecko confirmado como único ou igual ao da listagem existente.
- [ ] Homepage e URL da política publicadas e acessíveis.
- [ ] Testes automatizados e manuais aprovados.
- [ ] Testes reais documentados sem dados fictícios.
- [ ] `web-ext lint --warnings-as-errors` aprovado.
- [ ] ZIP final inspecionado e sem arquivos de desenvolvimento.
- [ ] Capturas, categoria, licença, suporte e política preenchidos no AMO.
- [ ] Nenhuma chave do GitHub ou credencial AMO incluída no repositório.

## Evidência desta versão

O pacote 3.1.0 foi validado com `web-ext@10 lint --warnings-as-errors` em 29 de
julho de 2026:

- erros: 0;
- notices: 0;
- warnings: 0.

Artefato local: `web-ext-artifacts/guardi_o_zero_pro-3.1.0.zip`.
