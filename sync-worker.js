const { chromium } = require("playwright");
const {
  STORAGE_STATE_PATH,
  hasSavedStorageState,
  saveStorageState,
  saveErrorArtifacts,
  fillFirstAvailable,
  clickFirstAvailable,
  clickByText,
  tryClickByText,
  waitForAnyText,
  clickButtonInsideCard,
  clickVisibleButtonByText,
  ensureStorageStateFromEnv,
} = require("./playwright-helpers");

function isHeadlessEnabled() {
  return String(process.env.HEADLESS).toLowerCase() === "true";
}

async function createContext(browser) {
  ensureStorageStateFromEnv();

  if (hasSavedStorageState()) {
    return browser.newContext({
      storageState: STORAGE_STATE_PATH,
      viewport: { width: 1600, height: 900 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    });
  }

  return browser.newContext({
    viewport: { width: 1600, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });
}

async function isLoginScreen(page) {
  const selectors = [
    'input[type="password"]',
    'input[type="email"]',
    'input[name="email"]',
    'input[name="usuario"]',
    'input[name="login"]',
  ];

  for (const selector of selectors) {
    const count = await page.locator(selector).count();
    if (count > 0) {
      return true;
    }
  }

  return false;
}

async function doLogin(page) {
  await fillFirstAvailable(
    page,
    [
      'input[type="email"]',
      'input[name="email"]',
      'input[name="usuario"]',
      'input[name="login"]',
      "#email",
      "#usuario",
      "#login",
    ],
    process.env.GC_EMAIL,
    "campo de email/usuário",
  );

  await fillFirstAvailable(
    page,
    [
      'input[type="password"]',
      'input[name="senha"]',
      'input[name="password"]',
      "#senha",
      "#password",
    ],
    process.env.GC_PASSWORD,
    "campo de senha",
  );

  await clickFirstAvailable(
    page,
    ['button[type="submit"]', 'input[type="submit"]', "button"],
    "botão de login",
  );

  await page.waitForTimeout(5000);
}

async function ensureLoggedIn(page, context) {
  await page.goto(process.env.GESTAOCLICK_URL, {
    waitUntil: "domcontentloaded",
  });

  await page.waitForTimeout(3000);

  if (!(await isLoginScreen(page))) {
    await saveStorageState(context);
    return;
  }

  if (hasSavedStorageState()) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    if (!(await isLoginScreen(page))) {
      await saveStorageState(context);
      return;
    }
  }

  await doLogin(page);

  if (await isLoginScreen(page)) {
    throw new Error("Não consegui concluir o login no GestãoClick.");
  }

  await saveStorageState(context);
}

async function openNuvemshopModule(page) {
  await clickByText(page, ["Meus aplicativos"]);
  await page.waitForTimeout(1500);

  await tryClickByText(page, ["Ver todos os aplicativos"]);
  await page.waitForTimeout(1500);

  await clickButtonInsideCard(page, ["NuvemShop", "Nuvemshop"], ["Acessar"]);
  await page.waitForTimeout(3000);

  await tryClickByText(page, ["Acessar aplicativo"]);
  await page.waitForTimeout(2500);

  await waitForAnyText(page, ["Produtos", "Pedidos", "Sincronizar"], 20000);
}

async function runProductSync(page) {
  await waitForAnyText(page, ["Produtos"], 20000);
  await clickByText(page, ["Produtos"], { timeout: 10000 });
  await page.waitForTimeout(2000);

  await waitForAnyText(page, ["Sincronizar"], 15000);
  await clickVisibleButtonByText(page, ["Sincronizar"], { timeout: 10000 });
  await page.waitForTimeout(2000);

  await waitForAnyText(
    page,
    ["Sincronizar produtos", "Cancelar", "Sincronizar"],
    15000,
  );
  await clickVisibleButtonByText(page, ["Sincronizar"], { timeout: 10000 });
  await page.waitForTimeout(Number(process.env.POST_SYNC_WAIT_MS || 12000));
}

async function executeLoginOnly() {
  const browser = await chromium.launch({
    headless: isHeadlessEnabled(),
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await createContext(browser);
  const page = await context.newPage();

  try {
    await ensureLoggedIn(page, context);
    await saveStorageState(context);
    return { ok: true };
  } catch (error) {
    const meta = await saveErrorArtifacts(page, {
      phase: "executeLoginOnly",
      message: error.message || "unknown_error",
    }).catch(() => null);

    if (meta) {
      error.debugMeta = meta;
    }

    throw error;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function executeSync(reason = "manual") {
  const browser = await chromium.launch({
    headless: isHeadlessEnabled(),
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await createContext(browser);
  const page = await context.newPage();

  try {
    await ensureLoggedIn(page, context);
    await openNuvemshopModule(page);
    await runProductSync(page);
    await saveStorageState(context);

    return {
      ok: true,
      reason,
    };
  } catch (error) {
    const meta = await saveErrorArtifacts(page, {
      phase: "executeSync",
      reason,
      message: error.message || "unknown_error",
    }).catch(() => null);

    if (meta) {
      error.debugMeta = meta;
    }

    throw error;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

module.exports = {
  executeLoginOnly,
  executeSync,
};
