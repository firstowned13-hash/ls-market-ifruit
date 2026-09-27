# LS Market — iFruit marketplace

Marketplace mobile para o iFruit/United Roleplay. Jogadores pagam uma taxa para publicar anúncios e podem pagar outra taxa para impulsioná-los.

## O que já vem pronto

- Feed mobile (390–430 px)
- Busca e categorias
- Criação de anúncio com até 10 fotos via `shell.gallery`
- Identidade exibida pelo username da conta iFruit (`shell.ifruit_account`)
- Contato pelo Messages nativo (`shell.compose_message`)
- Adicionar contato (`shell.new_contact`)
- Cobrança para publicar via iFruit Pay
- Impulsionamento pago com duração configurável
- Confirmação server-side da transação antes de publicar/impulsionar
- SQLite local
- Endpoint administrativo simples para remover anúncio

## Capabilities a solicitar na UCP

- `shell.gallery`
- `shell.ifruit_account`
- `shell.compose_message`
- `shell.new_contact`

`pay.open` já é uma função sempre incluída segundo o guia.

## Configuração

1. Instale Node.js 20+.
2. Rode `npm install`.
3. Copie `.env.example` para `.env`.
4. Preencha:
   - `APP_ORIGIN`: URL HTTPS aprovada do app.
   - `API_BASE`: URL base mostrada na aba **API access** após aprovação.
   - `IFRUIT_MERCHANT_KEY`: chave criada em **iFruit Pay → Sales**.
   - `LISTING_FEE`: taxa para publicar.
   - `BOOST_FEE`: taxa para impulsionar.
   - `BOOST_HOURS`: duração do boost.
5. Rode `npm start`.
6. Hospede em HTTPS (Vercel/Netlify não são ideais para SQLite persistente; prefira Railway, Render, Fly.io, VPS ou equivalente com disco persistente).

## Fluxo de pagamento

### Publicação

1. O jogador cria o anúncio.
2. O backend salva como `pending_payment`.
3. O backend chama `POST {API_BASE}/v1/phone/transactions` com a merchant key.
4. O frontend abre `united:ifruit:openPay` com o id da transação.
5. O backend consulta `GET {API_BASE}/v1/phone/transactions/{id}`.
6. Só quando o status é `succeeded` e o `metadata` confere, o anúncio vira `active`.

### Boost

O mesmo processo é usado. Após `succeeded`, `boosted_until` é estendido por `BOOST_HOURS`. Anúncios impulsionados aparecem primeiro no feed.

## Segurança importante

- Merchant key e App token nunca vão para o frontend.
- O projeto valida `metadata` antes de cumprir o pagamento.
- A API deve aceitar somente a origem aprovada pela staff.
- Se uma chave vazar, use **Reset token** e **Replace key**.

### Limitação de identidade

O guia fornecido não documenta um endpoint HTTP server-side para autenticar o personagem/conta iFruit do jogador. Este projeto usa o username retornado pelo bridge para exibição e para ações de dono na interface. Isso é suficiente para um protótipo funcional, mas não deve ser tratado como autenticação forte contra chamadas diretas à API. Quando a United disponibilizar uma rota oficial de autenticação/identidade, conecte-a ao backend antes de considerar propriedade de anúncio como segura.

## Preços sugeridos

Os valores ficam configuráveis no `.env`. O exemplo usa:

- Publicar anúncio: `$500`
- Impulsionar por 24h: `$750`

Ajuste de acordo com a economia do servidor.
