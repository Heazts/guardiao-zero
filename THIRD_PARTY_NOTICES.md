# Avisos de Terceiros

Este documento registra componentes, referências e dados que podem estar
sujeitos a termos diferentes da licença MIT aplicada ao código do Guardião
Zero Pro.

## Inter

Os estilos da extensão utilizam uma cópia local de **Inter Variable**,
distribuída sob a **SIL Open Font License, Version 1.1 (OFL-1.1)**. A fonte
não é carregada de CDN nem produz qualquer requisição de rede.

- Projeto: <https://github.com/rsms/inter>
- Licença: <https://openfontlicense.org/open-font-license-official-text/>
- Copyright: Copyright 2016 The Inter Project Authors

Arquivos redistribuídos:

- `assets/fonts/InterVariable.woff2`;
- `assets/fonts/OFL.txt`, com o texto integral da OFL-1.1.

A pilha de fontes do sistema permanece como fallback caso o navegador não
consiga carregar o WOFF2 empacotado.

## Newsreader

Títulos editoriais e mensagens de alto impacto utilizam uma cópia local de
**Newsreader Variable**, projetada pela Production Type para leitura contínua
em telas e distribuída sob a **SIL Open Font License, Version 1.1
(OFL-1.1)**. A fonte não é carregada de CDN.

- Projeto: <https://github.com/productiontype/Newsreader>
- Licença: <https://openfontlicense.org/open-font-license-official-text/>
- Copyright: Copyright 2020 The Newsreader Project Authors

Arquivos redistribuídos:

- `assets/fonts/NewsreaderVariable.woff2`;
- `assets/fonts/NEWSREADER-OFL.txt`, com o texto integral da OFL-1.1.

## Política de domínios de apostas do projeto

O arquivo `src/background/verified-betting-domains.js` é uma obra original,
mantida manualmente pelos contribuidores do Guardião Zero Pro e distribuída
sob a licença MIT do projeto. Ele contém uma lista pequena de raízes
inequivocamente associadas a serviços de apostas e a regra de sufixo `.bet.br`.

A regra de sufixo foi verificada na página pública da Secretaria de Prêmios e
Apostas, que informa que sites com autorização federal usam `.bet.br`:

<https://www.gov.br/fazenda/pt-br/composicao/orgaos/secretaria-de-premios-e-apostas/apostas-de-quota-fixa>

Nenhuma planilha, lista ou compilação do Ministério da Fazenda foi copiada ou
adaptada. O link é uma fonte de verificação da política de sufixo, não a fonte
de uma base redistribuída.

## Lista legada `heazts-blocklist.txt`

O arquivo `src/filters/heazts-blocklist.txt` havia sido fornecido como parte do
projeto, mas sua origem, autoria, data de obtenção e licença não estavam
documentadas. Desde a 3.1.2 ele ficou fora da validação, dos testes, do build e
do empacotamento; na 3.1.3 foi removido também do repositório. As travas em
`tools/build.mjs` e `tools/package-amo.mjs` continuam no lugar para impedir que
o caminho seja reintroduzido num artefato público.

Como defesa contra reintrodução acidental, `tools/build.mjs` continua excluindo
esse caminho e `tools/package-amo.mjs` recusa o release caso o arquivo apareça
no artefato. Uma cópia só poderá voltar ao projeto depois de documentar fonte,
titular, licença, versão, alterações e atribuições exigidas.

**Estado de publicação:** o bloqueador foi removido do artefato binário porque
o arquivo não é mais redistribuído. Ele ainda não pode integrar um arquivo de
código-fonte público nem ser licenciado sob MIT enquanto sua origem não for
comprovada. Use sempre `npm run package:amo`; não compacte a árvore de trabalho.

## Escopo da licença MIT

A licença MIT no arquivo `LICENSE` aplica-se ao código e à documentação
originais dos colaboradores do Guardião Zero, exceto onde outro aviso,
licença ou direito de terceiro prevalecer.
