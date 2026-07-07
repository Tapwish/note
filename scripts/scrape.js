'use strict';

const puppeteer = require('puppeteer');
const { parseCodex, flatten } = require('./parse');

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
 * нескольких тем кодекса (findCodexThreads/scrapeCodexAuto/scrapeAllServersLegalBase)
 * не поднимать браузер заново для каждой темы.
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
 * Список кодексов, которые ищем, с отдельной регуляркой на каждый —
 * так мы не только находим "кодексную" тему, но и знаем, ЧТО это за
 * кодекс (УК/АК/ПК/ДК), чтобы потом одинаково размечать статьи вне
 * зависимости от того, на каком сервере и в какой теме они найдены.
 *
 * \b не используется, т.к. в JS без /u-флага с \p{L} он не понимает
 * границы кириллических слов — вместо этого проверяем соседние символы
 * явно (пробел/скобка/начало-конец строки).
 *
 * Список можно дополнять новыми кодексами по мере надобности —
 * остальной пайплайн подхватит их автоматически.
 */
const CODEX_PATTERNS = [
  {
    type: 'УК',
    label: 'Уголовный кодекс',
    re: /(?:^|[\s\[(])УК(?:[\s\])]|$)|Уголовн\w*\s*кодекс/i,
  },
  {
    type: 'АК',
    label: 'Административный кодекс',
    re: /(?:^|[\s\[(])АК(?:[\s\])]|$)|Административн\w*\s*кодекс/i,
  },
  {
    type: 'ПК',
    label: 'Процессуальный кодекс',
    re: /(?:^|[\s\[(])ПК(?:[\s\])]|$)|Процессуальн\w*\s*кодекс/i,
  },
  {
    type: 'ДК',
    label: 'Дорожный кодекс',
    re: /(?:^|[\s\[(])ДК(?:[\s\])]|$)|Дорожн\w*\s*кодекс/i,
  },
];

/** Совпадает ли заголовок хоть с одним известным кодексом. */
function isCodexTitle(title) {
  return CODEX_PATTERNS.some((p) => p.re.test(title));
}

/** Определяет тип кодекса (УК/АК/ПК/ДК/...) по заголовку темы. */
function detectCodexType(title) {
  const found = CODEX_PATTERNS.find((p) => p.re.test(title));
  return found ? found.type : null;
}

/**
 * Ищет темы форума, похожие на кодекс (УК/АК/ПК/ДК и т.п.), начиная с
 * ЛЮБОЙ страницы форума — это может быть страница раздела, подраздела
 * или сразу страница темы. Как правило сюда передают раздел
 * "Законодательная база" конкретного сервера.
 *
 * Логика обхода:
 *  1. Если открытая страница — это уже страница темы (есть h1.p-title-value),
 *     проверяем её заголовок на соответствие CODEX_PATTERNS.
 *  2. Если это список раздела — сначала проверяем заголовки ссылок на темы
 *     (.structItem-title a), совпавшие сразу добавляем.
 *  3. Затем в пределах maxDepth рекурсивно заходим в ссылки на подразделы
 *     (.node-title a) и в остальные темы, чтобы поймать кодекс, даже если
 *     он лежит в подразделе или его нет в списке видимых по regex заголовков.
 *
 * @param {string} startUrl - любая страница форума (обычно раздел "Законодательная база")
 * @param {object} [opts]
 * @param {boolean} [opts.headless=true]
 * @param {number} [opts.maxDepth=2] - насколько глубоко идти по подразделам
 * @param {number} [opts.maxThreads=10] - не искать больше стольки тем
 * @returns {Promise<Array<{url:string, title:string, codexType:string|null}>>}
 */
async function findCodexThreads(startUrl, opts = {}) {
  const { headless = true, maxDepth = 2, maxThreads = 10 } = opts;

  const browser = await puppeteer.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const visited = new Set();
  const found = new Map(); // url -> {title, codexType}

  try {
    const page = await browser.newPage();
    await setupPage(page);
    await crawl(startUrl, 0);
    return Array.from(found.entries()).map(([url, meta]) => ({ url, ...meta }));

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
        if (isCodexTitle(threadTitle)) {
          const base = cleanUrl.replace(/\/page-\d+\/?$/, '').replace(/\/$/, '');
          found.set(base, { title: threadTitle, codexType: detectCodexType(threadTitle) });
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
        if (isCodexTitle(t.text)) {
          const base = t.href.replace(/\/page-\d+\/?$/, '').replace(/\/$/, '');
          found.set(base, { title: t.text, codexType: detectCodexType(t.text) });
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
 * @returns {Promise<Array<{url:string, title:string, codexType:string|null, posts:Array}>>}
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
        result.push({ url: t.url, title: t.title, codexType: t.codexType, posts });
      } catch (e) {
        console.error(`[scrape] не удалось обработать тему ${t.url}: ${e.message}`);
      }
    }
    return result;
  } finally {
    await browser.close();
  }
}

/**
 * Ссылки на раздел "Законодательная база" по каждому серверу Majestic.
 * Для Orlando ссылка настоящая, для остальных — заглушка (замени
 * 'PUT_LINK_HERE' на реальный ID/ссылку раздела соответствующего
 * сервера). Список можно дополнять по мере надобности.
 */
const SERVERS = {
  'New York': 'https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.PUT_LINK_HERE/',
  Detroit: 'https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.PUT_LINK_HERE/',
  Chicago: 'https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.PUT_LINK_HERE/',
  'San Francisco': 'https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.PUT_LINK_HERE/',
  Atlanta: 'https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.PUT_LINK_HERE/',
  'San Diego': 'https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.PUT_LINK_HERE/',
  'Los Angeles': 'https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.PUT_LINK_HERE/',
  Miami: 'https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.PUT_LINK_HERE/',
  'Las Vegas': 'https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.PUT_LINK_HERE/',
  Washington: 'https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.PUT_LINK_HERE/',
  Dallas: 'https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.PUT_LINK_HERE/',
  Boston: 'https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.PUT_LINK_HERE/',
  Houston: 'https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.PUT_LINK_HERE/',
  Seattle: 'https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.PUT_LINK_HERE/',
  Phoenix: 'https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.PUT_LINK_HERE/',
  Denver: 'https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.PUT_LINK_HERE/',
  Portland: 'https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.PUT_LINK_HERE/',
  Orlando: 'https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.1405/',
};

/**
 * Главный пайплайн: обходит раздел "Законодательная база" каждого сервера
 * из SERVERS (или из переданного объекта servers), находит там все темы
 * кодексов (УК/АК/ПК/ДК — см. CODEX_PATTERNS), скрапит их и парсит через
 * parseCodex/flatten из parse.js.
 *
 * Результат — одинаковая структура записей для ЛЮБОГО кодекса и сервера:
 *   {
 *     number, articleNumber, part, partLabel,
 *     tag, title, text, punishment,
 *     server, codexType, codexTitle, threadUrl
 *   }
 * Это значит, что статья ДК на Orlando и статья УК на New York после
 * парсинга выглядят абсолютно одинаково по форме (различаются только
 * содержанием и метаданными server/codexType) — независимо от того,
 * был ли в исходнике формат "ч. N" или формат с "Наказание:" сразу
 * под текстом.
 *
 * @param {object} [servers=SERVERS] - карта { имяСервера: ссылкаНаРазделЗаконки }
 * @param {object} [opts]
 * @param {boolean} [opts.headless=true]
 * @param {number} [opts.maxPages] - ограничение страниц на тему (для теста)
 * @param {number} [opts.maxDepth=1] - глубина обхода подразделов внутри раздела законки
 * @param {number} [opts.maxThreads=10] - максимум найденных тем кодекса на сервер
 * @returns {Promise<Array<{server:string, sectionUrl:string, threadUrl:string, codexType:string|null, codexTitle:string, entries:Array}>>}
 */
async function scrapeAllServersLegalBase(servers = SERVERS, opts = {}) {
  const { headless = true, maxPages, maxDepth = 1, maxThreads = 10 } = opts;

  const allResults = [];

  for (const [server, sectionUrl] of Object.entries(servers)) {
    if (!sectionUrl || sectionUrl.includes('PUT_LINK_HERE')) {
      console.error(`[scrape] пропускаю сервер "${server}" — ссылка на законку не задана`);
      continue;
    }

    console.error(`[scrape] === сервер: ${server} (${sectionUrl}) ===`);

    let threads;
    try {
      threads = await scrapeCodexAuto(sectionUrl, { headless, maxPages, maxDepth, maxThreads });
    } catch (e) {
      console.error(`[scrape] ошибка при обработке сервера "${server}": ${e.message}`);
      continue;
    }

    for (const t of threads) {
      const rawText = t.posts.map((p) => p.text).join('\n');
      const articles = parseCodex(rawText);
      const entries = flatten(articles).map((e) => ({
        ...e,
        server,
        codexType: t.codexType,
        codexTitle: t.title,
        threadUrl: t.url,
      }));

      allResults.push({
        server,
        sectionUrl,
        threadUrl: t.url,
        codexType: t.codexType,
        codexTitle: t.title,
        entries,
      });
    }
  }

  return allResults;
}

module.exports = {
  scrapeThread,
  scrapeThreadWithPage,
  findCodexThreads,
  scrapeCodexAuto,
  scrapeAllServersLegalBase,
  SERVERS,
  CODEX_PATTERNS,
  detectCodexType,
};
