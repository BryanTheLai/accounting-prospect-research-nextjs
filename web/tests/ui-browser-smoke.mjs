// Run from cua_repl with a bound fixture Tab and Browser. No live data writes.
// const { runUiSmoke } = await import('file:///.../web/tests/ui-browser-smoke.mjs');
// await runUiSmoke(qa, browser, nodeRepl.write);
export async function runUiSmoke(tab, browser, write) {
  const current = new URL(await tab.url());
  if (current.hostname !== '127.0.0.1' || current.port !== '3001') throw Error('Fixture service only');
  const routes = ['/#campaigns', '/#prospects', '/#settings', '/mailboxes', '/email-preflight', '/import', '/playbooks', '/activity', '/yc'];
  const viewport = await browser.capabilities.get('viewport');
  const results = [];
  try {
    for (const width of [375, 768, 1280]) {
      await viewport.set({ width, height: 900 });
      for (const route of routes) {
        await tab.goto(`http://127.0.0.1:3001${route}`);
        await tab.playwright.getByRole('heading', { level: 1 }).waitFor({ state: 'visible' });
        const state = await tab.playwright.evaluate(() => ({
          heading: document.querySelector('h1')?.textContent,
          actualWidth: innerWidth,
          overflow: document.documentElement.scrollWidth > innerWidth,
          unnamedButtons: [...document.querySelectorAll('button')]
            .filter(x => x.getClientRects().length && !x.textContent.trim() && !x.getAttribute('aria-label') && !x.getAttribute('aria-labelledby')).length,
          overview: [...document.querySelectorAll('nav a, nav button')].some(x => x.textContent.trim() === 'Overview'),
          navCount: document.querySelectorAll('nav[aria-label="Workspace navigation"]').length,
          navLabels: [...document.querySelectorAll('.workspace-shortcuts a:not(.workspace-brand)')].map(x => x.getAttribute('aria-label')),
          legacyNav: !!document.querySelector('.rail, .bottom-nav, .mobile-header'),
        }));
        results.push({ width, route, ...state });
        if (state.actualWidth !== width || state.overflow || state.unnamedButtons || state.overview || state.legacyNav || state.navCount !== 1 || JSON.stringify(state.navLabels) !== JSON.stringify(['Email', 'Prospects', 'Call', 'Campaigns', 'Activity', 'Settings'])) throw Error(JSON.stringify(results.at(-1)));
      }
    }
    write(results);
    write('30 responsive route checks passed');
  } finally {
    await viewport.reset();
  }
  return results;
}
