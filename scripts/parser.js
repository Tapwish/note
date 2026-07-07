'use strict';

/**
 * АВТОМАТИЧЕСКИЙ ПАРСЕР ВСЕХ КОДЕКСОВ
 * - Загружает страницы с форума
 * - Парсит в единый формат
 * - Сохраняет JSON-файлы
 * 
 * Запуск: node parser.js
 */

const fs = require('fs');
const puppeteer = require('puppeteer');

// ============================================================
// 1. РЕГУЛЯРНЫЕ ВЫРАЖЕНИЯ
// ============================================================

const ARTICLE_RE = /^Статья\s+(\d+(?:\.\d+)?)\s*(.*)$/i;
const HEADER_RE = /^[Гг]лава\s+[\dIVXLCDM]+/i;
const PUNISHMENT_RE = /Наказание[:\s]+([^\n]*)/i;
const PART_RE = /^ч\.?\s*(\d+)\s*[.)]?\s*/i;

// ============================================================
// 2. ПАРСЕР ТЕКСТА
// ============================================================

function parseText(text) {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const articles = [];
  let current = null;
  let body = [];
  let currentPart = null;
  let partBody = [];

  for (const line of lines) {
    // Новая статья
    const match = line.match(ARTICLE_RE);
    if (match) {
      // Сохраняем предыдущую
      if (current) {
        finalizeArticle(current, body, currentPart, partBody);
        articles.push(current);
        body = [];
        partBody = [];
        currentPart = null;
      }

      current = {
        number: match[1],
        title: match[2].trim() || 'Без названия',
        parts: []
      };
      continue;
    }

    // Пропускаем заголовки глав
    if (HEADER_RE.test(line)) continue;

    if (!current) continue;

    // Проверяем на часть "ч. X"
    const partMatch = line.match(PART_RE);
    if (partMatch) {
      // Сохраняем предыдущую часть
      if (currentPart !== null && partBody.length > 0) {
        const fullText = partBody.join(' ');
        const punishment = extractPunishment(fullText);
        current.parts.push({
          part: currentPart,
          text: removePunishment(fullText),
          punishment: punishment
        });
        partBody = [];
      }
      currentPart = parseInt(partMatch[1]);
      const rest = line.replace(PART_RE, '').trim();
      if (rest) partBody.push(rest);
      continue;
    }

    // Обычная строка
    if (currentPart !== null) {
      partBody.push(line);
    } else {
      body.push(line);
    }
  }

  // Сохраняем последнюю статью
  if (current) {
    finalizeArticle(current, body, currentPart, partBody);
    articles.push(current);
  }

  return articles;
}

function finalizeArticle(article, body, currentPart, partBody) {
  if (currentPart !== null && partBody.length > 0) {
    const fullText = partBody.join(' ');
    const punishment = extractPunishment(fullText);
    article.parts.push({
      part: currentPart,
      text: removePunishment(fullText),
      punishment: punishment
    });
  } else if (body.length > 0) {
    const fullText = body.join(' ');
    const punishment = extractPunishment(fullText);
    article.parts.push({
      part: 1,
      text: removePunishment(fullText),
      punishment: punishment
    });
  } else {
    article.parts.push({
      part: 1,
      text: article.title || 'Нет текста',
      punishment: null
    });
  }
}

function extractPunishment(text) {
  const match = text.match(PUNISHMENT_RE);
  return match ? match[1].trim() : null;
}

function removePunishment(text) {
  return text.replace(PUNISHMENT_RE, '').trim();
}

// ============================================================
// 3. ЗАГРУЗКА С ФОРУМА
// ============================================================

async function fetchPage(url) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  console.log(`📥 Загрузка: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

  await page.waitForSelector('.message-content', { timeout: 10000 });

  const text = await page.evaluate(() => {
    const messages = document.querySelectorAll('.message-content');
    return Array.from(messages)
      .map(msg => msg.textContent || '')
      .join('\n');
  });

  await browser.close();
  return text;
}

// ============================================================
// 4. СОХРАНЕНИЕ JSON
// ============================================================

function saveJSON(articles, codexType, title, url) {
  const result = {
    server: 'orlando',
    serverName: 'Orlando',
    codexType: codexType,
    title: title,
    url: url,
    lastUpdate: new Date().toISOString(),
    articles: articles,
    totalArticles: articles.length
  };

  fs.writeFileSync(`${codexType}.json`, JSON.stringify(result, null, 2));
  console.log(`✅ ${codexType}.json — ${articles.length} статей`);
}

// ============================================================
// 5. ЗАПУСК
// ============================================================

async function main() {
  const codexes = {
    uk: {
      url: 'https://forum.majestic-rp.ru/threads/ugolovnyi-kodeks-shtata-san-andreas.3232577/',
      title: 'Уголовный кодекс штата San-Andreas'
    },
    pk: {
      url: 'https://forum.majestic-rp.ru/threads/protsessual-nyi-kodeks-shtata-san-andreas.3232571/',
      title: 'Процессуальный кодекс штата San-Andreas'
    },
    ak: {
      url: 'https://forum.majestic-rp.ru/threads/administrativnyi-kodeks-shtata-san-andreas.3232568/',
      title: 'Административный кодекс штата San-Andreas'
    },
    dk: {
      url: 'https://forum.majestic-rp.ru/threads/dorozhnyi-kodeks-shtata-san-andreas.3232575/',
      title: 'Дорожный кодекс штата San-Andreas'
    }
  };

  for (const [type, data] of Object.entries(codexes)) {
    try {
      console.log(`\n📌 Обработка ${type.toUpperCase()}...`);
      const raw = await fetchPage(data.url);
      const articles = parseText(raw);
      saveJSON(articles, type, data.title, data.url);
    } catch (e) {
      console.error(`❌ ${type}: ${e.message}`);
    }
  }

  console.log('\n🎉 ВСЁ ГОТОВО!');
}

// Запуск
main().catch(console.error);
