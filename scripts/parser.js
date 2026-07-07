const fs = require('fs');
const https = require('https');

// ============================================================
// 1. ЗАГРУЗКА HTML
// ============================================================

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ============================================================
// 2. ИЗВЛЕЧЕНИЕ ТЕКСТА ИЗ HTML
// ============================================================

function extractText(html) {
  const messages = [];
  let start = 0;
  while (true) {
    const open = html.indexOf('<div class="message-content"', start);
    if (open === -1) break;
    const close = html.indexOf('</div>', open);
    if (close === -1) break;
    let content = html.substring(open, close);
    content = content.replace(/<[^>]*>/g, ' ');
    content = content.replace(/\s+/g, ' ').trim();
    if (content) messages.push(content);
    start = close + 1;
  }
  return messages.join('\n');
}

// ============================================================
// 3. ПАРСИНГ В JSON (с sections, chapters, articles, parts)
// ============================================================

function parseLawWithSections(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  const sections = [];
  let currentSection = null;
  let currentChapter = null;
  let currentArticle = null;
  let currentParts = [];
  let buffer = [];

  // === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===

  function cleanText(t) {
    return t.replace(/\s+/g, ' ').trim();
  }

  function extractPunishment(t) {
    const match = t.match(/Наказание[:\s]+([^\n]*)/i);
    return match ? match[1].trim() : null;
  }

  function removePunishment(t) {
    return t.replace(/Наказание[:\s]+[^\n]*/i, '').trim();
  }

  function savePart() {
    if (currentParts.length > 0 && buffer.length > 0) {
      const partText = cleanText(buffer.join(' '));
      const punishment = extractPunishment(partText);
      currentParts.push({
        id: `ч. ${currentParts.length + 1}`,
        text: punishment ? `${removePunishment(partText)} Наказание: ${punishment}` : removePunishment(partText)
      });
      buffer = [];
    }
  }

  function saveArticle() {
    if (currentArticle) {
      // Если есть буфер, но нет частей — создаём ч. 1
      if (currentParts.length === 0 && buffer.length > 0) {
        const partText = cleanText(buffer.join(' '));
        const punishment = extractPunishment(partText);
        currentParts.push({
          id: 'ч. 1',
          text: punishment ? `${removePunishment(partText)} Наказание: ${punishment}` : removePunishment(partText)
        });
        buffer = [];
      }
      // Если есть буфер и есть части — добавляем к последней части
      if (buffer.length > 0 && currentParts.length > 0) {
        const lastPart = currentParts[currentParts.length - 1];
        const extraText = cleanText(buffer.join(' '));
        const punishment = extractPunishment(extraText);
        if (punishment) {
          lastPart.text = `${lastPart.text} ${removePunishment(extraText)} Наказание: ${punishment}`;
        } else {
          lastPart.text = `${lastPart.text} ${extraText}`;
        }
        buffer = [];
      }
      // Если нет частей и нет буфера — создаём заглушку
      if (currentParts.length === 0) {
        currentParts.push({
          id: 'ч. 1',
          text: currentArticle.title || 'Нет текста'
        });
      }
      currentArticle.parts = currentParts;
      currentChapter.articles.push(currentArticle);
      currentArticle = null;
      currentParts = [];
    }
  }

  function saveChapter() {
    if (currentChapter) {
      currentSection.chapters.push(currentChapter);
      currentChapter = null;
    }
  }

  function saveSection() {
    if (currentSection) {
      sections.push(currentSection);
      currentSection = null;
    }
  }

  // === ОСНОВНОЙ ЦИКЛ ===

  for (const line of lines) {
    // === НОВЫЙ РАЗДЕЛ ===
    const sectionMatch = line.match(/^(?:Раздел|Глава)\s+([\dIVXLCDM]+)\.?\s*(.*)$/i);
    if (sectionMatch && !line.match(/^Глава\s+[\dIVXLCDM]+/i)) {
      saveArticle();
      saveChapter();
      saveSection();
      
      currentSection = {
        id: sectionMatch[1],
        title: sectionMatch[2] || '',
        chapters: []
      };
      continue;
    }

    // === НОВАЯ ГЛАВА ===
    const chapterMatch = line.match(/^Глава\s+([\dIVXLCDM]+)\.?\s*(.*)$/i);
    if (chapterMatch) {
      saveArticle();
      saveChapter();
      
      currentChapter = {
        id: chapterMatch[1],
        title: chapterMatch[2] || '',
        articles: []
      };
      continue;
    }

    // === НОВАЯ СТАТЬЯ ===
    const articleMatch = line.match(/^Статья\s+(\d+(?:\.\d+)?)\s*(.*)$/i);
    if (articleMatch) {
      saveArticle();
      
      currentArticle = {
        id: articleMatch[1],
        title: articleMatch[2] || '',
        parts: []
      };
      currentParts = [];
      buffer = [];
      continue;
    }

    // === НАКАЗАНИЕ ===
    const punishMatch = line.match(/^Наказание[:\s]+(.*)$/i);
    if (punishMatch && currentArticle) {
      const punishment = punishMatch[1].trim();
      if (currentParts.length > 0) {
        const lastPart = currentParts[currentParts.length - 1];
        lastPart.text = `${lastPart.text} Наказание: ${punishment}`;
      } else {
        buffer.push(`Наказание: ${punishment}`);
      }
      continue;
    }

    // === ОБЫЧНЫЙ ТЕКСТ ===
    if (currentArticle) {
      buffer.push(line);
    }
  }

  // Сохраняем последние элементы
  saveArticle();
  saveChapter();
  saveSection();

  return { sections };
}

// ============================================================
// 4. ЗАПУСК
// ============================================================

async function main() {
  const urls = {
    pk: 'https://forum.majestic-rp.ru/threads/protsessual-nyi-kodeks-shtata-san-andreas.3232571/',
    uk: 'https://forum.majestic-rp.ru/threads/ugolovnyi-kodeks-shtata-san-andreas.3232577/',
    ak: 'https://forum.majestic-rp.ru/threads/administrativnyi-kodeks-shtata-san-andreas.3232568/',
    dk: 'https://forum.majestic-rp.ru/threads/dorozhnyi-kodeks-shtata-san-andreas.3232575/'
  };

  const titles = {
    pk: 'Процессуальный кодекс штата San-Andreas',
    uk: 'Уголовный кодекс штата San-Andreas',
    ak: 'Административный кодекс штата San-Andreas',
    dk: 'Дорожный кодекс штата San-Andreas'
  };

  for (const [type, url] of Object.entries(urls)) {
    try {
      console.log(`📥 Загрузка ${type}...`);
      const html = await fetchHtml(url);
      const text = extractText(html);
      const data = parseLawWithSections(text);
      
      // Добавляем метаданные
      const result = {
        server: 'orlando',
        serverName: 'Orlando',
        codexType: type,
        title: titles[type],
        url: url,
        lastUpdate: new Date().toISOString(),
        ...data,
        totalArticles: data.sections.reduce((acc, s) => {
          return acc + s.chapters.reduce((acc2, c) => acc2 + c.articles.length, 0);
        }, 0)
      };

      fs.writeFileSync(`${type}.json`, JSON.stringify(result, null, 2));
      console.log(`✅ ${type}.json — ${result.totalArticles} статей`);
    } catch (e) {
      console.error(`❌ ${type}: ${e.message}`);
    }
  }
}

main().catch(console.error);
