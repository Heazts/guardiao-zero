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

O símbolo não deve ser substituído por texto, emoji ou glifo tipográfico.

## Origem única dos arquivos

A geometria do símbolo existe uma única vez, em `tools/make-icons.mjs`. Tanto os
SVG quanto os PNG são emitidos a partir dela por `npm run build:icons`; nenhum
arquivo de marca deve ser editado à mão. `npm run lint` recalcula os dois e falha
se algum divergir, de modo que o ícone da barra não pode deixar de ser o mesmo
símbolo do cabeçalho sem que a validação acuse.

| Arquivo | Uso |
| --- | --- |
| `assets/brand/limiar-orbital.svg` | selo vetorial das telas da extensão |
| `assets/icons/icon-{16,32,48,128}.png` | `icons` e `action.default_icon` |
| `assets/icons/icon-{light,dark}-{16,32,48}.png` | `action.theme_icons` |
| `docs/assets/brand/limiar-orbital-amo.svg` | vetor de 128 px para AMO e imprensa |
| `docs/assets/brand/limiar-orbital-glyph.svg` | glifo sem selo, em `currentColor` |
| `docs/assets/brand/limiar-orbital-{128,512}.png` | raster para lojas e imprensa |

Duas molduras derivam do mesmo desenho. O **selo** (fundo de tinta) dá ao símbolo
62 % do quadrado: com mais que isso o contraforma do `C` fecha em 16 px e o ícone
vira uma mancha. O **glifo** (sem fundo, usado nas `theme_icons`) pode ocupar 81 %,
porque não tem moldura competindo por espaço. Só a moldura muda — as curvas, o
traço e as proporções internas são os mesmos.

O kit de loja fica em `docs/`, e não em `assets/`, para não entrar no pacote
enviado à AMO: o `.zip` só deve conter o que a extensão realmente carrega.

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
