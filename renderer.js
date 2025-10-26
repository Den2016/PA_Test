const fs = require('fs');
const path = require('path');
const os = require('os');
const GCodeGenerator = require('./generator.js');

let currentSlicer = '';
let currentSlicerPath = '';
let selectedPrinter = null;

// Путь к файлу настроек
const settingsPath = path.join(__dirname, 'settings.json');

document.addEventListener('DOMContentLoaded', () => {
  const selSlicer = document.getElementById('selSlicer');
  const selPrinter = document.getElementById('selPrinter');
  const selFilament = document.getElementById('selFilament');
  const selPrint = document.getElementById('selPrint');
  
  selSlicer.addEventListener('change', (e) => {
    currentSlicer = e.target.value;
    loadPrinters(currentSlicer);
  });

  selPrinter.addEventListener('change', (e) => {
    const printerName = e.target.value;
    if (printerName) {
      selectedPrinter = parsePrinterName(printerName);
      initializePrinterSelection();
      // Загружаем сохраненные настройки для этого принтера
      loadPrinterSettings(printerName);
    } else {
      selFilament.disabled = true;
      selPrint.disabled = true;
    }
  });

  selFilament.addEventListener('change', (e) => {
    updatePrintSettings();
  });

  selPrint.addEventListener('change', (e) => {
    updateFilaments();
  });

  function loadPrinters(slicer) {
    if (slicer === 'orca') {
      selPrinter.disabled = true;
      selPrinter.innerHTML = '<option>Орка пока не поддерживается</option>';
      return;
    }

    const appData = process.env.APPDATA;
    const slicerPaths = {
      qidi: path.join(appData, 'QIDISlicer'),
      prusa: path.join(appData, 'PrusaSlicer')
    };

    const slicerPath = slicerPaths[slicer];
    if (!fs.existsSync(slicerPath)) {
      selPrinter.innerHTML = '<option>Слайсер не найден</option>';
      return;
    }
    
    currentSlicerPath = slicerPath;

    const printers = [];
    const physicalPrinters = [];

    const printersPath = path.join(slicerPath, 'printer');
    if (fs.existsSync(printersPath)) {
      const files = fs.readdirSync(printersPath).filter(f => f.endsWith('.ini'));
      files.forEach(file => {
        const name = path.basename(file, '.ini');
        printers.push({ name, type: 'printer' });
      });
    }

    const physicalPath = path.join(slicerPath, 'physical_printer');
    if (fs.existsSync(physicalPath)) {
      const files = fs.readdirSync(physicalPath).filter(f => f.endsWith('.ini'));
      files.forEach(file => {
        try {
          const content = fs.readFileSync(path.join(physicalPath, file), 'utf8');
          const presetMatch = content.match(/preset_name\s*=\s*(.+)/);
          if (presetMatch) {
            const physicalName = path.basename(file, '.ini');
            let presetName = presetMatch[1].trim();
            if (presetName.startsWith('"') && presetName.endsWith('"')) {
              presetName = presetName.slice(1, -1);
            }
            physicalPrinters.push({ 
              name: `${physicalName}*${presetName}`, 
              type: 'physical' 
            });
          }
        } catch (e) {
          console.error('Ошибка чтения файла:', file, e);
        }
      });
    }

    printers.sort((a, b) => a.name.localeCompare(b.name));
    physicalPrinters.sort((a, b) => a.name.localeCompare(b.name));

    let options = '<option value="">Выберите принтер</option>';
    printers.forEach(p => {
      options += `<option value="${p.name}">${p.name}</option>`;
    });
    
    if (physicalPrinters.length > 0) {
      options += '<option disabled>--- Физические принтеры ---</option>';
      physicalPrinters.forEach(p => {
        options += `<option value="${p.name}">${p.name}</option>`;
      });
    }

    selPrinter.innerHTML = options;
    selPrinter.disabled = false;
  }

  function parsePrinterName(printerName) {
    if (printerName.includes('*')) {
      const [physicalName, actualPrinter] = printerName.split('*');
      return { type: 'physical', name: actualPrinter, physicalName };
    } else {
      return { type: 'printer', name: printerName };
    }
  }

  function parseIniFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const config = {};
      const lines = content.split('\n');
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const match = trimmed.match(/^([^=]+)\s*=\s*(.*)$/);
          if (match) {
            const key = match[1].trim();
            let value = match[2].trim();
            if (value.startsWith('"') && value.endsWith('"')) {
              value = value.slice(1, -1);
            }
            config[key] = value;
          }
        }
      }
      return config;
    } catch (e) {
      console.error('Ошибка парсинга файла:', filePath, e);
      return {};
    }
  }

  function checkCompatibility(config, printerConfig, filamentConfig = null, printConfig = null, fileName = '') {
    const compatiblePrinters = config.compatible_printers || '';
    const compatibleCondition = config.compatible_printers_condition || '';
    const compatiblePrints = config.compatible_prints || '';
    const compatiblePrintsCondition = config.compatible_prints_condition || '';
    
    if (!compatiblePrinters && !compatibleCondition && !compatiblePrints && !compatiblePrintsCondition) {
      return true;
    }
    
    if (compatiblePrinters) {
      const printers = compatiblePrinters.split(';').map(p => p.trim().replace(/"/g, ''));
      if (!printers.includes(selectedPrinter.name)) {
        return false;
      }
    }
    
    if (compatibleCondition) {
      try {
        if (!evaluateCondition(compatibleCondition, printerConfig, filamentConfig, fileName, printConfig)) {
          return false;
        }
      } catch (e) {
        return false;
      }
    }

    if (compatiblePrints && printConfig) {
      const prints = compatiblePrints.split(';').map(p => p.trim().replace(/"/g, ''));
      const printName = selPrint.value;
      if (printName && !prints.includes(printName)) {
        return false;
      }
    }

    if (compatiblePrintsCondition && printConfig) {
      try {
        if (!evaluateCondition(compatiblePrintsCondition, printerConfig, filamentConfig, fileName, printConfig)) {
          return false;
        }
      } catch (e) {
        return false;
      }
    }
    
    return true;
  }

  function evaluateCondition(condition, printerConfig, filamentConfig = null, fileName = '', printConfig = null) {
    let evalCondition = condition
      .replace(/\band\b/g, '&&')
      .replace(/\bor\b/g, '||');
    
    const allConfigs = {...printerConfig};
    if (filamentConfig) {
      Object.assign(allConfigs, filamentConfig);
    }
    if (printConfig) {
      Object.assign(allConfigs, printConfig);
    }
    
    for (const [key, value] of Object.entries(allConfigs)) {
      const regex = new RegExp(`\\b${key}\\b`, 'g');
      
      if (evalCondition.includes(`${key}[0]`)) {
        const arrayRegex = new RegExp(`${key}\\[0\\]`, 'g');
        const arrayValue = value.split(';')[0] || value;
        evalCondition = evalCondition.replace(arrayRegex, arrayValue);
      } else {
        if (isNaN(value)) {
          evalCondition = evalCondition.replace(regex, `"${value}"`);
        } else {
          evalCondition = evalCondition.replace(regex, value);
        }
      }
    }
    
    evalCondition = evalCondition.replace(/"PET"\s*==\s*"PETG"/g, 'true');
    evalCondition = evalCondition.replace(/"PETG"\s*==\s*"PET"/g, 'true');
    
    try {
      const result = eval(evalCondition);
      return result;
    } catch (e) {
      return false;
    }
  }

  function initializePrinterSelection() {
    // 1. Загружаем настройки печати для принтера
    const printSettings = getCompatiblePrintSettings();
    updatePrintSelect(printSettings, printSettings[0] || '');
    
    // 2. Загружаем филаменты для принтера
    const filaments = getCompatibleFilaments();
    updateFilamentSelect(filaments, filaments[0] || '');
    
    // 3. Повторно проверяем настройки печати с учетом выбранного филамента
    const newPrintSettings = getCompatiblePrintSettings();
    const currentPrint = selPrint.value;
    const finalPrint = newPrintSettings.includes(currentPrint) ? currentPrint : (newPrintSettings[0] || '');
    updatePrintSelect(newPrintSettings, finalPrint);
  }

  function getCompatiblePrintSettings() {
    const printPath = path.join(currentSlicerPath, 'print');
    if (!fs.existsSync(printPath)) return [];

    const printerConfigPath = path.join(currentSlicerPath, 'printer', selectedPrinter.name + '.ini');
    const printerConfig = parseIniFile(printerConfigPath);
    if (Object.keys(printerConfig).length === 0) return [];

    let filamentConfig = null;
    if (selFilament.value) {
      const filamentConfigPath = path.join(currentSlicerPath, 'filament', selFilament.value + '.ini');
      filamentConfig = parseIniFile(filamentConfigPath);
    }

    const files = fs.readdirSync(printPath).filter(f => f.endsWith('.ini'));
    const compatible = [];

    files.forEach(file => {
      const printConfig = parseIniFile(path.join(printPath, file));
      const name = path.basename(file, '.ini');
      
      if (checkCompatibility(printConfig, printerConfig, filamentConfig, printConfig, name)) {
        compatible.push(name);
      }
    });

    return compatible.sort((a, b) => a.localeCompare(b));
  }

  function getCompatibleFilaments() {
    const filamentPath = path.join(currentSlicerPath, 'filament');
    if (!fs.existsSync(filamentPath)) return [];

    const printerConfigPath = path.join(currentSlicerPath, 'printer', selectedPrinter.name + '.ini');
    const printerConfig = parseIniFile(printerConfigPath);
    if (Object.keys(printerConfig).length === 0) return [];

    let printConfig = null;
    if (selPrint.value) {
      const printConfigPath = path.join(currentSlicerPath, 'print', selPrint.value + '.ini');
      printConfig = parseIniFile(printConfigPath);
    }

    const files = fs.readdirSync(filamentPath).filter(f => f.endsWith('.ini'));
    const compatible = [];

    files.forEach(file => {
      const filamentConfig = parseIniFile(path.join(filamentPath, file));
      const name = path.basename(file, '.ini');
      
      if (checkCompatibility(filamentConfig, printerConfig, filamentConfig, printConfig, name)) {
        compatible.push(name);
      }
    });

    return compatible.sort((a, b) => a.localeCompare(b));
  }

  function updatePrintSelect(options, selectedValue) {
    let html = '<option value="">Выберите настройки печати</option>';
    options.forEach(name => {
      html += `<option value="${name}">${name}</option>`;
    });
    selPrint.innerHTML = html;
    selPrint.value = selectedValue;
    selPrint.disabled = options.length === 0;
    checkGenerateReady();
  }

  function updateFilamentSelect(options, selectedValue) {
    let html = '<option value="">Выберите материал</option>';
    options.forEach(name => {
      html += `<option value="${name}">${name}</option>`;
    });
    selFilament.innerHTML = html;
    selFilament.value = selectedValue;
    selFilament.disabled = options.length === 0;
    checkGenerateReady();
  }

  function updatePrintSettings() {
    const printSettings = getCompatiblePrintSettings();
    const currentPrint = selPrint.value;
    const finalPrint = printSettings.includes(currentPrint) ? currentPrint : (printSettings[0] || '');
    updatePrintSelect(printSettings, finalPrint);
  }

  function updateFilaments() {
    const filaments = getCompatibleFilaments();
    const currentFilament = selFilament.value;
    const finalFilament = filaments.includes(currentFilament) ? currentFilament : (filaments[0] || '');
    updateFilamentSelect(filaments, finalFilament);
  }

  function calculateMaxObjects() {
    if (!selectedPrinter || !selPrint.value) return null;
    
    try {
      const printerConfigPath = path.join(currentSlicerPath, 'printer', selectedPrinter.name + '.ini');
      const printConfigPath = path.join(currentSlicerPath, 'print', selPrint.value + '.ini');
      
      const printerConfig = parseIniFile(printerConfigPath);
      const printConfig = parseIniFile(printConfigPath);
      
      const bedShape = printerConfig.bed_shape;
      if (!bedShape) return null;
      
      const points = bedShape.split(',').map(point => {
        const [x, y] = point.split('x').map(Number);
        return { x, y };
      });
      
      const xs = points.map(p => p.x);
      const ys = points.map(p => p.y);
      const bedWidth = Math.max(...xs) - Math.min(...xs);
      const bedHeight = Math.max(...ys) - Math.min(...ys);
      
      const nozzleDiameter = parseFloat(printerConfig.nozzle_diameter?.split(';')[0] || '0.4');
      
      let objectWidth, objectHeight;
      if (nozzleDiameter <= 0.4) {
        objectWidth = 30;
        objectHeight = 20;
      } else if (nozzleDiameter <= 0.6) {
        objectWidth = 35;
        objectHeight = 25;
      } else {
        objectWidth = 40;
        objectHeight = 30;
      }
      
      const spacing = 5;
      const margin = 10;
      const availableWidth = bedWidth - 2 * margin;
      const availableHeight = bedHeight - 2 * margin;
      
      const maxCols = Math.floor((availableWidth + spacing) / (objectWidth + spacing));
      const maxRows = Math.floor((availableHeight + spacing) / (objectHeight + spacing));
      
      return maxCols * maxRows;
    } catch (e) {
      return null;
    }
  }

  function calculatePACount() {
    const startPA = parseFloat(document.getElementById('startPA').value) || 0;
    const endPA = parseFloat(document.getElementById('endPA').value) || 0;
    const stepPA = parseFloat(document.getElementById('stepPA').value) || 0.001;
    
    if (stepPA <= 0 || endPA < startPA) {
      document.getElementById('countDisplay').textContent = '0';
      document.getElementById('paValues').textContent = '';
      return;
    }
    
    const values = [];
    for (let value = startPA; value <= endPA; value += stepPA) {
      values.push(value.toFixed(3));
    }
    
    const maxObjects = calculateMaxObjects();
    let displayText = values.length.toString();
    
    if (maxObjects && values.length > maxObjects) {
      displayText += ` (Макс: ${maxObjects})`;
      document.getElementById('countDisplay').style.color = 'red';
    } else {
      document.getElementById('countDisplay').style.color = '';
    }
    
    document.getElementById('countDisplay').textContent = displayText;
    document.getElementById('paValues').textContent = values.join(', ');
  }

  // Добавляем обработчики для PA параметров
  document.getElementById('startPA').addEventListener('input', calculatePACount);
  document.getElementById('endPA').addEventListener('input', calculatePACount);
  document.getElementById('stepPA').addEventListener('input', calculatePACount);
  
  // Начальный расчет
  calculatePACount();
  
  // Обработчик кнопки генерации
  document.getElementById('generateBtn').addEventListener('click', generateGCode);
  
  // Обработчик кнопки сохранения
  document.getElementById('saveBtn').addEventListener('click', saveGCode);
  
  // Загружаем сохраненные настройки при запуске
  loadSettings();
  
  // Сохраняем настройки при закрытии окна
  window.addEventListener('beforeunload', saveSettings);
  
  // Проверяем готовность к генерации
  function checkGenerateReady() {
    const ready = selectedPrinter && selFilament.value && selPrint.value;
    document.getElementById('generateBtn').disabled = !ready;
  }
  
  /**
   * Рассчитывает примерное время печати PA теста
   * @returns {number} Время в минутах
   */
  function calculatePrintTime() {
    try {
      const startPA = parseFloat(document.getElementById('startPA').value) || 0;
      const endPA = parseFloat(document.getElementById('endPA').value) || 0;
      const stepPA = parseFloat(document.getElementById('stepPA').value) || 0.001;
      
      // Количество объектов
      const objectCount = Math.floor((endPA - startPA) / stepPA) + 1;
      
      // Параметры печати
      const layerHeight = 0.2; // мм
      const layerCount = 25;
      const objectArea = 25 * 18; // мм²
      
      // Примерные скорости (мм/мин)
      const perimeterSpeed = 1800; // 30 мм/с
      const infillSpeed = 3000;    // 50 мм/с
      const travelSpeed = 9000;    // 150 мм/с
      
      let totalTime = 0;
      
      for (let layer = 0; layer < layerCount; layer++) {
        let layerTime = 0;
        
        // Определяем параметры слоя
        let perimeterCount, hasInfill;
        if (layer === 0) {
          perimeterCount = 1;
          hasInfill = true;
        } else if (layer === 1 || layer === 2) {
          perimeterCount = 5;
          hasInfill = true;
        } else {
          perimeterCount = 2;
          hasInfill = false;
        }
        
        for (let obj = 0; obj < objectCount; obj++) {
          // Время на периметры
          const perimeterLength = perimeterCount * (2 * (25 + 18)); // примерный периметр
          layerTime += perimeterLength / perimeterSpeed;
          
          // Время на заполнение
          if (hasInfill) {
            const infillLength = objectArea * 0.3; // примерная длина заполнения
            layerTime += infillLength / infillSpeed;
          }
          
          // Время на перемещения
          layerTime += 30 / travelSpeed; // примерно 30мм перемещений на объект
        }
        
        totalTime += layerTime;
      }
      
      return Math.round(totalTime); // в минутах
    } catch (e) {
      return 60; // по умолчанию 1 час
    }
  }
  
  function generateFilename() {
    try {
      const printerConfigPath = path.join(currentSlicerPath, 'printer', selectedPrinter.name + '.ini');
      const filamentConfigPath = path.join(currentSlicerPath, 'filament', selFilament.value + '.ini');
      const printConfigPath = path.join(currentSlicerPath, 'print', selPrint.value + '.ini');
      
      const printerConfig = parseIniFile(printerConfigPath);
      const filamentConfig = parseIniFile(filamentConfigPath);
      const printConfig = parseIniFile(printConfigPath);
      
      let template = printConfig.output_filename_format || '{input_filename_base}';
      
      // Объединяем все конфиги
      const allConfigs = {...printerConfig, ...filamentConfig, ...printConfig};
      
      // Специальные переменные
      template = template.replace(/\{input_filename_base\}/g, 'PA_Test');
      
      const printTimeMinutes = calculatePrintTime();
      const hours = Math.floor(printTimeMinutes / 60);
      const minutes = printTimeMinutes % 60;
      template = template.replace(/\{print_time\}/g, `${hours}h${minutes}m`);
      
      const now = new Date();
      template = template.replace(/\{timestamp\}/g, now.toISOString().replace(/[:.]/g, '-'));
      template = template.replace(/\{year\}/g, now.getFullYear());
      template = template.replace(/\{month\}/g, String(now.getMonth() + 1).padStart(2, '0'));
      template = template.replace(/\{day\}/g, String(now.getDate()).padStart(2, '0'));
      template = template.replace(/\{hour\}/g, String(now.getHours()).padStart(2, '0'));
      template = template.replace(/\{minute\}/g, String(now.getMinutes()).padStart(2, '0'));
      
      // Функция digits
      template = template.replace(/\{digits\(([^,]+),\s*(\d+),\s*(\d+)\)\}/g, (match, varName, minDigits, precision) => {
        const value = parseFloat(allConfigs[varName] || 0);
        return value.toFixed(parseInt(precision)).padStart(parseInt(minDigits), '0');
      });
      
      // Массивы с индексами
      template = template.replace(/\{([^}]+)\[(\d+)\]\}/g, (match, varName, index) => {
        const value = allConfigs[varName] || '';
        const array = value.split(';');
        return array[parseInt(index)] || value;
      });
      
      // Обычные переменные из конфигов
      for (const [key, value] of Object.entries(allConfigs)) {
        const regex = new RegExp(`\\{${key}\\}`, 'g');
        template = template.replace(regex, value);
      }
      
      return template.endsWith('.gcode') ? template : template + '.gcode';
    } catch (e) {
      return 'PA_Test.gcode';
    }
  }
  
  async function saveGCode() {
    const gcode = document.getElementById('gcodeOutput').value;
    if (!gcode.trim()) {
      alert('Нет G-code для сохранения');
      return;
    }
    
    try {
      const filename = generateFilename();
      
      try {
        // Пробуем использовать IPC для диалога
        const { ipcRenderer } = require('electron');
        
        const result = await ipcRenderer.invoke('save-file-dialog', {
          defaultPath: filename,
          filters: [
            { name: 'G-code files', extensions: ['gcode'] },
            { name: 'All files', extensions: ['*'] }
          ]
        });
        
        if (result && !result.canceled && result.filePath) {
          fs.writeFileSync(result.filePath, gcode, 'utf8');
          alert('Файл сохранен: ' + result.filePath);
        }
      } catch (ipcError) {
        console.warn('IPC не работает, используем fallback:', ipcError.message);
        
        // Fallback: сохраняем в папку ini_examples
        const outputPath = path.join(__dirname, 'ini_examples', filename);
        
        // Создаем папку если не существует
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }
        
        fs.writeFileSync(outputPath, gcode, 'utf8');
        alert(`Файл сохранен: ${outputPath}\n\nПримечание: Диалог сохранения недоступен. Перезапустите приложение.`);
      }
    } catch (err) {
      console.error('Ошибка сохранения:', err);
      alert('Ошибка сохранения файла: ' + err.message);
    }
  }
  
  function generateGCode() {
    if (!selectedPrinter || !selFilament.value || !selPrint.value) {
      alert('Выберите принтер, материал и настройки печати');
      return;
    }
    
    try {
      // Получаем значения PA
      const startPA = parseFloat(document.getElementById('startPA').value) || 0;
      const endPA = parseFloat(document.getElementById('endPA').value) || 0;
      const stepPA = parseFloat(document.getElementById('stepPA').value) || 0.001;
      
      const paValues = [];
      if (stepPA > 0 && endPA >= startPA) {
        for (let value = startPA; value <= endPA; value += stepPA) {
          paValues.push(parseFloat(value.toFixed(3)));
        }
      }
      
      const generator = new GCodeGenerator();
      const gcode = generator.generate(
        currentSlicerPath,
        selectedPrinter.name,
        selFilament.value,
        selPrint.value,
        paValues
      );
      
      document.getElementById('gcodeOutput').value = gcode;
      document.getElementById('saveBtn').disabled = false;
      
      // Сохраняем настройки после успешной генерации
      saveSettings();
    } catch (error) {
      alert(`Ошибка генерации G-code:\n${error.message}`);
      console.error('G-code generation error:', error);
      document.getElementById('saveBtn').disabled = true;
    }
  }
  
  /**
   * Загружает общие настройки приложения
   */
  function loadSettings() {
    try {
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        
        // Восстанавливаем последний выбранный слайсер
        if (settings.lastSlicer) {
          selSlicer.value = settings.lastSlicer;
          currentSlicer = settings.lastSlicer;
          loadPrinters(currentSlicer);
          
          // Восстанавливаем последний принтер после загрузки списка
          setTimeout(() => {
            if (settings.lastPrinter && selPrinter.querySelector(`option[value="${settings.lastPrinter}"]`)) {
              selPrinter.value = settings.lastPrinter;
              selectedPrinter = parsePrinterName(settings.lastPrinter);
              initializePrinterSelection();
              loadPrinterSettings(settings.lastPrinter);
            }
          }, 100);
        }
      }
    } catch (e) {
      console.error('Ошибка загрузки настроек:', e);
    }
  }
  
  /**
   * Загружает настройки для конкретного принтера
   * @param {string} printerName - Имя принтера
   */
  function loadPrinterSettings(printerName) {
    try {
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        const printerSettings = settings.printers?.[printerName];
        
        if (printerSettings) {
          // Восстанавливаем филамент
          setTimeout(() => {
            if (printerSettings.filament && selFilament.querySelector(`option[value="${printerSettings.filament}"]`)) {
              selFilament.value = printerSettings.filament;
              updatePrintSettings();
              
              // Восстанавливаем настройки печати
              setTimeout(() => {
                if (printerSettings.print && selPrint.querySelector(`option[value="${printerSettings.print}"]`)) {
                  selPrint.value = printerSettings.print;
                }
              }, 100);
            }
          }, 200);
          
          // Восстанавливаем PA параметры
          if (printerSettings.paSettings) {
            const pa = printerSettings.paSettings;
            if (pa.startPA !== undefined) document.getElementById('startPA').value = pa.startPA;
            if (pa.endPA !== undefined) document.getElementById('endPA').value = pa.endPA;
            if (pa.stepPA !== undefined) document.getElementById('stepPA').value = pa.stepPA;
            calculatePACount();
          }
        }
      }
    } catch (e) {
      console.error('Ошибка загрузки настроек принтера:', e);
    }
  }
  
  /**
   * Сохраняет текущие настройки
   */
  function saveSettings() {
    try {
      let settings = {};
      
      // Загружаем существующие настройки
      if (fs.existsSync(settingsPath)) {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      }
      
      // Обновляем общие настройки
      settings.lastSlicer = currentSlicer;
      settings.lastPrinter = selPrinter.value;
      
      // Обновляем настройки принтера
      if (selectedPrinter && selPrinter.value) {
        if (!settings.printers) settings.printers = {};
        
        settings.printers[selPrinter.value] = {
          filament: selFilament.value,
          print: selPrint.value,
          paSettings: {
            startPA: parseFloat(document.getElementById('startPA').value) || 0,
            endPA: parseFloat(document.getElementById('endPA').value) || 0.1,
            stepPA: parseFloat(document.getElementById('stepPA').value) || 0.01
          }
        };
      }
      
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    } catch (e) {
      console.error('Ошибка сохранения настроек:', e);
    }
  }

});