'use strict';

/**
 * Единый парсер для ВСЕХ кодексов (УК, ПК, АК, ДК)
 *
 * Вход: сырой текст с форума (XenForo)
 * Выход: единая структура { number, tag, stars, title, parts: [{ part, stars, text, punishment }] }
 */

const fs = require('fs');
const path = require('path');

// ========== РЕГУЛЯРНЫЕ ВЫРАЖЕНИЯ ==========

// Номер статьи + всё, что идёт после него на той же строке (разбирается отдельно ниже)
const ARTICLE_RE = /^Статья\s+(\d+(?:\.\d+)*)\.?\s*(.*)$/i;
const PART_RE = /^ч\.?\s*(\d+)\s*[.)]?\s*(.*)$/i;
const PUNISHMENT_RE = /(?:Наказание|Штраф)\s*[:\s]+([^\n]*)$/i;
const HEADER_RE = /^[Гг]лава\s+[\dIVXLCDM]+[\.\s]/i;
const INLINE_PUNISHMENT_RE = /Наказание[:\s]+([^\n]*)$/i;

// ========== РАЗБОР "ШАПКИ" СТАТЬИ (звёзды сложности + тег) ==========

/**
 * Отделяет маркер сложности (★, ★★★★, "★★ / ★★★", "от ★ до ★★★★★", "- ★★★ / ★★★★")
 * от начала строки, если он там есть.
 */
function splitLeadingStars(text) {
  let s = text;

  // Необязательный дефис-разделитель перед звёздами: "- ★★★ / ★★★★..."
  const dashMatch = s.match(/^[-–]\s*/);
  if (dashMatch) {
    const after = s.slice(dashMatch[0].length);
    if (/^(от\s+)?★/i.test(after)) {
      s = after;
    }
  }

  // Захватываем блок из звёзд/пробелов/слэшей/дефисов/слова "до" (для диапазонов "от ★ до ★★★★★"),
  // начинающийся со звезды (с необязательным "от " перед ней)
  const starMatch = s.match(/^((?:от\s+)?★(?:[★\s/–-]|до\s*)*)/i);
  if (starMatch && /★/.test(starMatch[1])) {
    const stars = starMatch[1].trim().replace(/\s+/g, ' ');
    const rest = s.slice(starMatch[0].length);
    return { stars, rest };
  }

  return { stars: null, rest: text };
}

/**
 * Отделяет тег в квадратных [Федеральная] ИЛИ круглых (ФЕДЕРАЛЬНЫЙ) скобках.
 */
function splitLeadingTag(text) {
  const s = text.replace(/^\s+/, '');

  const bracketMatch = s.match(/^\[([^\]]+)\]\s*/);
  if (bracketMatch) {
    return { tag: cleanText(bracketMatch[1]), rest: s.slice(bracketMatch[0].length) };
  }

  const parenMatch = s.match(/^\(([^)]+)\)\s*/);
  if (parenMatch) {
    return { tag: cleanText(parenMatch[1]), rest: s.slice(parenMatch[0].length) };
  }

  return { tag: null, rest: s };
}

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
          stars: null,
          text: text || bodyText,
          punishment: punishment
        });
      }

      // Если у статьи есть "общее" наказание (объявленное один раз, до перечисления ч.1/ч.2/...),
      // применяем его КО ВСЕМ частям, у которых своего наказания нет — а не только к последней.
      if (currentArticle._punishment && currentArticle.parts.length > 0) {
        const blanket = cleanText(currentArticle._punishment);
        for (const p of currentArticle.parts) {
          if (!p.punishment) {
            p.punishment = blanket;
          }
        }
      }

      if (currentArticle.parts.length === 0) {
        currentArticle.parts.push({
          part: 1,
          stars: null,
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

      let remainder = articleMatch[2] || '';

      const starsResult = splitLeadingStars(remainder);
      const tagResult = splitLeadingTag(starsResult.rest);

      let restText = cleanText(tagResult.rest);
      let inlinePunishment = null;
      const inlineMatchOnHeader = restText.match(INLINE_PUNISHMENT_RE);
      if (inlineMatchOnHeader) {
        inlinePunishment = cleanText(inlineMatchOnHeader[1]);
        restText = cleanText(restText.substring(0, inlineMatchOnHeader.index));
      }

      currentArticle = {
        number: articleMatch[1],
        stars: starsResult.stars,
        tag: tagResult.tag,
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

      let partText = partMatch[2] || '';

      const partStars = splitLeadingStars(partText);
      partText = partStars.rest;

      const punishmentMatch = partText.match(INLINE_PUNISHMENT_RE);
      let text = partText;
      let punishment = null;

      if (punishmentMatch) {
        text = cleanText(partText.substring(0, punishmentMatch.index));
        punishment = cleanText(punishmentMatch[1]);
      }

      currentPart = {
        part: parseInt(partMatch[1], 10),
        stars: partStars.stars,
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

module.exports = { parserCodex, splitLeadingStars, splitLeadingTag, cleanText, saveToJson, fetchForumPage };
