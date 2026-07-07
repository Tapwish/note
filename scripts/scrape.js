'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const puppeteer = require('puppeteer');
const { parseCodexText } = require('./parse');
const {
  BASE_URL,
  FORUM_ROOT_URL,
  LAW_SUBFORUM_PATTERNS,
  SERVERS,
  CODEX_TYPES,
  OUTPUT_DIR,
  REQUEST_DELAY_MS,
  MAX_THREAD_PAGES,
} = require('./config');

const FORCE_UPDATE = String(process.env.FORCE_UPDATE || '').toLowerCase() === 'true';
const ONLY_SERVER = process.argv.includes('--server')
  ? process.argv[process.argv.indexOf('--server') + 1]
  : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const abs = (href) => (href.startsWith('http') ? href : `${BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`);

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function hash(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

// ---------------------------------------------------------------------------
// Page helpers (XenForo 2 default markup — adjust selectors here if the
// forum's theme differs from stock XenForo).
// ---------------------------------------------------------------------------

async function findServerCategoryUrl(page, server) {
  await page.goto(FORUM_ROOT_URL, { waitUntil: 'networkidle2', timeout: 45000 });
  const links = await page.$$eval('a', (as) =>
    as.map((a) => ({ href: a.getAttribute('href') || '', text: (a.textContent || '').trim() }))
  );
  const nameRe = new RegExp(server.ru.replace(/\s+/g, '\\s*'), 'i');
  const match = links.find((l) => nameRe.test(l.text));
  return match ? abs(match.href) : null;
}

async function findLawSubforumUrl(page, categoryUrl) {
  await page.goto(categoryUrl, { waitUntil: 'networkidle2', timeout: 45000 });
  const links = await page.$$eval('a', (as) =>
    as.map((a) => ({ href: a.getAttribute('href') || '', text: (a.textContent || '').trim() }))
  );
  const match = links.find((l) => LAW_SUBFORUM_PATTERNS.some((re) => re.test(l.text) || re.test(l.href)));
  return match ? abs(match.href) : null;
}

async function resolveLawSubforumUrl(page, server) {
  if (server.forumUrl) return server.forumUrl;
  const categoryUrl = await findServerCategoryUrl(page, server);
  if (!categoryUrl) return null;
  await sleep(REQUEST_DELAY_MS);
  return findLawSubforumUrl(page, categoryUrl);
}

// Collect { title, url } for every thread in the subforum, across pages.
async function listThreads(page, subforumUrl) {
  const threads = [];
  let pageUrl = subforumUrl;
  let guard = 0;

  while (pageUrl && guard < 20) {
    guard += 1;
    await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    const pageThreads = await page.$$eval('.structItem--thread .structItem-title a', (as) =>
      as
        .filter((a) => !a.closest('.structItem-title').querySelector('.labelLink')) // skip "moved/deleted" ghost links
        .map((a) => ({ title: (a.textContent || '').trim(), href: a.getAttribute('href') || '' }))
    ).catch(() => []);

    for (const t of pageThreads) {
      if (t.href) threads.push({ title: t.title, url: abs(t.href) });
    }

    const nextHref = await page
      .$eval('.pageNav-jump--next', (a) => a.getAttribute('href'))
      .catch(() => null);
    pageUrl = nextHref ? abs(nextHref) : null;
    if (pageUrl) await sleep(REQUEST_DELAY_MS);
  }

  return threads;
}

function detectCodexType(title) {
  for (const [key, def] of Object.entries(CODEX_TYPES)) {
    if (def.pattern.test(title)) return key;
  }
  return null;
}

// Extract plain text from the first (author) post of a thread, converting
// block-level HTML into newlines so parse.js sees one "line" per element.
async function extractThreadText(page, threadUrl) {
  let combined = '';
  let pageUrl = threadUrl;
  let pages = 0;

  while (pageUrl && pages < MAX_THREAD_PAGES) {
    pages += 1;
    await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    const text = await page
      .$eval('.message-body .bbWrapper', (el) => {
        const clone = el.cloneNode(true);
        clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
        clone.querySelectorAll('p, div, li').forEach((node) => {
          node.appendChild(document.createTextNode('\n'));
        });
        return clone.textContent || '';
      })
      .catch(() => '');

    combined += `\n${text}`;

    // Only the first page of a law thread is normally needed (subsequent
    // pages are usually discussion/replies, not more articles), so stop
    // unless this looks like a continuation ("продолжение") thread.
    break;
  }

  return combined;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function scrapeServer(browser, server) {
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(45000);
  const result = { server: server.key, ok: false, codexesFound: [], error: null };

  try {
    log(`[${server.key}] resolving law subforum...`);
    const subforumUrl = await resolveLawSubforumUrl(page, server);
    if (!subforumUrl) throw new Error('law subforum not found (discovery failed)');
    log(`[${server.key}] subforum: ${subforumUrl}`);

    await sleep(REQUEST_DELAY_MS);
    const threads = await listThreads(page, subforumUrl);
    log(`[${server.key}] found ${threads.length} threads`);

    const serverDir = path.join(OUTPUT_DIR, server.key);
    fs.mkdirSync(serverDir, { recursive: true });

    for (const thread of threads) {
      const codexKey = detectCodexType(thread.title);
      if (!codexKey) continue;

      log(`[${server.key}] parsing ${codexKey}: "${thread.title}"`);
      await sleep(REQUEST_DELAY_MS);

      let articles = [];
      try {
        const rawText = await extractThreadText(page, thread.url);
        articles = parseCodexText(rawText);
      } catch (err) {
        log(`[${server.key}] WARN failed to parse ${codexKey}: ${err.message}`);
        continue; // one bad codex shouldn't stop the others
      }

      const outFile = path.join(serverDir, `${codexKey}.json`);
      const previous = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : null;

      const newData = {
        server: server.key,
        serverName: server.ru,
        codexType: codexKey,
        title: thread.title,
        sourceUrl: thread.url,
        lastUpdate: new Date().toISOString(),
        articles,
      };

      const previousBodyHash = previous ? hash(JSON.stringify(JSON.parse(previous).articles)) : null;
      const newBodyHash = hash(JSON.stringify(articles));

      if (!FORCE_UPDATE && previousBodyHash === newBodyHash) {
        log(`[${server.key}] ${codexKey}: no changes, skipping write`);
        result.codexesFound.push({ codex: codexKey, changed: false, articles: articles.length });
        continue;
      }

      fs.writeFileSync(outFile, JSON.stringify(newData, null, 2), 'utf8');
      log(`[${server.key}] ${codexKey}: wrote ${articles.length} articles`);
      result.codexesFound.push({ codex: codexKey, changed: true, articles: articles.length });
    }

    result.ok = true;
  } catch (err) {
    result.error = err.message;
    log(`[${server.key}] ERROR: ${err.message}`);
  } finally {
    await page.close().catch(() => {});
  }

  return result;
}

async function main() {
  const servers = ONLY_SERVER ? SERVERS.filter((s) => s.key === ONLY_SERVER) : SERVERS;
  if (servers.length === 0) {
    console.error(`Unknown --server value: ${ONLY_SERVER}`);
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const report = {
    runAt: new Date().toISOString(),
    forceUpdate: FORCE_UPDATE,
    servers: [],
  };

  try {
    for (const server of servers) {
      const result = await scrapeServer(browser, server);
      report.servers.push(result);
    }
  } finally {
    await browser.close();
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'report.json'), JSON.stringify(report, null, 2), 'utf8');

  const failed = report.servers.filter((s) => !s.ok);
  const changed = report.servers.some((s) => s.codexesFound.some((c) => c.changed));
  log(`Done. ${report.servers.length - failed.length}/${report.servers.length} servers OK. Changes: ${changed}`);
  if (failed.length) {
    log('Failed servers:', failed.map((s) => `${s.server} (${s.error})`).join(', '));
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
