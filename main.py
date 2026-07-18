#!/usr/bin/env python3
# main.py

import os
import sys
import time
import json
from datetime import datetime
from typing import Dict

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from parsers.forum_parser import ForumParser
from parsers.ai_parser import AIParser
from utils.logger import logger
from config import config


class MajesticLawParser:
    def __init__(self):
        # Проверяем API ключ
        if not config.GROQ_API_KEY:
            logger.error("❌ GROQ_API_KEY не найден!")
            sys.exit(1)
        
        # Проверяем логин и пароль
        if not config.FORUM_LOGIN or not config.FORUM_PASSWORD:
            logger.error("❌ FORUM_LOGIN и FORUM_PASSWORD не найдены!")
            logger.error("   Добавьте их в GitHub Secrets или в .env файл")
            sys.exit(1)
        
        # Создаём папки
        os.makedirs(config.DATA_DIR, exist_ok=True)
        os.makedirs(config.EXPORT_DIR, exist_ok=True)
        logger.info(f"📁 Папки созданы: {config.DATA_DIR}, {config.EXPORT_DIR}")
        
        # Настраиваем браузер
        self._setup_driver()
        
        # 🔥 АВТОРИЗУЕМСЯ НА ФОРУМЕ
        self._login_to_forum()
        
        # Инициализируем парсеры
        self.ai_parser = AIParser(
            api_key=config.GROQ_API_KEY,
            model=config.GROQ_MODEL
        )
        self.forum_parser = ForumParser(self.driver, self.ai_parser)
        
        # Статистика
        self.servers_processed = 0
        self.total_articles = 0
        self.errors = []
        self.servers_data = {}
    
    def _setup_driver(self):
        """Настраивает Selenium WebDriver"""
        chrome_options = Options()
        chrome_options.add_argument("--headless=new")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--window-size=1920,1080")
        chrome_options.add_argument("--disable-blink-features=AutomationControlled")
        chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
        chrome_options.add_experimental_option("useAutomationExtension", False)
        
        if os.environ.get("GITHUB_ACTIONS") == "true":
            from selenium.webdriver.chrome.service import Service as ChromeService
            service = ChromeService(executable_path="/usr/bin/chromedriver")
            self.driver = webdriver.Chrome(service=service, options=chrome_options)
            logger.info("✅ Selenium настроен для GitHub Actions")
        else:
            from selenium.webdriver.chrome.service import Service
            from webdriver_manager.chrome import ChromeDriverManager
            service = Service(ChromeDriverManager().install())
            self.driver = webdriver.Chrome(service=service, options=chrome_options)
            logger.info("✅ Selenium настроен локально")
        
        self.driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
    
    # ================================================================
    # 🔥 АВТОРИЗАЦИЯ НА ФОРУМЕ (ИСПРАВЛЕННАЯ)
    # ================================================================
    
    def _login_to_forum(self):
        """Авторизуется на форуме Majestic RP"""
        logger.info("🔐 Авторизация на форуме...")
        
        try:
            # Переходим на страницу входа
            login_url = "https://forum.majestic-rp.ru/login"
            self.driver.get(login_url)
            
            # Ждем загрузки страницы
            WebDriverWait(self.driver, 20).until(
                EC.presence_of_element_located((By.TAG_NAME, "body"))
            )
            
            time.sleep(2)
            
            # 🔥 ПОЛЕ ЛОГИНА (name="login")
            login_field = WebDriverWait(self.driver, 10).until(
                EC.presence_of_element_located((By.NAME, "login"))
            )
            login_field.clear()
            login_field.send_keys(config.FORUM_LOGIN)
            logger.info("  ✅ Логин введен")
            
            # 🔥 ПОЛЕ ПАРОЛЯ (name="password")
            password_field = self.driver.find_element(By.NAME, "password")
            password_field.clear()
            password_field.send_keys(config.FORUM_PASSWORD)
            logger.info("  ✅ Пароль введен")
            
            # 🔥 КНОПКА ВХОДА (текст "Войти")
            login_button = WebDriverWait(self.driver, 10).until(
                EC.element_to_be_clickable((By.XPATH, "//button[contains(text(), 'Войти')]"))
            )
            login_button.click()
            logger.info("  ✅ Кнопка 'Войти' нажата")
            
            time.sleep(5)
            
            # Проверяем результат
            if "login" in self.driver.current_url.lower():
                logger.error("❌ Авторизация не удалась!")
                self.driver.save_screenshot("login_error.png")
                sys.exit(1)
            else:
                logger.success("✅ Авторизация успешна!")
                logger.info(f"  📍 Текущий URL: {self.driver.current_url}")
                
        except Exception as e:
            logger.error(f"❌ Ошибка авторизации: {str(e)}")
            try:
                self.driver.save_screenshot("login_error.png")
            except:
                pass
            sys.exit(1)
    
    def _get_server_id(self, server_name: str) -> str:
        """Получает ID сервера по имени"""
        for server in config.SERVERS:
            if server['name'] == server_name:
                return server['id']
        return server_name.lower().replace(' ', '-')
    
    def run(self):
        try:
            logger.info("🚀 Запуск Majestic RP Laws Parser (Groq AI)")
            logger.info(f"🤖 Модель: {config.GROQ_MODEL}")
            logger.info(f"📡 Серверов: {len(config.SERVERS)}")
            start_time = time.time()
            
            for idx, server in enumerate(config.SERVERS, 1):
                logger.info(f"\n{'='*50}")
                logger.info(f"📡 [{idx}/{len(config.SERVERS)}] {server.get('name', 'Unknown')}")
                logger.info(f"{'='*50}")
                self._process_server(server)
                time.sleep(config.REQUEST_DELAY)
            
            self._save_all_servers()
            self._export_for_app()
            
            elapsed_time = time.time() - start_time
            self._create_report(elapsed_time)
            
            logger.success(f"\n✅ Готово за {elapsed_time:.2f} сек")
            logger.success(f"✅ Серверов: {self.servers_processed}, статей: {self.total_articles}")
            
        except Exception as e:
            logger.error(f"❌ Критическая ошибка: {str(e)}")
            import traceback
            traceback.print_exc()
        finally:
            self.driver.quit()
    
    def _process_server(self, server: Dict[str, str]):
        """Обрабатывает один сервер"""
        server_name = server.get('name', 'Unknown')
        section_url = server.get('url', '')
        server_id = self._get_server_id(server_name)
        
        try:
            codex_links = self.forum_parser.find_codexes_in_section(section_url)
            
            if not codex_links:
                logger.warning(f"  ⚠️ Кодексы не найдены")
                return
            
            server_data = {
                'name': server_name,
                'id': server_id,
                'url': section_url,
                'codexes': {}
            }
            
            server_articles = 0
            
            for codex_type, codex_url in codex_links.items():
                try:
                    parsed_data = self.forum_parser.parse_codex_page(codex_url, codex_type)
                    
                    if parsed_data and parsed_data.get('sections'):
                        server_data['codexes'][codex_type.lower()] = parsed_data
                        
                        articles_count = 0
                        for section in parsed_data.get('sections', []):
                            for chapter in section.get('chapters', []):
                                articles_count += len(chapter.get('articles', []))
                        
                        server_articles += articles_count
                        self.total_articles += articles_count
                        logger.success(f"    ✅ {articles_count} статей")
                    else:
                        logger.warning(f"    ⚠️ 0 статей")
                        
                except Exception as e:
                    logger.error(f"    ❌ Ошибка {codex_type}: {str(e)}")
            
            if server_articles > 0:
                self.servers_data[server_id] = server_data
                self.servers_processed += 1
                logger.success(f"\n✅ {server_name}: {server_articles} статей")
            else:
                logger.warning(f"\n⚠️ {server_name}: 0 статей")
                
        except Exception as e:
            logger.error(f"❌ Ошибка {server_name}: {str(e)}")
    
    def _save_all_servers(self):
        """Сохраняет каждый сервер в отдельную папку"""
        logger.info("\n" + "="*50)
        logger.info("💾 СОХРАНЕНИЕ СЕРВЕРОВ")
        logger.info("="*50)
        
        for server_id, server_data in self.servers_data.items():
            server_folder = os.path.join(config.DATA_DIR, server_id)
            os.makedirs(server_folder, exist_ok=True)
            
            logger.info(f"\n📁 {server_data['name']} -> {server_id}/")
            
            for codex_key, codex_data in server_data['codexes'].items():
                filename = f"{codex_key.upper()}.json"
                filepath = os.path.join(server_folder, filename)
                
                with open(filepath, 'w', encoding='utf-8') as f:
                    json.dump(codex_data, f, ensure_ascii=False, indent=2)
                
                logger.info(f"  ✅ {codex_key.upper()} сохранен")
    
    def _export_for_app(self):
        """Экспортирует данные для приложения"""
        logger.info("\n📤 ЭКСПОРТ ДЛЯ ПРИЛОЖЕНИЯ")
        
        all_data = {'uk': [], 'ak': [], 'pk': [], 'dk': []}
        
        for server_id, server_data in self.servers_data.items():
            for codex_key, codex_data in server_data['codexes'].items():
                app_key = codex_key.lower()
                if app_key in all_data:
                    all_data[app_key].append({
                        "server": server_data['name'],
                        "data": codex_data
                    })
        
        for key, data in all_data.items():
            if data:
                filename = f"{key}.json"
                filepath = os.path.join(config.EXPORT_DIR, filename)
                with open(filepath, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                logger.info(f"  ✅ {filename} — {len(data)} серверов")
    
    def _create_report(self, elapsed_time: float):
        """Создаёт отчёт"""
        report = {
            "updatedAt": int(datetime.now().timestamp() * 1000),
            "servers_processed": self.servers_processed,
            "total_articles": self.total_articles,
            "elapsedTime": round(elapsed_time, 2),
            "ai_model": config.GROQ_MODEL
        }
        
        with open(config.REPORT_FILE, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        
        logger.info(f"\n📄 Отчёт сохранён: {config.REPORT_FILE}")


def main():
    parser = MajesticLawParser()
    parser.run()


if __name__ == "__main__":
    main()
