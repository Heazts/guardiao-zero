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

## Lista de domínios `heazts-blocklist.txt`

O arquivo `src/filters/heazts-blocklist.txt` foi fornecido como parte do
projeto, mas sua origem, autoria, data de obtenção e licença não estavam
documentadas na árvore recebida.

Por esse motivo:

- este arquivo não deve ser presumido como coberto pela licença MIT do código;
- sua redistribuição pública não deve ocorrer até que os direitos aplicáveis
  sejam confirmados;
- antes da publicação, devem ser registrados a fonte original, o titular, a
  licença, a versão ou data da lista, as alterações realizadas e as
  atribuições exigidas;
- se não for possível confirmar permissão compatível com redistribuição, o
  arquivo deve ser removido ou substituído por uma fonte com licença clara.

**Estado de publicação:** pendente de confirmação. Este é um bloqueador para
distribuir o pacote atual ou licenciar todo o repositório de forma
indiscriminada sob MIT.

## Escopo da licença MIT

A licença MIT no arquivo `LICENSE` aplica-se ao código e à documentação
originais dos colaboradores do Guardião Zero, exceto onde outro aviso,
licença ou direito de terceiro prevalecer.
