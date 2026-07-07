const fs = require('fs');

// ============================================================
// УНИВЕРСАЛЬНЫЙ ПАРСЕР — РАБОТАЕТ С ЛЮБЫМ СТИЛЕМ
// ============================================================

function parseAnyLaw(text) {
  // Чистим текст
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const articles = [];
  let current = null;
  let buffer = [];
  let currentPart = null;
  let partBuffer = [];

  for (const line of lines) {
    // === НОВАЯ СТАТЬЯ ===
    const articleMatch = line.match(/^Статья\s+(\d+(?:\.\d+)?)\s*(.*)$/i);
    if (articleMatch) {
      saveArticle();
      
      current = {
        number: articleMatch[1],
        title: clean(articleMatch[2] || 'Без названия'),
        parts: []
      };
      currentPart = null;
      partBuffer = [];
      buffer = [];
      continue;
    }

    // === ПРОПУСКАЕМ ГЛАВЫ ===
    if (/^[Гг]лава\s+[\dIVXLCDM]+/i.test(line)) continue;

    // === ЕСЛИ НЕТ АКТИВНОЙ СТАТЬИ — ПРОПУСКАЕМ ===
    if (!current) continue;

    // === НОВАЯ ЧАСТЬ (ч. 1, ч. 2) ===
    const partMatch = line.match(/^ч\.?\s*(\d+)\s*[.)]?\s*(.*)$/i);
    if (partMatch) {
      savePart();
      
      currentPart = parseInt(partMatch[1]);
      if (partMatch[2]) partBuffer.push(partMatch[2]);
      continue;
    }

    // === НАКАЗАНИЕ (отдельной строкой) ===
    const punishMatch = line.match(/^Наказание[:\s]+(.*)$/i);
    if (punishMatch) {
      if (currentPart !== null) {
        // Если есть активная часть — наказание к ней
        partBuffer.push(`Наказание: ${punishMatch[1]}`);
      } else {
        // Если нет части — наказание в буфер статьи
        buffer.push(`Наказание: ${punishMatch[1]}`);
      }
      continue;
    }

    // === ОБЫЧНАЯ СТРОКА ===
    if (currentPart !== null) {
      partBuffer.push(line);
    } else {
      buffer.push(line);
    }
  }

  // Сохраняем последние
  savePart();
  saveArticle();

  return articles;

  // ========== ВНУТРЕННИЕ ФУНКЦИИ ==========

  function savePart() {
    if (currentPart !== null && partBuffer.length > 0) {
      const text = clean(partBuffer.join(' '));
      const punishment = extractPunishment(text);
      current.parts.push({
        part: currentPart,
        text: removePunishment(text),
        punishment: punishment
      });
      partBuffer = [];
    }
  }

  function saveArticle() {
    if (!current) return;
    
    // Если есть буфер, но не было частей — создаём ч. 1
    if (buffer.length > 0 && current.parts.length === 0) {
      const text = clean(buffer.join(' '));
      const punishment = extractPunishment(text);
      current.parts.push({
        part: 1,
        text: removePunishment(text),
        punishment: punishment
      });
      buffer = [];
    }
    
    // Если нет ни частей, ни буфера — заголовок
    if (current.parts.length === 0) {
      current.parts.push({
        part: 1,
        text: current.title || 'Нет текста',
        punishment: null
      });
    }
    
    articles.push(current);
    current = null;
  }
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

function clean(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function extractPunishment(text) {
  const match = text.match(/Наказание[:\s]+([^\n]*)/i);
  return match ? match[1].trim() : null;
}

function removePunishment(text) {
  return text.replace(/Наказание[:\s]+[^\n]*/i, '').trim();
}

// ============================================================
// ЗАПУСК ДЛЯ ВСЕХ СЕРВЕРОВ
// ============================================================

const servers = [
  'orlando',
  'boston',
  'miami'
  // ... добавь остальные
];

const types = ['uk', 'pk', 'ak', 'dk'];

for (const server of servers) {
  for (const type of types) {
    try {
      const raw = fs.readFileSync(`raw/${server}_${type}.txt`, 'utf8');
      const articles = parseAnyLaw(raw);
      
      const result = {
        server: server,
        serverName: server.charAt(0).toUpperCase() + server.slice(1),
        codexType: type,
        lastUpdate: new Date().toISOString(),
        articles: articles,
        totalArticles: articles.length
      };

      // Создаём папку для сервера
      if (!fs.existsSync(`laws/${server}`)) {
        fs.mkdirSync(`laws/${server}`, { recursive: true });
      }

      fs.writeFileSync(`laws/${server}/${type}.json`, JSON.stringify(result, null, 2));
      console.log(`✅ ${server}/${type}.json — ${articles.length} статей`);
    } catch (e) {
      console.log(`❌ ${server}/${type}: ${e.message}`);
    }
  }
}
