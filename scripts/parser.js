'use strict';

/**
 * ИДЕАЛЬНЫЙ ПАРСЕР для законов Majestic RP
 * 
 * Проверен на реальных данных из ваших JSON-файлов.
 * Все статьи приводятся к единому формату:
 *   {
 *     number: "1.1",
 *     title: "Законодательство об административных правонарушениях",
 *     parts: [
 *       { part: 1, text: "...", punishment: null },
 *       { part: 2, text: "...", punishment: null }
 *     ]
 *   }
 */

const fs = require('fs');

// ============================================================
// 1. РЕГУЛЯРНЫЕ ВЫРАЖЕНИЯ
// ============================================================

const ARTICLE_RE = /^Статья\s+(\d+(?:\.\d+)*)/i;
const PART_RE = /^ч\.?\s*(\d+)\s*[.)]?\s*/i;
const PUNISHMENT_RE = /Наказание[:\s]+([^\n]*)/i;
const HEADER_RE = /^[Гг]лава\s+[\dIVXLCDM]+/i;
const TAG_RE = /\[([^\]]+)\]/;

// ============================================================
// 2. ОСНОВНАЯ ФУНКЦИЯ ПАРСИНГА
// ============================================================

function parseLawText(rawText) {
  // --- Нормализация ---
  const lines = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  // --- Находим все статьи ---
  const articlePositions = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(ARTICLE_RE);
    if (match) {
      articlePositions.push({
        index: i,
        number: match[1],
        line: lines[i]
      });
    }
  }

  if (articlePositions.length === 0) {
    console.warn('⚠️ Статьи не найдены');
    return [];
  }

  const articles = [];

  // --- Парсим каждую статью ---
  for (let a = 0; a < articlePositions.length; a++) {
    const current = articlePositions[a];
    const next = articlePositions[a + 1];
    
    const startIdx = current.index;
    const endIdx = next ? next.index : lines.length;
    
    const articleLines = lines.slice(startIdx, endIdx);
    
    // --- Заголовок ---
    const headerLine = articleLines[0] || '';
    const titleMatch = headerLine.match(/^Статья\s+\d+(?:\.\d+)?\s*(?:\[([^\]]+)\])?\s*(.*)$/i);
    
    const article = {
      number: current.number,
      tag: titleMatch && titleMatch[1] ? clean(titleMatch[1]) : null,
      title: titleMatch ? clean(titleMatch[2] || '') : clean(headerLine.replace(/^Статья\s+\d+(?:\.\d+)?/, '')),
      parts: []
    };

    // --- Тело статьи (всё после заголовка) ---
    const bodyLines = articleLines.slice(1);
    
    if (bodyLines.length === 0) {
      article.parts.push({ part: 1, text: article.title || 'Нет текста', punishment: null });
      articles.push(article);
      continue;
    }

    // --- Разбираем тело на части ---
    let currentPart = null;
    let partBuffer = [];
    let hasParts = false;

    for (const line of bodyLines) {
      // Пропускаем заголовки глав
      if (HEADER_RE.test(line)) continue;

      // Проверяем на "ч. X"
      const partMatch = line.match(PART_RE);
      
      if (partMatch) {
        // Сохраняем предыдущую часть
        if (currentPart && partBuffer.length > 0) {
          const fullText = clean(partBuffer.join(' '));
          const punishment = extractPunishment(fullText);
          currentPart.text = removePunishment(fullText);
          currentPart.punishment = punishment;
          article.parts.push(currentPart);
          partBuffer = [];
        }
        
        // Начинаем новую часть
        const restText = line.replace(PART_RE, '').trim();
        currentPart = {
          part: parseInt(partMatch[1], 10),
          text: '',
          punishment: null
        };
        hasParts = true;
        
        if (restText) {
          partBuffer.push(restText);
        }
        continue;
      }

      // Если есть активная часть — добавляем в буфер
      if (currentPart) {
        partBuffer.push(line);
        continue;
      }

      // Если нет частей — это просто текст (ч. 1)
      partBuffer.push(line);
    }

    // --- Сохраняем последнюю часть ---
    if (currentPart && partBuffer.length > 0) {
      const fullText = clean(partBuffer.join(' '));
      const punishment = extractPunishment(fullText);
      currentPart.text = removePunishment(fullText);
      currentPart.punishment = punishment;
      article.parts.push(currentPart);
    } else if (partBuffer.length > 0 && !hasParts) {
      // Нет частей — создаём ч. 1
      const fullText = clean(partBuffer.join(' '));
      const punishment = extractPunishment(fullText);
      article.parts.push({
        part: 1,
        text: removePunishment(fullText),
        punishment: punishment
      });
    }

    // --- Если части всё ещё пустые ---
    if (article.parts.length === 0) {
      article.parts.push({
        part: 1,
        text: article.title || 'Нет текста',
        punishment: null
      });
    }

    articles.push(article);
  }

  return articles;
}

// ============================================================
// 3. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================================

function clean(text) {
  if (!text) return '';
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/[‌​]/g, '')
    .trim();
}

function extractPunishment(text) {
  if (!text) return null;
  const match = text.match(PUNISHMENT_RE);
  return match ? clean(match[1]) : null;
}

function removePunishment(text) {
  if (!text) return '';
  return clean(text.replace(PUNISHMENT_RE, ''));
}

// ============================================================
// 4. ЗАГРУЗКА С ФОРУМА (Puppeteer)
// ============================================================

async function fetchForumPage(url) {
  const puppeteer = require('puppeteer');
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
// 5. СОХРАНЕНИЕ В JSON
// ============================================================

function saveToJson(articles, codexType, title, url) {
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

  const filename = `${codexType}.json`;
  fs.writeFileSync(filename, JSON.stringify(result, null, 2));
  console.log(`✅ ${filename} — ${articles.length} статей`);
  return result;
}

// ============================================================
// 6. ЗАПУСК
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
      console.log(`\n📌 Обработка ${type.toUpperCase()}...`);
      const rawText = await fetchForumPage(url);
      const articles = parseLawText(rawText);
      saveToJson(articles, type, titles[type], url);
    } catch (error) {
      console.error(`❌ Ошибка для ${type}:`, error.message);
    }
  }

  console.log('\n✅ Готово!');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { parseLawText, clean, saveToJson, fetchForumPage };
