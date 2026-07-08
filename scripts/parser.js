'use strict';

/**
 * Универсальный парсер законов
 * Адаптируется под любую структуру HTML
 * Использует комбинацию методов для максимальной точности
 */

class UniversalLawParser {
    constructor() {
        this.strategies = [
            this.parseByStructure.bind(this),
            this.parseByRegex.bind(this),
            this.parseByDom.bind(this),
            this.parseByTextBlocks.bind(this)
        ];
    }

    /**
     * Главный метод парсинга
     * Перебирает все стратегии, пока не найдёт статьи
     */
    parse(htmlContent) {
        // Очищаем HTML
        const cleanHtml = this.cleanHtml(htmlContent);
        
        let articles = [];
        let usedStrategy = 'none';

        // Пробуем все стратегии по очереди
        for (const strategy of this.strategies) {
            try {
                const result = strategy(cleanHtml);
                if (result && result.length > 0) {
                    articles = result;
                    usedStrategy = strategy.name || 'unknown';
                    console.log(`✅ Парсинг успешен: стратегия "${usedStrategy}", найдено ${articles.length} статей`);
                    break;
                }
            } catch (e) {
                // Игнорируем ошибки, пробуем следующую стратегию
                continue;
            }
        }

        // Если ничего не найдено — пробуем экстренный парсинг
        if (articles.length === 0) {
            articles = this.emergencyParse(cleanHtml);
            console.log(`⚠️ Использован экстренный парсинг, найдено ${articles.length} статей`);
        }

        // Пост-обработка
        return this.postProcess(articles);
    }

    // ============================================================
    // 1. СТРУКТУРНЫЙ ПАРСИНГ (по DOM-элементам)
    // ============================================================
    parseByStructure(html) {
        const articles = [];
        
        // Ищем элементы, которые могут быть статьями
        const patterns = [
            /<h[1-6][^>]*>.*?Статья\s+(\d+(?:\.\d+)*).*?<\/h[1-6]>/gi,
            /<p[^>]*>.*?Статья\s+(\d+(?:\.\d+)*).*?<\/p>/gi,
            /<div[^>]*class="[^"]*article[^"]*"[^>]*>.*?<\/div>/gi,
            /<li[^>]*>.*?Статья\s+(\d+(?:\.\d+)*).*?<\/li>/gi
        ];

        for (const pattern of patterns) {
            const matches = html.matchAll(pattern);
            for (const match of matches) {
                const articleHtml = match[0];
                const number = match[1];
                const title = this.extractTitle(articleHtml);
                const parts = this.extractParts(articleHtml);
                
                if (parts.length > 0) {
                    articles.push({
                        number: number,
                        title: title,
                        parts: parts
                    });
                }
            }
        }

        return articles;
    }

    // ============================================================
    // 2. ПАРСИНГ ПО РЕГУЛЯРНЫМ ВЫРАЖЕНИЯМ
    // ============================================================
    parseByRegex(html) {
        const articles = [];
        
        // Убираем теги, оставляем только текст
        const text = this.stripTags(html);
        const lines = text.split('\n');

        let currentArticle = null;
        let currentParts = [];
        let buffer = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Ищем статью
            const articleMatch = trimmed.match(/^(?:Статья|ст\.?)\s+(\d+(?:\.\d+)*)\s*[.:-]?\s*(.*)/i);
            if (articleMatch) {
                if (currentArticle && currentParts.length > 0) {
                    articles.push({
                        number: currentArticle,
                        title: buffer.join(' ').trim(),
                        parts: currentParts
                    });
                }
                currentArticle = articleMatch[1];
                buffer = [articleMatch[2] || ''];
                currentParts = [];
                continue;
            }

            // Ищем часть статьи
            const partMatch = trimmed.match(/^(?:ч\.?\s*(\d+)|(\d+))\s*[.)]\s*(.*)/i);
            if (partMatch && currentArticle) {
                const partNum = partMatch[1] || partMatch[2];
                const text = partMatch[3]?.trim() || '';
                
                // Проверяем, не наказание ли это
                if (!text.match(/^Наказание/i)) {
                    if (currentParts.length > 0 && !currentParts[currentParts.length - 1].text) {
                        currentParts.pop();
                    }
                    currentParts.push({
                        part: parseInt(partNum, 10) || partNum,
                        text: text,
                        punishment: null
                    });
                    buffer.push(line);
                    continue;
                }
            }

            // Ищем наказание
            const punishMatch = trimmed.match(/^Наказание\s*[:.-]\s*(.*)/i);
            if (punishMatch && currentArticle && currentParts.length > 0) {
                currentParts[currentParts.length - 1].punishment = punishMatch[1]?.trim() || null;
                buffer.push(line);
                continue;
            }

            // Обычный текст
            if (currentArticle) {
                buffer.push(line);
                if (currentParts.length > 0) {
                    const lastPart = currentParts[currentParts.length - 1];
                    if (lastPart.text) {
                        lastPart.text += ' ' + trimmed;
                    } else {
                        lastPart.text = trimmed;
                    }
                }
            }
        }

        // Сохраняем последнюю статью
        if (currentArticle && currentParts.length > 0) {
            articles.push({
                number: currentArticle,
                title: buffer.join(' ').trim(),
                parts: currentParts
            });
        }

        return articles;
    }

    // ============================================================
    // 3. DOM-ПАРСИНГ (для HTML с чёткой структурой)
    // ============================================================
    parseByDom(html) {
        const articles = [];
        
        // Ищем блоки статей по классам
        const articleBlocks = html.match(/<[^>]*class="[^"]*(?:article|law|codex|section)[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi) || [];
        
        for (const block of articleBlocks) {
            const number = this.extractNumber(block);
            if (!number) continue;
            
            const title = this.extractTitle(block);
            const parts = this.extractParts(block);
            
            if (parts.length > 0) {
                articles.push({
                    number: number,
                    title: title,
                    parts: parts
                });
            }
        }

        return articles;
    }

    // ============================================================
    // 4. ПАРСИНГ ПО ТЕКСТОВЫМ БЛОКАМ
    // ============================================================
    parseByTextBlocks(html) {
        const articles = [];
        const text = this.stripTags(html);
        
        // Разбиваем на блоки по пустым строкам
        const blocks = text.split(/\n\s*\n/);
        
        let currentBlock = null;
        let buffer = [];

        for (const block of blocks) {
            const trimmed = block.trim();
            if (!trimmed) continue;

            // Проверяем, есть ли в блоке статья
            if (trimmed.match(/Статья\s+\d+(?:\.\d+)*/i)) {
                if (currentBlock && buffer.length > 0) {
                    const parsed = this.parseBlock(buffer.join('\n'));
                    if (parsed) {
                        articles.push(parsed);
                    }
                }
                currentBlock = trimmed;
                buffer = [trimmed];
            } else if (currentBlock) {
                buffer.push(trimmed);
            }
        }

        // Последний блок
        if (currentBlock && buffer.length > 0) {
            const parsed = this.parseBlock(buffer.join('\n'));
            if (parsed) {
                articles.push(parsed);
            }
        }

        return articles;
    }

    // ============================================================
    // 5. ЭКСТРЕННЫЙ ПАРСИНГ (когда ничего не работает)
    // ============================================================
    emergencyParse(html) {
        const articles = [];
        const text = this.stripTags(html);
        
        // Ищем все упоминания статей
        const matches = text.matchAll(/Статья\s+(\d+(?:\.\d+)*)\s*[.:-]?\s*([^.]*?)(?:\.|$)/gi);
        
        let currentNumber = null;
        let currentText = [];
        
        for (const match of matches) {
            const number = match[1];
            const title = match[2]?.trim() || '';
            
            if (currentNumber && currentText.length > 0) {
                articles.push({
                    number: currentNumber,
                    title: currentText.join(' ').trim(),
                    parts: [{
                        part: 1,
                        text: currentText.join(' ').trim(),
                        punishment: null
                    }]
                });
            }
            
            currentNumber = number;
            currentText = [title];
        }
        
        if (currentNumber && currentText.length > 0) {
            articles.push({
                number: currentNumber,
                title: currentText.join(' ').trim(),
                parts: [{
                    part: 1,
                    text: currentText.join(' ').trim(),
                    punishment: null
                }]
            });
        }

        return articles;
    }

    // ============================================================
    // ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
    // ============================================================

    cleanHtml(html) {
        return html
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<\/div>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .trim();
    }

    stripTags(html) {
        return html
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    extractNumber(html) {
        const match = html.match(/Статья\s+(\d+(?:\.\d+)*)/i);
        return match ? match[1] : null;
    }

    extractTitle(html) {
        const clean = this.stripTags(html);
        const match = clean.match(/Статья\s+\d+(?:\.\d+)*\s*[.:-]?\s*([^.]*?)(?:\.|$)/i);
        return match ? match[1]?.trim() || '' : '';
    }

    extractParts(html) {
        const parts = [];
        const text = this.stripTags(html);
        
        // Ищем части: ч.1, 1., 1)
        const partRegex = /(?:ч\.?\s*(\d+)|(\d+))\s*[.)]\s*([^]*?)(?=(?:ч\.?\s*\d+|\d+\s*[.)]|$))/gi;
        let match;
        
        while ((match = partRegex.exec(text)) !== null) {
            const partNum = match[1] || match[2];
            let partText = match[3]?.trim() || '';
            
            // Ищем наказание
            let punishment = null;
            const punishMatch = partText.match(/Наказание\s*[:.-]\s*([^]*?)$/i);
            if (punishMatch) {
                punishment = punishMatch[1].trim();
                partText = partText.replace(/Наказание\s*[:.-]\s*[^]*?$/i, '').trim();
            }
            
            if (partText || punishment) {
                parts.push({
                    part: parseInt(partNum, 10) || partNum,
                    text: partText,
                    punishment: punishment
                });
            }
        }

        return parts;
    }

    parseBlock(text) {
        const number = this.extractNumber(text);
        if (!number) return null;
        
        const title = this.extractTitle(text);
        const parts = this.extractParts(text);
        
        return {
            number: number,
            title: title || '',
            parts: parts.length > 0 ? parts : [{
                part: 1,
                text: this.stripTags(text).replace(/Статья\s+\d+(?:\.\d+)*\s*[.:-]?\s*/, '').trim(),
                punishment: null
            }]
        };
    }

    // ============================================================
    // ПОСТ-ОБРАБОТКА
    // ============================================================
    postProcess(articles) {
        return articles.map(article => {
            // Нормализуем номер
            const number = article.number || '';
            
            // Очищаем название
            let title = article.title || '';
            title = title.replace(/^[.,\s]+/, '').trim();
            
            // Обрабатываем части
            const parts = article.parts.map(part => {
                let text = part.text || '';
                let punishment = part.punishment || '';
                
                // Ищем наказание в тексте
                const punishMatch = text.match(/Наказание\s*[:.-]\s*([^]*?)$/i);
                if (punishMatch) {
                    punishment = punishMatch[1].trim();
                    text = text.replace(/Наказание\s*[:.-]\s*[^]*?$/i, '').trim();
                }
                
                // Очищаем текст
                text = text.replace(/^[.,\s]+/, '').trim();
                
                // Формируем ID части
                let id = '';
                if (part.part) {
                    if (typeof part.part === 'string' && part.part.match(/[а-я]/i)) {
                        id = part.part;
                    } else {
                        id = `ч. ${part.part}`;
                    }
                }
                
                return { id, text, punishment };
            }).filter(p => p.text || p.punishment);
            
            return { number, title, parts };
        }).filter(a => a.parts.length > 0);
    }

    /**
     * Конвертирует в формат приложения
     */
    convertToAppFormat(articles, tab) {
        if (!articles || articles.length === 0) {
            return { theoryText: '', penaltyArticles: [] };
        }

        const penaltyArticles = [];
        let theoryText = '';

        for (const article of articles) {
            const id = article.number || '';
            const title = article.title || '';
            
            // Определяем, является ли статья теоретической
            const numStr = id.split('.')[0] || id;
            const num = parseInt(numStr);
            let isTheory = false;
            
            if (tab === 'uk' && !isNaN(num) && num <= 5) isTheory = true;
            if (tab === 'ak' && !isNaN(num) && num < 5) isTheory = true;
            if (tab === 'pk') isTheory = true;
            
            if (article.parts && article.parts.length > 0) {
                if (isTheory) {
                    theoryText += `📌 Статья ${id}. ${title}\n`;
                    for (const part of article.parts) {
                        let line = '';
                        if (part.id) line += `${part.id} `;
                        if (part.text) line += `${part.text}`;
                        if (part.punishment) line += ` Наказание: ${part.punishment}`;
                        if (line.trim()) theoryText += `   ${line.trim()}\n`;
                    }
                    theoryText += '\n';
                } else {
                    const hasPunishment = article.parts.some(p => p.punishment);
                    if (hasPunishment || tab === 'ak' || tab === 'dk') {
                        penaltyArticles.push({
                            id: id,
                            title: title,
                            parts: article.parts
                        });
                    }
                }
            }
        }

        return { theoryText, penaltyArticles };
    }
}

// ============================================================
// ЭКСПОРТ
// ============================================================

const parser = new UniversalLawParser();

module.exports = {
    parseCodex: (html) => parser.parse(html),
    convertToAppFormat: (articles, tab) => parser.convertToAppFormat(articles, tab),
    UniversalLawParser
};
