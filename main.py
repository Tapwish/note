#!/usr/bin/env python3
import os
import sys
import time
import json
import re
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
        
        # Данные по каждому серверу
        self.servers_data = {}
    
    def _ensure_directories(self):
        """Создаёт все необходимые папки"""
        os.makedirs(config.DATA_DIR, exist_ok=True)
        logger.info(f"📁 Папка создана: {config.DATA_DIR}")
    
    def _get_server_folder(self, server_name: str) -> str:
        """Генерирует имя папки для сервера"""
        # Приводим к нижнему регистру, заменяем пробелы на дефисы
        folder_name = server_name.lower().replace(' ', '-')
        # Убираем спецсимволы
        folder_name = re.sub(r'[^a-z0-9-]', '', folder_name)
        return folder_name
    
    def run(self):
        try:
            logger.info("🚀 Запуск Majestic RP Laws Parser (GitHub Actions)")
            start_time = time.time()
            
            # Обрабатываем каждый сервер
            for server in config.SERVERS:
                self._process_server(server)
                time.sleep(1)
            
            # ============================================================
            # СОХРАНЯЕМ КАЖДЫЙ СЕРВЕР В ОТДЕЛЬНУЮ ПАПКУ
            # ============================================================
            self._save_all_servers()
            
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
            
            # Данные для этого сервера
            server_data = {
                'name': server_name,
                'url': section_url,
                'codexes': {}
            }
            
            server_articles = 0
            
            # Парсим каждый кодекс
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
                    # Сохраняем в данные сервера
                    server_data['codexes'][codex_type.lower()] = {
                        'theory': theory,
                        'articles': articles,
                        'url': codex_url
                    }
                    
                    server_articles += len(articles)
                    self.total_articles += len(articles)
                    logger.success(f"  ✅ {codex_type}: {len(articles)} статей")
                else:
                    logger.warning(f"  ⚠️ {codex_type}: 0 статей")
            
            if server_articles > 0:
                # Сохраняем данные сервера
                folder_name = self._get_server_folder(server_name)
                self.servers_data[folder_name] = server_data
                self.servers_processed += 1
                logger.success(f"✅ {server_name}: {server_articles} статей -> папка {folder_name}")
            else:
                logger.warning(f"⚠️ {server_name}: 0 статей, пропускаем")
                
        except Exception as e:
            logger.error(f"❌ Ошибка: {str(e)}")
            self.errors.append(f"{server_name}: {str(e)}")
    
    def _save_all_servers(self):
        """Сохраняет каждый сервер в отдельную папку"""
        logger.info("\n" + "="*50)
        logger.info("💾 СОХРАНЕНИЕ СЕРВЕРОВ В ОТДЕЛЬНЫЕ ПАПКИ")
        logger.info("="*50)
        
        for folder_name, server_data in self.servers_data.items():
            # Создаём папку для сервера
            server_folder = os.path.join(config.DATA_DIR, folder_name)
            os.makedirs(server_folder, exist_ok=True)
            
            logger.info(f"\n📁 {server_data['name']} -> {folder_name}/")
            
            # Сохраняем каждый кодекс
            for codex_key, codex_data in server_data['codexes'].items():
                filename = f"{codex_key}.json"
                filepath = os.path.join(server_folder, filename)
                
                # Структура файла
                output = {
                    "theory": codex_data['theory'],
                    "articles": codex_data['articles'],
                    "url": codex_data.get('url', '')
                }
                
                with open(filepath, 'w', encoding='utf-8') as f:
                    json.dump(output, f, ensure_ascii=False, indent=2)
                
                logger.info(f"  ✅ {codex_key.upper()}: {len(codex_data['articles'])} статей -> {filename}")
            
            # Сохраняем метаданные сервера
            meta_path = os.path.join(server_folder, '_meta.json')
            meta = {
                "name": server_data['name'],
                "url": server_data['url'],
                "codexes": list(server_data['codexes'].keys()),
                "total_articles": sum(len(c['articles']) for c in server_data['codexes'].values()),
                "updatedAt": int(datetime.now().timestamp() * 1000)
            }
            with open(meta_path, 'w', encoding='utf-8') as f:
                json.dump(meta, f, ensure_ascii=False, indent=2)
    
    def _create_report(self, elapsed_time: float):
        """Создаёт общий отчёт"""
        report = {
            "updatedAt": int(datetime.now().timestamp() * 1000),
            "servers_processed": self.servers_processed,
            "total_articles": self.total_articles,
            "errors": self.errors,
            "elapsedTime": round(elapsed_time, 2),
            "servers": {}
        }
        
        for folder_name, server_data in self.servers_data.items():
            report["servers"][folder_name] = {
                "name": server_data['name'],
                "codexes": {
                    key: len(data['articles'])
                    for key, data in server_data['codexes'].items()
                },
                "total": sum(len(c['articles']) for c in server_data['codexes'].values())
            }
        
        with open(config.REPORT_FILE, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        
        logger.info(f"📄 Отчёт сохранён: {config.REPORT_FILE}")


def main():
    parser = MajesticLawParser()
    parser.run()


if __name__ == "__main__":
    main()
