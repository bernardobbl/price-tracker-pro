# Auditoria de responsividade — 10/ago/2026

Teste automatizado do frontend em **10 viewports × 7 telas = 70 combinações**, com
Chromium real (emulação móvel: DPR, `isMobile`, touch, user-agent de iPhone), API e
sessão do Supabase simuladas. Cada combinação foi medida para: estouro horizontal,
conteúdo cortado, alvo de toque abaixo de 44px, texto abaixo de 11,5px e erro de JS.

Prints em `antes/` e `depois/` (mesmo nome de arquivo dos dois lados). Ficaram
versionados os seis celulares em retrato — que é onde o problema estava — mais o
desktop de 1440px como prova de não-regressão. Tablet, celular deitado e páginas
legais foram medidos igual e entram só na tabela abaixo; guardar as 140 imagens
custaria 14 MB de repositório para mostrar telas que não mudaram.

## Resultado

| medida | antes | depois |
|---|---|---|
| combinações com **estouro horizontal** | **14** | **0** |
| conteúdo cortado (só celulares) | 100 | 33 |
| alvo de toque < 44px (só celulares) | 261 | 55 |
| texto < 11,5px (só celulares) | 119 | 23 |
| erros de JS | 0 | 0 |

`133/133` testes do projeto passando, `tsc --noEmit` e `eslint` limpos, build ok.
O desktop (1440px) ficou **pixel a pixel idêntico** ao anterior — compare
`antes/deslogado__laptop_1440.jpg` com `depois/deslogado__laptop_1440.jpg`.

## O que estava quebrado

### 1. A página inteira estourava a largura no celular (crítico)

Só acontecia **com o usuário logado**, que é justamente o caso que não aparece
quando você abre o site para conferir deslogado.

Num Android de 360px o documento ficava com **544px** de largura. O navegador
responde a isso dando zoom-out na página inteira: tudo minúsculo, texto no limite
do ilegível e uma faixa morta à direita. Em todos os celulares testados:

```
logado @ android_small_360    544px de conteúdo numa tela de 360px
logado @ iphone_se_375        545px  →  375px
logado @ iphone5_320          544px  →  320px
conta  @ (idem em todos)
```

**Causa.** `.dashboard` é uma grade de uma coluna. Uma coluna de grade automática
tem largura **mínima** igual ao `min-content` do que está dentro dela — e dentro
dela estava o nome do posto, com `white-space: nowrap`. Texto `nowrap` não
encolhe, então o piso da coluna virava "Auto Posto Estrela Do Norte Comercio De
Combustiveis Ltda" inteiro. Deslogado o problema não aparecia porque favoritos e
alertas (com os rótulos mais longos) só existem depois do login.

**Correção.** `grid-template-columns: minmax(0, 1fr)` remove o piso, e
`min-width: 0` faz o mesmo nos elementos flex do caminho (`.sidebar`, `.panel`,
`.card`, `.product-card`, `.alert-item`). Mesma correção em `.ranking-row`,
`checkout.html` e `premium.html`.

### 2. O gráfico não encolhia

O canvas do Chart.js segurava 478px de largura sozinho. Chart.js só reduz o
desenho quando o contêiner reduz, e o contêiner herdava o piso da grade —
realimentação. `min-width: 0` no `.chart-container` mais `max-width: 100%` no
canvas.

### 3. iOS dava zoom ao tocar em qualquer campo

O Safari amplia a página inteira quando o dedo toca um campo com fonte menor que
16px, e não desfaz o zoom depois. Os selects e inputs estavam em 14,4px. Agora
são 16px até 768px de largura.

Vale registrar por que não se resolve pelo caminho óbvio: `maximum-scale=1` no
`viewport` também impede o zoom — e impede também o de quem precisa ampliar para
enxergar. A fonte de 16px resolve sem tirar isso de ninguém.

### 4. Ranking de postos ilegível no celular

"Auto Posto Estrela Do…" cortado na metade, endereço idem — some justamente a
informação que a pessoa foi buscar em "onde está mais barato". No celular a linha
agora quebra em duas colunas, o nome ganha até duas linhas e o preço vai para
baixo.

### 5. Outros

- Cabeçalho: "Price Tracker Pro" quebrava em três linhas ao lado do subtítulo →
  empilhado abaixo de 640px.
- Preço em destaque (`R$ 5,893`) quebrava em duas linhas porque o botão
  "Favoritar" dividia a linha → empilhado, botão vira faixa cheia.
- Alvo de toque: vários botões entre 28 e 34px de altura, incluindo o "Remover"
  de alerta, que é destrutivo. Agora 44px em ponteiro grosso (`pointer: coarse`),
  então o desktop mantém o desenho compacto.
- Texto de 10–11px em rótulos, selos e olhos-de-seção → piso subido no celular.
- `stat-grid`: seis cards em ~556px no iPad em retrato cortavam "R$ 5.644" →
  breakpoint novo entre 901 e 1180px.
- `checkout.html` estourava em 320 e 360px; plano e valor agora empilham.
- Tabelas dos documentos legais ganham rolagem própria em vez de esticar a página.

## iOS e Android: o que foi testado de fato

**Isto precisa estar escrito com clareza, porque o resumo de cima pode dar a
impressão errada.** A medição rodou em **Chromium** (a engine do Chrome, do Edge
e — no Android — de praticamente todo navegador). Para o Android, portanto, o
teste é direto.

Para o **iPhone, não**. O Safari usa WebKit, e WebKit não roda neste ambiente
(faltam 11 bibliotecas de sistema e não há como instalá-las aqui). O que dá para
afirmar com segurança, e o que não dá:

**Vale para os dois.** A causa do bug era `min-content` de coluna de grade — regra
da especificação de CSS Grid, implementada igual nas três engines. A correção
(`minmax(0, 1fr)` + `min-width: 0`) é do mesmo tipo: comportamento especificado,
não truque de engine. Todas as propriedades usadas têm suporte em Safari há anos,
e onde havia dúvida foi escrita uma linha de fallback antes (`overflow-wrap:
break-word` antes de `anywhere`, `padding-top/bottom` no lugar de `padding-block`).

**Específico do Safari, corrigido por análise e não por teste:**

- `-webkit-text-size-adjust: 100%` — o Safari do iPhone infla a fonte por conta
  própria ao girar para paisagem. Nenhum teste em Chromium mostra isso.
- `min-height: 100dvh` ao lado de `100vh` — no iOS, `100vh` é a altura *com a
  barra de endereço escondida*, o que sobra como rolagem morta.
- `env(safe-area-inset-*)` no toast — a 24px do rodapé ele nascia por baixo do
  indicador de home do iPhone.
- Fonte de 16px nos campos — é a causa do zoom automático do Safari, e a razão de
  a correção ser essa e não `maximum-scale=1` no viewport.

**O que continua sem cobertura:** bug de renderização exclusivo do WebKit. Não
tenho como afirmar que não existe nenhum. O teste de 5 minutos que fecha essa
lacuna está no fim deste documento.

## Segunda rodada — o que os prints do iPhone real mostraram

Três apontamentos vindos de uso de verdade num iPhone, e a lição é que dois deles
a medição automática **não pegaria nunca**: eram decisões de projeto, não
defeitos de layout. A régua achava que estava tudo certo porque nada estourava.

### O selo do Premium sumia no celular

Não era bug de responsivo: era um `display: none` abaixo de 560px, escrito de
propósito, com comentário justificando. A justificativa: "em tela estreita o
header já é apertado, e o selo é a informação menos urgente".

A premissa estava errada em duas pontas. O selo do plano gratuito é **o único
caminho para o Premium dentro do app** — some justamente para quem mais o veria.
E o header não precisava caber numa linha: bastava empilhar. No celular ele agora
é

```
Price Tracker Pro
Preços reais de combustível (dados abertos da ANP)
[ Plano gratuito · conhecer o Premium ]
[ e-mail ]                       [ Sair ]
```

e cabem os três sem espremer nenhum. O "some às vezes" que o Bernardo notou era o
breakpoint: aparecia ao girar o aparelho para paisagem, sumia em retrato.

### O topo quebrava "Price / Tracker / Pro" em três linhas

Nas três páginas estáticas, pela mesma causa: o nome era **texto solto dentro de
um contêiner flex**. Texto solto vira um item anônimo, e item anônimo quebra
palavra a palavra quando a linha aperta. Envolver o nome num `span` dá onde
pendurar o `white-space: nowrap`. Na `premium.html` o topo também empilha abaixo
de 560px — antes o `space-between` jogava a marca e o "voltar" para os cantos e
espremia os dois.

### "Ativar alerta" espremido ao lado do campo

O campo e o botão dividiam uma linha que não comportava os dois. No celular cada
um ocupa a largura inteira, na ordem em que se usam: digita, depois confirma.

## O que sobrou de propósito

- **Reticências** em `.auth-email` (e-mail no header) e `.product-card-name`
  (rótulo do favorito): é corte intencional com `text-overflow: ellipsis`, não
  quebra de layout.
- **`div.backdrop`**: o SVG decorativo do fundo transborda e é recortado — tem
  `pointer-events: none` e `aria-hidden`, não afeta nada.
- **Links dentro de parágrafo** (o `mailto:` dos termos, o "ANP" do rodapé): dar
  44px a cada um deles esticaria o texto corrido.
- **Celular deitado (844×390)**: cai nos breakpoints de tela larga e usa a
  tipografia de desktop. É o comportamento correto para essa largura.

## Como reproduzir

O arnês de teste está fora do repositório (foi gerado na sessão). O essencial:
Chromium via Playwright, contexto com `isMobile: true` e `deviceScaleFactor` real
do aparelho, rotas de `/api/fuel/*` interceptadas com dados fixos, sessão do
Supabase plantada em `localStorage`, e a medição feita em `page.evaluate` sobre
`document.documentElement.scrollWidth` vs `window.innerWidth`.

O sinal que importa é esse par: quando `innerWidth` sai maior que a largura do
aparelho, o navegador já deu zoom-out — é o sintoma do estouro, não a causa.

## O teste de 5 minutos num iPhone de verdade

Vale a pena antes de divulgar. Na ordem, porque a ordem importa — o bug morava no
estado logado, que é o que ninguém confere:

1. Abrir o site **logado**, com pelo menos dois favoritos, um deles de município
   com nome longo (São João Del Rei, Santa Bárbara d'Oeste).
2. Olhar se o conteúdo ocupa a largura da tela. Se aparecer faixa vazia à direita
   ou o texto vier pequeno, o estouro voltou.
3. Tocar no campo "Combustível". Se a página der zoom e não voltar, a regra dos
   16px não pegou.
4. Girar para paisagem e voltar. Se a fonte mudar de tamanho sozinha, o
   `text-size-adjust` não pegou.
5. Favoritar algo e ver onde o aviso verde aparece — ele não pode encostar na
   barrinha de home.
6. Rolar até "onde está mais barato" e conferir se dá para ler o nome do posto
   inteiro.
7. Conferir se o selo "Plano gratuito · conhecer o Premium" está no topo, em
   retrato **e** em paisagem — era ele que sumia.
8. Abrir `/premium.html` e ver se "Price Tracker Pro" cabe numa linha só.

Se os oito passarem, o iPhone está coberto de fato, e não por inferência.
