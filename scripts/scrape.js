const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { parseCodexText, parseDkText } = require('./parser');

// ==== НАСТРОЙКА: впишите сюда реальные ссылки на треды каждого кодекса ====
const CODICES = [
    {
        tab: 'uk',
        url: 'https://forum.majestic-rp.ru/threads/dorozhnyi-kodeks-shtata-san-andreas.3232575/',
        outFile: 'data/uk.json'
    },
    {
        tab: 'ak',
        url: 'https://forum.majestic-rp.ru/threads/administrativnyi-kodeks-shtata-san-andreas.3232568/',
        outFile: 'data/ak.json'
    },
    {
        tab: 'pk',
        url: 'https://forum.majestic-rp.ru/threads/protsessual-nyi-kodeks-shtata-san-andreas.3232571/',
        outFile: 'data/pk.json'
    },
    {
        tab: 'dk',
        url: 'https://forum.majestic-rp.ru/threads/dorozhnyi-kodeks-shtata-san-andreas.3232575/',
        outFile: 'data/dk.json'
    }
];

// Селектор первого поста в теме на XenForo. Если верстка форума другая -
// поменяйте здесь (см. инструкцию в README-automation.md, как его найти).
const FIRST_POST_SELECTOR = '.message-body .bbWrapper';

const LAST_RUN_FILE = 'data/.last-run.json';
const MIN_INTERVAL_DAYS = 3;

function shouldRunNow() {
    if (process.env.FORCE_UPDATE === 'true') return true;
    if (!fs.existsSync(LAST_RUN_FILE)) return true;
    const { lastRun } = JSON.parse(fs.readFileSync(LAST_RUN_FILE, 'utf8'));
    const diffDays = (Date.now() - new Date(lastRun).getTime()) / (1000 * 60 * 60 * 24);
    return diffDays >= MIN_INTERVAL_DAYS;
}

function saveLastRun() {
    fs.mkdirSync('data', { recursive: true });
    fs.writeFileSync(LAST_RUN_FILE, JSON.stringify({ lastRun: new Date().toISOString() }, null, 2));
}

async function scrapeOne(browser, entry) {
    const page = await browser.newPage();
    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
    );

    console.log(`[${entry.tab}] открываю ${entry.url}`);
    await page.goto(entry.url, { waitUntil: 'networkidle2', timeout: 60000 });

    await page.waitForSelector(FIRST_POST_SELECTOR, { timeout: 30000 });

    // берём именно ПЕРВЫЙ пост темы (там обычно лежит актуальный кодекс)
    const rawText = await page.$eval(FIRST_POST_SELECTOR, (el) => el.innerText);

    await page.close();

    const data = entry.tab === 'dk' ? parseDkText(rawText) : parseCodexText(rawText);

    fs.mkdirSync(path.dirname(entry.outFile), { recursive: true });

    const newJson = JSON.stringify(data, null, 2);
    const oldJson = fs.existsSync(entry.outFile) ? fs.readFileSync(entry.outFile, 'utf8') : null;

    if (newJson === oldJson) {
        console.log(`[${entry.tab}] изменений нет`);
    } else {
        fs.writeFileSync(entry.outFile, newJson, 'utf8');
        console.log(`[${entry.tab}] файл обновлён: ${entry.outFile}`);
    }
}

async function main() {
    if (!shouldRunNow()) {
        console.log('С последнего запуска прошло меньше 3 дней, пропускаю.');
        return;
    }

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        for (const entry of CODICES) {
            try {
                await scrapeOne(browser, entry);
            } catch (e) {
                // одна упавшая страница не должна валить весь прогон
                console.error(`[${entry.tab}] ошибка: ${e.message}`);
            }
        }
    } finally {
        await browser.close();
    }

    saveLastRun();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
