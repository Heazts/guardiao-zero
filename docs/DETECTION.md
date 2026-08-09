# Especificação do Detector

## Princípios

- whitelist tem prioridade absoluta;
- nenhuma categoria automática alcança sozinha o limiar mínimo de 100;
- ocorrências repetidas são limitadas por grupo;
- termos curtos são comparados como tokens, não substrings;
- contexto jornalístico/informativo reduz o score e ativa um gate adicional;
- regras são determinísticas, explicáveis e executadas localmente.

## Grupos e tetos

| Grupo | Teto | Exemplos |
|---|---:|---|
| domínio | 95 | política verificada, token delimitado, TLD |
| URL | 45 | `/sportsbook`, `/live-casino`, `/betslip` |
| metadados | 60 | título, description, Open Graph, favicon |
| conteúdo | 75 | frases contextuais, cluster de jogos/links |
| transação | 80 | botão de aposta, betslip, formulário financeiro |
| integração | 90 | provedor, API de odds/apostas, WebSocket |
| storage | 30 | nomes específicos de IndexedDB/storage; nunca valores |
| rede | 15 | pixels e cluster de tracking (somente suporte) |
| informativo | -80 | schema de artigo, reportagem/regulação/saúde |

## Pesos principais

- domínio presente na política empacotada: +90;
- padrão inequívoco de domínio: +30 a +35;
- rota inequívoca de plataforma: +30;
- cassino ao vivo em metadados: +45;
- cassino/sportsbook no conteúdo: +30 a +35;
- botão “aposte agora/place bet”: +50;
- formulário com `stake + odds + potential return`: +55;
- provedor de jogos conhecido: +65;
- API específica de sportsbook/odds: +70;
- gateway de pagamento genérico: +10;
- schema `NewsArticle/Article/BlogPosting`: -45;
- contexto informativo forte: até -45 adicional.

## Gates

Para bloquear automaticamente:

```text
score >= threshold
AND strongGroups >= 2
AND (operationalEvidence OR knownDomainConfirmed OR strongGroups >= 3)
AND (NOT informationalContext OR operationalEvidence)
```

`operationalEvidence` significa transação >= 25 ou integração >= 50.
`knownDomainConfirmed` exige match da política local mais metadados, conteúdo
ou evidência operacional. Antes da coleta DOM, domínios verificados e o sufixo
`.bet.br` também são bloqueados de forma síncrona por DNR `main_frame`, salvo
pausa, whitelist ou liberação temporária.

## Diferenciação de contexto

`alphabet`, `beta`, `betterstack`, `betaflight` e `betelgeuse` não combinam com
o token isolado `bet`. Uma notícia sobre apostas recebe sinais negativos por
schema e vocabulário editorial. Frases de jogo responsável são apenas suporte
fraco (+5), porque também aparecem em plataformas reais.

## Coleta e performance

- texto visível: até 14.000 caracteres e 2.500 text nodes;
- listas DOM têm limites fixos;
- JSON-LD: somente `@type`, nunca o objeto completo;
- IndexedDB/service workers: timeout de 250 ms;
- recursos: no máximo 160 entradas;
- URLs auxiliares perdem credenciais, query e fragmento antes da mensagem;
- somente formulários, integrações e nomes de storage relevantes seguem ao
  background; cookies e valores de storage não são lidos;
- observer: 20 segundos, debounce de 2,5 s e no máximo duas reanálises;
- análise apenas no frame principal;
- nenhuma varredura DOM quando a camada de apostas está desativada;
- cache LRU simples limitado a 128 resultados.

A política atual contém 28 raízes de apostas mantidas pelo projeto e o sufixo
`.bet.br`. Ela é carregada como código local pequeno, sem I/O, download ou
materialização de centenas de milhares de strings. A lista legada sem licença
não participa do build.
