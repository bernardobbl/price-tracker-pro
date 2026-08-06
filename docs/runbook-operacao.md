# Runbook de operação — como honrar as promessas antes de automatizar

> **Problema que este documento resolve:** os documentos legais prometem estorno, reembolso
> proporcional, aviso antes de vencer e exclusão de dados. Nada disso existe no código ainda.
>
> **A saída não é apagar as promessas** — a maioria é obrigação legal, não escolha. A saída é
> **executá-las à mão de forma confiável enquanto o volume é pequeno**, com procedimento escrito
> para nada ser esquecido. Promessa cumprida por humano continua sendo promessa cumprida. O que
> mata é promessa que ninguém sabe como cumprir às 23h de um sábado.
>
> 🔴 **Desde 06/ago/2026, 12:44, o dinheiro é real.** As credenciais de produção entraram no Render
> e o boot confirma `env: "production"`. Este parágrafo dizia "o risco real ainda é zero" e ficou
> falso no instante em que o serviço reiniciou — corrigido na mesma sessão, porque um runbook que
> tranquiliza quando não devia é pior do que nenhum.
>
> A partir daqui, cada procedimento da §3 pode ser acionado por uma pessoa que pagou. O portão da
> §1 abaixo continua servindo de registro do que foi conferido antes da virada.

---

## 1. 🚦 Portão de go-live

**Nada de `MERCADOPAGO_ENV=production` antes de todas estas linhas estarem marcadas.** Não é
burocracia: cada item corresponde a uma promessa já publicada por escrito.

> **Por que o gatilho mudou de nome.** Este portão dizia "nada de `DEMO = false`" — o que fazia
> sentido quando o checkout era uma maquete. Hoje `DEMO` já é `false` e mesmo assim **nenhum
> dinheiro circula**, porque as credenciais são de teste. A bandeira que separa "não cobra" de
> "cobra de verdade" passou a ser `MERCADOPAGO_ENV`, e é ela que este portão protege. Manter o
> nome antigo faria a lista parecer violada quando não está — e uma lista que parece violada
> deixa de ser lida.

- [x] Chave Pix cadastrada na conta do Mercado Pago — chave **aleatória**, conferida em 06/ago no
      painel (menu **Pix**) e provada pelo teste de fumaça
- [x] Revisão jurídica dos 3 documentos concluída — 06/ago, **sem mudança de texto**; por isso a
      §1.5 não se aplica e `LEGAL_VERSION` segue `1.0` → **§1.1**
- [x] Webhook cadastrado no painel + `MERCADOPAGO_WEBHOOK_SECRET` no Render — 06/ago, **aba
      produtiva** (o segredo da aba de teste não valida notificação de produção) → **§1.2**
- [x] Credenciais de **produção** no Render, nunca no repositório e nunca no front — 06/ago → **§1.3**
- [x] `MERCADOPAGO_ENV=production` **e** `NODE_ENV=production` no Render — conferido no boot de
      06/ago 12:44: `env: "production"`, `validacaoDeAssinaturaDoWebhook: "ATIVA"` → **§1.3**
- [x] `ADMIN_EMAILS` no Render **e uma conta no Supabase com esse e-mail** — 06/ago, provado por
      `GET /api/billing/refund/<uuid-falso>` devolver `CHARGE_NOT_FOUND` → **§1.6**
- [ ] Compra real de ponta a ponta, feita por você, **e depois estornada** → **§1.4**
- [ ] Tabela `subscriptions` criada, com o índice único por `charge_id`
- [ ] Os 10 testes de `vigencia-do-acesso.md` §5 passando
- [ ] **Este runbook lido uma vez** e os comandos da §3 testados no Supabase com dado falso
- [ ] Uma **planilha ou consulta salva** com todas as assinaturas ativas e vencimentos (§2)
- [ ] Lembrete recorrente semanal no seu calendário: *"rodar a checagem de vencimento"*
- [ ] `LEGAL_VERSION` no `checkout.html` conferido contra a versão publicada nos documentos → **§1.5**

> **Se você só puder fazer uma coisa desta lista:** o lembrete no calendário. É o único item que
> protege um cliente pagante de perder acesso sem aviso — e é grátis.

### A ordem importa, e não é a da lista

A lista acima é uma checagem; **isto** é a sequência de execução. Ela foi montada por um critério
só: **o que ainda pode ser corrigido de graça vem antes do que é irreversível.**

```
§1.1 revisão jurídica        ─┐
                              ├─ podem correr em paralelo, nada quebra
§1.2 webhook + segredo       ─┘   (ambos funcionam com credencial de teste)
        │
        ▼
§1.3 credenciais de produção     ← a partir daqui o dinheiro é real
        │
        ▼
§1.4 compra real + estorno       ← o único teste que prova o caminho inteiro
        │
        ▼
§1.5 conferências finais
```

Trocar a credencial primeiro e testar o webhook depois inverte isso: você descobre um erro de
configuração com dinheiro de cliente em vez de com o seu.

---

### §1.1 Revisão jurídica dos 3 documentos

**O que revisar:** `frontend/public/termos.html`, `privacidade.html` e `reembolso.html`. São
rascunhos escritos a partir do que o produto realmente faz — o que já é mais do que um modelo
genérico entrega —, mas **ninguém com OAB olhou**.

1. **Exporte os três em PDF** (abrir no navegador → Imprimir → Salvar como PDF). Advogado não
   deve receber HTML nem link para localhost.
2. **Mande junto o contexto que o texto não tem.** Sem isto o parecer sai genérico:
   - pessoa física sem CNPJ, recebendo por Mercado Pago (instituição de pagamento regulada);
   - **compra avulsa, sem renovação automática** — a razão é regulatória, não de produto: Pix
     Automático exige CNPJ por regra do Banco Central (`docs/recebimento-sem-cnpj.md`);
   - preços: R$ 16,90 (1 mês) e R$ 59,90 (12 meses), vigência em **mês de calendário**;
   - a política de reembolso já está implementada em código exatamente como escrita: integral em
     7 dias (art. 49 do CDC, inclusive no mensal e mesmo tendo usado), proporcional por meses
     inteiros no anual, nada no mensal fora do prazo;
   - dados pessoais guardados: e-mail, favoritos, alertas e registros de pagamento. Registro de
     pagamento é **anonimizado, não apagado**, na exclusão de conta — obrigação fiscal de 5 anos.
3. **Peça três coisas específicas**, não "dá uma olhada": (a) o que está prometido a mais do que a
   lei exige e pode ser reduzido; (b) o que a lei exige e não está lá; (c) o texto do art. 49 está
   aplicado corretamente para serviço digital contratado à distância?
4. **Se o texto mudar**, siga a §1.5 — versão de documento é prova, e mexer nela tem ordem própria.

> **Por que trava o dinheiro e não o código:** um documento errado publicado com cliente pagante
> vira disputa. Publicado sem cliente nenhum, vira um `git commit`.

---

### §1.2 Webhook: cadastrar a URL e ligar a conferência de assinatura

O código já existe (`backend/src/lib/webhookSignature.ts`) e está **desligado** enquanto
`MERCADOPAGO_WEBHOOK_SECRET` não estiver no ambiente. Ligar é configuração, não programação.

> **Pode ser feito agora, com credencial de teste.** O painel tem abas separadas para modo teste e
> modo produtivo — e **cada aba gera um segredo diferente**. Fazer no teste primeiro é ensaio de
> graça; só não esqueça de repetir na aba de produção quando trocar as credenciais (§1.3), porque o
> segredo do teste não valida notificação de produção e o sintoma será 401 em tudo.

**Passo 1 — cadastrar a URL.** Em [Suas integrações](https://www.mercadopago.com.br/developers/panel/app)
→ sua aplicação → menu esquerdo **Webhooks → Configurar notificações**:

```
https://price-tracker-pro-api.onrender.com/api/billing/webhook
```

**Passo 2 — marcar o evento certo.** Selecione **"Order (Mercado Pago)"**. É o único que interessa:
a integração é a API de Orders, e assinar tópicos de `payment` traria notificações que o
`extractOrderId` não sabe resolver — elas cairiam no caminho de "ignorado" e poluiriam o log sem
nunca liberar nada.

**Passo 3 — salvar e revelar o segredo.** Salvar é o que **gera** a chave. Clique em revelar e
copie. Ela não expira; o botão *Reset* troca (e invalida a anterior na hora).

**Passo 4 — colar no Render.** Painel do Render → serviço `price-tracker-pro-api` → **Environment**
→ `MERCADOPAGO_WEBHOOK_SECRET` = a chave. Salvar reinicia o serviço.

**Passo 5 — conferir que ligou.** Render → serviço `price-tracker-pro-api` → aba **Logs**. Logo
depois de `Backend rodando na porta`, a linha `[MercadoPago] Configurado` traz:

```
validacaoDeAssinaturaDoWebhook: "ATIVA"
```

Se vier `"DESLIGADA (sem segredo)"`, a variável não chegou — confira se salvou no serviço certo e
se o deploy terminou.

**Passo 6 — simular.** No painel, **Simular notificação**: escolha a URL, o evento *Order* e um
`Data ID` qualquer. Esperado: **200** com `{"received":true,"ignored":true}` — a assinatura bateu
(senão seria 401) e a order simulada não é nossa (por isso `ignored`). Os dois juntos provam o
caminho inteiro.

⚠️ **Se der 401 na simulação**, a causa quase certa é o segredo da aba errada (teste × produção).
As duas outras causas conhecidas estão presas por teste em `test/webhookSignature.test.ts`: o
`data.id` vai em **minúsculas** no manifesto, e campo ausente **sai** da string em vez de virar
vazio.

⚠️ **Um 502/504 na primeira simulação não é erro seu:** o Render Free hiberna após 15 min e o
cold start leva de 30 a 60 s. Simule de novo. Em produção isso não perde pagamento — o Mercado
Pago reenvia a cada 15 min até receber 200, e o processamento é idempotente.

---

### §1.3 Credenciais de produção — o ponto de não retorno

**A partir daqui o dinheiro é real.** Não faça este passo no mesmo dia em que fizer os anteriores:
durma sobre a §1.1 e a §1.2 primeiro.

**Passo 1 — pegar as credenciais.** [Suas integrações](https://www.mercadopago.com.br/developers/panel/app)
→ sua aplicação → **Credenciais de produção**. ⚠️ **Os tokens de teste e de produção começam ambos
com `APP_USR` e são indistinguíveis a olho nu** — é exatamente por isso que `MERCADOPAGO_ENV`
existe. Copie um de cada vez e confira a aba de onde veio.

**Passo 2 — no Render** (`price-tracker-pro-api` → Environment), quatro variáveis:

| Variável | Valor |
|---|---|
| `MERCADOPAGO_ACCESS_TOKEN` | token de **produção** |
| `MERCADOPAGO_PUBLIC_KEY` | public key de **produção** |
| `MERCADOPAGO_ENV` | `production` |
| `MERCADOPAGO_WEBHOOK_SECRET` | segredo da aba **produtiva** do painel (§1.2) |

`NODE_ENV=production` já vem do `render.yaml`. **Nada disso vai para o `.env` do repositório nem
para o frontend** — o front nunca vê token de pagamento, e o `checkout.html` não precisa de
nenhuma alteração: ele já lê o ambiente da resposta do backend.

**Passo 3 — conferir o boot.** Render → `price-tracker-pro-api` → aba **Logs**, logo após
`Backend rodando na porta`:

```
[MercadoPago] Configurado  env: "production"  validacaoDeAssinaturaDoWebhook: "ATIVA"
```

Se aparecer qualquer coisa dizendo que a cobrança foi **desligada**, leia a mensagem inteira: o
config recusa `NODE_ENV=production` + `MERCADOPAGO_ENV=test` de propósito, e é a proteção
funcionando, não um bug.

**Passo 4 — sinal de que deu certo, do lado do usuário.** Abra `/premium/checkout` logado e gere
um pagamento. **O aviso amarelo de "código de teste" tem de sumir.** Se ele continuar aparecendo,
o backend ainda está em sandbox — não pague nada até resolver.

---

### §1.4 A compra real — o único teste que prova o caminho inteiro

> ⚠️ **Esqueça o "pagamento de R$ 0,01" que este runbook pedia antes: ele não é possível.** O preço
> vem de `PLAN_PRICE_CENTS` no backend, e o corpo do checkout nem tem campo de valor — que é a
> regra que impede alguém de comprar o anual por um centavo. Criar um plano de teste para furar
> isso seria abrir a porta que a regra existe para fechar.
>
> **Compre o mensal de verdade, de você mesmo, e estorne depois.** Custa, no pior caso, a taxa de
> 0,99% (R$ 0,17) — e, diferente do centavo, exercita o fluxo que os clientes vão percorrer:
> checkout → Pix pago no app do seu banco → webhook assinado → assinatura criada → gate liberado →
> estorno → acesso encerrado. É o único teste que toca as duas pontas que mais doem se falharem.

**Passo 1 — comprar.** Logado, `/premium/checkout?plan=mensal` → aceitar os documentos → **Gerar
pagamento** → pagar o Pix no app do seu banco. Cronometre: a tela deve virar "Pagamento
confirmado" sozinha em segundos (o polling é 3s no primeiro minuto).

**Passo 2 — conferir os quatro lugares**, nesta ordem:

```sql
-- 1. a cobrança fechou
select id, status, amount_cents, paid_at, provider_order_id
  from billing_charges order by created_at desc limit 1;

-- 2. a assinatura nasceu com a vigência certa (1 mês de CALENDÁRIO, não 30 dias)
select plan, status, starts_at, expires_at, charge_id, legal_version, accepted_at
  from subscriptions order by starts_at desc limit 1;
```

3. **No app:** o selo `Premium até DD/MM` no header.
4. **No log do Render:** `[Billing] Webhook processado` — se só aparecer a reconciliação do
   polling e nunca o webhook, ele não está chegando; volte à §1.2.

**Passo 3 — estornar**, seguindo a §3.1. Confira o preview antes: dentro de 7 dias a regra tem de
ser `cdc-7-dias` com devolução **integral**.

**Passo 4 — conferir que o acesso caiu.** O selo do header volta a "Plano gratuito", e:

```sql
select status, expires_at from subscriptions order by starts_at desc limit 1;
-- esperado: status = 'refunded', expires_at ≈ o instante do estorno
```

> **Se este passo falhar**, o problema é grave e é o que o runbook avisava desde o começo: dinheiro
> devolvido com acesso ainda ativo. O `logger.error` de `expireSubscriptionForCharge` grita quando
> isso acontece.

---

### §1.5 Conferências finais

**`LEGAL_VERSION`.** Se a revisão jurídica (§1.1) mudou qualquer um dos três documentos, a versão
precisa subir — e **a ordem é uma só**:

1. acrescente a versão nova em `backend/src/lib/legalVersions.ts` (**sem remover as antigas**:
   cobranças passadas apontam para elas);
2. só depois atualize `LEGAL_VERSION` no `frontend/public/checkout.html`;
3. faça o deploy do **backend antes** do frontend.

Invertido, o checkout responde **400 para todo mundo** até o backend subir — o front estaria
mandando uma versão que a lista branca ainda não conhece.

**O que NÃO precisa mudar no go-live:** `DEMO` já é `false`, os links já apontam para os arquivos
reais, e o `checkout.html` lê o ambiente do backend. Se você se pegar editando o front para subir
em produção, pare e confira o que está fazendo.

---

### §1.6 `ADMIN_EMAILS` — e a conta que precisa existir do outro lado

Sem esta variável, as rotas de estorno respondem **503** e ninguém é admin, nem em
desenvolvimento (`middleware/requireAdmin.ts`, fail-closed de propósito: env incompleta não pode
virar rota pública que devolve dinheiro).

**Passo 1 — no Render** (`price-tracker-pro-api` → Environment): `ADMIN_EMAILS` = seu e-mail.
Aceita lista separada por vírgula; o código faz `trim` e `lowercase`, então maiúscula e espaço
sobrando não quebram.

**Passo 2 — confira que existe uma conta no app com esse e-mail.** Supabase → Authentication →
Users. Este passo parece redundante e **não é**: o `requireAdmin` compara com o e-mail do token do
Supabase, não com o Render. Em 06/ago a variável estava certa e a conta não existia — o estorno
teria dado 404 e ninguém saberia até a primeira venda real.

**Passo 3 — a prova.** Logado no app, no console do navegador:

```js
const k = Object.keys(localStorage).find(x => x.includes('auth-token'));
const tok = JSON.parse(localStorage.getItem(k)).access_token;
const r = await fetch('https://price-tracker-pro-api.onrender.com/api/billing/refund/00000000-0000-0000-0000-000000000000',
                      { headers: { Authorization: 'Bearer ' + tok } });
console.log(r.status, await r.text());
```

| Resposta | Significa |
|---|---|
| `503 ADMIN_UNAVAILABLE` | a variável não chegou no Render |
| `404 NOT_FOUND` | variável ok, mas o e-mail do token não está na lista |
| `404 CHARGE_NOT_FOUND` | passou pelo `requireAdmin` — **é este que prova** |

É seguro: a rota de preview não toca em dinheiro por desenho, e o UUID é inventado.

> **Por que não basta olhar o log.** A ausência de `[Admin] ADMIN_EMAILS não configurada` no boot
> só descarta o primeiro caso. O segundo — variável certa, conta ausente ou com e-mail diferente —
> é silencioso no log e idêntico ao terceiro pelo status HTTP. Só o **código** do erro separa os
> dois.

---

## 2. Painel do pobre — o que olhar toda semana

Sem tela de admin, uma consulta resolve. Salve como *saved query* no Supabase.

```sql
-- Quem está ativo, e quanto falta
select
  u.email,
  s.plan,
  s.starts_at at time zone 'America/Sao_Paulo' as inicio,
  s.expires_at at time zone 'America/Sao_Paulo' as vence,
  date_trunc('day', s.expires_at - now()) as falta,
  s.amount_cents / 100.0 as pago,
  s.charge_id
from subscriptions s
join auth.users u on u.id = s.user_id
where s.status = 'active' and s.expires_at > now()
order by s.expires_at;
```

```sql
-- Quem vence nos próximos 7 dias  → PRECISA de aviso por e-mail
select u.email, s.plan,
       s.expires_at at time zone 'America/Sao_Paulo' as vence
from subscriptions s
join auth.users u on u.id = s.user_id
where s.status = 'active'
  and s.expires_at between now() and now() + interval '7 days'
order by s.expires_at;
```

---

## 3. Procedimentos

### 3.1 e 3.2 Reembolso — ✅ AUTOMATIZADO em 05/ago/2026

> **Não faça mais à mão.** As duas regras da política (integral em 7 dias, proporcional no anual)
> viraram código, e o acesso é encerrado na mesma operação — que era justamente o passo que
> dependia de alguém lembrar de rodar um `UPDATE`.

**Pré-requisito:** seu e-mail em `ADMIN_EMAILS` no ambiente do backend. Sem a variável, as rotas
respondem 503 para todo mundo (fail-closed).

**Passo 1 — localize a cobrança.**

```sql
select bc.id as charge_id, bc.plan, bc.amount_cents/100.0 as pago, bc.paid_at, bc.status
  from billing_charges bc
  join auth.users u on u.id = bc.user_id
 where u.email = 'cliente@exemplo.com'
 order by bc.paid_at desc nulls last;
```

**Passo 2 — veja o que a política manda devolver.** Não move dinheiro:

```bash
curl -s https://price-tracker-pro-api.onrender.com/api/billing/refund/<charge_id> \
  -H "Authorization: Bearer <seu_token_supabase>"
```

Devolve a regra aplicada (`cdc-7-dias`, `prorata-anual` ou `sem-reembolso`), o valor em centavos e
uma frase pronta para colar na resposta ao cliente.

**Passo 3 — execute**, repetindo o valor que veio no preview:

```bash
curl -s -X POST https://price-tracker-pro-api.onrender.com/api/billing/refund \
  -H "Authorization: Bearer <seu_token_supabase>" \
  -H "Content-Type: application/json" \
  -d '{"chargeId":"<charge_id>","expectedCents":3993}'
```

O `expectedCents` **tem de bater** com o calculado, senão a operação é recusada. Não é burocracia:
é a diferença entre "o sistema devolveu R$ 39,93" e "alguém digitou um número e o sistema
obedeceu". O pró-rata também cai a cada mês que passa, então confirmar o valor evita executar um
preview velho.

**O que acontece automaticamente:** estorno no provedor (total com corpo vazio, parcial com valor +
id da transação), `billing_charges.status = 'refunded'`, e a assinatura encerrada com
`status = 'refunded'` e `expires_at = agora`. **A linha nunca é apagada** — é prova fiscal e os
Termos prometem guardá-la.

**Se o provedor recusar** (falta de saldo é o caso comum), **nada é alterado no banco**. Ninguém
fica sem acesso e sem dinheiro. O log traz `[Billing] Provedor recusou o estorno`.

**Estorno feito pelo painel do Mercado Pago também corta o acesso agora** — a próxima consulta da
order vê `refunded` e encerra a assinatura sozinha. Era exatamente o furo que este runbook avisava:
"o estorno no painel não avisa o seu sistema".

<details>
<summary>Procedimento manual (guardado caso as rotas estejam fora)</summary>

1. Painel do Mercado Pago: **Atividade → a transação → Estornar**.
2. Corte o acesso na mão:
   ```sql
   update subscriptions set expires_at = now(), status = 'refunded'
    where charge_id = '<charge_id>';
   update billing_charges set status = 'refunded' where id = '<charge_id>';
   ```
3. Confira o pró-rata contra o exemplo publicado: cancelou no 4º mês → 8 meses restantes →
   `59,90 × 8 / 12 = R$ 39,93`.

</details>

**Prazos que continuam sendo seus:** confirmar o recebimento do pedido em até 2 dias úteis e
solicitar o estorno em até 5 dias úteis, como a política promete.

### 3.3 Aviso antes de vencer — ✅ AUTOMATIZADO em 04/ago/2026

> **Não precisa mais fazer à mão.** O aviso roda junto do job semanal da ANP
> (`scripts/ingest.ts`, disparado pelo GitHub Actions toda segunda 09:00 UTC).
>
> - Janela de **8 dias**, e não 7: o job é semanal, então 7 deixaria escapar quem vence 7,5 dias
>   depois de uma execução.
> - `warned_at` impede aviso repetido.
> - Quem renovou **não** recebe aviso pela assinatura antiga — o serviço só olha a de maior
>   vigência de cada usuário.
> - Roda **fora** do `if (ingestão teve sucesso)`: uma semana sem publicação da ANP não pode
>   deixar o assinante sem aviso.
>
> **O que ainda depende de você:** os secrets de SMTP e a variable `FRONTEND_URL` precisam estar
> configurados no GitHub Actions. Sem SMTP o aviso não sai (e o log diz isso); sem `FRONTEND_URL`
> o e-mail sai, mas sem o link de renovação.
>
> Para conferir se está funcionando, veja a saída do workflow na aba **Actions** — a linha
> `[ingest] Avisos de vencimento: N elegíveis · N enviados`.

<details>
<summary>Procedimento manual (guardado caso o automático falhe)</summary>

**Toda segunda-feira**, rode a segunda consulta da §2 e envie para cada e-mail listado:

> **Assunto:** Seu acesso ao Price Tracker Pro vence em X dias
>
> Oi! Seu plano *(mensal/anual)* vence em **DD/MM**. Não existe cobrança automática — se quiser
> continuar, é só renovar em precos-combustivel-br.vercel.app/premium. Se não renovar, sua conta
> volta ao uso gratuito e você não perde nada do que já salvou.

Registre o envio para não mandar duas vezes:
```sql
update subscriptions set warned_at = now() where charge_id = '<charge_id>';
```

Para forçar um reenvio (ex.: o e-mail voltou), limpe a marca:
```sql
update subscriptions set warned_at = null where charge_id = '<charge_id>';
```

</details>

### 3.4 Exclusão e exportação de dados (LGPD art. 18) — ✅ AUTOMATIZADO em 05/ago/2026

> **O próprio titular resolve, sem passar por você.** Duas rotas autenticadas, agindo sempre sobre
> a conta do token — não existe parâmetro de "qual usuário".

| O quê | Rota | Efeito |
|---|---|---|
| Cópia dos dados | `GET /api/account/export` | JSON com conta, favoritos, alertas, assinaturas e cobranças. Baixa como arquivo |
| Excluir a conta | `DELETE /api/account` com `{"confirm":"EXCLUIR MINHA CONTA"}` | Anonimiza o registro fiscal e remove o usuário |

⚠️ **O conflito que isso resolve:** a Política de Privacidade promete apagar os dados **e** guardar
os registros de pagamento por 5 anos. As duas coisas só coexistem **anonimizando** em vez de
deletar: `subscriptions.user_id` e `billing_charges.user_id` viram `null`, favoritos e alertas caem
em cascata, o usuário sai do `auth.users`. Valor e data continuam lá, sem apontar para pessoa
nenhuma.

A ordem no código é anonimizar **antes** de remover o usuário. Se a remoção falhar, sobra uma conta
com registro já desvinculado — recuperável, e o log grita. Na ordem inversa, uma falha deixaria
registro fiscal órfão ou apagado.

**Exclusão é imediata**, não em 30 dias. O prazo publicado é um teto, não uma meta.

> O `on delete set null` das duas colunas já estava certo desde a migração 003 — a preocupação
> registrada aqui ("ajuste antes do go-live") era infundada. Conferido em 05/ago/2026.

<details>
<summary>Procedimento manual (guardado caso as rotas estejam fora)</summary>

```sql
-- 1. Anonimiza o vínculo, preservando o registro fiscal
update subscriptions    set user_id = null
 where user_id = (select id from auth.users where email = 'cliente@exemplo.com');
update billing_charges  set user_id = null
 where user_id = (select id from auth.users where email = 'cliente@exemplo.com');

-- 2. Apaga os dados pessoais (favoritos e alertas caem em cascata)
delete from auth.users where email = 'cliente@exemplo.com';
```

</details>

Depois, confirme por e-mail que foi feito — o prazo de resposta de **15 dias** continua sendo seu.

### 3.5 Pagou e o acesso não liberou

O caso mais provável de suporte: o webhook falhou (cold start do Render, timeout, deploy no ar).

1. Confirme o pagamento no painel do Mercado Pago (status *aprovado*).
2. Libere na mão, com a mesma regra de data do doc de vigência:
   ```sql
   insert into subscriptions
     (user_id, plan, status, starts_at, expires_at,
      provider, charge_id, amount_cents, paid_at, legal_version, accepted_at)
   values (
     (select id from auth.users where email = 'cliente@exemplo.com'),
     'anual', 'active',
     now(),
     greatest(now(), coalesce(
       (select max(expires_at) from subscriptions
         where user_id = (select id from auth.users where email='cliente@exemplo.com')
           and status = 'active'), now()))
     + interval '12 months',
     'mercadopago', '<charge_id>', 5990, now(), '1.0', now()
   );
   ```
3. Peça desculpa e diga que foi resolvido. Anote a causa — se repetir, o webhook precisa de retry.

---

## 4. Até quando o manual aguenta

| Assinantes ativos | Situação | O que fazer |
|---|---|---|
| **1 – 10** | Manual funciona bem. Poucos minutos por semana. | Seguir este runbook |
| **10 – 30** | Começa a doer. Esquecer um aviso vira questão de tempo. | **Automatizar o aviso de vencimento** (Etapa B) — é o de maior risco e o mais fácil, reaproveita o job semanal da ANP |
| **30 +** | Manual é irresponsável. | Automatizar também estorno e exclusão |

> A ordem de automação segue o **risco para o cliente**, não a dificuldade:
> 1. **Aviso de vencimento** — falhar aqui prejudica quem está pagando, em silêncio
> 2. **Estorno + corte de acesso** — falhar aqui é problema legal
> 3. **Exclusão de dados** — prazo de 30 dias dá folga para fazer à mão por mais tempo

### Por que essa ordem também é a melhor para nós

Risco para o cliente e custo de construção **apontam para o mesmo lugar** aqui, o que é sorte e
deve ser aproveitado:

| | Risco se falhar | O que já existe pronto | Esforço |
|---|---|---|---|
| **1. Aviso de vencimento** | Alto e **silencioso** — o cliente some sem reclamar, e você nem sabe que perdeu | **Quase tudo**: o job semanal do GitHub Actions já roda, e o Nodemailer já manda e-mail de alerta de preço | **Baixo** — é uma consulta e um template a mais no que já existe |
| **2. Estorno automático** | Alto, mas **barulhento** — o cliente reclama, você fica sabendo | Nada. Precisa de endpoint novo + integração de refund + webhook | Médio |
| **3. Exclusão de dados** | Baixo no curto prazo — a LGPD dá 30 dias | Nada | Médio |

O aviso de vencimento é **o de maior risco e o de menor custo ao mesmo tempo**. Não existe decisão
difícil aqui: é o primeiro, com folga.

> **Mas antes de qualquer um dos três:** com zero clientes, automatizar é fabricar estoque que pode
> nunca ser vendido. O certo agora é o **gate de assinatura** (§5) — sem ele o produto não é
> vendável — e o resto à mão, seguindo este runbook.

---

## 5. O gate de assinatura — a única coisa sem versão manual

> Ou o código checa `now() < expires_at` antes de deixar criar alerta, ou todo mundo tem acesso
> pago de graça. Não existe "fazer à mão" isso: são milhares de requisições.

**A boa notícia: ele não depende do Mercado Pago.** O gate lê a tabela `subscriptions` e compara
duas datas. Dá para construir e testar **hoje**, sem gateway nenhum, inserindo uma linha na mão:

```sql
-- Simula um assinante ativo, sem pagamento nenhum envolvido
insert into subscriptions
  (user_id, plan, status, starts_at, expires_at, provider, charge_id,
   amount_cents, paid_at, legal_version, accepted_at)
values
  ((select id from auth.users where email='seu@email.com'),
   'mensal','active', now(), now() + interval '1 month',
   'manual','teste-001', 1690, now(), '1.0', now());

-- Depois, para testar o bloqueio, expire na marra:
update subscriptions set expires_at = now() - interval '1 second'
 where charge_id = 'teste-001';
```

Por isso ele deveria ser **a primeira coisa construída**, antes de qualquer linha de pagamento.

### ⚠️ E tem um problema anterior a ele

Hoje **o plano grátis também tem alertas ilimitados**, enquanto a landing vende "alertas
ilimitados" como se fosse benefício do Premium. Ou seja: mesmo com o gate perfeito, **não há motivo
para ninguém pagar.**

O gate são, na prática, duas coisas:

1. **Limitar o plano grátis** (ex.: 1 ou 2 alertas) — é o que cria a razão de existir do Premium
2. **Checar assinatura ativa** para liberar o ilimitado

Fazer só a 2 é construir uma catraca numa porta que continua aberta do lado.
(Já apontado na §8 do `fase10-pagamentos.md`.)
