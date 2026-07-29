# Sistema de identidade — Limiar Zero

## Ideia central

O Guardião Zero existe para impedir que um conteúdo atravesse um limite
definido pelo usuário. A identidade traduz esse comportamento no símbolo
**Limiar Orbital**:

- a órbita aberta representa a meta de exposição e telemetria zero;
- a abertura e o braço central sugerem o `G` de Guardião sem desenhar uma letra
  convencional;
- o braço registra a interceptação da navegação;
- a haste vertical representa o limiar local que o conteúdo não atravessa;
- a forma é desenhada por geometria própria, permanece legível em 16 px e não
  depende de uma fonte;
- o símbolo substitui o escudo genérico, removido de todas as superfícies
  principais.

O arquivo vetorial canônico é `assets/brand/limiar-orbital.svg`. Os ícones raster
do manifesto são derivados da mesma geometria por `tools/make_icons.py`.
O símbolo não deve ser substituído por texto, emoji ou glifo tipográfico.

## Voz visual

A interface segue uma linguagem editorial operacional:

- títulos em Newsreader, com peso moderado e contraste de escala;
- controles, rótulos e corpo em Inter;
- números, estados e metadados em fonte monoespaçada;
- regras horizontais organizam conteúdo; cards são usados somente quando há
  uma fronteira funcional real;
- seções recebem índices (`01`, `02`, `03`) para formar um registro navegável;
- raios são pequenos e sombras são reservadas para elementos sobrepostos;
- cor de destaque é opcional; a identidade padrão funciona integralmente em
  preto, branco e cinzas quentes.

## Gramática de ícones

Ícones decorativos não são usados. Quando um símbolo funcional é necessário:

- traço de 1,5–1,75 px;
- terminais retos sempre que possível;
- caixa óptica de 16 ou 20 px;
- nenhum fundo colorido ou container circular;
- setas `←` e `↗` identificam navegação de forma textual e consistente.

O Limiar Orbital é a única exceção de marca à regra de ícones funcionais. Ele
deve preservar a órbita aberta, o braço central e a haste, sem efeitos 3D,
contorno extra ou preenchimento colorido.

## Movimento

Movimento comunica mudança de estado, não decoração:

- duração entre 120 e 180 ms;
- deslocamento máximo de 3 px;
- sem elasticidade, brilho, parallax ou animação contínua;
- `prefers-reduced-motion` e a preferência local removem as transições.

## Linguagem

Os textos devem ser diretos, verificáveis e locais:

- preferir “processamento local” a slogans abstratos;
- preferir “classificação multifator” a “IA”;
- explicar por que uma decisão ocorreu;
- não prometer precisão absoluta ou impacto de performance sem medição.

## Uso incorreto

Não reintroduzir:

- escudos genéricos;
- grades de cards iguais para conteúdos sem relação;
- gradientes decorativos;
- pills para qualquer rótulo;
- ícones diferentes para cada configuração;
- sombras em superfícies estáticas;
- cores de marca que não tenham função de estado ou preferência explícita.
