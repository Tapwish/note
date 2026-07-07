const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs');

// ============================================================
// 1. ЗАГРУЗКА HTML С ФОРУМА (только Orlando)
// ============================================================

async function fetchForumHtml(url) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  console.log(`📥 Загрузка: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

  await page.waitForSelector('.message-content', { timeout: 10000 });

  const html = await page.evaluate(() => {
    const messages = document.querySelectorAll('.message-content');
    return Array.from(messages)
      .map(msg => msg.innerHTML || '')
      .join('\n');
  });

  await browser.close();
  return html;
}

// ============================================================
// 2. ПАРСИНГ HTML В СТАТЬИ
// ============================================================

function parseHtmlToArticles(html) {
  const $ = cheerio.load(html);
  
  const articles = [];
  let current = null;
  let parts = [];
  let buffer = [];

  $('body *').each((i, el) => {
    const text = $(el).text().trim();
    if (!text) return;

    const articleMatch = text.match(/^Статья\s+(\d+(?:\.\d+)?)\s*(.*)$/i);
    if (articleMatch) {
      if (current) {
        if (buffer.length > 0 && parts.length === 0) {
          parts.push({ part: 1, text: buffer.join(' ') });
        }
        current.parts = parts;
        articles.push(current);
        parts = [];
        buffer = [];
      }

      current = {
        number: articleMatch[1],
        title: articleMatch[2] || 'Без названия',
        parts: []
      };
      return;
    }

    if (!current) return;

    const partMatch = text.match(/^ч\.?\s*(\d+)\s*[.)]?\s*/i);
    if (partMatch) {
      if (parts.length > 0 && buffer.length > 0) {
        parts[parts.length - 1].text = buffer.join(' ');
        buffer = [];
      }
      parts.push({
        part: parseInt(partMatch[1]),
        text: text.replace(partMatch[0], '').trim()
      });
      return;
    }

    buffer.push(text);
  });

  if (current) {
    if (buffer.length > 0 && parts.length === 0) {
      parts.push({ part: 1, text: buffer.join(' ') });
    }
    if (parts.length > 0 && buffer.length > 0) {
      parts[parts.length - 1].text += ' ' + buffer.join(' ');
    }
    current.parts = parts;
    articles.push(current);
  }

  return articles;
}

// ============================================================
// 3. ЗАПУСК ДЛЯ ORLANDO
// ============================================================

async function main() {
  const urls = {
    uk: 'https://forum.majestic-rp.ru/threads/ugolovnyi-kodeks-shtata-san-andreas.3232577/',
    pk: 'https://forum.majestic-rp.ru/threads/protsessual-nyi-kodeks-shtata-san-andreas.3232571/',
    ak: 'https://forum.majestic-rp.ru/threads/administrativnyi-kodeks-shtata-san-andreas.3232568/',
    dk: 'https://forum.majestic-rp.ru/threads/dorozhnyi-kodeks-shtata-san-andreas.3232575/'
  };

  const titles = {
    uk: 'Уголовный кодекс штата San-Andreas',
    pk: 'Процессуальный кодекс штата San-Andreas',
    ak: 'Административный кодекс штата San-Andreas',
    dk: 'Дорожный кодекс штата San-Andreas'
  };

  for (const [type, url] of Object.entries(urls)) {
    try {
      console.log(`\n📌 ${type.toUpperCase()} — загрузка...`);
      const html = await fetchForumHtml(url);
      const articles = parseHtmlToArticles(html);
      
      const result = {
        server: 'orlando',
        serverName: 'Orlando',
        codexType: type,
        title: titles[type],
        url: url,
        lastUpdate: new Date().toISOString(),
        articles: articles,
        totalArticles: articles.length
      };

      fs.writeFileSync(`${type}.json`, JSON.stringify(result, null, 2));
      console.log(`✅ ${type}.json — ${articles.length} статей`);
    } catch (e) {
      console.error(`❌ ${type}: ${e.message}`);
    }
  }

  console.log('\n✅ Готово!');
}

main().catch(console.error);
