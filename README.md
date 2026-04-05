# Sync Render — Automação de sincronização de estoque entre Nuvemshop e GestãoClick

O **Sync Render** automatiza a rotina de sincronização de estoque entre a **Nuvemshop** e o **GestãoClick**, criado para uso de uma loja real de moda feminina, chamada **Lola**. O sistema recebe eventos de venda da Nuvemshop via webhook, organiza o processamento em fila e executa a sincronização dentro do módulo da integração no GestãoClick por automação de navegador com **Playwright**.

---

## Objetivo

O objetivo deste projeto é eliminar a necessidade de executar manualmente, a cada venda, o fluxo:

**Meus aplicativos > Nuvemshop > Produtos > Sincronizar > Confirmar sincronização**

Com isso, sempre que um pedido pago for identificado na Nuvemshop, o sistema tenta disparar automaticamente a sincronização para refletir a baixa de estoque no GestãoClick.

---

## Funcionalidades

### Webhook da Nuvemshop

- Recebe eventos HTTP da Nuvemshop
- Valida a assinatura HMAC no header `x-linkedstore-hmac-sha256`
- Trata apenas eventos `order/paid` no MVP
- Ignora eventos duplicados com deduplicação por `event/store_id/id`
- Responde rapidamente com `202 Accepted`

### Fila de processamento

- Evita sincronizações paralelas
- Processa uma tarefa por vez
- Mantém estado local de fila e últimos processamentos
- Registra último sucesso, último erro e último webhook recebido

### Automação do GestãoClick

- Reutiliza sessão salva quando disponível
- Faz login automático quando necessário
- Navega até a integração da Nuvemshop
- Abre a tela de produtos
- Clica em **Sincronizar** e confirma a operação no modal
- Salva screenshot em caso de erro para facilitar debug

### Rotas administrativas

- `GET /health`
- `GET /admin/debug-state`
- `GET /admin/last-screenshot`
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
- Módulos utilitários para armazenamento local e helpers de automação

### Persistência do MVP

- JSON em disco para estado da fila e deduplicação
- Arquivo local para `storageState` do navegador
- Screenshot local para depuração

### Execução

- Docker
- Render como alvo inicial de hospedagem do MVP

---

## Fluxo da automação

1. A Nuvemshop envia um webhook quando ocorre um `order/paid`
2. O servidor valida a assinatura e aceita o evento
3. O evento entra em uma fila serial
4. O worker inicia a automação com Playwright
5. O sistema entra no GestãoClick
6. Abre o app da Nuvemshop dentro do GestãoClick
7. Vai para **Produtos**
8. Executa **Sincronizar**
9. Confirma o modal da sincronização
10. Registra sucesso ou erro no estado interno

---

## Estrutura do Projeto

```text
lola-sync-render/
│
├── data/
│   └── .gitkeep
├── .env.example
├── .gitignore
├── .dockerignore
├── package.json
├── storage.js
├── playwright-helpers.js
├── sync-worker.js
├── auth.js
├── server.js
├── Dockerfile
└── README.md
```

---

## Variáveis de Ambiente

Crie um arquivo `.env` com base no `.env.example`:

```env
PORT=3000

ADMIN_KEY=chave-secreta
NUVEMSHOP_APP_SECRET=client-secret-nuvemshop

GC_EMAIL=email-login-gestaoclick
GC_PASSWORD=senha-login-gestaoclick
GESTAOCLICK_URL=https://link-login-gestaoclick

HEADLESS=true
POST_SYNC_WAIT_MS=12000
```

---

## Rodando Localmente

### Instalação

```bash
npm install
npx playwright install chromium
```

### Iniciar o servidor

```bash
npm run dev
```

### Salvar a sessão inicial do GestãoClick

```bash
npm run auth
```

Faça login manualmente no navegador aberto e, quando estiver na tela principal do GestãoClick, volte ao terminal e pressione **Enter**.

---

## Testes locais

### Healthcheck

```powershell
Invoke-RestMethod -Method GET -Uri "http://localhost:3000/health"
```

### Teste de login

```powershell
Invoke-RestMethod `
  -Method POST `
  -Uri "http://localhost:3000/admin/login-only" `
  -Headers @{ "x-admin-key" = "SEU_ADMIN_KEY" }
```

### Teste de sincronização manual

```powershell
Invoke-RestMethod `
  -Method POST `
  -Uri "http://localhost:3000/admin/run-sync" `
  -Headers @{ "x-admin-key" = "SEU_ADMIN_KEY" }
```

### Ver estado interno

```powershell
Invoke-RestMethod `
  -Method GET `
  -Uri "http://localhost:3000/admin/debug-state" `
  -Headers @{ "x-admin-key" = "SEU_ADMIN_KEY" }
```

### Simular webhook de pedido pago

```powershell
Invoke-RestMethod `
  -Method POST `
  -Uri "http://localhost:3000/admin/test-webhook" `
  -Headers @{
    "x-admin-key" = "SEU_ADMIN_KEY"
    "Content-Type" = "application/json"
  } `
  -Body '{"event":"order/paid","store_id":"123","id":"pedido-teste-001"}'
```

### Baixar screenshot de erro

```powershell
Invoke-WebRequest `
  -Method GET `
  -Uri "http://localhost:3000/admin/last-screenshot" `
  -Headers @{ "x-admin-key" = "SEU_ADMIN_KEY" } `
  -OutFile "last-screenshot.png"
```

---

## Observações do MVP

- O projeto usa **filesystem local** para estado, sessão e screenshot
- Em plataformas com **filesystem efêmero**, isso é suficiente para um MVP e debug, mas não é persistência definitiva
- O endpoint `/admin/test-webhook` existe para validação interna e pode ser removido depois
- O fluxo depende de a interface do GestãoClick manter textos e estrutura semelhantes aos usados nos seletores

---

## Deploy

O projeto foi preparado para rodar em container Docker.

### Build local do container

```bash
docker build -t lola-sync-render .
```

### Execução local com Docker

```bash
docker run --env-file .env -p 3000:3000 lola-sync-render
```

---

## Licença

Este projeto é de uso privado e não possui licença pública de distribuição.
