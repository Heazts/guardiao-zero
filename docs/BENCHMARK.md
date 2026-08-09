# Metodologia de benchmark

## O que é medido aqui

`npm run bench:engine` mede os caminhos que executam por navegação, por
requisição ou por importação de lista — tudo dentro do processo Node, sem
navegador:

- **matcher de subdomínio**: custo por consulta em listas de 10 a 5.000 entradas;
- **política de apostas**: consulta das raízes mantidas e do sufixo `.bet.br`;
- **parser de filtros**: regras por segundo e MiB por segundo.

`npm run benchmark` mede o classificador de apostas contra o corpus
determinístico versionado.

### Como as medições são feitas

- 3 execuções de aquecimento antes de qualquer amostra;
- 9 repetições, com a **ordem das variantes alternada** entre repetições para
  diluir efeito de aquecimento e de ordem;
- **mediana** como estatística principal; mínimo e máximo sempre reportados;
- um acumulador de resultado impede o motor de eliminar o trabalho medido;
- comparações antes/depois verificam **equivalência de saída** antes de
  comparar tempo. Uma otimização que muda o resultado não é uma otimização.

Resultados completos em `docs/reports/engine-benchmark.json`.

## O que NÃO é medido aqui

Estas métricas exigem navegador real com a extensão carregada e **não são
estimadas** em lugar nenhum deste repositório:

| Métrica | Por que não é medida |
| --- | --- |
| requisições totais / bloqueadas | precisa de CDP ou `webRequest` numa sessão real |
| anúncios que escaparam | precisa de inspeção de página real |
| transferência de dados | idem |
| tempo de carregamento | idem |
| CPU e RAM do processo | idem |
| manipulações de DOM | idem |
| comparação direta com uBlock Origin / AdGuard | exige as três extensões carregadas na mesma sessão controlada |

Qualquer número dessas categorias que apareça num relatório sem uma execução
real por trás deve ser tratado como inválido.

### Como medir o que falta

O projeto possui `npm run smoke:firefox`, que prova em Firefox headless que o
pacote pode ser instalado temporariamente e recarregado. Ele ainda não mede
requisições, tempo ou memória da página. Um harness completo precisaria:

1. subir Chromium com `--load-extension=dist/chromium`;
2. registrar `Network.requestWillBeSent` e `Network.loadingFailed` via CDP;
3. carregar cada página do corpus três vezes, descartando a primeira;
4. exportar mediana, mínimo e máximo por página e por métrica;
5. repetir com a extensão desligada e com cada bloqueador de referência.

Sem os passos 3 e 4, o ruído entre execuções supera a diferença medida.

## Limites de plataforma que restringem o desenho

Documentados aqui para que nenhuma promessa seja feita além deles:

- **contagem de requisições bloqueadas é indisponível.** Observar
  correspondência de regra de `declarativeNetRequest` exige a permissão
  `declarativeNetRequestFeedback`, que o Chrome só honra em extensão
  descompactada. `tools/validate.mjs` proíbe a API no `src/` justamente para
  manter essa fronteira. Por isso os contadores de anúncio e rastreador medem
  o que **escapou**, não o que foi bloqueado;
- **regras dinâmicas**: o projeto se limita a 4.900 para preservar a quota
  portátil, abaixo do teto de plataforma;
- **regex em regras**: `regexFilter` não é usado. O parser recusa regex
  arbitrária vinda de listas importadas, por custo e por superfície de ataque;
- **service worker**: no Chromium ele é encerrado por ociosidade. Nenhum estado
  em memória pode ser tratado como persistente.
