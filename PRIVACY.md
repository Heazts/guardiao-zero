# Política de Privacidade — Guardião Zero Pro

**Última atualização:** 9 de agosto de 2026

## Resumo

O Guardião Zero Pro não envia, vende nem compartilha dados do usuário com o
desenvolvedor, servidores próprios ou terceiros. A detecção e o bloqueio são
executados localmente no navegador, sem coleta externa.

Não há telemetria, analytics, publicidade injetada, identificação de usuário
ou criação de perfil remoto.

## Processamento transitório

Para identificar plataformas de apostas, a extensão pode analisar localmente
sinais da página aberta, como URL e domínio, título, metadados, texto visível,
rótulos e nomes estruturais de formulários, botões, menus, links e indicadores
técnicos relevantes para a classificação. Essa análise também pode ocorrer em
páginas autenticadas quando a proteção de apostas estiver ativa.

A URL da página atual é necessária para aplicar as listas e a política de
bloqueio. Em URLs auxiliares de imagens, scripts, frames, links e recursos de
rede, a extensão remove credenciais, parâmetros de consulta e fragmentos antes
de encaminhar o sinal ao processo de background. A lista genérica de recursos
de rede sem relevância para o detector é usada, quando necessário, apenas no
content script para formar contadores agregados de anúncios e rastreadores
observados.

Esses sinais transitam somente entre o content script e o processo de
background da própria extensão, dentro do navegador. Eles são usados para a
decisão atual e não são gravados como histórico de navegação.

A extensão não lê nem armazena valores digitados em campos, senhas, dados de
pagamento, conteúdo de bancos IndexedDB, cookies ou valores de `localStorage` e
`sessionStorage`. Para sinais técnicos, ela pode ler localmente nomes de chaves
de storage e nomes de bancos IndexedDB, mas somente nomes que correspondam a
padrões de apostas são incluídos na análise interna. Valores nunca são lidos.

## Dados mantidos localmente

O Guardião Zero Pro utiliza `storage.local` exclusivamente para manter dados
necessários ao funcionamento e às preferências escolhidas pelo usuário:

- configurações de proteção e aparência;
- contadores agregados de bloqueios;
- listas locais de permissão, bloqueio e filtros importados;
- liberações temporárias e informações locais necessárias para expirá-las;
- versão do esquema usada para migrar configurações.

Esses dados permanecem no perfil local do navegador. Eles não são
sincronizados pela extensão nem enviados ao desenvolvedor ou a terceiros.

O navegador pode conservar esses dados enquanto a extensão estiver instalada,
de acordo com o comportamento de `storage.local`. O usuário pode redefinir
dados pela interface da extensão e removê-los integralmente ao desinstalá-la,
ressalvadas cópias de segurança que o próprio usuário tenha exportado.

## Bloqueio de rede

As regras de anúncios, rastreadores e redirecionamentos são aplicadas pelo
mecanismo local `declarativeNetRequest` do navegador. O Guardião Zero Pro não
recebe cópias das requisições bloqueadas e não envia registros delas para
qualquer serviço externo.

O acesso normal do navegador aos sites visitados não é uma transmissão feita
ao desenvolvedor da extensão.

## Listas importadas

Listas escolhidas e importadas pelo usuário são analisadas e armazenadas
localmente. Seu conteúdo não é enviado pelo Guardião Zero Pro para o
desenvolvedor ou para terceiros.

O usuário é responsável por avaliar a procedência e os termos de uso de listas
personalizadas que decidir importar.

## Permissões do navegador

A extensão solicita somente permissões relacionadas às suas funções:

- `storage`: armazenar as preferências, os contadores e as listas locais;
- `declarativeNetRequest`: bloquear recursos por regras locais;
- `webNavigation`: aplicar políticas locais de navegação antes do carregamento;
- acesso a páginas HTTP(S): coletar, no dispositivo, os sinais necessários à
  classificação e ao bloqueio.

Essas permissões não autorizam nem implicam transmissão de dados ao
desenvolvedor.

## Crianças e dados sensíveis

Como nenhum dado é transmitido ou coletado pelo desenvolvedor, a extensão não
mantém cadastro de usuários nem base remota contendo dados pessoais, inclusive
de crianças ou adolescentes.

## Alterações desta política

Qualquer mudança material nas práticas de dados será descrita nesta política,
no changelog e, quando exigido, no manifesto ou na página da extensão no
Firefox Add-ons. Uma versão futura não declarará ausência de coleta se passar
a transmitir dados.

## Contato

Dúvidas sobre privacidade podem ser encaminhadas pelo canal de suporte
informado na página oficial da extensão no Firefox Add-ons ou pelo repositório
oficial do Guardião Zero Pro no GitHub.
