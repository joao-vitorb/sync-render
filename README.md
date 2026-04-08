# Sync Render — Automação de sincronização de estoque entre Nuvemshop e GestãoClick

O **Sync Render** automatiza a rotina de sincronização de estoque entre a **Nuvemshop** e o **GestãoClick**, criado para uso de uma loja real de moda feminina, chamada **Lola**. O sistema recebe eventos de venda da Nuvemshop via webhook, organiza o processamento em fila e executa a sincronização dentro do módulo da integração no GestãoClick por automação de navegador com **Playwright**.

---

## Acesse

- Serviço: `https://sync-render-hb67.onrender.com`
- Healthcheck: `https://sync-render-hb67.onrender.com/health`

---

## Objetivo

O objetivo deste projeto é eliminar a necessidade de executar manualmente, a nova cada venda, o fluxo:

**Meus aplicativos > Nuvemshop > Produtos > Sincronizar > Confirmar sincronização**

Com isso, sempre que um pedido pago for identificado na Nuvemshop, o sistema tenta disparar automaticamente a sincronização para refletir a baixa de estoque no GestãoClick, reduzindo retrabalho e risco de estoque divergente.

---

## Visão Geral do Fluxo

1. A Nuvemshop envia um webhook quando ocorre um evento `order/paid`.
2. O backend valida a assinatura HMAC do webhook.
3. O evento entra em uma fila serial.
4. O worker abre o GestãoClick com Playwright.
5. O sistema reutiliza a sessão salva do GestãoClick quando disponível.
6. O worker navega diretamente até o módulo da Nuvemshop no GestãoClick.
7. A automação abre **Produtos**, clica em **Sincronizar** e confirma a operação.
8. O sistema salva logs, metadados e screenshot em caso de erro.

---

## Funcionalidades

### Webhook da Nuvemshop

- Recebe eventos HTTP da Nuvemshop
- Valida assinatura `x-linkedstore-hmac-sha256`
- Trata `order/paid`
- Ignora duplicados por chave de evento
- Responde rapidamente com `202 Accepted`

### Fila de processamento

- Processamento serial
- Evita sincronizações paralelas
- Mantém estado de execução para debug
- Permite acionamento manual por endpoint admin

### Automação do GestãoClick

- Reaproveita sessão salva
- Faz login automático quando necessário
- Navega até a integração da Nuvemshop
- Executa a sincronização de produtos
- Salva screenshot e HTML em caso de falha

### Administração e diagnóstico

- `GET /health`
- `GET /admin/debug-state`
- `GET /admin/last-screenshot`
- `GET /admin/last-meta`
- `GET /admin/last-html`
- `POST /admin/login-only`
- `POST /admin/run-sync`
- `POST /admin/test-webhook`

---

## Tecnologias e Arquitetura

### Backend

- Node.js
- Express
- Playwright
- dotenv

### Execução

- Docker
- Render como alvo inicial de hospedagem do MVP

### Hospedagem

- Render (Web Service com Docker)

### Integrações

- Nuvemshop (webhook + OAuth para cadastro do webhook)
- GestãoClick (automação por navegador)

### Persistência do MVP

- Arquivos locais em `data/`
  - `state.json`
  - `storage-state.json`
  - `last-screenshot.png`
  - `last-page.html`
  - `last-meta.json`

---

## Estrutura do Projeto

```text
LOLA-SYNC-RENDER/
│
├── data/
│   └── .gitkeep
│
├── auth.js
├── server.js
├── sync-worker.js
├── storage.js
├── playwright-helpers.js
│
├── .env.example
├── .gitignore
├── .dockerignore
├── Dockerfile
├── package.json
└── README.md
```

## Variáveis de Ambiente

```env
PORT=3000

ADMIN_KEY=troque-por-uma-chave-secreta
NUVEMSHOP_APP_SECRET=troque-pelo-client-secret-do-app-da-nuvemshop

GC_EMAIL=seu-login-do-gestaoclick
GC_PASSWORD=sua-senha-do-gestaoclick
GESTAOCLICK_URL=https://gestaoclick.com/login

HEADLESS=true
POST_SYNC_WAIT_MS=12000

GC_STORAGE_STATE_B64=
```

---

## Rodando Localmente

### Instalação

```bash
npm install
npx playwright install chromium
```

### Execução

```bash
npm run dev
```

### Gerar sessão manual do GestãoClick

```bash
npm run auth
```

Faça login manualmente na janela aberta e pressione **Enter** no terminal para salvar a sessão em `data/storage-state.json`.

---

## Endpoints

### Públicos

- `GET /health`
- `POST /webhooks/nuvemshop`

### Admin

- `GET /admin/debug-state`
- `GET /admin/last-screenshot`
- `GET /admin/last-meta`
- `GET /admin/last-html`
- `POST /admin/login-only`
- `POST /admin/run-sync`
- `POST /admin/test-webhook`

---

## Fluxo de Operação

### Sincronização manual

Use quando quiser forçar uma sincronização:

```powershell
Invoke-RestMethod `
  -Method POST `
  -Uri "https://sync-render-hb67.onrender.com/admin/run-sync" `
  -Headers @{ "x-admin-key" = "SEU_ADMIN_KEY" }
```

### Teste fake de webhook

Use para validar o pipeline completo sem depender de uma compra real:

```powershell
Invoke-RestMethod `
  -Method POST `
  -Uri "https://sync-render-hb67.onrender.com/admin/test-webhook" `
  -Headers @{
    "x-admin-key" = "SEU_ADMIN_KEY"
    "Content-Type" = "application/json"
  } `
  -Body '{"event":"order/paid","store_id":"7165733","id":"pedido-teste-manual-001"}'
```

### Inspecionar o estado atual

```powershell
Invoke-RestMethod `
  -Method GET `
  -Uri "https://sync-render-hb67.onrender.com/admin/debug-state" `
  -Headers @{ "x-admin-key" = "SEU_ADMIN_KEY" }
```

---

## Deploy

O projeto está preparado para deploy como **Web Service Docker** no Render.

### Dockerfile

O serviço utiliza a imagem oficial do Playwright e sobe o backend Node.js com:

```dockerfile
CMD ["node", "server.js"]
```

### Observações do deploy

- O serviço precisa das variáveis de ambiente configuradas no Render.
- Para reaproveitar a sessão do GestãoClick no servidor, use `GC_STORAGE_STATE_B64`.
- A automação foi validada em ambiente local e em produção no Render via endpoints admin.

---

## Observações Importantes

- O projeto foi pensado como **MVP funcional**.
- O sistema de arquivos do Render Free é efêmero; os arquivos em `data/` servem para diagnóstico, não para persistência definitiva.
- Em serviços Free do Render, o web service entra em idle após um período sem tráfego. Em cenários assim, a primeira entrega do webhook pode atrasar e depender de retry da Nuvemshop.
- Para operação crítica 24/7, o ideal no futuro é migrar para um serviço always-on.

---

## Próximas Melhorias

- Persistir fila e estado em banco/Redis
- Adicionar alertas automáticos em caso de erro
- Criar painel simples de monitoramento
- Melhorar telemetria e logs estruturados
- Evoluir do Render Free para uma hospedagem sempre ativa

---

## Licença

## Este projeto é de uso privado e não possui licença de distribuição.
