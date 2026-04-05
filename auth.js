require("dotenv").config();

const readline = require("readline");
const { chromium } = require("playwright");
const { saveStorageState } = require("./playwright-helpers");

function waitEnter() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      "Depois de fazer login no GestãoClick e ver a tela inicial, pressione ENTER aqui: ",
      () => {
        rl.close();
        resolve();
      },
    );
  });
}

(async () => {
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
  });

  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
  });

  const page = await context.newPage();
  await page.goto(process.env.GESTAOCLICK_URL, {
    waitUntil: "domcontentloaded",
  });

  console.log("Faça login manualmente no navegador aberto.");
  await waitEnter();

  await saveStorageState(context);
  console.log("Sessão salva com sucesso em data/storage-state.json");

  await context.close();
  await browser.close();
})();
