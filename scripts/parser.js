const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs');

// ============================================================
// 1. ЗАГРУЗКА HTML
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
// 2. ПАРСИНГ HTML → СТАТЬИ
// ============================================================

function parseHtmlToArticles(html) {
  const $ = cheerio.load(html);
  
  const articles = [];
  let current = null;
  let parts = [];
  let buffer = [];
  let currentPartNum = 0;

  $('body *').each((i, el) => {
    const text = $(el).text().trim();
    if (!text) return;

    const articleMatch = text.match(/^Статья\s+(\d+(?:\.\d+)?)\s*(.*)$/i);
    if (articleMatch) {
      if (current) {
        finishArticle();
      }

      current = {
        number: articleMatch[1],
        title: articleMatch[2] || 'Без названия',
        parts: []
      };
      parts = [];
      buffer = [];
      currentPartNum = 0;
      return;
    }

    if (!current) return;

    const partMatch = text.match(/^ч\.?\s*(\d+)\s*[.)]?\s*/i);
    if (partMatch) {
      if (parts.length > 0 && buffer.length > 0) {
        const lastPart = parts[parts.length - 1];
        lastPart.text = cleanText(buffer.join(' '));
        const punishment = extractPunishment(lastPart.text);
        if (punishment) {
          lastPart.text = removePunishment(lastPart.text);
          lastPart.punishment = punishment;
        }
        buffer = [];
      }

      currentPartNum = parseInt(partMatch[1]);
      const restText = text.replace(partMatch[0], '').trim();
      parts.push({
        part: currentPartNum,
        text: restText || '',
        punishment: null
      });
      return;
    }

    const punishMatch = text.match(/^Наказание[:\s]+(.*)$/i);
    if (punishMatch) {
      const punishment = punishMatch[1].trim();
      if (parts.length > 0) {
        const lastPart = parts[parts.length - 1];
        lastPart.punishment = punishment;
        if (!lastPart.text) {
          lastPart.text = `Наказание: ${punishment}`;
        }
      } else {
        buffer.push(`Наказание: ${punishment}`);
      }
      return;
    }

    buffer.push(text);
  });

  if (current) {
    finishArticle();
  }

  return articles;

  function finishArticle() {
    if (buffer.length > 0 && parts.length === 0) {
      const fullText = cleanText(buffer.join(' '));
      const punishment = extractPunishment(fullText);
      current.parts.push({
        part: 1,
        text: removePunishment(fullText),
        punishment: punishment
      });
    } else if (parts.length > 0 && buffer.length > 0) {
      const lastPart = parts[parts.length - 1];
      const extraText = cleanText(buffer.join(' '));
      if (extraText) {
        const punishment = extractPunishment(extraText);
        if (punishment) {
          lastPart.punishment = lastPart.punishment || punishment;
          lastPart.text = lastPart.text ? `${lastPart.text} ${removePunishment(extraText)}` : removePunishment(extraText);
        } else {
          lastPart.text = lastPart.text ? `${lastPart.text} ${extraText}` : extraText;
        }
      }
    }

    current.parts = parts.map(p => ({
      part: p.part,
      text: cleanText(p.text || 'Нет текста'),
      punishment: p.punishment ? cleanText(p.punishment) : null
    }));

    if (current.parts.length === 0) {
      current.parts.push({
        part: 1,
        text: current.title || 'Нет текста',
        punishment: null
      });
    }

    articles.push(current);
    current = null;
  }
}

function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function extractPunishment(text) {
  const match = text.match(/Наказание[:\s]+([^\n]*)/i);
  return match ? cleanText(match[1]) : null;
}

function removePunishment(text) {
  return text.replace(/Наказание[:\s]+[^\n]*/i, '').trim();
}

// ============================================================
// 3. ЗАПУСК
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

  if (!fs.existsSync('orlando')) {
    fs.mkdirSync('orlando');
  }

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

      fs.writeFileSync(`orlando/${type}.json`, JSON.stringify(result, null, 2));
      console.log(`✅ orlando/${type}.json — ${articles.length} статей`);
    } catch (e) {
      console.error(`❌ ${type}: ${e.message}`);
    }
  }

  console.log('\n✅ Готово!');
}

main().catch(console.error);
