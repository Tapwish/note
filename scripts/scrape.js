'use strict';

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { parseCodex, convertToAppFormat } = require('./parser.js');

// ============================================================
// КОНФИГУРАЦИЯ
// ============================================================

const DATA_DIR = path.join(__dirname, '../data');
try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('✅ Папка data/ создана');
} catch(e) {}

const SERVERS = [
    {
        id: 'orlando',
        name: 'Orlando',
        url: 'https://forum.majestic-rp.ru/forums/zakonodatel-naya-baza.1405/'
    }
];

const CODEX_KEYWORDS = {
    uk: ['уголовный кодекс', 'ук рф', 'уголовный', 'ук'],
    ak: ['административный кодекс', 'коап', 'административный'],
    pk: ['процессуальный кодекс', 'упк', 'процессуальный'],
    dk: ['дорожный кодекс', 'пдд', 'дорожный']
};

const SELECTORS = {
    threadLink: '.structItem-title a, a[data-preview]',
    content: '.message-body .bbWrapper, .bbWrapper, .messageContent'
};

// ============================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
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

function getCodexLabel(type) {
    const labels = {
        uk: 'Уголовный кодекс',
        ak: 'Административный кодекс',
        pk: 'Процессуальный кодекс',
        dk: 'Дорожный кодекс'
    };
    return labels[type] || type.toUpperCase();
}

// ============================================================
// ПОИСК ТЕМ НА ФОРУМЕ
// ============================================================

async function findCodexThreads(page, sectionUrl) {
    console.log(`🔍 Ищем темы в разделе: ${sectionUrl}`);
    
    try {
        await page.goto(sectionUrl, { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });
        
        // Ждём загрузки ссылок
        await page.waitForSelector(SELECTORS.threadLink, { 
            timeout: 30000 
        });

        // Собираем все ссылки на темы
        const threads = await page.evaluate((selector) => {
            const results = [];
            const links = document.querySelectorAll(selector);
            
            links.forEach(el => {
                const href = el.getAttribute('href');
                const title = el.innerText.trim();
                if (href && title) {
                    const fullUrl = href.startsWith('http') 
                        ? href 
                        : `https://forum.majestic-rp.ru${href}`;
                    results.push({ url: fullUrl, title });
                }
            });
            
            return results;
        }, SELECTORS.threadLink);

        console.log(`📋 Найдено тем: ${threads.length}`);

        // Определяем, какие темы относятся к кодексам
        const found = {};
        for (const thread of threads) {
            const type = detectCodexType(thread.title);
            if (type && !found[type]) {
                found[type] = { 
                    url: thread.url, 
                    title: thread.title 
                };
                console.log(`✅ Найден ${getCodexLabel(type)}: "${thread.title}"`);
            }
        }

        // Проверяем, все ли кодексы найдены
        const allTypes = ['uk', 'ak', 'pk', 'dk'];
        for (const type of allTypes) {
            if (!found[type]) {
                console.log(`⚠️ ${getCodexLabel(type)} не найден`);
            }
        }

        return found;

    } catch (e) {
        console.error(`❌ Ошибка поиска тем: ${e.message}`);
        return {};
    }
}

// ============================================================
// ПАРСИНГ СТРАНИЦЫ СТАТЬИ
// ============================================================

async function scrapeThread(page, url) {
    try {
        console.log(`📖 Парсинг: ${url}`);
        
        await page.goto(url, { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });
        
        // Ждём загрузки контента
        await page.waitForSelector(SELECTORS.content, { 
            timeout: 30000 
        });

        // Извлекаем HTML-контент
        const htmlContent = await page.evaluate((selector) => {
            const el = document.querySelector(selector);
            if (!el) return null;
            
            const clone = el.cloneNode(true);
            
            // Убираем цитаты
            clone.querySelectorAll('blockquote, .bbCodeBlock--quote, .quoteContainer, .bbCodeBlock').forEach(q => q.remove());
            
            // Убираем кнопки
            clone.querySelectorAll('button, .button, .js-quote, .js-insertQuote, .js-reply').forEach(b => b.remove());
            
            // Убираем спойлеры
            clone.querySelectorAll('.bbCodeSpoiler, .spoiler, .bbCodeSpoiler-button').forEach(s => s.remove());
            
            // Убираем подписи
            clone.querySelectorAll('.attribution, .message-attribution, .userSignature').forEach(s => s.remove());
            
            // Убираем скрытые элементы
            clone.querySelectorAll('[style*="display:none"], [style*="display: none"]').forEach(s => s.remove());
            
            // Получаем чистый HTML
            return clone.innerHTML;
        }, SELECTORS.content);

        if (!htmlContent) {
            throw new Error('Контент не найден');
        }

        console.log(`📄 HTML получен: ${htmlContent.length} символов`);
        return htmlContent;

    } catch (e) {
        console.error(`❌ Ошибка парсинга страницы: ${e.message}`);
        return null;
    }
}

// ============================================================
// ОСНОВНАЯ ФУНКЦИЯ ПАРСИНГА СЕРВЕРА
// ============================================================

async function scrapeServer(server) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🌐 Обработка: ${server.name} (${server.id})`);
    console.log(`${'='.repeat(60)}`);

    const serverDir = path.join(DATA_DIR, server.id);
    fs.mkdirSync(serverDir, { recursive: true });

    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage'
        ]
    });

    try {
        const page = await browser.newPage();
        
        // Устанавливаем юзер-агент
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        );
        
        // Устанавливаем таймауты
        page.setDefaultNavigationTimeout(60000);
        page.setDefaultTimeout(30000);

        // Ищем темы кодексов
        const found = await findCodexThreads(page, server.url);
        const results = {};

        // Парсим каждый кодекс
        const allTypes = ['uk', 'ak', 'pk', 'dk'];
        for (const type of allTypes) {
            const thread = found[type];
            
            if (!thread) {
                results[type] = { 
                    success: false, 
                    error: 'Тема не найдена' 
                };
                continue;
            }

            console.log(`\n📚 Парсинг ${getCodexLabel(type)}...`);

            // Получаем HTML страницы
            const html = await scrapeThread(page, thread.url);
            
            if (!html) {
                results[type] = { 
                    success: false, 
                    error: 'Не удалось получить HTML' 
                };
                continue;
            }

            // ===== УНИВЕРСАЛЬНЫЙ ПАРСИНГ =====
            console.log(`🔍 Парсинг статей из HTML...`);
            
            try {
                const parsedArticles = parseCodex(html);
                console.log(`📊 Найдено статей: ${parsedArticles.length}`);

                // Конвертируем в формат приложения
                const appData = convertToAppFormat(parsedArticles, type);
                
                // Статистика
                const theoryLines = appData.theoryText.split('\n').filter(l => l.trim()).length;
                const penaltyCount = appData.penaltyArticles.length;
                
                console.log(`📊 Статистика:`);
                console.log(`   - Всего статей: ${parsedArticles.length}`);
                console.log(`   - Статей с наказаниями: ${penaltyCount}`);
                console.log(`   - Строк теории: ${theoryLines}`);
                console.log(`   - Размер HTML: ${(html.length / 1024).toFixed(1)} KB`);

                // Сохраняем результат
                const output = {
                    server: server.id,
                    serverName: server.name,
                    codexType: type,
                    codexLabel: getCodexLabel(type),
                    title: thread.title,
                    url: thread.url,
                    lastUpdate: new Date().toISOString(),
                    // Исходный HTML
                    htmlContent: html,
                    // Распарсенные статьи
                    articles: parsedArticles,
                    // Данные для приложения
                    theoryText: appData.theoryText,
                    penaltyArticles: appData.penaltyArticles,
                    // Статистика
                    totalArticles: parsedArticles.length,
                    penaltyCount: penaltyCount,
                    theoryLines: theoryLines,
                    htmlSize: html.length
                };

                const filePath = path.join(serverDir, `${type}.json`);
                fs.writeFileSync(filePath, JSON.stringify(output, null, 2));
                console.log(`✅ ${getCodexLabel(type)} сохранён в ${filePath}`);

                results[type] = { 
                    success: true, 
                    totalArticles: parsedArticles.length,
                    penaltyCount: penaltyCount,
                    theoryLines: theoryLines
                };

            } catch (parseError) {
                console.error(`❌ Ошибка парсинга ${getCodexLabel(type)}:`, parseError.message);
                results[type] = { 
                    success: false, 
                    error: parseError.message 
                };
            }
        }

        return results;

    } catch (e) {
        console.error(`❌ Критическая ошибка: ${e.message}`);
        return { error: e.message };
    } finally {
        await browser.close();
        console.log(`\n✅ Браузер закрыт`);
    }
}

// ============================================================
// ПАРСИНГ ВСЕХ СЕРВЕРОВ
// ============================================================

async function scrapeAllServers() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 ЗАПУСК ПАРСИНГА ЗАКОНОВ`);
    console.log(`${'='.repeat(60)}`);
    console.log(`📁 Папка данных: ${DATA_DIR}`);
    console.log(`🖥️  Серверов: ${SERVERS.length}`);
    console.log(`⏰ Время: ${new Date().toLocaleString()}`);

    const results = {};
    const startTime = Date.now();

    for (const server of SERVERS) {
        try {
            results[server.id] = await scrapeServer(server);
        } catch (e) {
            console.error(`❌ Ошибка на ${server.id}:`, e.message);
            results[server.id] = { error: e.message };
        }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // ===== СОЗДАЁМ ОТЧЁТ =====
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 ИТОГОВЫЙ ОТЧЁТ (${elapsed}с)`);
    console.log(`${'='.repeat(60)}`);

    for (const [id, result] of Object.entries(results)) {
        const server = SERVERS.find(s => s.id === id);
        const name = server ? server.name : id;
        
        if (result.error) {
            console.log(`❌ ${name}: ОШИБКА — ${result.error}`);
        } else {
            let stats = [];
            for (const [type, data] of Object.entries(result)) {
                if (data.success) {
                    stats.push(`${getCodexLabel(type)}(${data.totalArticles} ст.)`);
                } else if (data.error) {
                    stats.push(`${getCodexLabel(type)}❌`);
                }
            }
            console.log(`✅ ${name}: ${stats.join(', ') || 'нет данных'}`);
        }
    }

    // Сохраняем отчёт
    const report = {
        timestamp: new Date().toISOString(),
        duration: parseFloat(elapsed),
        servers: Object.keys(results).map(id => ({
            id,
            status: results[id].error ? 'error' : 'success',
            details: results[id]
        }))
    };

    const reportPath = path.join(DATA_DIR, 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Отчёт сохранён: ${reportPath}`);

    // Сохраняем информацию о последнем запуске
    const lastRunPath = path.join(DATA_DIR, '.last-run.json');
    fs.writeFileSync(lastRunPath, JSON.stringify({
        lastRun: new Date().toISOString(),
        duration: parseFloat(elapsed),
        servers: Object.keys(results).map(id => ({
            id,
            status: results[id].error ? 'error' : 'success'
        }))
    }, null, 2));

    return results;
}

// ============================================================
// ТЕСТОВЫЙ РЕЖИМ
// ============================================================

async function testMode() {
    console.log('🧪 ТЕСТОВЫЙ РЕЖИМ');
    console.log('📖 Будет спарсен только Orlando\n');
    
    const testServer = SERVERS.find(s => s.id === 'orlando');
    if (!testServer) {
        console.error('❌ Тестовый сервер не найден');
        return;
    }

    // Ограничиваем количество попыток
    const result = await scrapeServer(testServer);
    
    console.log('\n📊 Результат теста:');
    console.log(JSON.stringify(result, null, 2));
    
    return result;
}

// ============================================================
// ЗАПУСК
// ============================================================

if (require.main === module) {
    const args = process.argv.slice(2);
    const isTest = args.includes('--test') || args.includes('-t');
    const isHelp = args.includes('--help') || args.includes('-h');

    if (isHelp) {
        console.log(`
Использование:
  node scraper.js          — полный парсинг всех серверов
  node scraper.js --test   — тестовый режим (только Orlando)
  node scraper.js --help   — показать эту справку
        `);
        process.exit(0);
    }

    if (isTest) {
        testMode().catch(console.error);
    } else {
        scrapeAllServers().catch(console.error);
    }
}

// ============================================================
// ЭКСПОРТ
// ============================================================

module.exports = {
    scrapeServer,
    scrapeAllServers,
    SERVERS,
    getCodexLabel,
    detectCodexType
};
