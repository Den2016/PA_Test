const fs = require('fs');
const path = require('path');
const GCodeGenerator = require('./generator.js');
const OrcaIntegration = require('./orca_integration');

class TestGenerator {
  constructor() {
    this.testResultsPath = path.join(__dirname, 'test_results');
    this.settingsPath = path.join(__dirname, 'settings.json');
    this.results = [];
  }

  // Очистка папки результатов
  clearTestResults() {
    if (fs.existsSync(this.testResultsPath)) {
      const files = fs.readdirSync(this.testResultsPath);
      files.forEach(file => {
        fs.unlinkSync(path.join(this.testResultsPath, file));
      });
      console.log('Папка test_results очищена');
    } else {
      fs.mkdirSync(this.testResultsPath, { recursive: true });
      console.log('Создана папка test_results');
    }
  }

  // Генерация PA значений
  generatePAValues(startPA, endPA, stepPA) {
    const values = [];
    for (let value = startPA; value <= endPA; value += stepPA) {
      values.push(parseFloat(value.toFixed(3)));
    }
    return values;
  }

  // Безопасное имя файла
  sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
  }

  // Получение пути к слайсеру
  getSlicerPath(slicer) {
    const appData = process.env.APPDATA;
    const slicerPaths = {
      qidi: path.join(appData, 'QIDISlicer'),
      prusa: path.join(appData, 'PrusaSlicer'),
      orca: path.join(__dirname, 'ini_examples', 'orcaslicer')
    };
    return slicerPaths[slicer];
  }

  // Тестирование одной конфигурации
  async testConfiguration(slicer, printerName, config) {
    const testName = `${slicer}-${this.sanitizeFilename(printerName)}-${this.sanitizeFilename(config.filament)}-${this.sanitizeFilename(config.print)}`;
    console.log(`\nТестирование: ${testName}`);

    try {
      const generator = new GCodeGenerator();
      const paValues = this.generatePAValues(
        config.paSettings.startPA,
        config.paSettings.endPA,
        config.paSettings.stepPA
      );

      let gcode;
      const slicerPath = this.getSlicerPath(slicer);
      
      // Извлекаем реальное имя принтера из физического принтера
      let actualPrinterName = printerName;
      if (printerName.includes('*')) {
        // Для PrusaSlicer формат: физический_принтер*принтер
        actualPrinterName = printerName.split('*')[1];
      }

      if (slicer === 'orca') {
        // Для Orca используем специальную логику
        gcode = generator.generate(
          slicerPath,
          actualPrinterName,
          config.filament,
          config.print,
          paValues,
          true // isOrca = true
        );
      } else {
        // Для других слайсеров обычная логика
        gcode = generator.generate(
          slicerPath,
          actualPrinterName,
          config.filament,
          config.print,
          paValues,
          false // isOrca = false
        );
      }

      // Анализируем пропущенные плейсхолдеры
      const placeholderAnalysis = this.analyzePlaceholders(gcode);
      
      // Сохраняем результат
      const filename = `${testName}.gcode`;
      const filepath = path.join(this.testResultsPath, filename);
      fs.writeFileSync(filepath, gcode, 'utf8');

      this.results.push({
        slicer,
        printer: printerName,
        filament: config.filament,
        print: config.print,
        paCount: paValues.length,
        paRange: `${paValues[0]}-${paValues[paValues.length - 1]}`,
        status: 'SUCCESS',
        filename,
        size: gcode.length,
        placeholders: placeholderAnalysis
      });

      const placeholderWarning = placeholderAnalysis.unresolved.length > 0 ? 
        ` ⚠️ ${placeholderAnalysis.unresolved.length} неразрешенных плейсхолдеров` : '';
      console.log(`✓ Успешно: ${filename} (${gcode.length} символов, ${paValues.length} PA значений)${placeholderWarning}`);

    } catch (error) {
      console.error(`✗ Ошибка: ${error.message}`);
      
      this.results.push({
        slicer,
        printer: printerName,
        filament: config.filament,
        print: config.print,
        status: 'ERROR',
        error: error.message,
        filename: null
      });
    }
  }

  // Анализ плейсхолдеров в G-code
  analyzePlaceholders(gcode) {
    const lines = gcode.split('\n');
    const unresolved = [];
    const resolved = [];
    
    // Паттерны для поиска плейсхолдеров
    const patterns = [
      /\{[^}]+\}/g,  // {placeholder}
      /\[[^\]]+\]/g  // [placeholder] для Klipper
    ];
    
    lines.forEach((line, lineNum) => {
      patterns.forEach(pattern => {
        const matches = line.match(pattern);
        if (matches) {
          matches.forEach(match => {
            // Исключаем комментарии и валидные G-code команды
            if (!line.trim().startsWith(';') && 
                !match.match(/^\{[0-9.]+\}$/) && // числовые значения
                !match.match(/^\[[XYZ][0-9.]+\]$/)) { // координаты
              unresolved.push({
                placeholder: match,
                line: lineNum + 1,
                context: line.trim()
              });
            } else {
              resolved.push(match);
            }
          });
        }
      });
    });
    
    return {
      total: unresolved.length + resolved.length,
      resolved: resolved.length,
      unresolved: unresolved
    };
  }

  // Анализ результатов
  analyzeResults() {
    console.log('\n=== АНАЛИЗ РЕЗУЛЬТАТОВ ===');
    
    const total = this.results.length;
    const successful = this.results.filter(r => r.status === 'SUCCESS').length;
    const failed = this.results.filter(r => r.status === 'ERROR').length;
    
    console.log(`Всего тестов: ${total}`);
    console.log(`Успешных: ${successful}`);
    console.log(`Ошибок: ${failed}`);
    console.log(`Процент успеха: ${((successful / total) * 100).toFixed(1)}%`);

    // Группировка по слайсерам
    const bySlicers = {};
    this.results.forEach(r => {
      if (!bySlicers[r.slicer]) bySlicers[r.slicer] = { success: 0, error: 0 };
      bySlicers[r.slicer][r.status === 'SUCCESS' ? 'success' : 'error']++;
    });

    console.log('\nПо слайсерам:');
    Object.entries(bySlicers).forEach(([slicer, stats]) => {
      console.log(`  ${slicer}: ${stats.success} успешных, ${stats.error} ошибок`);
    });

    // Ошибки
    const errors = this.results.filter(r => r.status === 'ERROR');
    if (errors.length > 0) {
      console.log('\nОШИБКИ:');
      errors.forEach(r => {
        console.log(`  ${r.slicer}/${r.printer}: ${r.error}`);
      });
    }

    // Статистика по размерам файлов
    const successful_results = this.results.filter(r => r.status === 'SUCCESS');
    if (successful_results.length > 0) {
      const sizes = successful_results.map(r => r.size);
      const avgSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;
      const minSize = Math.min(...sizes);
      const maxSize = Math.max(...sizes);
      
      console.log('\nСтатистика размеров файлов:');
      console.log(`  Средний: ${Math.round(avgSize)} символов`);
      console.log(`  Минимальный: ${minSize} символов`);
      console.log(`  Максимальный: ${maxSize} символов`);
      
      // Анализ плейсхолдеров
      const withPlaceholders = successful_results.filter(r => r.placeholders && r.placeholders.unresolved.length > 0);
      if (withPlaceholders.length > 0) {
        console.log('\n⚠️ ФАЙЛЫ С НЕРАЗРЕШЕННЫМИ ПЛЕЙСХОЛДЕРАМИ:');
        withPlaceholders.forEach(r => {
          console.log(`  ${r.filename}: ${r.placeholders.unresolved.length} плейсхолдеров`);
          r.placeholders.unresolved.slice(0, 3).forEach(p => {
            console.log(`    - ${p.placeholder} (строка ${p.line})`);
          });
          if (r.placeholders.unresolved.length > 3) {
            console.log(`    ... и еще ${r.placeholders.unresolved.length - 3}`);
          }
        });
      } else {
        console.log('\n✓ Все плейсхолдеры успешно разрешены');
      }
    }

    // Сохраняем отчет
    const reportPath = path.join(this.testResultsPath, 'test_report.json');
    fs.writeFileSync(reportPath, JSON.stringify({
      summary: { total, successful, failed, successRate: (successful / total) * 100 },
      bySlicers,
      results: this.results
    }, null, 2), 'utf8');
    
    console.log(`\nОтчет сохранен: ${reportPath}`);
  }

  // Основной метод тестирования
  async runTests() {
    console.log('=== ЗАПУСК ТЕСТИРОВАНИЯ ГЕНЕРАТОРА G-CODE ===');
    
    // Очищаем папку результатов
    this.clearTestResults();

    // Загружаем настройки
    if (!fs.existsSync(this.settingsPath)) {
      console.error('Файл settings.json не найден!');
      return;
    }

    const settings = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
    
    if (!settings.slicers) {
      console.error('В settings.json отсутствует секция slicers!');
      return;
    }

    // Проходим по всем слайсерам и принтерам
    for (const [slicer, slicerData] of Object.entries(settings.slicers)) {
      console.log(`\n--- Тестирование слайсера: ${slicer} ---`);
      
      if (!slicerData.printers) {
        console.log(`Нет принтеров для слайсера ${slicer}`);
        continue;
      }

      for (const [printerName, config] of Object.entries(slicerData.printers)) {
        await this.testConfiguration(slicer, printerName, config);
      }
    }

    // Анализируем результаты
    this.analyzeResults();
    
    console.log('\n=== ТЕСТИРОВАНИЕ ЗАВЕРШЕНО ===');
  }
}

// Запуск тестирования
if (require.main === module) {
  const tester = new TestGenerator();
  tester.runTests().catch(console.error);
}

module.exports = TestGenerator;