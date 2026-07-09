#!/usr/bin/env python3
import os
import sys
import time
import json
from datetime import datetime
from typing import Dict, List, Optional

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager

from parsers.forum_parser import ForumParser
from parsers.codex_parser import CodexParser
from parsers.article_parser import ArticleParser
from utils.logger import logger
from config import config


class MajesticLawParser:
    def __init__(self):
        # СОЗДАЁМ ПАПКУ ДЛЯ ДАННЫХ
        self._ensure_directories()
        
        # НАСТРАИВАЕМ БРАУЗЕР
        chrome_options = Options()
        chrome_options.add_argument("--disable-blink-features=AutomationControlled")
        chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
        chrome_options.add_experimental_option('useAutomationExtension', False)
        
        # GitHub Actions
        chrome_options.add_argument("--headless")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--window-size=1920,1080")
        
        service = Service(ChromeDriverManager().install())
        self.driver = webdriver.Chrome(service=service, options=chrome_options)
        self.driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
        
        self.forum_parser = ForumParser(self.driver)
        self.codex_parser = CodexParser(self.driver)
        self.article_parser = ArticleParser()
        
        self.servers_processed = 0
        self.total_articles = 0
        self.errors = []
        self.start_time = time.time()
        
        # Словарь для хранения данных по каждому кодексу
        self.codex_data = {
            'uk': {'theory': '', 'articles': []},
            'pk': {'theory': '', 'articles': []},
            'ak': {'theory': '', 'articles': []},
            'dk': {'theory': '', 'articles': []}
        }
    
    def _ensure_directories(self):
        """Создаёт все необходимые папки"""
        os.makedirs(config.DATA_DIR, exist_ok=True)
        logger.info(f"📁 Папка создана: {config.DATA_DIR}")
    
    def run(self):
        try:
            logger.info("🚀 Запуск Majestic RP Laws Parser (GitHub Actions)")
            start_time = time.time()
            
            # Обрабатываем каждый сервер
            for server in config.SERVERS:
                self._process_server(server)
                time.sleep(1)
            
            # ============================================================
            # СОХРАНЯЕМ КАЖДЫЙ КОДЕКС В ОТДЕЛЬНЫЙ ФАЙЛ
            # ============================================================
            self._save_all_codexes()
            
            elapsed_time = time.time() - start_time
            self._create_report(elapsed_time)
            
            logger.success(f"✅ Готово за {elapsed_time:.2f} сек")
            logger.success(f"✅ Серверов: {self.servers_processed}, статей: {self.total_articles}")
            
        except Exception as e:
            logger.error(f"❌ Ошибка: {str(e)}")
            import traceback
            traceback.print_exc()
        finally:
            self.driver.quit()
    
    def _process_server(self, server: Dict[str, str]):
        """Обрабатывает один сервер"""
        server_name = server.get('name', 'Unknown')
        section_url = server.get('url', '')
        
        logger.info(f"\n{'='*50}")
        logger.info(f"🏢 {server_name}")
        logger.info(f"{'='*50}")
        
        try:
            # Ищем кодексы
            codex_links = self.forum_parser.find_codexes_in_section(section_url)
            
            if not codex_links:
                logger.warning(f"⚠️ Кодексы не найдены для {server_name}")
                return
            
            # Парсим каждый кодекс
            server_articles = 0
            
            for codex_type, codex_url in codex_links.items():
                logger.info(f"📖 Парсинг {codex_type}...")
                
                # Получаем HTML-контент
                html_content = self.codex_parser.get_codex_content(codex_url, self.driver)
                
                if not html_content:
                    logger.warning(f"  ⚠️ {codex_type}: не удалось загрузить")
                    continue
                
                # Парсим HTML в текст
                text_content = self.codex_parser.extract_text(html_content)
                
                if not text_content:
                    logger.warning(f"  ⚠️ {codex_type}: не удалось извлечь текст")
                    continue
                
                # Парсим текст в структурированные статьи
                parsed_data = self.article_parser.parse(text_content, codex_type.lower())
                
                articles = parsed_data.get('articles', [])
                theory = parsed_data.get('theory', '')
                
                if articles:
                    # Сохраняем в общий словарь
                    codex_key = codex_type.lower()
                    if codex_key not in self.codex_data:
                        self.codex_data[codex_key] = {'theory': '', 'articles': []}
                    
                    self.codex_data[codex_key]['theory'] = theory
                    self.codex_data[codex_key]['articles'].extend(articles)
                    
                    server_articles += len(articles)
                    self.total_articles += len(articles)
                    logger.success(f"  ✅ {codex_type}: {len(articles)} статей")
                else:
                    logger.warning(f"  ⚠️ {codex_type}: 0 статей")
            
            if server_articles > 0:
                self.servers_processed += 1
                logger.success(f"✅ {server_name}: {server_articles} статей")
            else:
                logger.warning(f"⚠️ {server_name}: 0 статей")
                
        except Exception as e:
            logger.error(f"❌ Ошибка: {str(e)}")
            self.errors.append(f"{server_name}: {str(e)}")
    
    def _save_all_codexes(self):
        """Сохраняет каждый кодекс в отдельный файл"""
        logger.info("\n" + "="*50)
        logger.info("💾 СОХРАНЕНИЕ КОДЕКСОВ В ОТДЕЛЬНЫЕ ФАЙЛЫ")
        logger.info("="*50)
        
        # Маппинг названий
        codex_names = {
            'uk': 'Уголовный кодекс',
            'pk': 'Процессуальный кодекс',
            'ak': 'Административный кодекс',
            'dk': 'Дорожный кодекс'
        }
        
        for codex_key, data in self.codex_data.items():
            if not data['articles']:
                logger.warning(f"⚠️ {codex_names.get(codex_key, codex_key)}: нет статей, пропускаем")
                continue
            
            filename = f"{codex_key}.json"
            filepath = os.path.join(config.DATA_DIR, filename)
            
            # Структура файла
            output = {
                "theory": data['theory'],
                "articles": data['articles']
            }
            
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(output, f, ensure_ascii=False, indent=2)
            
            logger.success(f"✅ {codex_names.get(codex_key, codex_key)}: {len(data['articles'])} статей -> {filename}")
    
    def _create_report(self, elapsed_time: float):
        """Создаёт отчёт"""
        report = {
            "updatedAt": int(datetime.now().timestamp() * 1000),
            "servers_processed": self.servers_processed,
            "total_articles": self.total_articles,
            "errors": self.errors,
            "elapsedTime": round(elapsed_time, 2),
            "codexes": {
                key: len(data['articles']) 
                for key, data in self.codex_data.items() 
                if data['articles']
            }
        }
        
        os.makedirs(config.DATA_DIR, exist_ok=True)
        with open(config.REPORT_FILE, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        
        logger.info(f"📄 Отчёт сохранён: {config.REPORT_FILE}")


def main():
    parser = MajesticLawParser()
    parser.run()


if __name__ == "__main__":
    main()
