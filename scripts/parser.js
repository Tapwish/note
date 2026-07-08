='use strict';

/**
 * Парсер, который извлекает статьи из HTML-кода
 * Сохраняет структуру и форматирование
 */

function parseCodex(htmlContent) {
    // Разбиваем на строки
    const lines = htmlContent.split('\n');
    const articles = [];
    
    let currentArticle = null;
    let currentParts = [];
    let currentHtml = [];
    let currentNumber = null;
    let currentTitle = '';
    let currentTag = null;
    let isInArticle = false;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // ===== 1. НАХОДИМ СТАТЬЮ =====
        // "Статья 6.1 Название"
        // "Статья 12.4 ★★★★★ [Федеральная] Название"
        const articleMatch = trimmed.match(/Статья\s+(\d+(?:\.\d+)*)\s*(?:\[([^\]]+)\])?\s*(.*)/i);
        if (articleMatch) {
            // Сохраняем предыдущую статью
            if (currentNumber && currentParts.length > 0) {
                articles.push({
                    number: currentNumber,
                    title: currentTitle,
                    tag: currentTag,
                    html: currentHtml.join('\n'),
                    parts: currentParts
                });
                currentParts = [];
                currentHtml = [];
            }

            currentNumber = articleMatch[1];
            currentTag = articleMatch[2] || null;
            currentTitle = articleMatch[3]?.trim() || '';
            currentHtml.push(line);
            isInArticle = true;
            continue;
        }

        // ===== 2. НАХОДИМ ЧАСТЬ СТАТЬИ =====
        // "ч.1 Текст"
        // "ч. 1 Текст"
        // "часть 1 Текст"
        const partMatch = trimmed.match(/ч\.?\s*(\d+)\s*[.)]?\s*(.*)/i);
        if (partMatch && isInArticle) {
            currentParts.push({
                part: parseInt(partMatch[1], 10),
                text: partMatch[2]?.trim() || '',
                punishment: null
            });
            currentHtml.push(line);
            continue;
        }

        // ===== 3. НАХОДИМ НАКАЗАНИЕ =====
        // "Наказание: 5 лет ЛС"
        // "Наказание - 5 лет ЛС"
        const punishMatch = trimmed.match(/Наказание\s*[:.-]\s*(.*)/i);
        if (punishMatch && isInArticle && currentParts.length > 0) {
            const lastPart = currentParts[currentParts.length - 1];
            lastPart.punishment = punishMatch[1]?.trim() || null;
            currentHtml.push(line);
            continue;
        }

        // ===== 4. ОБЫЧНЫЙ ТЕКСТ =====
        // Если строка не начинается с маркеров и мы внутри статьи — добавляем к последней части
        if (isInArticle && currentParts.length > 0) {
            // Если строка не является новой частью или наказанием
            if (!trimmed.match(/^ч\.?\s*\d+/) && !trimmed.match(/Наказание/)) {
                const lastPart = currentParts[currentParts.length - 1];
                // Добавляем текст к последней части
                if (lastPart.text) {
                    lastPart.text += ' ' + trimmed;
                } else {
                    lastPart.text = trimmed;
                }
                currentHtml.push(line);
            }
        } else if (isInArticle) {
            // Если внутри статьи, но нет частей — добавляем в тело
            currentHtml.push(line);
        }
    }

    // Сохраняем последнюю статью
    if (currentNumber && currentParts.length > 0) {
        articles.push({
            number: currentNumber,
            title: currentTitle,
            tag: currentTag,
            html: currentHtml.join('\n'),
            parts: currentParts
        });
    }

    // ===== 4.5 ЕСЛИ СТАТЕЙ НЕ НАШЛИ — ПРОБУЕМ АЛЬТЕРНАТИВНЫЙ МЕТОД =====
    if (articles.length === 0) {
        console.log('⚠️ Статей не найдено, пробуем альтернативный парсинг...');
        return parseCodexAlternative(htmlContent);
    }

    return articles;
}

// ============================================================
// АЛЬТЕРНАТИВНЫЙ ПАРСИНГ (если основной не сработал)
// ============================================================
function parseCodexAlternative(htmlContent) {
    const articles = [];
    
    // Ищем все блоки, которые выглядят как статьи
    const blocks = htmlContent.split(/Статья\s+(\d+(?:\.\d+)*)/i);
    
    let currentNumber = null;
    let currentText = '';
    
    for (const block of blocks) {
        const trimmed = block.trim();
        if (!trimmed) continue;
        
        // Если блок начинается с номера — это новая статья
        const numMatch = trimmed.match(/^(\d+(?:\.\d+)*)/);
        if (numMatch) {
            if (currentNumber && currentText) {
                articles.push({
                    number: currentNumber,
                    title: currentText.split('\n')[0]?.trim() || '',
                    tag: null,
                    html: currentText,
                    parts: []
                });
            }
            currentNumber = numMatch[1];
            currentText = trimmed;
        } else if (currentNumber) {
            currentText += '\n' + trimmed;
        }
    }
    
    if (currentNumber && currentText) {
        articles.push({
            number: currentNumber,
            title: currentText.split('\n')[0]?.trim() || '',
            tag: null,
            html: currentText,
            parts: []
        });
    }
    
    return articles;
}

module.exports = { parseCodex };
