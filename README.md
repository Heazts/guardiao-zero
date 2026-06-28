# Guardião Zero Pro

### Proteção avançada contra conteúdo de apostas, jogos de azar e rastreamento.

Extensão de navegador (Manifest V3) com detecção heurística inteligente, bloqueio de anúncios, anti-rastreamento e múltiplas camadas de segurança — tudo processado localmente, sem coleta de dados.

![Versão](https://img.shields.io/badge/v2.1.0-blue?style=flat-square)
![Manifest](https://img.shields.io/badge/Manifest_V3-green?style=flat-square)
![Firefox](https://img.shields.io/badge/Firefox-140%2B-orange?style=flat-square)
![License](https://img.shields.io/badge/Licença-MIT-brightgreen?style=flat-square)
![Zero Data](https://img.shields.io/badge/Dados-Zero%20Coleta-red?style=flat-square)

---

## Funcionalidades

| Recurso | Descrição |
|---------|-----------|
| **Detecção Heurística** | Analisa URLs e conteúdo de páginas usando +100 keywords categorizadas |
| **Bloqueio de Busca** | Intercepta consultas em motores de busca (Google, Bing, DuckDuckGo, etc) |
| **Remoção de Anúncios** | Oculta anúncios de apostas via seletores CSS e regras DNR |
| **Anti-Rastreamento** | Bloqueia trackers, pixels de conversão e fingerprinting |
| **Proteção por Senha** | Hash PBKDF2 (100k iterações), rate limiting e lockout temporário |
| **Confirmação Consciente** | Aviso detalhado com riscos antes de ações críticas |
| **Controle de JS** | Gerenciamento de execução de JavaScript por site |
| **Backup e Diagnóstico** | Ferramentas de integridade, exportação e importação de configurações |
| **Modo Foco** | Bloqueio mais rigoroso com menos falsos positivos |
| **Modo Estrito** | Bloqueio agressivo para proteção máxima |
| **Lista Branca/Negra** | Controle manual de sites permitidos e bloqueados |
| **Filtros Personalizados** | Regras de bloqueio customizadas com padrões de texto |

---

## Stack Técnica

| Camada | Tecnologia |
|--------|-----------|
| **Plataforma** | Manifest V3 (Firefox / Chrome / Edge / Brave) |
| **Background** | Service Worker (`declarativeNetRequest`) |
| **Content Script** | Vanilla JS puro (sem bundler, sem dependências externas) |
| **Criptografia** | Web Crypto API — PBKDF2 + salt (100.000 iterações) |
| **Armazenamento** | `chrome.storage.local` |
| **Estilos** | CSS puro com Design System compartilhado |
| **Idioma** | Português Brasileiro (`pt_BR`) |

---

## Instalação

### Firefox (Desenvolvimento)

```bash
git clone https://github.com/Heazts/guardiao-zero.git
cd guardiao-zero
```

1. Abra `about:debugging#/runtime/this-firefox` no Firefox
2. Clique em **"Carregar componente temporário"**
3. Selecione o arquivo `manifest.json` dentro da pasta do projeto

### Chrome / Edge / Brave (Desenvolvimento)

1. Acesse `chrome://extensions`
2. Ative o **Modo do desenvolvedor**
3. Clique em **"Carregar sem compactação"** e selecione a pasta do projeto

&gt; **Nota:** A extensão é otimizada para Firefox mas funciona em navegadores baseados em Chromium via Manifest V3.

---

## Estrutura do Projeto

```
guardiao-zero-pro/
├── manifest.json                    # Manifest V3 — configuração da extensão
├── README.md
├── _locales/
│   └── pt_BR/
│       └── messages.json            # Strings em Português BR
├── assets/
│   └── icons/                       # Ícones 16/32/48/128px
└── src/
    ├── background/
    │   ├── service-worker.js        # Service Worker principal
    │   └── rules.json               # Regras declarativeNetRequest (bloqueio)
    ├── content/
    │   ├── content-script.js        # Injetado em todas as páginas
    │   └── content-styles.css       # Estilos de ocultação de elementos
    ├── popup/                       # Interface rápida do popup
    │   ├── popup.html
    │   ├── popup.js
    │   └── popup.css
    ├── options/                     # Página de configurações (7 abas)
    │   ├── options.html
    │   ├── options.js
    │   └── options.css
    ├── blocked/                     # Página exibida ao bloquear um site
    │   ├── blocked.html
    │   ├── blocked.js
    │   └── blocked.css
    ├── help/                        # Central de ajuda
    │   ├── help.html
    │   ├── help.js
    │   └── help.css
    ├── diagnostics/                 # Verificação de integridade
    │   ├── diagnostics.html
    │   ├── diagnostics.js
    │   └── diagnostics.css
    └── shared/
        └── shared-styles.css        # Design system e estilos compartilhados
```

---

## Segurança e Privacidade

- **Zero Telemetria**: Toda análise é local. Nenhum dado é enviado para servidores externos.
- **PBKDF2 + Salt**: Senhas armazenadas com hash criptográfico (100.000 iterações). Nunca em texto plano.
- **Constant-Time Comparison**: Proteção contra *timing attacks* na verificação de senha.
- **Rate Limiting**: Bloqueio após 5 tentativas incorretas (5 minutos de lockout).
- **DNR (declarativeNetRequest)**: Uso de APIs nativas de bloqueio para máxima performance e privacidade.
- **Sem Dependências Externas**: Código 100% vanilla JS, sem riscos de *supply chain*.
- **CSP Compatível**: Utiliza `trustedTypes` / `createPolicy` do Firefox para segurança de injeção.

---

## Configurações Disponíveis

A página de configurações (`options.html`) possui **7 abas**:

| Aba | Descrição |
|-----|-----------|
| **Geral** | Toggles de proteção, sensibilidade (Baixa/Média/Alta), interface |
| **Segurança** | Proteção por senha, ações protegidas, confirmação consciente |
| **Privacidade** | Bloqueio de fingerprinting, referrer, Do Not Track, controle de JS |
| **Listas** | Lista branca e lista negra de sites |
| **Filtros** | Filtros personalizados e importação de listas |
| **Backup** | Exportação/importação de configurações, backups automáticos |
| **Avançado** | Estatísticas detalhadas, diagnóstico, modo de depuração |

---

## Roadmap

- [x] Regras `declarativeNetRequest` (DNR) implementadas
- [x] Correção de bugs de navegação e performance
- [x] Refinamento da proteção por senha (PBKDF2 + rate limiting)
- [x] Content script com gerenciamento de memória e DOM Observer
- [x] Tratamento de erros robusto (try/catch em toda comunicação assíncrona)
- [x] Dead code removido e caminhos relativos corrigidos
- [ ] Suporte multilíngue (i18n completo)
- [ ] Modo claro
- [ ] Sincronização de configurações entre dispositivos
- [ ] Testes automatizados
- [ ] Publicação na Firefox Add-ons (AMO)

---

## Contribuindo

1. Fork o repositório
2. Crie uma branch para sua feature (`git checkout -b feature/nova-feature`)
3. Commit suas alterações (`git commit -m 'Adiciona nova feature'`)
4. Push para a branch (`git push origin feature/nova-feature`)
5. Abra um Pull Request

---

## Licença

MIT License — veja o arquivo [LICENSE](LICENSE) para detalhes.

---

## Contato

- **GitHub**: [github.com/Heazts/guardiao-zero](https://github.com/Heazts/guardiao-zero)
- **Issues**: [github.com/Heazts/guardiao-zero/issues](https://github.com/Heazts/guardiao-zero/issues)

---

Feito com dedicação para proteger quem mais precisa.
