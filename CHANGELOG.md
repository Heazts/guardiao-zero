# Changelog

## 3.1.0

- cria a identidade Limiar Zero, com monograma `0|`, marca vetorial, família de
  ícones e regras de uso documentadas;
- combina Newsreader local para voz editorial, Inter para controles e
  numeração monoespaçada para estados e metadados;
- reformula popup, opções, bloqueio, ajuda, diagnóstico, privacidade e overlay
  de conteúdo como registros operacionais, sem escudos, mosaicos de cards ou
  iconografia decorativa genérica;
- adiciona página e política de privacidade;
- adiciona tema claro/escuro/sistema, accent color, alto contraste, densidade
  e redução de movimento em `storage.local`;
- corrige foco, contraste, tooltips, rótulos, hash navigation, responsividade e
  feedback assíncrono;
- importa e gerencia filtros EasyList/EasyPrivacy/AdGuard/uBlock/HOSTS;
- adiciona allow rules DNR prioritárias e rollback de rede/persistência;
- corrige a semântica de hostname exato ao preservar `www`;
- evita varredura DOM quando apenas anúncios/rastreadores estão ativos;
- separa builds Firefox e Chromium;
- adiciona licença MIT, OFL, avisos de terceiros e checklist AMO;
- adiciona corpus real reproduzível, resultados com hashes e gráficos
  derivados;
- publica no README um benchmark em SVG com fundo branco, gerado diretamente
  das métricas locais e acompanhado dos dados JSON completos;
- valida o pacote Firefox com `web-ext` 10 sem erros, notices ou warnings.

## 3.0.0

- substitui decisão por palavra única por classificação multifator;
- adiciona score configurável e safeguard informativo;
- implementa whitelist/blocklist tipadas;
- reduz memória da blocklist com busca binária;
- valida mensagens e origens;
- limita coleta DOM e MutationObserver;
- separa rulesets de anúncios/rastreadores;
- unifica compatibilidade Firefox/Chromium MV3;
- remove código morto, artefatos de assinatura e cache acidental;
- adiciona build, validação, benchmark e testes sem dependências npm.
