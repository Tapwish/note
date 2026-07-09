#!/usr/bin/env python3
"""
MAJESTIC RP LAWS PARSER
Полностью автономный парсер законодательной базы Majestic RP
"""

import os
import sys
import time
from datetime import datetime
from typing import Dict, List, Optional

from selenium import webdriver
from selenium.webdriver.edge.options import Options
from selenium.webdriver.edge.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from parsers.forum_parser import ForumParser
from parsers.codex_parser import CodexParser
from utils.logger import logger
from utils.exporter import Exporter
from utils.validator import Validator
from models.law_models import ServerLaws, Codex, Article
from config import config


# ================================================================
# ПУТЬ К MSEDGEDRIVER.EXE
# ================================================================
EDGE_DRIVER_PATH = r"C:\Users\Tapwish\Downloads\zakonka\parser\msedgedriver.exe"


class MajesticLawParser:
    """Основной класс парсера — обрабатывает все серверы"""
    
    def __init__(self):
        """Инициализация парсера с настройкой Edge драйвера"""
        
        # Проверяем, существует ли файл драйвера
        if not os.path.exists(EDGE_DRIVER_PATH):
            logger.error(f"❌ Файл драйвера не найден по пути: {EDGE_DRIVER_PATH}")
            logger.info("📥 Скачайте EdgeDriver с https://developer.microsoft.com/en-us/microsoft-edge/tools/webdriver/")
            logger.info("📂 И поместите файл msedgedriver.exe в папку с проектом")
            logger.info("⚠️ ВАЖНО: Скачайте версию, соответствующую вашему Edge!")
            sys.exit(1)
        
        # Настройки Edge
        edge_options = Options()
        edge_options.add_argument("--disable-blink-features=AutomationControlled")
        edge_options.add_experimental_option("excludeSwitches", ["enable-automation"])
        edge_options.add_experimental_option('useAutomationExtension', False)
        # edge_options.add_argument("--headless")  # Раскомментировать для фонового режима
        
        # Указываем путь к Edge (если не найдет автоматически)
        edge_options.binary_location = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
        
        # Подключаем драйвер по указанному пути
        service = Service(EDGE_DRIVER_PATH)
        self.driver = webdriver.Edge(service=service, options=edge_options)
        self.driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
        
        # Инициализация компонентов
        self.forum_parser = ForumParser(self.driver)
        self.codex_parser = CodexParser(self.driver)
        self.exporter = Exporter(config.DATA_DIR)
        self.validator = Validator()
        
        # Статистика
        self.servers_processed = 0
        self.total_articles = 0
        self.errors: List[str] = []
    
    def run(self):
        """Запуск парсинга всех серверов"""
        try:
            logger.info("🚀 Запуск Majestic RP Laws Parser (Edge)")
            start_time = time.time()
            
            # Проверяем наличие серверов в конфиге
            if not config.SERVERS:
                logger.error("❌ Серверы не найдены в конфигурации!")
                return
            
            logger.success(f"📋 Найдено серверов в конфиге: {len(config.SERVERS)}")
            
            # Обрабатываем каждый сервер
            for server in config.SERVERS:
                self._process_server(server)
                time.sleep(2)  # Задержка между серверами
            
            # Создаем отчет
            elapsed_time = time.time() - start_time
            self._create_report(elapsed_time)
            
            # Итоговый вывод
            logger.success(f"\n{'='*50}")
            logger.success(f"✅ Парсинг завершен за {elapsed_time:.2f} секунд")
            logger.success(f"📊 Обработано серверов: {self.servers_processed}")
            logger.success(f"📊 Всего статей: {self.total_articles}")
            if self.errors:
                logger.warning(f"⚠️ Ошибок: {len(self.errors)}")
            logger.success(f"{'='*50}")
            
        except KeyboardInterrupt:
            logger.warning("⏹ Прервано пользователем")
        except Exception as e:
            logger.error(f"❌ Критическая ошибка: {str(e)}")
            import traceback
            traceback.print_exc()
        finally:
            self.driver.quit()
            logger.info("🔚 Парсер завершил работу")
    
    def _process_server(self, server: Dict[str, str]):
        """
        Обработка отдельного сервера
        
        Args:
            server: Словарь с данными сервера {name, url}
        """
        server_name = server.get('name', 'Unknown')
        section_url = server.get('url', '')
        
        if not section_url:
            logger.error(f"❌ Нет URL для {server_name}")
            self.errors.append(f"Нет URL для {server_name}")
            return
        
        logger.info(f"\n{'='*50}")
        logger.info(f"🏢 Обработка сервера: {server_name}")
        logger.info(f"📂 Раздел: {section_url}")
        logger.info(f"{'='*50}")
        
        try:
            # ============================================================
            # ШАГ 1: Находим все кодексы в разделе
            # ============================================================
            codex_links = self.forum_parser.find_codexes_in_section(section_url)
            
            if not codex_links:
                logger.warning(f"⚠️ Кодексы не найдены для {server_name}")
                self.errors.append(f"Кодексы не найдены для {server_name}")
                return
            
            logger.success(f"✅ Найдено кодексов: {len(codex_links)}")
            
            # ============================================================
            # ШАГ 2: Создаем структуру для сервера
            # ============================================================
            server_laws = ServerLaws(server_name=server_name)
            server_articles_count = 0
            
            # ============================================================
            # ШАГ 3: Парсим каждый кодекс
            # ============================================================
            for codex_type, codex_url in codex_links.items():
                logger.info(f"\n📖 Парсинг {codex_type}...")
                
                try:
                    # Загружаем страницу кодекса через Selenium
                    result = self.codex_parser.parse_codex(codex_url, self.driver)
                    articles_data = result.get('articles', [])
                    
                    if not articles_data:
                        logger.warning(f"  ⚠️ {codex_type}: 0 статей")
                        continue
                    
                    # Конвертируем в объекты Article
                    articles = []
                    for a in articles_data:
                        article = Article(
                            code=a.get('code', ''),
                            title=a.get('title', ''),
                            text=a.get('text', ''),
                            penalty=a.get('penalty')
                        )
                        articles.append(article)
                    
                    # Создаем кодекс и добавляем в структуру
                    codex = Codex(url=codex_url, articles=articles)
                    server_laws.data[codex_type] = codex
                    
                    server_articles_count += len(articles)
                    self.total_articles += len(articles)
                    logger.success(f"  ✅ {codex_type}: {len(articles)} статей")
                    
                    # Показываем первую статью для проверки
                    if articles:
                        first = articles[0]
                        logger.debug(f"    📌 Первая: {first.code} - {first.title[:50] if first.title else 'Без названия'}")
                        if first.penalty:
                            logger.debug(f"    ⚖️ Наказание: {first.penalty[:50]}")
                    
                except Exception as e:
                    error_msg = f"Ошибка парсинга {codex_type} для {server_name}: {str(e)}"
                    self.errors.append(error_msg)
                    logger.error(f"  ❌ {error_msg}")
                    continue
                
                time.sleep(1)  # Задержка между кодексами
            
            # ============================================================
            # ШАГ 4: Валидация и сохранение
            # ============================================================
            if server_articles_count > 0:
                # Валидируем данные
                if self.validator.validate_server_laws(server_laws):
                    # Сохраняем JSON
                    self.exporter.save_server(server_name, section_url, server_laws)
                    self.servers_processed += 1
                    logger.success(f"\n✅ {server_name} успешно обработан: {server_articles_count} статей")
                else:
                    error_msg = f"Валидация не пройдена для {server_name}"
                    self.errors.append(error_msg)
                    logger.error(f"❌ {error_msg}")
            else:
                logger.warning(f"⚠️ {server_name}: статей не найдено")
                    
        except Exception as e:
            error_msg = f"Ошибка обработки {server_name}: {str(e)}"
            self.errors.append(error_msg)
            logger.error(f"❌ {error_msg}")
            import traceback
            traceback.print_exc()
    
    def _create_report(self, elapsed_time: float):
        """
        Создание отчета о работе парсера
        
        Args:
            elapsed_time: Время выполнения в секундах
        """
        report = {
            "updatedAt": int(datetime.now().timestamp() * 1000),
            "servers_processed": self.servers_processed,
            "total_servers": len(config.SERVERS),
            "total_articles": self.total_articles,
            "errors": self.errors,
            "elapsedTime": round(elapsed_time, 2)
        }
        self.exporter.save_report()


def main():
    """Точка входа в программу"""
    # Создаем директорию для данных, если её нет
    os.makedirs(config.DATA_DIR, exist_ok=True)
    
    # Запускаем парсер
    parser = MajesticLawParser()
    parser.run()


if __name__ == "__main__":
    main()