'use strict';

/**
 * Единый парсер для ВСЕХ кодексов (УК, ПК, АК, ДК)
 *
 * Вход: сырой текст с форума (XenForo)
 * Выход: единая структура { number, tag, stars, title, parts: [{ part, text, punishment }] }
 */

const fs = require('fs');
const path = require('path');

// ========== РЕГУЛЯРНЫЕ ВЫРАЖЕНИЯ ==========

// Группы: 1 - номер статьи, 2 - звёзды сложности (★★★★), 3 - тег в скобках, 4 - остальной текст строки
const ARTICLE_RE = /^Статья\s+(\d+(?:\.\d+)*)\.?\s*(★+)?\s*(?:\[([^\]]+)\])?\s*(.*)$/i;
const PART_RE = /^ч\.?\s*(\d+)\s*[.)]?\s*(.*)$/i;
const PUNISHMENT_RE = /(?:Наказание|★★|Штраф)\s*[:\s]+([^\n]*)$/i;
const HEADER_RE = /^[Гг]лава\s+[\dIVXLCDM]+[\.\s]/i;
const INLINE_PUNISHMENT_RE = /Наказание[:\s]+([^\n]*)$/i;

// ========== ОСНОВНАЯ ФУНКЦИЯ ==========

function parserCodex(rawText) {
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

  const finalizePart = () => {
    if (currentPart) {
      currentPart.text = cleanText(currentPart.text.join(' '));
      currentPart.punishment = currentPart.punishment
        ? cleanText(currentPart.punishment)
        : null;
    }
  };

  const finalizeArticle = () => {
    finalizePart();

    if (currentArticle) {
      const body = currentArticle._body || [];
      const bodyText = cleanText(body.join(' '));

      if (currentArticle.parts.length === 0 && bodyText) {
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

      if (currentArticle._punishment && currentArticle.parts.length > 0) {
        const lastPart = currentArticle.parts[currentArticle.parts.length - 1];
        if (!lastPart.punishment) {
          lastPart.punishment = cleanText(currentArticle._punishment);
        } else if (lastPart.punishment !== cleanText(currentArticle._punishment)) {
          lastPart.punishment = cleanText(`${lastPart.punishment}. ${currentArticle._punishment}`);
        }
      }

      if (currentArticle.parts.length === 0) {
        currentArticle.parts.push({
          part: 1,
          text: currentArticle.title || 'Нет текста',
          punishment: currentArticle._punishment ? cleanText(currentArticle._punishment) : null
        });
      }

      delete currentArticle._body;
      delete currentArticle._punishment;

      currentArticle.title = cleanText(currentArticle.title || '');

      if (currentArticle.title || currentArticle.parts.some(p => p.text)) {
        articles.push(currentArticle);
      }

      currentArticle = null;
    }
  };

  for (const line of lines) {
    if (HEADER_RE.test(line)) {
      continue;
    }

    const articleMatch = line.match(ARTICLE_RE);
    if (articleMatch) {
      foundFirstArticle = true;
      finalizeArticle();

      currentPart = null;

      // Текст после номера/звёзд/тега может содержать всё сразу:
      // короткий заголовок ИЛИ полный текст статьи с "Наказание: ..." в конце.
      // Проверяем и отделяем наказание сразу, чтобы оно не осело в title.
      let restText = cleanText(articleMatch[4] || '');
      let inlinePunishment = null;
      const inlineMatchOnHeader = restText.match(INLINE_PUNISHMENT_RE);
      if (inlineMatchOnHeader) {
        inlinePunishment = cleanText(inlineMatchOnHeader[1]);
        restText = cleanText(restText.substring(0, inlineMatchOnHeader.index));
      }

      currentArticle = {
        number: articleMatch[1],
        stars: articleMatch[2] ? articleMatch[2].length : null,
        tag: articleMatch[3] ? cleanText(articleMatch[3]) : null,
        title: restText,
        parts: [],
        _body: [],
        _punishment: inlinePunishment
      };
      continue;
    }

    if (!currentArticle) continue;

    const partMatch = line.match(PART_RE);
    if (partMatch) {
      finalizePart();

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

    if (currentPart) {
      currentPart.text.push(line);
    } else {
      currentArticle._body.push(line);
    }
  }

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

// ========== ЗАПУСК ==========

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
      const rawText = await fetchForumPage(url);
      const articles = parserCodex(rawText);
      saveToJson(articles, type, titles[type], url);
    } catch (error) {
      hadError = true;
      console.error(`❌ Ошибка для ${type}:`, error.message);
    }
  }

  console.log('✅ Готово!');
  if (hadError) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = { parserCodex, cleanText, saveToJson, fetchForumPage };
