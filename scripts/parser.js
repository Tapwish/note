'use strict';

const ARTICLE_RE = /^Статья\s+(\d+(?:\.\d+)*)\s*(?:\[([^\]]+)\])?\s*(.*)$/i;
const PART_RE = /^ч\.?\s*(\d+)\s*[.)]?\s*(.*)$/i;
const PUNISHMENT_RE = /^Наказание\s*:\s*(.*)$/i;

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

    if (!currentArticle) continue;

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

module.exports = { parseCodex, cleanText };
