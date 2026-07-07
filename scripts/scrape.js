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
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

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
      console.error(`[scrape] страница ${p}/${totalPages}: ${posts.length} постов`);
    }

    return allPosts;
  } finally {
    await browser.close();
  }
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

module.exports = { scrapeThread };
