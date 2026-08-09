<!--
Este texto some quando você escreve por cima. Se um item não se aplica, apague a
linha em vez de deixá-la vazia — checklist meio preenchido não informa nada.
-->

## O que muda e por quê

<!-- O problema antes do conserto. Quem lê o histórico daqui a seis meses
precisa entender a motivação sem abrir o código. -->

## Como foi verificado

<!-- O que você rodou ou olhou, e o resultado. "Testado" não é verificação;
"popup medido em 541 px no Firefox, sem barra de rolagem" é. -->

## Portões

- [ ] `npm run lint` — inclui deriva de rulesets, ativos de marca e catálogos de idioma
- [ ] `npm test`
- [ ] `npm run build:firefox` e `npm run build:chromium`
- [ ] `npm run package:amo`, se o pacote publicado muda

## Arquivos gerados

Rulesets, ícones, gráfico e capturas são **gerados**, nunca editados à mão. Se o
PR mexe na origem de algum deles, regenere e inclua a saída no mesmo commit:

- [ ] `npm run build:rules` — seed lists em `src/filters/sources/`
- [ ] `npm run build:icons` — geometria em `tools/make-icons.mjs`
- [ ] `npm run build:chart` — relatórios de benchmark
- [ ] `npm run build:shots` — capturas da listagem, se a interface mudou

## Se muda algo que o usuário vê ou que a loja lê

- [ ] `CHANGELOG.md` atualizado
- [ ] chaves novas presentes nos **doze** idiomas em `_locales/`
- [ ] `docs/AMO_SUBMISSION.md` continua descrevendo o código de verdade —
      em especial permissões, tratamento de dados e comportamento de rede
- [ ] `PRIVACY.md` e `src/privacy/privacy.html` continuam exatos

## Riscos

<!-- O que pode quebrar, e o que você decidiu não fazer. Um PR que declara
"nenhum risco" quase sempre é um PR que não procurou. -->
