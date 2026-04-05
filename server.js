require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { executeLoginOnly, executeSync } = require("./sync-worker");
const { SCREENSHOT_PATH } = require("./playwright-helpers");
const { readState, updateState, pruneProcessedEvents } = require("./storage");

const app = express();
const PORT = Number(process.env.PORT || 3000);

let syncRunning = false;

function nowIso() {
  return new Date().toISOString();
}

function verifyNuvemshopSignature(rawBody, receivedSignature, appSecret) {
  if (!receivedSignature || !appSecret) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(receivedSignature, "utf8");

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

function buildEventKey(body) {
  return `evt:${body.event}:${body.store_id}:${body.id}`;
}

function enqueueJob(job) {
  updateState((state) => {
    const nextProcessed = pruneProcessedEvents(state.processedEvents);

    state.queue.push(job);
    state.lastEnqueuedAt = nowIso();
    state.processedEvents = nextProcessed;

    return state;
  });
}

async function processQueue() {
  if (syncRunning) {
    return;
  }

  syncRunning = true;

  try {
    while (true) {
      const currentState = readState();
      const nextJob = currentState.queue[0];

      if (!nextJob) {
        updateState((state) => {
          state.isProcessing = false;
          return state;
        });
        break;
      }

      updateState((state) => {
        state.isProcessing = true;
        state.lastRunAt = nowIso();
        state.lastProcessedReason = nextJob.reason;
        return state;
      });

      try {
        await executeSync(nextJob.reason);

        updateState((state) => {
          state.queue.shift();
          state.lastSuccessAt = nowIso();
          state.lastError = null;
          state.isProcessing = state.queue.length > 0;
          return state;
        });
      } catch (error) {
        updateState((state) => {
          state.queue.shift();
          state.lastError = {
            message: error.message || "Erro desconhecido",
            at: nowIso(),
          };
          state.isProcessing = state.queue.length > 0;
          return state;
        });
      }
    }
  } finally {
    syncRunning = false;
  }
}

function requireAdmin(req, res, next) {
  const adminKey = req.header("x-admin-key");

  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  next();
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/admin/debug-state", requireAdmin, (_req, res) => {
  res.json({
    ok: true,
    ...readState(),
    syncRunning,
  });
});

app.get("/admin/last-screenshot", requireAdmin, (_req, res) => {
  if (!fs.existsSync(SCREENSHOT_PATH)) {
    return res.status(404).send("Sem screenshot salva.");
  }

  return res.sendFile(path.resolve(SCREENSHOT_PATH));
});

app.post("/admin/login-only", requireAdmin, async (_req, res) => {
  try {
    await executeLoginOnly();
    res.json({ ok: true, action: "login-only" });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message || "unknown_error",
    });
  }
});

app.post("/admin/run-sync", requireAdmin, (_req, res) => {
  enqueueJob({
    reason: "admin-manual-sync",
    createdAt: nowIso(),
  });

  processQueue().catch((error) => {
    console.error("Erro no processQueue:", error.message);
  });

  res.status(202).json({
    ok: true,
    accepted: true,
  });
});

app.post("/admin/test-webhook", requireAdmin, express.json(), (req, res) => {
  const body = req.body || {};

  if (body.event !== "order/paid") {
    return res.status(202).json({ ok: true, ignored: true });
  }

  const eventKey = `evt:${body.event}:${body.store_id}:${body.id}`;
  const currentState = readState();
  const processedEvents = pruneProcessedEvents(currentState.processedEvents);

  if (processedEvents[eventKey]) {
    updateState((state) => {
      state.processedEvents = processedEvents;
      return state;
    });

    return res.status(202).json({ ok: true, duplicate: true });
  }

  processedEvents[eventKey] = {
    ts: Date.now(),
    event: body.event,
    id: body.id,
    store_id: body.store_id,
  };

  updateState((state) => {
    state.processedEvents = processedEvents;
    state.queue.push({
      reason: `order/paid:${body.id}`,
      createdAt: nowIso(),
      eventKey,
    });
    state.lastEnqueuedAt = nowIso();
    state.lastWebhookAt = nowIso();
    return state;
  });

  processQueue().catch((error) => {
    console.error("Erro no processQueue:", error.message);
  });

  return res.status(202).json({ ok: true, accepted: true });
});

app.post(
  "/webhooks/nuvemshop",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const rawBody = req.body;
    const signature = req.header("x-linkedstore-hmac-sha256") || "";

    const valid = verifyNuvemshopSignature(
      rawBody,
      signature,
      process.env.NUVEMSHOP_APP_SECRET,
    );

    if (!valid) {
      return res.status(401).json({ ok: false, error: "invalid_signature" });
    }

    let body;
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return res.status(400).json({ ok: false, error: "invalid_json" });
    }

    updateState((state) => {
      state.lastWebhookAt = nowIso();
      return state;
    });

    if (body.event !== "order/paid") {
      return res.status(202).json({ ok: true, ignored: true });
    }

    const eventKey = buildEventKey(body);
    const currentState = readState();
    const processedEvents = pruneProcessedEvents(currentState.processedEvents);

    if (processedEvents[eventKey]) {
      updateState((state) => {
        state.processedEvents = processedEvents;
        return state;
      });

      return res.status(202).json({ ok: true, duplicate: true });
    }

    processedEvents[eventKey] = {
      ts: Date.now(),
      event: body.event,
      id: body.id,
      store_id: body.store_id,
    };

    updateState((state) => {
      state.processedEvents = processedEvents;
      state.queue.push({
        reason: `order/paid:${body.id}`,
        createdAt: nowIso(),
        eventKey,
      });
      state.lastEnqueuedAt = nowIso();
      return state;
    });

    processQueue().catch((error) => {
      console.error("Erro no processQueue:", error.message);
    });

    return res.status(202).json({ ok: true, accepted: true });
  },
);

app.listen(PORT, () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});
