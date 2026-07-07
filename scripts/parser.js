'use strict';

/**
 * Turns the raw plain-text body of a "law thread" forum post into the
 * structured article/part JSON format used by the rest of the app.
 *
 * Expected loose input shape (typical Majestic RP law post):
 *
 *   Статья 5.2. Общие начала назначения наказания
 *   Лицу, признанному виновным в совершении преступления...
 *
 *   Статья 12.5. [Федеральная] Организация экстремистской организации
 *   Организация деятельности общественного или религиозного объединения...
 *   Наказание: 5 лет лишения свободы.
 *
 *   Статья 20.1. Побои
 *   Ч.1 Умышленное нанесение побоев
 *   Наказание: 3 года лишения свободы.
 *   Ч.2 Умышленное нанесение особо тяжких телесных повреждений
 *   Наказание: 4 года лишения свободы.
 *
 * Output matches the schema already used in data/*.json:
 *   { number, tag, title, parts: [{ part, text, punishment }] }
 */

// "Статья 5.2.", "Статья 5.2 —", "ст. 12.5." ...
const ARTICLE_RE = /^(?:статья|ст\.?)\s*№?\s*(\d+(?:\.\d+)*)\.?\s*[-—:]?\s*(.*)$/i;

// "Ч.1", "Часть 1.", "ч. 1 —" ...
const PART_RE = /^(?:ч\.?|часть)\s*(\d+)\.?\s*[-—:]?\s*(.*)$/i;

// "Наказание: ...", "Наказание —  ..."
const PUNISHMENT_RE = /^наказание\s*[:\-—]\s*(.+)$/i;

// Tags like "[Федеральная]", "(R/F)", "[F]" appearing anywhere in a title line.
const TAG_RE = /[\[(]([^\])]+)[\])]/;

function extractTag(line) {
  const match = line.match(TAG_RE);
  if (!match) return { tag: null, rest: line.trim() };
  const tag = match[1].trim();
  const rest = (line.slice(0, match.index) + line.slice(match.index + match[0].length)).trim();
  return { tag, rest };
}

function cleanLine(line) {
  return line.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function newPart(partNumber) {
  return { part: partNumber, text: '', punishment: null };
}

function pushPart(article, part) {
  if (!part) return;
  part.text = part.text.trim();
  if (!part.text && !part.punishment) return; // drop fully-empty stray parts
  article.parts.push(part);
}

function finalizeArticle(article) {
  if (!article) return null;
  // If nothing under the article was ever captured as a part, make sure at
  // least the virtual (part: null) part is present so the article isn't lost.
  if (article.parts.length === 0) {
    article.parts.push(newPart(null));
  }
  return article;
}

/**
 * @param {string} rawText Plain text extracted from the forum post (HTML
 *   already stripped, <br>/<p> converted to newlines upstream).
 * @returns {Array<object>} parsed articles
 */
function parseCodexText(rawText) {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((l) => l.length > 0);

  const articles = [];
  let currentArticle = null;
  let currentPart = null;
  let virtualPartCounter = 0;

  for (const line of lines) {
    const articleMatch = line.match(ARTICLE_RE);
    if (articleMatch) {
      pushPart(currentArticle, currentPart);
      currentArticle = finalizeArticle(currentArticle);
      if (currentArticle) articles.push(currentArticle);

      const [, number, titleRaw] = articleMatch;
      const { tag, rest: title } = extractTag(titleRaw);
      currentArticle = { number, tag, title, parts: [] };
      currentPart = null;
      virtualPartCounter = 0;
      continue;
    }

    if (!currentArticle) continue; // ignore preamble text before first article

    const partMatch = line.match(PART_RE);
    if (partMatch) {
      pushPart(currentArticle, currentPart);
      const [, partNum, partTitleRaw] = partMatch;
      currentPart = newPart(Number(partNum));
      if (partTitleRaw) currentPart.text = partTitleRaw;
      continue;
    }

    const punishmentMatch = line.match(PUNISHMENT_RE);
    if (punishmentMatch) {
      if (!currentPart) currentPart = newPart(null);
      currentPart.punishment = punishmentMatch[1].trim();
      continue;
    }

    // Regular body text line.
    if (!currentPart) currentPart = newPart(null);
    currentPart.text = currentPart.text ? `${currentPart.text} ${line}` : line;
  }

  pushPart(currentArticle, currentPart);
  currentArticle = finalizeArticle(currentArticle);
  if (currentArticle) articles.push(currentArticle);

  // Re-number virtual (null) parts sequentially is intentionally NOT done
  // here — "part: null" is preserved so the frontend can decide to display
  // it as an implicit "ч.1" (see web/shared.js buildArticlesHTML).
  return articles;
}

module.exports = { parseCodexText, ARTICLE_RE, PART_RE, PUNISHMENT_RE };
