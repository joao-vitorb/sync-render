const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");

const DEFAULT_STATE = {
  queue: [],
  isProcessing: false,
  processedEvents: {},
  lastError: null,
  lastRunAt: null,
  lastSuccessAt: null,
  lastWebhookAt: null,
  lastEnqueuedAt: null,
  lastProcessedReason: null,
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function ensureStateFile() {
  ensureDataDir();

  if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(DEFAULT_STATE, null, 2),
      "utf8",
    );
  }
}

function readState() {
  ensureStateFile();

  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);

    return {
      ...DEFAULT_STATE,
      ...parsed,
      queue: Array.isArray(parsed.queue) ? parsed.queue : [],
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function writeState(nextState) {
  ensureStateFile();
  fs.writeFileSync(STATE_FILE, JSON.stringify(nextState, null, 2), "utf8");
}

function updateState(updater) {
  const current = readState();
  const next = updater(current) || current;
  writeState(next);
  return next;
}

function pruneProcessedEvents(processedEvents) {
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  const cleaned = {};
  for (const [key, value] of Object.entries(processedEvents || {})) {
    if (value && value.ts && now - value.ts < sevenDays) {
      cleaned[key] = value;
    }
  }

  return cleaned;
}

module.exports = {
  DATA_DIR,
  STATE_FILE,
  readState,
  writeState,
  updateState,
  pruneProcessedEvents,
};
