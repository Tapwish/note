'use strict';

/**
 * Парсер, который принимает HTML-контент и сохраняет его структуру
 */

function parseCodex(htmlContent) {
    // Сохраняем HTML как есть, но чистим от мусора
    const cleanHtml = htmlContent
        .replace(/\s+/g, ' ')
        .trim();

    // Пробуем извлечь статьи из HTML через регулярки
    // Но основной фокус — сохранить HTML структуру
    const articles = extractArticlesFromHtml(cleanHtml);
    
    return articles;
}

function extractArticlesFromHtml(html) {
    // Ищем все блоки статей в HTML
    // Статья обычно начинается с "Статья X.X" и заканчивается перед следующей "Статья"
    const articleRegex = /Статья\s+(\d+(?:\.\d+)*)[^<]*?(?=(?:Статья\s+\d|$))/gi;
    const articles = [];
    let match;
    
    // Временный парсинг для структуры
    const lines = html.split('\n');
    let currentArticle = null;
    let currentParts = [];
    let currentHtml = [];
    let isInArticle = false;
    
    for (const line of lines) {
        const trimmed = line.trim();
        
        // Проверяем, начинается ли строка с "Статья"
        const articleMatch = trimmed.match(/^Статья\s+(\d+(?:\.\d+)*)/i);
        if (articleMatch) {
            // Сохраняем предыдущую статью
            if (currentArticle && currentHtml.length > 0) {
                articles.push({
                    number: currentArticle,
                    html: currentHtml.join('\n'),
                    parts: currentParts
                });
                currentParts = [];
                currentHtml = [];
            }
            
            currentArticle = articleMatch[1];
            currentHtml.push(line);
            isInArticle = true;
            
            // Извлекаем заголовок
            const titleMatch = trimmed.match(/^Статья\s+\d+(?:\.\d+)*\s*(?:\[([^\]]+)\])?\s*(.*)/i);
            if (titleMatch) {
                currentParts.push({
                    part: null,
                    text: titleMatch[2]?.trim() || '',
                    punishment: null
                });
            }
        } else if (isInArticle) {
            currentHtml.push(line);
            
            // Проверяем на наличие наказания
            if (trimmed.includes('Наказание')) {
                const lastPart = currentParts[currentParts.length - 1];
                if (lastPart) {
                    const punishMatch = trimmed.match(/Наказание\s*[:.-]\s*(.*)/i);
                    if (punishMatch) {
                        lastPart.punishment = punishMatch[1].trim();
                    } else {
                        lastPart.punishment = trimmed;
                    }
                }
            }
        }
    }
    
    // Сохраняем последнюю статью
    if (currentArticle && currentHtml.length > 0) {
        articles.push({
            number: currentArticle,
            html: currentHtml.join('\n'),
            parts: currentParts
        });
    }
    
    return articles;
}

module.exports = { parseCodex };
