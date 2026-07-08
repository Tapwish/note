'use strict';

/**
 * Парсер, который извлекает статьи из HTML-кода
 * Сохраняет структуру и форматирование
 * Возвращает данные в формате, совместимом с приложением
 */

function parseCodex(htmlContent) {
    // Очищаем HTML от лишних пробелов
    const cleanHtml = htmlContent
        .replace(/\s+/g, ' ')
        .trim();

    const articles = [];
    let currentNumber = null;
    let currentTitle = '';
    let currentTag = null;
    let currentParts = [];
    let currentHtml = [];
    let isInArticle = false;

    // Разбиваем на строки (сохраняя структуру)
    const lines = cleanHtml.split(/\n|(?=<)/);

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // ===== ИЩЕМ СТАТЬЮ =====
        const articleMatch = trimmed.match(/Статья\s+(\d+(?:\.\d+)*)\s*(?:\[([^\]]+)\])?\s*(.*)/i);
        if (articleMatch) {
            // Сохраняем предыдущую статью
            if (currentNumber && currentParts.length > 0) {
                articles.push({
                    number: currentNumber,
                    title: currentTitle,
                    tag: currentTag,
                    html: currentHtml.join(''),
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

        // ===== ИЩЕМ ЧАСТЬ СТАТЬИ =====
        const partMatch = trimmed.match(/ч\.?\s*(\d+)\s*[.)]?\s*(.*)/i);
        if (partMatch && isInArticle) {
            // Если есть предыдущая часть с пустым текстом — обновляем
            if (currentParts.length > 0 && currentParts[currentParts.length - 1].text === '') {
                currentParts.pop();
            }
            currentParts.push({
                part: parseInt(partMatch[1], 10),
                text: partMatch[2]?.trim() || '',
                punishment: null
            });
            currentHtml.push(line);
            continue;
        }

        // ===== ИЩЕМ НАКАЗАНИЕ =====
        const punishMatch = trimmed.match(/Наказание\s*[:.-]\s*(.*)/i);
        if (punishMatch && isInArticle && currentParts.length > 0) {
            const lastPart = currentParts[currentParts.length - 1];
            lastPart.punishment = punishMatch[1]?.trim() || null;
            currentHtml.push(line);
            continue;
        }

        // ===== ОБЫЧНЫЙ ТЕКСТ (добавляем к последней части) =====
        if (isInArticle && currentParts.length > 0) {
            if (!trimmed.match(/^ч\.?\s*\d+/) && !trimmed.match(/Наказание/)) {
                const lastPart = currentParts[currentParts.length - 1];
                if (lastPart.text) {
                    lastPart.text += ' ' + trimmed;
                } else {
                    lastPart.text = trimmed;
                }
                currentHtml.push(line);
            }
        } else if (isInArticle) {
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

    // ===== ЕСЛИ СТАТЕЙ НЕ НАШЛИ — ПРОБУЕМ АЛЬТЕРНАТИВНЫЙ МЕТОД =====
    if (articles.length === 0) {
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

/**
 * Конвертирует данные парсера в формат, совместимый с приложением
 * (для использования в shared.js)
 */
function convertToAppFormat(parsedArticles) {
    if (!parsedArticles || parsedArticles.length === 0) {
        return { theoryText: '', penaltyArticles: [] };
    }

    const penaltyArticles = [];
    let theoryText = '';

    for (const article of parsedArticles) {
        const id = article.number || '';
        const title = article.title || '';
        
        // Проверяем, является ли статья теоретической (по номеру)
        const numStr = id.split('.')[0] || id;
        const num = parseInt(numStr);
        let isTheory = false;
        
        // Для УК: статьи 1-5 — теория
        if (!isNaN(num) && num <= 5) isTheory = true;
        
        // Если есть части
        if (article.parts && article.parts.length > 0) {
            const parts = [];
            
            for (const part of article.parts) {
                const partNum = part.part || '';
                let text = part.text || '';
                let punishment = part.punishment || '';
                
                // Если текст содержит наказание — извлекаем его
                const punishMatch = text.match(/Наказание[:\s]+([^\n]*)$/i);
                if (punishMatch) {
                    punishment = punishMatch[1].trim();
                    text = text.replace(/\s*Наказание[:\s]+[^\n]*$/i, '').trim();
                }
                
                if (text || punishment) {
                    parts.push({
                        id: partNum ? `ч. ${partNum}` : '',
                        text: text,
                        punishment: punishment
                    });
                }
            }
            
            if (parts.length > 0) {
                if (isTheory) {
                    // Добавляем в теорию
                    theoryText += `📌 Статья ${id}. ${title}\n`;
                    for (const part of parts) {
                        let line = '';
                        if (part.id) line += `${part.id} `;
                        if (part.text) line += `${part.text}`;
                        if (part.punishment) line += ` Наказание: ${part.punishment}`;
                        if (line.trim()) theoryText += `   ${line.trim()}\n`;
                    }
                    theoryText += '\n';
                } else {
                    // Добавляем в статьи с наказаниями
                    penaltyArticles.push({
                        id: id,
                        title: title,
                        parts: parts
                    });
                }
            }
        }
    }

    return { theoryText, penaltyArticles };
}

module.exports = { parseCodex, convertToAppFormat };
