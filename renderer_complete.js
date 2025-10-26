const fs = require('fs');
const path = require('path');
const os = require('os');

let currentSlicer = '';
let currentSlicerPath = '';
let selectedPrinter = null;

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
      loadFilaments();
      loadPrintSettings();
    } else {
      selFilament.disabled = true;
      selPrint.disabled = true;
    }
  });

  selFilament.addEventListener('change', (e) => {
    loadPrintSettings();
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

    // Загружаем обычные принтеры
    const printersPath = path.join(slicerPath, 'printer');
    if (fs.existsSync(printersPath)) {
      const files = fs.readdirSync(printersPath).filter(f => f.endsWith('.ini'));
      files.forEach(file => {
        const name = path.basename(file, '.ini');
        printers.push({ name, type: 'printer' });
      });
    }

    // Загружаем физические принтеры
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

  function checkCompatibility(config, printerConfig, filamentConfig = null) {
    const compatiblePrinters = config.compatible_printers || '';
    const compatibleCondition = config.compatible_printers_condition || '';
    
    if (!compatiblePrinters && !compatibleCondition) {
      return true;
    }
    
    if (compatiblePrinters) {
      const printers = compatiblePrinters.split(';').map(p => p.trim());
      if (!printers.includes(selectedPrinter.name)) {
        return false;
      }
    }
    
    if (compatibleCondition) {
      try {
        return evaluateCondition(compatibleCondition, printerConfig, filamentConfig);
      } catch (e) {
        console.warn('Ошибка проверки условия:', compatibleCondition, e);
        return false;
      }
    }
    
    return true;
  }

  function evaluateCondition(condition, printerConfig, filamentConfig = null) {
    let evalCondition = condition
      .replace(/\band\b/g, '&&')
      .replace(/\bor\b/g, '||');
    
    const tempCondition = evalCondition.replace(/"[^"]*"/g, '""');
    const variables = tempCondition.match(/\b[a-zA-Z_][a-zA-Z0-9_]*(?:\[\d+\])?\b/g) || [];
    
    for (const variable of variables) {
      const baseVar = variable.replace(/\[\d+\]/, '');
      const hasInPrinter = printerConfig.hasOwnProperty(baseVar);
      const hasInFilament = filamentConfig && filamentConfig.hasOwnProperty(baseVar);
      
      if (!hasInPrinter && !hasInFilament && 
          !['true', 'false', 'null', 'undefined'].includes(variable) &&
          isNaN(variable)) {
        return false;
      }
    }
    
    const allConfigs = {...printerConfig};
    if (filamentConfig) {
      Object.assign(allConfigs, filamentConfig);
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
    
    try {
      return eval(evalCondition);
    } catch (e) {
      return false;
    }
  }

  function loadFilaments() {
    const filamentPath = path.join(currentSlicerPath, 'filament');
    if (!fs.existsSync(filamentPath)) {
      selFilament.innerHTML = '<option>Материалы не найдены</option>';
      return;
    }

    const printerConfigPath = path.join(currentSlicerPath, 'printer', selectedPrinter.name + '.ini');
    let printerConfig = parseIniFile(printerConfigPath);
    
    if (Object.keys(printerConfig).length === 0) {
      selFilament.innerHTML = '<option>Конфиг принтера не найден</option>';
      return;
    }

    const files = fs.readdirSync(filamentPath).filter(f => f.endsWith('.ini'));
    const compatibleFilaments = [];

    files.forEach(file => {
      const filamentConfig = parseIniFile(path.join(filamentPath, file));
      if (checkCompatibility(filamentConfig, printerConfig, filamentConfig)) {
        const name = path.basename(file, '.ini');
        compatibleFilaments.push(name);
      }
    });

    let options = '<option value="">Выберите материал</option>';
    compatibleFilaments.forEach(name => {
      options += `<option value="${name}">${name}</option>`;
    });

    selFilament.innerHTML = options;
    selFilament.disabled = false;
  }

  function loadPrintSettings() {
    const printPath = path.join(currentSlicerPath, 'print');
    if (!fs.existsExists(printPath)) {
      selPrint.innerHTML = '<option>Настройки печати не найдены</option>';
      return;
    }

    const printerConfigPath = path.join(currentSlicerPath, 'printer', selectedPrinter.name + '.ini');
    let printerConfig = parseIniFile(printerConfigPath);
    
    if (Object.keys(printerConfig).length === 0) {
      selPrint.innerHTML = '<option>Конфиг принтера не найден</option>';
      return;
    }

    let filamentConfig = null;
    const selectedFilament = selFilament.value;
    if (selectedFilament) {
      const filamentConfigPath = path.join(currentSlicerPath, 'filament', selectedFilament + '.ini');
      filamentConfig = parseIniFile(filamentConfigPath);
    }

    const files = fs.readdirSync(printPath).filter(f => f.endsWith('.ini'));
    const compatiblePrintSettings = [];

    files.forEach(file => {
      const printConfig = parseIniFile(path.join(printPath, file));
      if (checkCompatibility(printConfig, printerConfig, filamentConfig)) {
        const name = path.basename(file, '.ini');
        compatiblePrintSettings.push(name);
      }
    });

    let options = '<option value="">Выберите настройки печати</option>';
    compatiblePrintSettings.forEach(name => {
      options += `<option value="${name}">${name}</option>`;
    });

    selPrint.innerHTML = options;
    selPrint.disabled = false;
  }
});