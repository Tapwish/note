'use strict';

/**
 * Единый парсер для ВСЕХ кодексов (УК, ПК, АК, ДК)
 * 
 * Вход: сырой текст с форума (XenForo)
 * Выход: единая структура { number, title, parts: [{ part, text, punishment }] }
 * 
 * Все статьи приводятся к формату:
 *   - Заголовок: Статья X. Название
 *   - Разворот: ч. 1 Текст. Наказание: ...
 */

const fs = require('fs');
const path = require('path');

// ========== РЕГУЛЯРНЫЕ ВЫРАЖЕНИЯ ==========

const ARTICLE_RE = /^Статья\s+(\d+(?:\.\d+)*)\s*(?:\[([^\]]+)\])?\s*(.*)$/i;
const PART_RE = /^ч\.?\s*(\d+)\s*[.)]?\s*(.*)$/i;
const PUNISHMENT_RE = /(?:Наказание|★★|Штраф)\s*[:\s]+([^\n]*)$/i;
const HEADER_RE = /^[Гг]лава\s+[\dIVXLCDM]+[\.\s]/i;
const INLINE_PUNISHMENT_RE = /Наказание[:\s]+([^\n]*)$/i;

// ========== ОСНОВНАЯ ФУНКЦИЯ ==========

function parserCodex(rawText) {
  // Нормализуем текст
  const lines = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const articles = [];
  let currentArticle = null;
  let currentPart = null;
  let foundFirstArticle = false;

  // Финализирует текущую часть
  const finalizePart = () => {
    if (currentPart) {
      currentPart.text = cleanText(currentPart.text.join(' '));
      currentPart.punishment = currentPart.punishment
        ? cleanText(currentPart.punishment)
        : null;
    }
  };

  // Финализирует текущую статью
  const finalizeArticle = () => {
    finalizePart();

    if (currentArticle) {
      // Если у статьи есть тело, но нет частей — создаём ч. 1
      const body = currentArticle._body || [];
      const bodyText = cleanText(body.join(' '));

      if (currentArticle.parts.length === 0 && bodyText) {
        // Проверяем, есть ли наказание в теле
        const punishmentMatch = bodyText.match(INLINE_PUNISHMENT_RE);
        let text = bodyText;
        let punishment = currentArticle._punishment || null;

        if (punishmentMatch) {
          text = cleanText(bodyText.substring(0, punishmentMatch.index));
          if (!punishment) {
            punishment = cleanText(punishmentMatch[1]);
          }
        }

        currentArticle.parts.push({
          part: 1,
          text: text || bodyText,
          punishment: punishment
        });
      }

      // Если есть наказание у статьи, но нет у частей — добавляем к последней части
      if (currentArticle._punishment && currentArticle.parts.length > 0) {
        const lastPart = currentArticle.parts[currentArticle.parts.length - 1];
        if (!lastPart.punishment) {
          lastPart.punishment = cleanText(currentArticle._punishment);
        } else {
          // Если у части уже есть наказание — объединяем
          lastPart.punishment = cleanText(`${lastPart.punishment}. ${currentArticle._punishment}`);
        }
      }

      // Если нет частей и нет тела — создаём ч. 1 с заголовком
      if (currentArticle.parts.length === 0) {
        currentArticle.parts.push({
          part: 1,
          text: currentArticle.title || 'Нет текста',
          punishment: currentArticle._punishment ? cleanText(currentArticle._punishment) : null
        });
      }

      // Удаляем служебные поля
      delete currentArticle._body;
      delete currentArticle._punishment;

      // Очищаем заголовок от мусора
      currentArticle.title = cleanText(currentArticle.title || '');

      // Пропускаем пустые статьи
      if (currentArticle.title || currentArticle.parts.some(p => p.text)) {
        articles.push(currentArticle);
      }

      currentArticle = null;
    }
  };

  // ===== ОСНОВНОЙ ЦИКЛ ПАРСИНГА =====

  for (const line of lines) {
    // Пропускаем заголовки глав
    if (HEADER_RE.test(line)) {
      // Если это первая глава и мы ещё не нашли статью — пропускаем
      if (!foundFirstArticle) continue;
      continue;
    }

    // Проверяем, начинается ли строка с "Статья"
    const articleMatch = line.match(ARTICLE_RE);
    if (articleMatch) {
      foundFirstArticle = true;
      finalizeArticle();

      currentPart = null;
      currentArticle = {
        number: articleMatch[1],
        tag: articleMatch[2] ? cleanText(articleMatch[2]) : null,
        title: cleanText(articleMatch[3] || ''),
        parts: [],
        _body: [],
        _punishment: null
      };
      continue;
    }

    // Если статья ещё не началась — пропускаем
    if (!currentArticle) continue;

    // Проверяем на "ч. X"
    const partMatch = line.match(PART_RE);
    if (partMatch) {
      finalizePart();

      // Проверяем, есть ли наказание внутри строки части
      const partText = partMatch[2] || '';
      const punishmentMatch = partText.match(INLINE_PUNISHMENT_RE);
      let text = partText;
      let punishment = null;

      if (punishmentMatch) {
        text = cleanText(partText.substring(0, punishmentMatch.index));
        punishment = cleanText(punishmentMatch[1]);
      }

      currentPart = {
        part: parseInt(partMatch[1], 10),
        text: [text || ''],
        punishment: punishment || null
      };
      currentArticle.parts.push(currentPart);
      continue;
    }

    // Проверяем на отдельное наказание
    const punishmentMatch = line.match(PUNISHMENT_RE);
    if (punishmentMatch) {
      const punishmentText = cleanText(punishmentMatch[1]);

      if (currentPart) {
        if (currentPart.punishment) {
          currentPart.text.push(`Наказание: ${punishmentText}`);
        } else {
          currentPart.punishment = punishmentText;
        }
      } else {
        currentArticle._punishment = punishmentText;
      }
      continue;
    }

    // Проверяем на наказание внутри строки
    const inlineMatch = line.match(INLINE_PUNISHMENT_RE);
    if (inlineMatch) {
      const textBefore = cleanText(line.substring(0, inlineMatch.index));
      const punishmentText = cleanText(inlineMatch[1]);

      if (currentPart) {
        if (textBefore) {
          currentPart.text.push(textBefore);
        }
        if (currentPart.punishment) {
          currentPart.text.push(`Наказание: ${punishmentText}`);
        } else {
          currentPart.punishment = punishmentText;
        }
      } else {
        if (textBefore) {
          currentArticle._body.push(textBefore);
        }
        currentArticle._punishment = punishmentText;
      }
      continue;
    }

    // Обычная строка текста
    if (currentPart) {
      currentPart.text.push(line);
    } else {
      currentArticle._body.push(line);
    }
  }

  // Финализируем последнюю статью
  finalizeArticle();

  return articles;
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/[‌​]/g, '')
    .replace(/^[\.\s]+/, '')
    .replace(/[\.\s]+$/, '')
    .trim();
}

// ========== СОХРАНЕНИЕ В JSON ==========

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

  // Сохраняем в корень репозитория (на уровень выше scripts/),
  // чтобы workflow мог найти uk.json/pk.json/ak.json/dk.json через "git add".
  const filename = path.join(__dirname, '..', `${codexType}.json`);
  fs.writeFileSync(filename, JSON.stringify(result, null, 2));
  console.log(`✅ ${codexType}.json — ${articles.length} статей`);
  return result;
}

// ========== ЗАГРУЗКА С ФОРУМА (Puppeteer) ==========

async function fetchForumPage(url) {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });
  const page = await browser.newPage();

  console.log(`📥 Загрузка: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

  // Ждём загрузки контента
  await page.waitForSelector('.message-content', { timeout: 10000 });

  // Собираем весь текст
  const text = await page.evaluate(() => {
    const messages = document.querySelectorAll('.message-content');
    return Array.from(messages)
      .map(msg => msg.textContent || '')
      .join('\n');
  });

  await browser.close();
  return text;
}

// ========== ПРИМЕР ИСПОЛЬЗОВАНИЯ ==========

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

  let hadError = false;

  for (const [type, url] of Object.entries(urls)) {
    try {
      // 1. Загружаем страницу
      const rawText = await fetchForumPage(url);

      // 2. Парсим
      const articles = parserCodex(rawText);

      // 3. Сохраняем
      saveToJson(articles, type, titles[type], url);

    } catch (error) {
      hadError = true;
      console.error(`❌ Ошибка для ${type}:`, error.message);
    }
  }

  console.log('✅ Готово!');

  // Если хотя бы один кодекс не спарсился — завершаем процесс с ошибкой,
  // чтобы workflow не пытался закоммитить пустые/неполные данные молча.
  if (hadError) {
    process.exitCode = 1;
  }
}

// Если запускаем напрямую
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = { parserCodex, cleanText, saveToJson, fetchForumPage };
