// ЭТОТ ФАЙЛ НАДО БУДЕТ ПОДОГНАТЬ ПОД РЕАЛЬНОЕ ФОРМАТИРОВАНИЕ ПОСТА.
// Ниже — рабочая базовая логика, рассчитанная на типичный для таких
// кодексов текст вида:
//
//   РАЗДЕЛ I. ОБЩИЕ ПОЛОЖЕНИЯ
//   ГЛАВА 1. НЕЧТО
//   Статья 1.1. Название статьи
//   1) текст части первой
//   2) текст части второй, тут может быть "Наказание: ..." или "★★"
//
//   Статья 1.2. Следующая статья
//   ...
//
// Если реальный текст выглядит иначе - пришлите мне кусок текста ОДНОЙ
// статьи как он есть в посте, и я перепишу регулярки под него.

const SECTION_RE = /^РАЗДЕЛ\s+([IVXLCDM\d]+)\.?\s*(.*)$/i;
const CHAPTER_RE = /^ГЛАВА\s+(\d+)\.?\s*(.*)$/i;
const ARTICLE_RE = /^Статья\s+([\d.]+)\.?\s*(.*)$/i;
// часть статьи. Реальный формат на форуме: "ч. 1 текст части", "ч.2 текст" и т.п.
// Дополнительно поддержаны варианты "1)" и "★" на случай, если в других
// кодексах (АК/ПК/ДК) части оформлены иначе.
const PART_PATTERNS = [
    /^ч\.?\s*(\d+)\.?\s*(.*)$/i,   // "ч. 1 текст" / "ч.1 текст" / "ч 1 текст"
    /^(\d+)[).]\s*(.*)$/,          // "1) текст" / "1. текст"
    /^★+\s*(.*)$/                  // "★ текст" (без явного номера)
];

function matchPart(line, currentPartsCount) {
    // "Примечание: текст" - отдельная часть с текстовым id, не продолжение предыдущей
    const namedMatch = line.match(/^(?:Примечание|Прим\.?)\s*:?\s*(.*)$/i);
    if (namedMatch) {
        return { id: 'Примечание', text: namedMatch[1] || '' };
    }

    for (let i = 0; i < PART_PATTERNS.length; i++) {
        const m = line.match(PART_PATTERNS[i]);
        if (!m) continue;
        if (i === PART_PATTERNS.length - 1) {
            // паттерн без номера - нумеруем по порядку
            return { id: String(currentPartsCount + 1), text: m[1] || '' };
        }
        return { id: m[1], text: m[2] || '' };
    }
    return null;
}

function parseCodexText(rawText) {
    const lines = rawText
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

    const sections = [];
    let currentSection = null;
    let currentChapter = null;
    let currentArticle = null;
    let currentPart = null;

    function ensureDefaultSection() {
        if (!currentSection) {
            currentSection = { id: '1', title: '', chapters: [] };
            sections.push(currentSection);
        }
        if (!currentChapter) {
            currentChapter = { id: '1', title: '', articles: [] };
            currentSection.chapters.push(currentChapter);
        }
    }

    function pushCurrentPart() {
        if (currentPart && currentArticle) {
            currentArticle.parts.push(currentPart);
        }
        currentPart = null;
    }

    function pushCurrentArticle() {
        pushCurrentPart();
        if (currentArticle && currentChapter) {
            currentChapter.articles.push(currentArticle);
        }
        currentArticle = null;
    }

    for (const line of lines) {
        const sectionMatch = line.match(SECTION_RE);
        if (sectionMatch) {
            pushCurrentArticle();
            currentSection = { id: sectionMatch[1], title: sectionMatch[2] || '', chapters: [] };
            sections.push(currentSection);
            currentChapter = null;
            continue;
        }

        const chapterMatch = line.match(CHAPTER_RE);
        if (chapterMatch) {
            pushCurrentArticle();
            ensureDefaultSection();
            currentChapter = { id: chapterMatch[1], title: chapterMatch[2] || '', articles: [] };
            currentSection.chapters.push(currentChapter);
            continue;
        }

        const articleMatch = line.match(ARTICLE_RE);
        if (articleMatch) {
            pushCurrentArticle();
            ensureDefaultSection();
            currentArticle = { id: articleMatch[1], title: articleMatch[2] || '', parts: [] };
            continue;
        }

        if (!currentArticle) {
            // строка до первой найденной статьи - пропускаем (шапка поста, оглавление и т.п.)
            continue;
        }

        // строки-заглушки/многоточия (".." и т.п.) пропускаем - это не данные
        if (/^\.{2,}$/.test(line)) continue;

        const partMatch = matchPart(line, currentArticle.parts.length);
        if (partMatch) {
            pushCurrentPart();
            currentPart = { id: partMatch.id, text: partMatch.text };
        } else if (currentPart) {
            // продолжение текста той же части на следующей строке
            currentPart.text += ' ' + line;
        } else {
            // строка внутри статьи, но ещё нет явного маркера части -
            // считаем её первой частью статьи
            currentPart = { id: '1', text: line };
        }
    }

    pushCurrentArticle();

    return { sections };
}

// ==== Короткий заголовок без ИИ (для ДК, где в посте только длинный
// сплошной абзац, а короткого названия статьи как такового нет) ====
//
// Логика: если недалеко от начала есть запятая - обрезаем по ней (обычно
// это конец смыслового вводного оборота). Если запятой нет/она слишком
// далеко - берём первые N слов целиком, без "...", без обрезания слова
// посередине.
function capitalize(s) {
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function deriveShortTitle(text, maxWords = 8, maxCharsForComma = 70) {
    const clean = text.trim();
    const commaIdx = clean.indexOf(',');
    if (commaIdx !== -1 && commaIdx <= maxCharsForComma) {
        return capitalize(clean.slice(0, commaIdx).trim());
    }
    const words = clean.split(/\s+/).slice(0, maxWords);
    let title = words.join(' ').replace(/[.,;:]+$/, '');
    return capitalize(title);
}

// ==== Парсер для ДК: статья = "Статья N. <сплошной текст>", без ч.N,
// с "Наказание: ..." отдельной строкой ниже. Короткий title для карточки
// генерируем сами (deriveShortTitle), а весь абзац + наказание кладём
// в parts[0].text - именно его показывает приложение целиком. ====
const ARTICLE_RE_DK = /^Статья\s+(\d+)\.?\s*(.*)$/i;

function parseDkText(rawText) {
    const lines = rawText
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

    const articles = [];
    let current = null; // { id, bodyLines: [] }

    function finalizeCurrent() {
        if (!current) return;
        const fullText = current.bodyLines.join(' ').replace(/\s+/g, ' ').trim();
        const descPart = fullText.split(/Наказание\s*:/i)[0].trim();
        const title = deriveShortTitle(descPart || fullText);
        articles.push({
            id: current.id,
            title,
            parts: [{ id: '1', text: fullText }]
        });
    }

    for (const line of lines) {
        if (/^\.{2,}$/.test(line)) continue; // многоточия-заглушки пропускаем

        const m = line.match(ARTICLE_RE_DK);
        if (m) {
            finalizeCurrent();
            current = { id: m[1], bodyLines: [] };
            if (m[2]) current.bodyLines.push(m[2]);
            continue;
        }

        if (!current) continue; // текст до первой статьи (шапка поста) - пропускаем
        current.bodyLines.push(line);
    }
    finalizeCurrent();

    // ДК в текущей схеме приложения не делится на разделы/главы (shared.js
    // просто идёт sections -> chapters -> articles), поэтому заворачиваем
    // всё в одну дефолтную секцию/главу для совместимости формата.
    return {
        sections: [
            {
                id: '1',
                title: '',
                chapters: [{ id: '1', title: '', articles }]
            }
        ]
    };
}

module.exports = { parseCodexText, parseDkText, deriveShortTitle };
