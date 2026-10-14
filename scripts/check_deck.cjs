#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
function parse(argv) {
  const options = {};
  const allowed = new Set(['input', 'output', 'playwright-module', 'browser-executable']);
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--') || !allowed.has(name) || !argv[i + 1] || argv[i + 1].startsWith('--') || name in options) throw new Error(`Invalid argument ${argv[i]}`);
    options[name] = argv[i + 1];
  }
  if (!options.input || !options.output) throw new Error('Required: --input FILE --output PRIVATE_DIRECTORY');
  return options;
}
async function main() {
  const options = parse(process.argv.slice(2));
  const input = path.resolve(options.input), output = path.resolve(options.output);
  await fs.access(input);
  const { chromium } = require(options['playwright-module'] || 'playwright');
  const settings = { headless: true };
  if (options['browser-executable']) settings.executablePath = options['browser-executable'];
  let browser;
  const failures = [], reports = [], external = [], runtime = [];
  try {
    browser = await chromium.launch(settings);
    const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
    page.on('pageerror', error => runtime.push(error.message));
    await page.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
    await page.goto(pathToFileURL(input).href);
    await page.evaluate(() => document.fonts.ready);
    const count = await page.locator('.slide').count();
    if (!count) throw new Error('No slides');
    await fs.mkdir(output, { recursive: true });
    const inspectSlide = slide => {
          const bounds = slide.getBoundingClientRect(), issues = [];
          const scale = bounds.width / 1600, eps = Math.max(.7, scale);
          const outside = (a, b) => a.left < b.left - eps || a.right > b.right + eps || a.top < b.top - eps || a.bottom > b.bottom + eps;
          if (Math.abs(bounds.width / bounds.height - 16 / 9) > .005) issues.push('Invalid aspect ratio');
          if (bounds.left < -eps || bounds.right > innerWidth + eps || bounds.top < -eps || bounds.bottom > innerHeight - (document.fullscreenElement ? 0 : 60) + eps) issues.push('Canvas outside viewport');
          for (const node of slide.querySelectorAll('*')) {
            if (!node.getClientRects().length) continue;
            const rect = node.getBoundingClientRect();
            if (outside(rect, bounds)) issues.push(`Outside canvas ${node.tagName}.${node.className}`);
            if (node instanceof HTMLElement && getComputedStyle(node).display !== 'inline' && (node.scrollWidth > node.clientWidth + 2 || (node.children.length > 0 && !/^H[1-6]$/.test(node.tagName) && node.scrollHeight > node.clientHeight + 2))) issues.push(`Element overflow ${node.tagName}.${node.className}`);
            for (const child of node.childNodes) {
              if (child.nodeType !== Node.TEXT_NODE || !child.textContent.trim()) continue;
              const range = document.createRange(); range.selectNodeContents(child);
              // Font glyph boxes can extend vertically beyond a short CSS line box. Check horizontal fit and the containing layout region instead.
              const container = node.closest('.step,.flow-box,.loop-node,.evidence article,.cover-body,.closing,.heading,.take,.footer') || slide;
              const box = container.getBoundingClientRect();
              const verticalInkAllowance = getComputedStyle(container).overflow === 'visible' ? parseFloat(getComputedStyle(node).fontSize) * scale * .2 : 0;
              for (const textRect of range.getClientRects()) if (textRect.left < rect.left - eps || textRect.right > rect.right + eps || textRect.top < box.top - eps - verticalInkAllowance || textRect.bottom > box.bottom + eps + verticalInkAllowance) issues.push(`Text outside region ${child.textContent.trim().slice(0, 24)}`);
            }
          }
          const regions = [...slide.children].filter(node => !node.classList.contains('edition'));
          for (let a = 0; a < regions.length; a++) for (let b = a + 1; b < regions.length; b++) {
            const first = regions[a].getBoundingClientRect(), second = regions[b].getBoundingClientRect();
            if (Math.min(first.right, second.right) - Math.max(first.left, second.left) > eps && Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > eps) issues.push(`Region overlap ${regions[a].className} / ${regions[b].className}`);
          }
          for (const graphic of slide.querySelectorAll('svg')) {
            const labels = [...graphic.querySelectorAll('text')];
            for (const label of labels) if (outside(label.getBoundingClientRect(), graphic.getBoundingClientRect())) issues.push(`SVG label overflow: ${label.textContent}`);
            for (let a = 0; a < labels.length; a++) for (let b = a + 1; b < labels.length; b++) {
              const first = labels[a].getBoundingClientRect(), second = labels[b].getBoundingClientRect();
              if (Math.min(first.right, second.right) - Math.max(first.left, second.left) > eps && Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > eps) issues.push(`SVG text overlap: ${labels[a].textContent} / ${labels[b].textContent}`);
            }
            for (const node of graphic.querySelectorAll('[data-node]')) {
              const shape = node.querySelector('rect,circle,ellipse');
              if (!shape) continue;
              for (const label of node.querySelectorAll('text')) if (outside(label.getBoundingClientRect(), shape.getBoundingClientRect())) issues.push(`SVG text outside node: ${label.textContent}`);
            }
          }
          if (!slide.dataset.layout || !slide.getAttribute('aria-label')) issues.push('Missing layout or page title');
          return { title: slide.getAttribute('aria-label'), layout: slide.dataset.layout, issues: [...new Set(issues)] };
        };
    for (const viewport of [{ width: 1600, height: 960 }, { width: 1280, height: 800 }, { width: 900, height: 430 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.waitForFunction(() => Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scale')) - Math.min(innerWidth / 1600, Math.max(100, innerHeight - 60) / 900)) < .0001);
      await page.keyboard.press('Home');
      for (let i = 0; i < count; i++) {
        if (i) await page.keyboard.press('ArrowRight');
        const report = await page.locator('.slide.active').evaluate(inspectSlide);
        reports.push({ viewport, slide: i + 1, ...report });
        if (report.issues.length) failures.push(`${viewport.width} slide ${i + 1}: ${report.issues.join('; ')}`);
        if (viewport.width === 1600) await page.locator('.slide.active').screenshot({ path: path.join(output, `slide_${String(i + 1).padStart(2, '0')}.png`) });
      }
    }
    await page.setViewportSize({ width: 1600, height: 960 });
    const expectIndex = async (index, action) => {
      const actual = await page.locator('.slide').evaluateAll(slides => slides.findIndex(s => s.classList.contains('active')));
      if (actual !== index) failures.push(`${action}: expected ${index}, got ${actual}`);
    };
    await page.keyboard.press('Home'); await expectIndex(0, 'Home');
    await page.keyboard.press('End'); await expectIndex(count - 1, 'End');
    await page.keyboard.press('ArrowRight'); await expectIndex(count - 1, 'Last-page clamp');
    await page.keyboard.press('Home');
    if (count > 1) { await page.locator('#next').click(); await expectIndex(1, 'Next button'); await page.locator('#prev').click(); await expectIndex(0, 'Previous button'); }
    await page.keyboard.press('Escape');
    if (await page.locator('#overview').evaluate(d => d.open)) failures.push('Escape unexpectedly opened directory');
    await page.locator('#index').click();
    if (!await page.locator('#overview').evaluate(d => d.open)) failures.push('Directory button did not open');
    await page.locator('#index-list button').last().click(); await expectIndex(count - 1, 'Directory jump');
    if (await page.locator('#overview').evaluate(d => d.open)) failures.push('Directory did not close');
    await page.locator('#index').click(); await page.keyboard.press('Escape');
    if (await page.locator('#overview').evaluate(d => d.open)) failures.push('Escape did not close directory');
    await page.keyboard.press('Home');
    if (count > 1) { await page.mouse.wheel(0, 150); await page.waitForTimeout(100); await expectIndex(1, 'Wheel'); }
    const notesButton = page.locator('#notes');
    if (await notesButton.count()) {
      await page.keyboard.press('Home');
      for (let i = 0; i < count; i++) {
        if (i) await page.keyboard.press('ArrowRight');
        await page.keyboard.press('n');
        const open = await page.locator('#speaker-dialog').evaluate(d => d.open);
        const title = await page.locator('#speaker-title').innerText();
        const body = await page.locator('#speaker-copy').innerText();
        const pageTitle = await page.locator('.slide.active').getAttribute('aria-label');
        if (!open || !title.startsWith(`${i + 1} / ${count}`) || !title.includes(pageTitle) || !body.trim()) failures.push(`Notes mismatch on page ${i + 1}`);
        await page.keyboard.press('Escape');
        if (await page.locator('#speaker-dialog').evaluate(d => d.open) || await page.locator('#overview').evaluate(d => d.open)) failures.push(`Notes close interferes with dialogs on page ${i + 1}`);
      }
    }
    await page.locator('#fullscreen').click();
    await page.waitForFunction(() => Boolean(document.fullscreenElement));
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#controls')).display === 'none' && Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scale')) - Math.min(innerWidth / 1600, Math.max(100, innerHeight) / 900)) < .0001);
    if (!await page.locator('#controls').evaluate(node => node.inert)) failures.push('Fullscreen controls remain focusable');
    await page.keyboard.press('f');
    if (!await page.evaluate(() => Boolean(document.fullscreenElement))) failures.push('F exited fullscreen');
    await page.keyboard.press('Home');
    for (let i = 0; i < count; i++) {
      if (i) await page.keyboard.press('ArrowRight');
      const report = await page.locator('.slide.active').evaluate(inspectSlide);
      reports.push({ viewport: page.viewportSize(), fullscreen: true, slide: i + 1, ...report });
      if (report.issues.length) failures.push(`Fullscreen slide ${i + 1}: ${report.issues.join('; ')}`);
    }
    await expectIndex(count - 1, 'Fullscreen navigation');
    await page.screenshot({ path: path.join(output, 'fullscreen_window.png') });
    if (await notesButton.count()) {
      await page.keyboard.press('n');
      if (!await page.locator('#speaker-dialog').evaluate(dialog => dialog.open)) failures.push('Fullscreen notes did not open');
    }
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.fullscreenElement && getComputedStyle(document.querySelector('#controls')).display === 'flex' && Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scale')) - Math.min(innerWidth / 1600, Math.max(100, innerHeight - 60) / 900)) < .0001);
    if (await page.locator('dialog').evaluateAll(dialogs => dialogs.some(dialog => dialog.open))) failures.push('Escape left a dialog open after fullscreen');
    if (await page.locator('#controls').evaluate(node => node.inert)) failures.push('Restored controls remain inert');
    await expectIndex(count - 1, 'Fullscreen exit keeps current page');
    await page.keyboard.press('f');
    await page.waitForFunction(() => Boolean(document.fullscreenElement));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.fullscreenElement);
    await page.emulateMedia({ media: 'print' });
    const printStates = await page.locator('.slide').evaluateAll(slides => slides.map(slide => ({ visibility: getComputedStyle(slide).visibility, position: getComputedStyle(slide).position })));
    if (printStates.some(s => s.visibility !== 'visible' || s.position !== 'relative')) failures.push('Print styles hide slides');
    await page.pdf({ path: path.join(output, 'print_check.pdf'), printBackground: true, preferCSSPageSize: true });
    if (runtime.length) failures.push(...runtime.map(e => `Runtime: ${e}`));
    if (external.length) failures.push(`External dependencies: ${[...new Set(external)].join(', ')}`);
    const result = { slides: count, reports, failures, external, runtime };
    await fs.writeFile(path.join(output, 'checks.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ slides: count, viewports: 4, fullscreen: "button, F, Escape, scale and menu verified", failures, output }, null, 2));
    if (failures.length) throw new Error('Deck checks failed; inspect checks.json and screenshots');
  } finally { if (browser) await browser.close(); }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
