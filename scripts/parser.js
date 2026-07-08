'use strict';

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { parseCodexFromHtml } = require('./parser.js');

// ============================================================
// ГАРАНТИРОВАННОЕ СОЗДАНИЕ ПАПКИ data/ ПРИ ЗАПУСКЕ
// ============================================================
const DATA_DIR = path.join(__dirname, '../data');
try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('✅ Папка data/ создана (или уже существует)');
} catch(e) {
    console.log('⚠️ Не удалось создать папку data/');
}

// ============================================================
// КОНФИГУРАЦИЯ СЕРВЕРОВ — ТОЛЬКО ORLANDO
// ============================================================
const SERVERS = [
    {
        id: 'orlando',
        name: 'Orlando',
        url: 'https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.1405/'
    }
    // ===== ДЛЯ ДОБАВЛЕНИЯ ДРУГИХ СЕРВЕРОВ РАСКОММЕНТИРУЙ И ЗАМЕНИ ССЫЛКИ =====
    // {
    //     id: 'new_york',
    //     name: 'New York',
    //     url: 'https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.1405/'
    // }
];

// ============================================================
// КЛЮЧЕВЫЕ СЛОВА ДЛЯ ПОИСКА ТЕМ
// ============================================================
const CODEX_KEYWORDS = {
    uk: ['уголовный кодекс'],
    ak: ['административный кодекс'],
    pk: ['процессуальный кодекс'],
    dk: ['дорожный кодекс']
};

const SELECTORS = {
    threadLink: '.structItem-title a, a[data-preview]',
    // каждое сообщение в теме (XenForo 2)
    postArticle: 'article.message--post, article.message',
    // тело сообщения внутри поста
    content: '.message-body .bbWrapper, .bbWrapper, .messageContent',
    // кнопка спойлера, которую нужно "раскрыть", чтобы её содержимое попало в HTML
    spoilerButton: '.bbCodeSpoiler-button',
    // ссылка "следующая страница" в пагинации темы
    nextPage: '.pageNav-jump--next, a.pageNav-jump--next'
};

// ============================================================
// РАСКРЫТИЕ ВСЕХ СПОЙЛЕРОВ НА СТРАНИЦЕ
// (иначе их текст просто не попадёт ни в HTML, ни в innerText)
// ============================================================
async function expandAllSpoilers(page) {
    const MAX_ROUNDS = 25;
    for (let i = 0; i < MAX_ROUNDS; i++) {
        const clicked = await page.evaluate((selector) => {
            const buttons = Array.from(document.querySelectorAll(selector));
            let count = 0;
            for (const btn of buttons) {
                const wrapper = btn.closest('.bbCodeSpoiler');
                const content = wrapper ? wrapper.querySelector('.bbCodeSpoiler-content') : null;
                const isHidden = content &&
                    (content.style.display === 'none' || getComputedStyle(content).display === 'none');
                if (isHidden) {
                    btn.click();
                    count++;
                }
            }
            return count;
        }, SELECTORS.spoilerButton);

        if (clicked === 0) break;
        await new Promise((r) => setTimeout(r, 150));
    }
}

// ============================================================
// ИЗВЛЕЧЕНИЕ ВСЕХ ПОСТОВ ТЕКУЩЕЙ СТРАНИЦЫ (автор + сырой HTML тела)
// ============================================================
async function extractPostsOnPage(page) {
    return await page.evaluate((sel) => {
        const posts = [];
        document.querySelectorAll(sel.postArticle).forEach((art) => {
            const author = art.getAttribute('data-author') || '';
            const bodyEl = art.querySelector(sel.content.split(',')[0].trim()) || art.querySelector('.bbWrapper');
            if (!bodyEl) return;

            const clone = bodyEl.cloneNode(true);
            clone.querySelectorAll('blockquote, .bbCodeBlock--quote, .quoteContainer').forEach((q) => q.remove());

            posts.push({ author, html: clone.innerHTML });
        });
        return posts;
    }, SELECTORS);
}

// ============================================================
// ОСНОВНЫЕ ФУНКЦИИ
// ============================================================

function detectCodexType(title) {
    const lower = title.toLowerCase();
    for (const [type, keywords] of Object.entries(CODEX_KEYWORDS)) {
        for (const keyword of keywords) {
            if (lower.includes(keyword)) {
                return type;
            }
        }
    }
    return null;
}

async function findCodexThreads(page, sectionUrl) {
    console.log(`🔍 Ищем темы с кодексами в разделе: ${sectionUrl}`);

    await page.goto(sectionUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector(SELECTORS.threadLink, { timeout: 30000 });

    const threads = await page.evaluate((selector) => {
        const results = [];
        document.querySelectorAll(selector).forEach(el => {
            const href = el.getAttribute('href');
            const title = el.innerText.trim();
            if (href && title) {
                const fullUrl = href.startsWith('http') ? href : `https://forum.majestic-rp.ru${href}`;
                results.push({ url: fullUrl, title });
            }
        });
        return results;
    }, SELECTORS.threadLink);

    const found = {};
    for (const thread of threads) {
        const type = detectCodexType(thread.title);
        if (type && !found[type]) {
            found[type] = { url: thread.url, title: thread.title };
            console.log(`✅ Найден ${type.toUpperCase()}: "${thread.title}"`);
        }
    }

    return found;
}

/**
 * Скачивает ПОЛНЫЙ HTML темы, ничего не теряя:
 *  - раскрывает все спойлеры перед извлечением,
 *  - берёт innerHTML (а не innerText), чтобы сохранить всю структуру,
 *  - склеивает подряд идущие посты автора темы (кодекс часто разбит на
 *    несколько сообщений подряд из-за лимита символов XenForo),
 *  - при необходимости переходит по страницам пагинации, пока посты
 *    принадлежат автору темы.
 *
 * Возвращает сырой HTML (не текст) — его дальше разбирает parseCodexFromHtml.
 */
async function scrapeThread(page, url) {
    try {
        console.log(`📖 Парсинг: ${url}`);

        const htmlParts = [];
        let opAuthor = null;
        let currentUrl = url;
        let pageIndex = 1;
        const MAX_PAGES = 10;

        while (currentUrl && pageIndex <= MAX_PAGES) {
            await page.goto(currentUrl, { waitUntil: 'networkidle2', timeout: 60000 });
            await page.waitForSelector(SELECTORS.content, { timeout: 30000 });

            await expandAllSpoilers(page);

            const posts = await extractPostsOnPage(page);
            if (!posts.length) break;

            if (opAuthor === null) {
                opAuthor = posts[0].author;
            }

            let hitOtherAuthor = false;
            for (const post of posts) {
                if (post.author !== opAuthor) {
                    hitOtherAuthor = true;
                    break;
                }
                htmlParts.push(post.html);
            }

            if (hitOtherAuthor) {
                // дошли до ответа другого пользователя — кодекс закончился
                break;
            }

            // вся страница состояла из постов автора темы — проверяем, есть ли ещё страницы
            const nextHref = await page.evaluate((selector) => {
                const a = document.querySelector(selector);
                return a ? a.getAttribute('href') : null;
            }, SELECTORS.nextPage);

            if (!nextHref) break;

            currentUrl = nextHref.startsWith('http') ? nextHref : `https://forum.majestic-rp.ru${nextHref}`;
            pageIndex++;
            if (pageIndex > 1) {
                console.log(`   ↳ продолжение темы: страница ${pageIndex}`);
            }
        }

        if (!htmlParts.length) return null;

        return htmlParts.join('\n<!--POST_BREAK-->\n');
    } catch (e) {
        console.error(`❌ Ошибка парсинга ${url}: ${e.message}`);
        return null;
    }
}

async function scrapeServer(server) {
    console.log(`\n🌐 Обработка сервера: ${server.name} (${server.id})`);
    console.log(`🔗 Раздел с законами: ${server.url}`);

    const serverDir = path.join(DATA_DIR, server.id);
    if (!fs.existsSync(serverDir)) {
        fs.mkdirSync(serverDir, { recursive: true });
    }

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        );

        const found = await findCodexThreads(page, server.url);

        const codexTypes = ['uk', 'ak', 'pk', 'dk'];
        const results = {};

        for (const type of codexTypes) {
            const thread = found[type];
            if (!thread) {
                console.log(`⚠️ ${type.toUpperCase()} не найден в разделе`);
                results[type] = { success: false, error: 'Не найдено' };
                continue;
            }

            const html = await scrapeThread(page, thread.url);
            if (html) {
                const articles = parseCodexFromHtml(html);
                const output = {
                    server: server.id,
                    serverName: server.name,
                    codexType: type,
                    title: thread.title,
                    url: thread.url,
                    lastUpdate: new Date().toISOString(),
                    articles: articles,
                    totalArticles: articles.length
                };

                const filePath = path.join(serverDir, `${type}.json`);
                fs.writeFileSync(filePath, JSON.stringify(output, null, 2));

                // сырой HTML сохраняем отдельно — полезно для отладки парсера,
                // если регулярки в parser.js не разобрали что-то новое
                const rawPath = path.join(serverDir, `${type}.raw.html`);
                fs.writeFileSync(rawPath, html);

                console.log(`✅ ${type.toUpperCase()} сохранён (${articles.length} статей)`);
                results[type] = { success: true, articles: articles.length };
            } else {
                console.log(`❌ ${type.toUpperCase()} не удалось спарсить`);
                results[type] = { success: false, error: 'Ошибка парсинга' };
            }
        }

        return results;

    } finally {
        await browser.close();
    }
}

async function scrapeAllServers() {
    const results = {};

    for (const server of SERVERS) {
        try {
            results[server.id] = await scrapeServer(server);
        } catch (e) {
            console.error(`❌ Критическая ошибка на сервере ${server.id}:`, e.message);
            results[server.id] = { error: e.message };
        }
    }

    // ============================================================
    // ГАРАНТИРОВАННОЕ СОЗДАНИЕ .last-run.json
    // ============================================================
    const lastRunFile = path.join(DATA_DIR, '.last-run.json');
    try {
        fs.writeFileSync(lastRunFile, JSON.stringify({
            lastRun: new Date().toISOString(),
            servers: Object.keys(results).map(id => ({
                id,
                status: results[id].error ? 'error' : 'success'
            }))
        }, null, 2));
        console.log(`✅ .last-run.json создан`);
    } catch(e) {
        console.log('⚠️ Не удалось создать .last-run.json:', e.message);
        // СОЗДАЁМ МИНИМАЛЬНЫЙ ФАЙЛ, ЧТОБЫ GIT НЕ ПАДАЛ
        try {
            fs.writeFileSync(lastRunFile, JSON.stringify({ lastRun: new Date().toISOString() }));
            console.log('✅ .last-run.json создан (минимальная версия)');
        } catch(e2) {
            console.log('❌ Критическая ошибка: не удалось создать .last-run.json');
        }
    }

    // ============================================================
    // ОТЧЁТ
    // ============================================================
    const reportPath = path.join(DATA_DIR, 'report.json');
    const report = {
        timestamp: new Date().toISOString(),
        servers: Object.keys(results).map(id => ({
            id,
            status: results[id].error ? 'error' : 'success',
            details: results[id]
        }))
    };
    try {
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`\n📊 Отчёт сохранён в ${reportPath}`);
    } catch(e) {
        console.log('⚠️ Не удалось сохранить отчёт');
    }

    return results;
}

// ============================================================
// ЗАПУСК
// ============================================================
if (require.main === module) {
    const isTest = process.argv.includes('--test');

    if (isTest) {
        console.log('🧪 Тестовый режим');
        const testServer = SERVERS.find(s => s.id === 'orlando');
        if (testServer) {
            scrapeServer(testServer).then(console.log).catch(console.error);
        } else {
            console.log('❌ Сервер Orlando не найден в конфиге');
        }
    } else {
        scrapeAllServers().then(console.log).catch(console.error);
    }
}

module.exports = { scrapeServer, scrapeAllServers, SERVERS };
