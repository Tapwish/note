'use strict';

/**
 * Парсер уголовного/административного кодекса форума Majestic (XenForo).
 *
 * Работает НЕ построчно, а по всему тексту сразу — независимо от того, как
 * именно отформатирован конкретный пост: с переносами строк или без них,
 * со звёздами рейтинга/тегом или без, с "ч. N" или одним сплошным абзацем,
 * с "Наказание:" на отдельной строке или вклеенным в конец предложения.
 *
 * Правило простое: как только в тексте встречается "Статья N" — начинается
 * новая статья. Как только внутри неё (или её части) встречается
 * "Наказание" — всё, что после него, уходит в punishment, а всё, что до
 * него — в text. Больше никаких требований к разметке нет.
 *
 * Режимы работы:
 *  - parseCodex(rawText)      — на вход обычный текст
 *  - parseCodexFromHtml(html) — на вход сырой HTML сообщения(й) форума;
 *    HTML сначала превращается в текст (htmlToText), а затем разбирается
 *    той же логикой.
 */

// заголовок статьи: номер [+ звёзды рейтинга] [+ тег в скобках]
const ARTICLE_HEADER_RE = /Статья\s+(\d+(?:\.\d+)*)\s*(★+)?\s*(?:\[([^\]]+)\])?/gi;
// заголовок части: "ч. N" / "ч N" / "ч.N)" и т.п.
const PART_HEADER_RE = /ч\.?\s*(\d+)\s*[.)]?/gi;
// "Наказание", "Наказания", "Наказанием" и т.д., с любым разделителем после (":", "-", "—") или без него
const PUNISHMENT_RE = /Наказани[а-яё]*\s*[:\-—]?\s*/gi;

// символы, которые считаем допустимой границей перед словом-маркером
// (начало текста или пробел/знак препинания перед ним)
function isBoundary(str, idx) {
  if (idx <= 0) return true;
  return /[\s.,;:()\-—\n\r]/.test(str[idx - 1]);
}

function normalizeWhitespace(text) {
  return text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
}

/**
 * Находит последнее вхождение "Наказание..." в тексте и разбивает его на
 * содержательную часть и текст наказания. Работает независимо от того,
 * стоит ли "Наказание" в начале своей строки или вклеено в конец абзаца.
 */
function splitPunishmentFromText(text) {
  if (!text) return { text: '', punishment: null };

  const matches = [...text.matchAll(PUNISHMENT_RE)].filter((m) => isBoundary(text, m.index));
  if (!matches.length) {
    return { text: cleanText(text), punishment: null };
  }

  const last = matches[matches.length - 1];
  const before = text.slice(0, last.index);
  const after = text.slice(last.index + last[0].length);

  return {
    text: cleanText(before),
    punishment: cleanText(after) || null,
  };
}

function parseCodex(rawText) {
  const text = normalizeWhitespace(rawText);
  const articles = [];

  const headerMatches = [...text.matchAll(ARTICLE_HEADER_RE)].filter((m) => isBoundary(text, m.index));

  for (let i = 0; i < headerMatches.length; i++) {
    const m = headerMatches[i];
    const bodyStart = m.index + m[0].length;
    const bodyEnd = i + 1 < headerMatches.length ? headerMatches[i + 1].index : text.length;
    const chunk = text.slice(bodyStart, bodyEnd).trim();

    const stars = m[2] || '';
    const article = {
      number: m[1],
      rating: stars.length || null,
      tag: m[3] ? m[3].trim() : null,
      title: null,
      parts: [],
    };

    const partMatches = [...chunk.matchAll(PART_HEADER_RE)].filter((pm) => isBoundary(chunk, pm.index));

    if (partMatches.length === 0) {
      // явных частей нет — весь текст статьи это одно тело
      const split = splitPunishmentFromText(chunk);
      article.parts.push({ part: null, text: split.text, punishment: split.punishment });
    } else {
      // текст до первой части — короткое название статьи (если есть)
      const headText = chunk.slice(0, partMatches[0].index).trim();
      article.title = headText ? cleanText(headText) : null;

      for (let j = 0; j < partMatches.length; j++) {
        const pm = partMatches[j];
        const partBodyStart = pm.index + pm[0].length;
        const partBodyEnd = j + 1 < partMatches.length ? partMatches[j + 1].index : chunk.length;
        const partChunk = chunk.slice(partBodyStart, partBodyEnd).trim();

        const split = splitPunishmentFromText(partChunk);
        article.parts.push({
          part: parseInt(pm[1], 10),
          text: split.text,
          punishment: split.punishment,
        });
      }
    }

    articles.push(article);
  }

  return articles;
}

function cleanText(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

// ------------------------------------------------------------------
// HTML -> текст, без потерь структуры
// ------------------------------------------------------------------

const NAMED_ENTITIES = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  laquo: '«',
  raquo: '»',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  copy: '©',
  reg: '®',
  deg: '°',
  bull: '•',
};

function decodeEntities(str) {
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) =>
      Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : m
    );
}

/**
 * Превращает сырой HTML (innerHTML одного или нескольких bbWrapper, склеенных
 * маркером POST_BREAK) в текст. Переносы строк тут не критичны для парсинга
 * (parseCodex работает по всему тексту целиком), но сохраняются для
 * читаемости и на случай отладки через *.raw.html/*.txt.
 */
function htmlToText(html) {
  if (!html) return '';

  let text = html;

  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<blockquote[\s\S]*?<\/blockquote>/gi, '');

  text = text.replace(/<!--\s*POST_BREAK\s*-->/g, '\n\n');

  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<li[^>]*>/gi, '\n');
  text = text.replace(
    /<\/(p|div|li|tr|td|th|h[1-6]|blockquote|section|article|table|ul|ol)>/gi,
    '\n'
  );

  text = text.replace(/<[^>]+>/g, '');
  text = decodeEntities(text);

  text = text
    .split('\n')
    .map((l) => l.replace(/\u00A0/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

function parseCodexFromHtml(html) {
  const text = htmlToText(html);
  return parseCodex(text);
}

module.exports = { parseCodex, parseCodexFromHtml, htmlToText, cleanText };
