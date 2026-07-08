'use strict';

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { parseCodex } = require('./parser.js');

// ============================================================
// ГАРАНТИРОВАННОЕ СОЗДАНИЕ ПАПКИ data/
// ============================================================
const DATA_DIR = path.join(__dirname, '../data');
try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('✅ Папка data/ создана');
} catch(e) {
    console.log('⚠️ Не удалось создать папку data/');
}

// ============================================================
// КОНФИГУРАЦИЯ СЕРВЕРОВ
// ============================================================
const SERVERS = [
    {
        id: 'orlando',
        name: 'Orlando',
        url: 'https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.1405/'
    }
    // ===== ДЛЯ ДОБАВЛЕНИЯ ДРУГИХ СЕРВЕРОВ =====
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
    content: '.message-body .bbWrapper, .bbWrapper, .messageContent'
};

// ============================================================
// ФУНКЦИИ
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
    console.log(`🔍 Ищем темы в разделе: ${sectionUrl}`);
    
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

async function scrapeThread(page, url) {
    try {
        console.log(`📖 Парсинг: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForSelector(SELECTORS.content, { timeout: 30000 });

        const text = await page.evaluate((selector) => {
            const el = document.querySelector(selector);
            if (!el) return null;
            const clone = el.cloneNode(true);
            clone.querySelectorAll('blockquote, .bbCodeBlock--quote, .quoteContainer').forEach(q => q.remove());
            return clone.innerText.trim();
        }, SELECTORS.content);

        return text;
    } catch (e) {
        console.error(`❌ Ошибка: ${e.message}`);
        return null;
    }
}

async function scrapeServer(server) {
    console.log(`\n🌐 Обработка: ${server.name} (${server.id})`);

    const serverDir = path.join(DATA_DIR, server.id);
    fs.mkdirSync(serverDir, { recursive: true });

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
        const results = {};

        for (const type of ['uk', 'ak', 'pk', 'dk']) {
            const thread = found[type];
            if (!thread) {
                console.log(`⚠️ ${type.toUpperCase()} не найден`);
                results[type] = { success: false };
                continue;
            }

            const text = await scrapeThread(page, thread.url);
            if (text) {
                const articles = parseCodex(text);
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
                console.log(`✅ ${type.toUpperCase()} сохранён (${articles.length} статей)`);
                results[type] = { success: true, articles: articles.length };
            } else {
                console.log(`❌ ${type.toUpperCase()} не спарсен`);
                results[type] = { success: false };
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
            console.error(`❌ Ошибка на ${server.id}:`, e.message);
            results[server.id] = { error: e.message };
        }
    }

    // .last-run.json
    const lastRunFile = path.join(DATA_DIR, '.last-run.json');
    try {
        fs.writeFileSync(lastRunFile, JSON.stringify({
            lastRun: new Date().toISOString(),
            servers: Object.keys(results).map(id => ({
                id,
                status: results[id].error ? 'error' : 'success'
            }))
        }, null, 2));
        console.log('✅ .last-run.json создан');
    } catch(e) {
        console.log('⚠️ .last-run.json не создан');
    }

    // report.json
    const reportPath = path.join(DATA_DIR, 'report.json');
    const report = {
        timestamp: new Date().toISOString(),
        servers: Object.keys(results).map(id => ({
            id,
            status: results[id].error ? 'error' : 'success',
            details: results[id]
        }))
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📊 Отчёт: ${reportPath}`);

    return results;
}

// ============================================================
// ЗАПУСК
// ============================================================
if (require.main === module) {
    const isTest = process.argv.includes('--test');

    if (isTest) {
        console.log('🧪 Тестовый режим (только Orlando)');
        const testServer = SERVERS.find(s => s.id === 'orlando');
        if (testServer) {
            scrapeServer(testServer).then(console.log).catch(console.error);
        }
    } else {
        scrapeAllServers().catch(console.error);
    }
}

module.exports = { scrapeServer, scrapeAllServers, SERVERS };
