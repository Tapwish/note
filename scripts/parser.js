'use strict';

/**
 * Парсер уголовного/административного кодекса форума Majestic (XenForo).
 *
 * Проблема: в теме встречаются РАЗНЫЕ форматы статей:
 *
 *   Формат A (с частями):
 *     Статья 5.2 Общие начала назначения наказания
 *     ч. 1 Лицу, признанному виновным в совершении преступления, ...
 *
 *   Формат B (с тегом и наказанием сразу под текстом, без "ч."):
 *     Статья 12.5  [Федеральная] Организация экстремистской организации
 *     Организация деятельности общественного или религиозного объединения ...
 *     Наказание: 5 лет лишения свободы.
 *
 * Задача этого модуля — привести оба формата к единой структуре:
 *
 *   {
 *     number: '12.5',        // номер статьи как есть на форуме
 *     tag: 'Федеральная',    // тег в квадратных скобках, если был
 *     title: '...',          // заголовок статьи (остаток строки "Статья N ...")
 *     parts: [
 *       {
 *         part: 1,            // номер части (или null, если частей не было)
 *         text: '...',        // полный текст части/статьи
 *         punishment: '...'   // текст наказания или null
 *       }
 *     ]
 *   }
 *
 * Если у статьи не было явных "ч. N", она получает единственную "виртуальную"
 * часть с part: null — так формат остаётся одинаковым для всех статей.
 */

const ARTICLE_RE = /^Статья\s+(\d+(?:\.\d+)*)\s*(?:\[([^\]]+)\])?\s*(.*)$/i;
const PART_RE = /^ч\.?\s*(\d+)\s*[.)]?\s*(.*)$/i;
const PUNISHMENT_RE = /^Наказание\s*:\s*(.*)$/i;

/**
 * @param {string} rawText - весь текст темы (все посты склеены переводом строки)
 * @returns {Array<object>} массив нормализованных статей (см. описание выше)
 */
function parseCodex(rawText) {
  const lines = rawText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim());

  const articles = [];
  let currentArticle = null;
  let currentPart = null;

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
      // если явных "ч. N" не было — у нас накопился "черновой" body/punishment
      if (currentArticle.parts.length === 0) {
        currentArticle.parts.push({
          part: null,
          text: cleanText(currentArticle._body.join(' ')),
          punishment: currentArticle._punishment
            ? cleanText(currentArticle._punishment)
            : null,
        });
      }
      delete currentArticle._body;
      delete currentArticle._punishment;
      articles.push(currentArticle);
    }
  };

  for (const line of lines) {
    if (!line) continue;

    const articleMatch = line.match(ARTICLE_RE);
    if (articleMatch) {
      finalizeArticle();
      currentPart = null;
      currentArticle = {
        number: articleMatch[1],
        tag: articleMatch[2] ? articleMatch[2].trim() : null,
        title: cleanText(articleMatch[3] || ''),
        parts: [],
        _body: [],
        _punishment: null,
      };
      continue;
    }

    if (!currentArticle) continue; // мусор до первой статьи — пропускаем

    const partMatch = line.match(PART_RE);
    if (partMatch) {
      finalizePart();
      currentPart = {
        part: parseInt(partMatch[1], 10),
        text: [partMatch[2] || ''],
        punishment: null,
      };
      currentArticle.parts.push(currentPart);
      continue;
    }

    const punishmentMatch = line.match(PUNISHMENT_RE);
    if (punishmentMatch) {
      if (currentPart) {
        currentPart.punishment = punishmentMatch[1];
      } else {
        currentArticle._punishment = punishmentMatch[1];
      }
      continue;
    }

    // обычная строка текста
    if (currentPart) {
      currentPart.text.push(line);
    } else {
      currentArticle._body.push(line);
    }
  }

  finalizeArticle();
  return articles;
}

function cleanText(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

/**
 * "Разворачивает" статьи с несколькими частями в плоский список записей —
 * удобно для рендера/поиска/загрузки в БД.
 *
 * number для части получает вид "5.2.1" (номер статьи + номер части),
 * либо остаётся "5.2", если части не было.
 */
function flatten(articles) {
  const entries = [];
  for (const art of articles) {
    for (const part of art.parts) {
      entries.push({
        number: part.part != null ? `${art.number}.${part.part}` : art.number,
        articleNumber: art.number,
        part: part.part,
        // part.part === null значит, что в исходном тексте явной "ч. N"
        // не было (формат B). Для отображения в приложении такие статьи
        // всё равно должны показываться как "ч1" — поэтому partLabel
        // всегда числовой (реальный номер части, либо 1 по умолчанию).
        partLabel: part.part != null ? part.part : 1,
        tag: art.tag,
        title: art.title,
        text: part.text,
        punishment: part.punishment,
      });
    }
  }
  return entries;
}

/**
 * Короткое "резюме" для свёрнутого вида статьи (как в примере: "Статья N.
 * Краткое описание"). Если есть title с форума — используем его, иначе
 * обрезаем текст части.
 */
function shortTitle(entry, maxLen = 100) {
  const base = entry.title && entry.title.length > 0 ? entry.title : entry.text;
  if (base.length <= maxLen) return base;
  return base.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
}

/**
 * Рендерит плоский список записей в текстовый вид, как в примере ТЗ:
 *
 *   Статья 1. <краткое описание>
 *   <полный текст статьи>
 *   Наказание: <наказание>
 */
function renderText(entries) {
  return entries
    .map((e) => {
      const tag = e.tag ? ` [${e.tag}]` : '';
      const header = `Статья ${e.number}${tag}. ${shortTitle(e)}`;
      // partLabel всегда есть (даже у статей без явных "ч. N" в исходнике,
      // см. flatten()) — поэтому "чN" пишется перед текстом всегда.
      const body = `ч${e.partLabel} ${e.text}`;
      const punishment = `Наказание: ${e.punishment || '—'}`;
      return `${header}\n${body}\n${punishment}`;
    })
    .join('\n\n');
}

module.exports = { parseCodex, flatten, shortTitle, renderText, cleanText };
