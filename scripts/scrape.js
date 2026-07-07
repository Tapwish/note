'use strict';

const puppeteer = require('puppeteer');

/**
 * Скрапит тему форума XenForo (Majestic RP) и возвращает массив постов:
 *   [{ page: 1, postId: 'post-12345', author: 'Nick', text: '...' }, ...]
 *
 * Особенности XenForo, которые учитываются:
 *  - контент поста лежит в article.message .message-body .bbWrapper
 *  - внутри может быть цитата (blockquote.bbCodeBlock--quote / .quoteContainer) —
 *    её мы вырезаем перед извлечением текста, чтобы не дублировать статьи,
 *    процитированные в чужом посте
 *  - спойлеры (.bbCodeSpoiler) обычно тоже статьи кодекса — их НЕ вырезаем,
 *    но раскрываем клики не требуются: innerText спойлера доступен в DOM и без клика
 *  - пагинация: ссылка последней страницы в .pageNav-main .pageNav-page:last-child a
 *
 * @param {string} threadUrl
 * @param {object} [opts]
 * @param {boolean} [opts.headless=true]
 * @param {number} [opts.maxPages] - ограничить число страниц (для теста)
 * @returns {Promise<Array<{page:number, postId:string, author:string, text:string}>>}
 */
async function scrapeThread(threadUrl, opts = {}) {
  const { headless = true, maxPages } = opts;

  const browser = await puppeteer.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await setupPage(page);
    return await scrapeThreadWithPage(page, threadUrl, { maxPages });
  } finally {
    await browser.close();
  }
}

/** Общая настройка страницы (user-agent и т.п.), чтобы не дублировать код. */
async function setupPage(page) {
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );
}

/**
 * То же самое, что и scrapeThread(), но работает на уже открытой
 * (переданной снаружи) странице puppeteer. Нужно, чтобы при автопоиске
 * нескольких тем кодекса (findCodexThreads/scrapeCodexAuto) не поднимать
 * браузер заново для каждой темы.
 */
async function scrapeThreadWithPage(page, threadUrl, opts = {}) {
  const { maxPages } = opts;

  await page.goto(threadUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('article.message', { timeout: 30000 });

  const lastPage = await getLastPageNumber(page);
  const totalPages = maxPages ? Math.min(lastPage, maxPages) : lastPage;

  const allPosts = [];
  const baseUrl = threadUrl.replace(/\/page-\d+\/?$/, '').replace(/\/$/, '');

  for (let p = 1; p <= totalPages; p++) {
    const url = p === 1 ? `${baseUrl}/` : `${baseUrl}/page-${p}`;
    if (p > 1) {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForSelector('article.message', { timeout: 30000 });
    }

    const posts = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('article.message').forEach((msg) => {
        const body = msg.querySelector('.message-body .bbWrapper');
        if (!body) return;

        // клонируем, чтобы не портить реальный DOM, и вырезаем цитаты
        const clone = body.cloneNode(true);
        clone
          .querySelectorAll('blockquote, .bbCodeBlock--quote, .quoteContainer')
          .forEach((q) => q.remove());

        const text = clone.innerText.trim();
        if (!text) return;

        const author =
          msg.getAttribute('data-author') ||
          msg.querySelector('.message-name')?.innerText?.trim() ||
          'unknown';
        const postId = msg.id || '';

        results.push({ postId, author, text });
      });
      return results;
    });

    posts.forEach((post) => allPosts.push({ page: p, ...post }));
    console.error(
      `[scrape] ${threadUrl} — страница ${p}/${totalPages}: ${posts.length} постов`
    );
  }

  return allPosts;
}

async function getLastPageNumber(page) {
  const last = await page.evaluate(() => {
    const nav = document.querySelector('.pageNav-main');
    if (!nav) return 1;
    const items = Array.from(nav.querySelectorAll('.pageNav-page'));
    if (items.length === 0) return 1;
    const nums = items
      .map((li) => parseInt(li.textContent.trim(), 10))
      .filter((n) => !Number.isNaN(n));
    return nums.length ? Math.max(...nums) : 1;
  });
  return last || 1;
}

/**
 * Регулярка для распознавания "кодексных" тем по заголовку/тексту ссылки:
 * УК / АК / ПК / ДК как отдельные аббревиатуры (в скобках, квадратных
 * скобках или просто отдельным словом), плюс полные названия
 * ("Уголовный кодекс" и т.п.).
 *
 * \b не используется, т.к. в JS без /u-флага с \p{L} он не понимает
 * границы кириллических слов — вместо этого проверяем соседние символы
 * явно (пробел/скобка/начало-конец строки).
 */
const CODEX_TITLE_RE =
  /(?:^|[\s\[(])(УК|АК|ПК|ДК)(?:[\s\])]|$)|Уголовн\w*\s*кодекс|Административн\w*\s*кодекс|Дорожн\w*\s*кодекс|Процессуальн\w*\s*кодекс/i;

/**
 * Ищет темы форума, похожие на кодекс (УК/АК/ПК/ДК и т.п.), начиная с
 * ЛЮБОЙ страницы форума — это может быть страница раздела, подраздела
 * или сразу страница темы.
 *
 * Логика обхода:
 *  1. Если открытая страница — это уже страница темы (есть h1.p-title-value),
 *     проверяем её заголовок на соответствие CODEX_TITLE_RE.
 *  2. Если это список раздела — сначала проверяем заголовки ссылок на темы
 *     (.structItem-title a), совпавшие сразу добавляем.
 *  3. Затем в пределах maxDepth рекурсивно заходим в ссылки на подразделы
 *     (.node-title a) и в остальные темы, чтобы поймать кодекс, даже если
 *     он лежит в подразделе или его нет в списке видимых по regex заголовков.
 *
 * @param {string} startUrl - любая страница форума
 * @param {object} [opts]
 * @param {boolean} [opts.headless=true]
 * @param {number} [opts.maxDepth=2] - насколько глубоко идти по подразделам
 * @param {number} [opts.maxThreads=10] - не искать больше стольки тем
 * @returns {Promise<Array<{url:string, title:string}>>}
 */
async function findCodexThreads(startUrl, opts = {}) {
  const { headless = true, maxDepth = 2, maxThreads = 10 } = opts;

  const browser = await puppeteer.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const visited = new Set();
  const found = new Map(); // url -> title

  try {
    const page = await browser.newPage();
    await setupPage(page);
    await crawl(startUrl, 0);
    return Array.from(found.entries()).map(([url, title]) => ({ url, title }));

    async function crawl(url, depth) {
      if (found.size >= maxThreads) return;

      const cleanUrl = url.split('#')[0];
      if (visited.has(cleanUrl)) return;
      visited.add(cleanUrl);

      try {
        await page.goto(cleanUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      } catch (e) {
        console.error(`[scrape] не удалось открыть ${cleanUrl}: ${e.message}`);
        return;
      }

      // если это страница темы — сразу проверяем её заголовок
      const threadTitle = await page.evaluate(() => {
        const el = document.querySelector('h1.p-title-value');
        return el ? el.innerText.trim() : null;
      });

      if (threadTitle) {
        if (CODEX_TITLE_RE.test(threadTitle)) {
          const base = cleanUrl.replace(/\/page-\d+\/?$/, '').replace(/\/$/, '');
          found.set(base, threadTitle);
          console.error(`[scrape] найдена тема кодекса: "${threadTitle}" — ${base}`);
        }
        return; // дальше со страницы темы вглубь не идём
      }

      if (depth >= maxDepth) return;

      // собираем ссылки на подразделы и на темы
      const links = await page.evaluate(() => {
        const collect = (selector) =>
          Array.from(document.querySelectorAll(selector))
            .map((a) => ({ href: a.href, text: a.innerText.trim() }))
            .filter((l) => l.href);
        return {
          forums: collect('.node--forum .node-title a'),
          threads: collect('.structItem--thread .structItem-title a'),
        };
      });

      // темы, у которых уже в тексте ссылки виден кодекс — добавляем сразу,
      // без захода внутрь (экономим запросы)
      for (const t of links.threads) {
        if (found.size >= maxThreads) break;
        if (CODEX_TITLE_RE.test(t.text)) {
          const base = t.href.replace(/\/page-\d+\/?$/, '').replace(/\/$/, '');
          found.set(base, t.text);
          console.error(`[scrape] найдена тема кодекса: "${t.text}" — ${base}`);
        }
      }

      // остальное (подразделы + темы, не совпавшие по заголовку ссылки)
      // обходим вглубь, вдруг кодекс лежит внутри подраздела
      const toVisit = [...links.forums, ...links.threads]
        .map((l) => l.href)
        .filter((href, i, arr) => arr.indexOf(href) === i && !visited.has(href.split('#')[0]));

      for (const href of toVisit) {
        if (found.size >= maxThreads) break;
        await crawl(href, depth + 1);
      }
    }
  } finally {
    await browser.close();
  }
}

/**
 * Полный автоматический пайплайн: начиная с ЛЮБОЙ страницы форума находит
 * темы с кодексом (УК/АК/ПК/ДК) и скрапит каждую из них.
 *
 * @param {string} startUrl - любая страница форума (раздел, подраздел, тема)
 * @param {object} [opts]
 * @param {boolean} [opts.headless=true]
 * @param {number} [opts.maxPages] - ограничение страниц на тему (для теста)
 * @param {number} [opts.maxDepth=2] - глубина обхода подразделов при поиске
 * @param {number} [opts.maxThreads=10] - максимум найденных тем кодекса
 * @returns {Promise<Array<{url:string, title:string, posts:Array}>>}
 */
async function scrapeCodexAuto(startUrl, opts = {}) {
  const { headless = true, maxPages, maxDepth = 2, maxThreads = 10 } = opts;

  const threads = await findCodexThreads(startUrl, { headless, maxDepth, maxThreads });

  if (threads.length === 0) {
    console.error(`[scrape] ни одной темы с кодексом не найдено начиная с ${startUrl}`);
    return [];
  }
  console.error(`[scrape] всего найдено тем с кодексом: ${threads.length}`);

  const browser = await puppeteer.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await setupPage(page);

    const result = [];
    for (const t of threads) {
      try {
        const posts = await scrapeThreadWithPage(page, t.url, { maxPages });
        result.push({ url: t.url, title: t.title, posts });
      } catch (e) {
        console.error(`[scrape] не удалось обработать тему ${t.url}: ${e.message}`);
      }
    }
    return result;
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeThread, findCodexThreads, scrapeCodexAuto };
