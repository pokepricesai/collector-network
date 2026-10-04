import { chromium } from 'playwright';
const PAGES = {
  home: 'https://ygoprices.io/',
  set: 'https://ygoprices.io/set/lob',
  card: 'https://ygoprices.io/card/blue-eyes-white-dragon',
};
const browser = await chromium.launch();
try {
  for (const [label, url] of Object.entries(PAGES)) {
    console.log(`\n=== ${label}: ${url} ===`);
    for (const width of [320, 375, 390, 430]) {
      const ctx = await browser.newContext({ viewport: { width, height: 800 } });
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);
      const r = await page.evaluate((vp) => ({
        iw: window.innerWidth,
        dsw: document.documentElement.scrollWidth,
        delta: document.documentElement.scrollWidth - vp,
      }), width);
      await ctx.close();
      console.log(`  ${width} → scrollWidth ${r.dsw} vs ${r.iw} (delta ${r.delta})`);
    }
  }
} finally { await browser.close(); }
