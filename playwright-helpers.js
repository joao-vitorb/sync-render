const path = require("path");
const fs = require("fs");

const STORAGE_STATE_PATH = path.join(__dirname, "data", "storage-state.json");
const SCREENSHOT_PATH = path.join(__dirname, "data", "last-screenshot.png");
const HTML_DUMP_PATH = path.join(__dirname, "data", "last-page.html");
const META_PATH = path.join(__dirname, "data", "last-meta.json");

function ensureDataDir() {
  const dir = path.join(__dirname, "data");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function saveStorageState(context) {
  ensureDataDir();
  await context.storageState({ path: STORAGE_STATE_PATH });
}

function hasSavedStorageState() {
  return fs.existsSync(STORAGE_STATE_PATH);
}

async function saveErrorArtifacts(page, extra = {}) {
  ensureDataDir();

  const meta = {
    at: new Date().toISOString(),
    url: null,
    title: null,
    screenshotSaved: false,
    htmlSaved: false,
    ...extra,
  };

  try {
    meta.url = page.url();
  } catch {}

  try {
    meta.title = await page.title();
  } catch {}

  try {
    await page.screenshot({
      path: SCREENSHOT_PATH,
      fullPage: true,
    });
    meta.screenshotSaved = true;
  } catch (error) {
    meta.screenshotError = error.message;
  }

  try {
    const html = await page.content();
    fs.writeFileSync(HTML_DUMP_PATH, html, "utf8");
    meta.htmlSaved = true;
  } catch (error) {
    meta.htmlError = error.message;
  }

  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2), "utf8");
  return meta;
}

async function fillFirstAvailable(page, selectors, value, description) {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();

    if (count > 0) {
      await locator.first().fill(value);
      return;
    }
  }

  throw new Error(`Não encontrei ${description}`);
}

async function clickFirstAvailable(page, selectors, description) {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();

    if (count > 0) {
      await locator.first().click();
      return;
    }
  }

  throw new Error(`Não encontrei ${description}`);
}

async function clickByText(page, texts, options = {}) {
  const timeout = options.timeout ?? 10000;

  for (const text of texts) {
    const exact = page.getByText(text, { exact: true });
    const exactCount = await exact.count();

    for (let i = 0; i < exactCount; i++) {
      const item = exact.nth(i);
      const visible = await item.isVisible().catch(() => false);

      if (visible) {
        await item.scrollIntoViewIfNeeded().catch(() => {});
        await item.click({ timeout, force: true });
        return;
      }
    }

    const partial = page.getByText(text);
    const partialCount = await partial.count();

    for (let i = 0; i < partialCount; i++) {
      const item = partial.nth(i);
      const visible = await item.isVisible().catch(() => false);

      if (visible) {
        await item.scrollIntoViewIfNeeded().catch(() => {});
        await item.click({ timeout, force: true });
        return;
      }
    }
  }

  throw new Error(`Não encontrei texto visível/clicável: ${texts.join(" / ")}`);
}

async function tryClickByText(page, texts, options = {}) {
  try {
    await clickByText(page, texts, options);
    return true;
  } catch {
    return false;
  }
}

async function waitForAnyText(page, texts, timeout = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    for (const text of texts) {
      const exact = page.getByText(text, { exact: true });
      const exactCount = await exact.count();

      for (let i = 0; i < exactCount; i++) {
        const item = exact.nth(i);
        if (await item.isVisible().catch(() => false)) {
          return text;
        }
      }

      const partial = page.getByText(text);
      const partialCount = await partial.count();

      for (let i = 0; i < partialCount; i++) {
        const item = partial.nth(i);
        if (await item.isVisible().catch(() => false)) {
          return text;
        }
      }
    }

    await page.waitForTimeout(500);
  }

  throw new Error(
    `Nenhum destes textos apareceu a tempo: ${texts.join(" / ")}`,
  );
}

async function clickButtonInsideCard(page, cardTexts, buttonTexts) {
  const clicked = await page.evaluate(
    ({ cardTexts, buttonTexts }) => {
      function isVisible(el) {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();

        return (
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          rect.width > 0 &&
          rect.height > 0
        );
      }

      const possibleCards = Array.from(
        document.querySelectorAll("div, article, section, li"),
      );

      for (const rawCardText of cardTexts) {
        const cardText = String(rawCardText).trim().toLowerCase();

        const card = possibleCards.find((el) => {
          const text = (el.textContent || "").trim().toLowerCase();
          return text.includes(cardText) && isVisible(el);
        });

        if (!card) {
          continue;
        }

        const buttonCandidates = Array.from(
          card.querySelectorAll("button, a, [role='button']"),
        );

        for (const rawButtonText of buttonTexts) {
          const buttonText = String(rawButtonText).trim().toLowerCase();

          const button = buttonCandidates.find((el) => {
            const text = (el.textContent || "").trim().toLowerCase();
            return text.includes(buttonText) && isVisible(el);
          });

          if (button) {
            button.scrollIntoView({ block: "center", inline: "center" });
            button.click();
            return true;
          }
        }
      }

      return false;
    },
    { cardTexts, buttonTexts },
  );

  if (!clicked) {
    throw new Error(
      `Não encontrei botão ${buttonTexts.join(" / ")} dentro do card ${cardTexts.join(" / ")}`,
    );
  }
}

async function clickVisibleButtonByText(page, texts, options = {}) {
  const timeout = options.timeout ?? 10000;
  const selector = "button, a, [role='button'], input[type='submit']";

  for (const text of texts) {
    const locator = page.locator(selector).filter({ hasText: text });
    const count = await locator.count();

    for (let i = 0; i < count; i++) {
      const item = locator.nth(i);
      const visible = await item.isVisible().catch(() => false);

      if (visible) {
        await item.scrollIntoViewIfNeeded().catch(() => {});
        await item.click({ timeout, force: true });
        return;
      }
    }
  }

  throw new Error(`Não encontrei botão visível: ${texts.join(" / ")}`);
}

module.exports = {
  STORAGE_STATE_PATH,
  SCREENSHOT_PATH,
  HTML_DUMP_PATH,
  META_PATH,
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
};
