const fs = require('fs');
const path = require('path');
const os = require('os');
const GCodeGenerator = require('./generator.js');

let currentSlicer = '';
let currentSlicerPath = '';
let selectedPrinter = null;

// Путь к файлу настроек
const settingsPath = path.join(__dirname, 'settings.json');

// 3D визуализация
class BedVisualizer {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.bedMesh = null;
    this.objects = [];
    this.animationId = null;
  }

  init(container) {
    try {
      const width = container.clientWidth;
      const height = container.clientHeight;

      // Проверяем поддержку WebGL
      if (!this.isWebGLSupported()) {
        console.log('WebGL недоступен, используем 2D Canvas');
        this.create2DFallback(container);
        return;
      }

      // Пробуем Babylon.js
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        container.appendChild(canvas);
        
        this.engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
        this.scene = new BABYLON.Scene(this.engine);
        
        // Камера
        this.camera = new BABYLON.ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 2.5, 200, BABYLON.Vector3.Zero(), this.scene);
        this.camera.setTarget(BABYLON.Vector3.Zero());
        this.camera.attachControls(canvas);
        
        // Освещение
        const light = new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0, 1, 0), this.scene);
        light.intensity = 0.7;
        
        console.log('Babylon.js успешно инициализирован');
        this.is3D = true;
      } catch (e) {
        console.log('Переход на 2D Canvas из-за ошибки WebGL');
        this.create2DFallback(container);
        return;
      }
      
      // Запуск рендеринга
      this.engine.runRenderLoop(() => {
        this.scene.render();
      });

      // Обработка изменения размера
      window.addEventListener('resize', () => {
        this.engine.resize();
      });
    } catch (e) {
      console.error('Ошибка инициализации 3D:', e);
      this.create2DFallback(container);
    }
  }

  isWebGLSupported() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return false;
      
      // Проверяем базовые возможности WebGL
      const hasRequiredExtensions = gl.getExtension('OES_element_index_uint') !== null;
      return hasRequiredExtensions;
    } catch (e) {
      return false;
    }
  }

  create2DFallback(container) {
    this.switchTo2D(container);
  }
  
  switchTo2D(container) {
    // Очищаем контейнер
    container.innerHTML = '';
    
    // Останавливаем 3D анимацию
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);
    
    this.canvas2D = canvas;
    this.ctx2D = ctx;
    this.is2D = true;
    
    // Начальная отрисовка
    this.draw2D();
  }

  draw2D() {
    if (!this.is2D || !this.ctx2D) return;
    
    const ctx = this.ctx2D;
    const canvas = this.canvas2D;
    
    // Очищаем канвас
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    if (!this.bedData) return;
    
    const { bedWidth, bedHeight, objects = [] } = this.bedData;
    if (!bedWidth || !bedHeight) return;
    
    const scale = Math.min(canvas.width / (bedWidth + 40), canvas.height / (bedHeight + 40));
    const offsetX = (canvas.width - bedWidth * scale) / 2;
    const offsetY = (canvas.height - bedHeight * scale) / 2;
    
    // Рисуем стол
    ctx.fillStyle = '#888888';
    ctx.fillRect(offsetX, offsetY, bedWidth * scale, bedHeight * scale);
    
    // Сетка
    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 1;
    const gridSize = 20 * scale;
    for (let x = offsetX; x <= offsetX + bedWidth * scale; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, offsetY);
      ctx.lineTo(x, offsetY + bedHeight * scale);
      ctx.stroke();
    }
    for (let y = offsetY; y <= offsetY + bedHeight * scale; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(offsetX, y);
      ctx.lineTo(offsetX + bedWidth * scale, y);
      ctx.stroke();
    }
    
    // Рисуем объекты
    if (objects.length > 0) {
      objects.forEach((obj, i) => {
        const x = offsetX + obj.x * scale;
        const y = offsetY + obj.y * scale;
        const w = obj.width * scale;
        const h = obj.height * scale;
        
        // Цвет объекта
        const hue = (i / objects.length) * 240;
        ctx.fillStyle = `hsl(${hue}, 70%, 60%)`;
        ctx.fillRect(x, y, w, h);
        
        // Обводка
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
        
        // Текст
        ctx.fillStyle = '#000';
        ctx.font = `${Math.max(10, w / 8)}px Arial`;
        ctx.textAlign = 'center';
        ctx.fillText(`PA: ${obj.pa}`, x + w/2, y + h/2 + 4);
      });
    }
  }

  createBed(width, height) {
    if (this.is2D) {
      if (!this.bedData) this.bedData = { objects: [] };
      this.bedData.bedWidth = width;
      this.bedData.bedHeight = height;
      if (!this.bedData.objects) this.bedData.objects = [];
      this.draw2D();
      return;
    }

    if (this.is3D && this.scene) {
      // Удаляем старый стол
      if (this.bedMesh) {
        this.bedMesh.dispose();
      }

      // Создаем новый стол
      this.bedMesh = BABYLON.MeshBuilder.CreateBox('bed', {width: width, height: 2, depth: height}, this.scene);
      this.bedMesh.position.y = -1;
      this.bedMesh.position.x = width/2;
      this.bedMesh.position.z = height/2;
      
      const bedMaterial = new BABYLON.StandardMaterial('bedMaterial', this.scene);
      bedMaterial.diffuseColor = new BABYLON.Color3(0.5, 0.5, 0.5);
      this.bedMesh.material = bedMaterial;
    }
  }

  updateObjects(bedWidth, bedHeight, paValues, layout, objectWidth, objectHeight) {
    if (this.is2D) {
      const objects = [];
      if (layout && paValues.length) {
        for (let i = 0; i < paValues.length; i++) {
          const row = Math.floor(i / layout.cols);
          const col = i % layout.cols;
          const x = layout.startX + col * (objectWidth + 5);
          const y = layout.startY + row * (objectHeight + 5);
          
          objects.push({
            x, y,
            width: objectWidth,
            height: objectHeight,
            pa: paValues[i]
          });
        }
      }
      
      this.bedData = { bedWidth, bedHeight, objects };
      this.draw2D();
      return;
    }

    if (this.is3D && this.scene) {
      // Удаляем старые объекты
      this.objects.forEach(obj => obj.dispose());
      this.objects = [];

      if (!layout || !paValues.length) return;

      for (let i = 0; i < paValues.length; i++) {
        const row = Math.floor(i / layout.cols);
        const col = i % layout.cols;
        const x = layout.startX + col * (objectWidth + 5) + objectWidth/2;
        const z = layout.startY + row * (objectHeight + 5) + objectHeight/2;
        
        // Объект
        const objectMesh = BABYLON.MeshBuilder.CreateBox(`object${i}`, {width: objectWidth, height: 5, depth: objectHeight}, this.scene);
        objectMesh.position.x = x;
        objectMesh.position.y = 2.5;
        objectMesh.position.z = z;
        
        const hue = (i / paValues.length) * 0.7;
        const objectMaterial = new BABYLON.StandardMaterial(`objectMaterial${i}`, this.scene);
        objectMaterial.diffuseColor = BABYLON.Color3.FromHSV(hue * 360, 0.7, 0.8);
        objectMesh.material = objectMaterial;
        
        this.objects.push(objectMesh);
      }
    }
  }

  destroy() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    if (this.renderer) {
      this.renderer.dispose();
    }
  }
}

let bedVisualizer = null;

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
    clearGeneratedGCode();
    if (printerName) {
      selectedPrinter = parsePrinterName(printerName);
      initializePrinterSelection();
      loadPrinterSettings(printerName);
    } else {
      selFilament.disabled = true;
      selPrint.disabled = true;
    }
  });

  function clearGeneratedGCode() {
    document.getElementById('gcodeOutput').value = '';
    document.getElementById('saveBtn').disabled = true;
    document.getElementById('sendBtn').disabled = true;
  }

  selFilament.addEventListener('change', (e) => {
    clearGeneratedGCode();
    updatePrintSettings();
  });

  selPrint.addEventListener('change', (e) => {
    clearGeneratedGCode();
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
    const printSettings = getCompatiblePrintSettings();
    updatePrintSelect(printSettings, printSettings[0] || '');
    
    const filaments = getCompatibleFilaments();
    updateFilamentSelect(filaments, filaments[0] || '');
    
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
    
    updateBedVisualization(values);
  }
  
  function updateBedVisualization(paValues) {
    if (!selectedPrinter || !selPrint.value) return;
    
    if (!bedVisualizer) {
      const bedContainer = document.getElementById('bedVisualization');
      if (bedContainer) {
        bedVisualizer = new BedVisualizer();
        bedVisualizer.init(bedContainer);
      }
    }
    
    try {
      const printerConfigPath = path.join(currentSlicerPath, 'printer', selectedPrinter.name + '.ini');
      const printerConfig = parseIniFile(printerConfigPath);
      
      const bedShape = printerConfig.bed_shape;
      if (!bedShape) return;
      
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
      const layout = calculateOptimalLayout(paValues.length, objectWidth, objectHeight, spacing, bedWidth, bedHeight);
      
      bedVisualizer.createBed(bedWidth, bedHeight);
      bedVisualizer.updateObjects(bedWidth, bedHeight, paValues, layout, objectWidth, objectHeight);
    } catch (e) {
      console.error('Ошибка обновления визуализации:', e);
    }
  }
  
  function calculateOptimalLayout(objectCount, objectWidth, objectHeight, spacing, bedWidth, bedHeight) {
    const margin = 10;
    const availableWidth = bedWidth - 2 * margin;
    const availableHeight = bedHeight - 2 * margin;
    
    let bestLayout = null;
    let minAspectRatio = Infinity;
    
    for (let cols = 1; cols <= objectCount; cols++) {
      const rows = Math.ceil(objectCount / cols);
      
      const totalWidth = cols * objectWidth + (cols - 1) * spacing;
      const totalHeight = rows * objectHeight + (rows - 1) * spacing;
      
      if (totalWidth <= availableWidth && totalHeight <= availableHeight) {
        const aspectRatio = Math.max(totalWidth / totalHeight, totalHeight / totalWidth);
        
        if (aspectRatio < minAspectRatio) {
          minAspectRatio = aspectRatio;
          bestLayout = {
            cols,
            rows,
            totalWidth,
            totalHeight,
            startX: margin + (availableWidth - totalWidth) / 2,
            startY: margin + (availableHeight - totalHeight) / 2
          };
        }
      }
    }
    
    return bestLayout;
  }

  document.getElementById('startPA').addEventListener('input', () => {
    clearGeneratedGCode();
    calculatePACount();
  });
  document.getElementById('endPA').addEventListener('input', () => {
    clearGeneratedGCode();
    calculatePACount();
  });
  document.getElementById('stepPA').addEventListener('input', () => {
    clearGeneratedGCode();
    calculatePACount();
  });
  
  calculatePACount();
  
  document.getElementById('generateBtn').addEventListener('click', generateGCode);
  document.getElementById('saveBtn').addEventListener('click', saveGCode);
  const sendBtn = document.getElementById('sendBtn');
  sendBtn.addEventListener('click', () => {
    sendBtn.disabled = true;
    sendToPrinter().finally(() => {
      sendBtn.disabled = false;
    });
  });
  
  // Загружаем настройки после небольшой задержки
  setTimeout(() => {
    loadSettings();
  }, 500);
  
  window.addEventListener('beforeunload', saveSettings);
  
  function checkGenerateReady() {
    const ready = selectedPrinter && selFilament.value && selPrint.value;
    document.getElementById('generateBtn').disabled = !ready;
  }
  
  function updateSendButton() {
    const hasGcode = document.getElementById('gcodeOutput').value.trim();
    const isPhysicalPrinter = selectedPrinter && selectedPrinter.type === 'physical';
    document.getElementById('sendBtn').disabled = !hasGcode || !isPhysicalPrinter;
  }
  
  function calculatePrintTime() {
    try {
      const startPA = parseFloat(document.getElementById('startPA').value) || 0;
      const endPA = parseFloat(document.getElementById('endPA').value) || 0;
      const stepPA = parseFloat(document.getElementById('stepPA').value) || 0.001;
      
      const objectCount = Math.floor((endPA - startPA) / stepPA) + 1;
      
      const layerHeight = 0.2;
      const layerCount = 25;
      const objectArea = 25 * 18;
      
      const perimeterSpeed = 1800;
      const infillSpeed = 3000;
      const travelSpeed = 9000;
      
      let totalTime = 0;
      
      for (let layer = 0; layer < layerCount; layer++) {
        let layerTime = 0;
        
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
          const perimeterLength = perimeterCount * (2 * (25 + 18));
          layerTime += perimeterLength / perimeterSpeed;
          
          if (hasInfill) {
            const infillLength = objectArea * 0.3;
            layerTime += infillLength / infillSpeed;
          }
          
          layerTime += 30 / travelSpeed;
        }
        
        totalTime += layerTime;
      }
      
      return Math.round(totalTime);
    } catch (e) {
      return 60;
    }
  }
  
  function calculateGCodePlaceholders() {
    try {
      if (!selectedPrinter || !selPrint.value) return {};
      
      const printerConfigPath = path.join(currentSlicerPath, 'printer', selectedPrinter.name + '.ini');
      const filamentConfigPath = path.join(currentSlicerPath, 'filament', selFilament.value + '.ini');
      const printConfigPath = path.join(currentSlicerPath, 'print', selPrint.value + '.ini');
      const printerConfig = parseIniFile(printerConfigPath);
      const filamentConfig = parseIniFile(filamentConfigPath);
      const printConfig = parseIniFile(printConfigPath);
      
      // Получаем параметры PA теста
      const startPA = parseFloat(document.getElementById('startPA').value) || 0;
      const endPA = parseFloat(document.getElementById('endPA').value) || 0;
      const stepPA = parseFloat(document.getElementById('stepPA').value) || 0.001;
      const paValues = [];
      for (let value = startPA; value <= endPA; value += stepPA) {
        paValues.push(parseFloat(value.toFixed(3)));
      }
      
      // Размеры объектов
      const nozzleDiameter = parseFloat(printerConfig.nozzle_diameter?.split(';')[0] || '0.4');
      let objectWidth, objectHeight;
      if (nozzleDiameter <= 0.4) {
        objectWidth = 30; objectHeight = 20;
      } else if (nozzleDiameter <= 0.6) {
        objectWidth = 35; objectHeight = 25;
      } else {
        objectWidth = 40; objectHeight = 30;
      }
      
      // Получаем размеры стола
      const bedShape = printerConfig.bed_shape;
      if (!bedShape) return {};
      
      const points = bedShape.split(',').map(point => {
        const [x, y] = point.split('x').map(Number);
        return { x, y };
      });
      
      const xs = points.map(p => p.x);
      const ys = points.map(p => p.y);
      const bedWidth = Math.max(...xs) - Math.min(...xs);
      const bedHeight = Math.max(...ys) - Math.min(...ys);
      
      // Рассчитываем расположение объектов
      const spacing = 5;
      const layout = calculateOptimalLayout(paValues.length, objectWidth, objectHeight, spacing, bedWidth, bedHeight);
      
      if (!layout) return {};
      
      // Границы печати
      const printMinX = layout.startX;
      const printMaxX = layout.startX + layout.totalWidth;
      const printMinY = layout.startY;
      const printMaxY = layout.startY + layout.totalHeight;
      
      // Расчет материала
      const layerHeight = parseFloat(printConfig.layer_height || filamentConfig.layer_height || '0.2');
      const firstLayerHeight = parseFloat(printConfig.first_layer_height || filamentConfig.first_layer_height || '0.3');
      const filamentDiameter = parseFloat(filamentConfig.filament_diameter || '1.75');
      const filamentDensity = parseFloat(filamentConfig.filament_density || '1.24');
      const filamentCost = parseFloat(filamentConfig.filament_cost || '25');
      
      // Примерный объем филамента
      const layerCount = 25;
      const maxLayerZ = firstLayerHeight + (layerCount - 1) * layerHeight;
      const volumePerObject = objectWidth * objectHeight * layerHeight * layerCount * 0.3;
      const totalVolume = volumePerObject * paValues.length;
      
      const filamentCrossSectionArea = Math.PI * Math.pow(filamentDiameter / 2, 2);
      const filamentLength = totalVolume / filamentCrossSectionArea;
      const filamentWeight = (totalVolume / 1000) * filamentDensity;
      const materialCost = (filamentWeight / 1000) * filamentCost;
      
      // Функция получения значения из конфигов
      const getConfigValue = (key, defaultValue = '') => {
        return printConfig[key] || filamentConfig[key] || printerConfig[key] || defaultValue;
      };
      
      return {
        // Геометрические параметры
        'scale': '1',
        'object_copies_num': paValues.length.toString(),
        'layer_height': layerHeight.toFixed(3),
        'first_layer_height': firstLayerHeight.toFixed(3),
        'initial_layer_height': firstLayerHeight.toFixed(3),
        'layer_z': firstLayerHeight.toFixed(3),
        'max_layer_z': maxLayerZ.toFixed(3),
        'nozzle_diameter': nozzleDiameter.toFixed(3),
        'perimeters': getConfigValue('perimeters', '2'),
        'infill_overlap': getConfigValue('infill_overlap', '10%'),
        
        // Скоростные параметры
        'print_speed': getConfigValue('print_speed', '50'),
        'first_layer_speed': getConfigValue('first_layer_speed', '30'),
        'perimeter_speed': getConfigValue('perimeter_speed', '50'),
        'external_perimeter_speed': getConfigValue('external_perimeter_speed', '50%'),
        'small_perimeter_speed': getConfigValue('small_perimeter_speed', '50%'),
        'infill_speed': getConfigValue('infill_speed', '80'),
        'travel_speed': getConfigValue('travel_speed', '150'),
        'bridge_speed': getConfigValue('bridge_speed', '60'),
        'gap_fill_speed': getConfigValue('gap_fill_speed', '20'),
        
        // Параметры материала
        'filament_diameter': filamentDiameter.toFixed(3),
        'extrusion_multiplier': getConfigValue('extrusion_multiplier', '1'),
        'temperature': getConfigValue('temperature', '200'),
        'bed_temperature': getConfigValue('bed_temperature', '60'),
        'first_layer_temperature': getConfigValue('first_layer_temperature', getConfigValue('temperature', '200')),
        'first_layer_bed_temperature': getConfigValue('first_layer_bed_temperature', getConfigValue('bed_temperature', '60')),
        'filament_type': getConfigValue('filament_type', 'PLA'),
        'filament_soluble': getConfigValue('filament_soluble', '0'),
        'filament_cost': filamentCost.toFixed(2),
        'filament_density': filamentDensity.toFixed(2),
        'filament_colour': getConfigValue('filament_colour', getConfigValue('filament_color', '#FFFFFF')),
        'filament_color': getConfigValue('filament_color', getConfigValue('filament_colour', '#FFFFFF')),
        
        // Параметры отката
        'retract_length': getConfigValue('retract_length', '0.8'),
        'retract_speed': getConfigValue('retract_speed', '35'),
        'retract_restart_extra': getConfigValue('retract_restart_extra', '0'),
        'retract_before_travel': getConfigValue('retract_before_travel', '2'),
        
        // Параметры заполнения
        'fill_density': getConfigValue('fill_density', getConfigValue('infill_density', '20%')),
        'infill_density': getConfigValue('infill_density', getConfigValue('fill_density', '20%')),
        'fill_pattern': getConfigValue('fill_pattern', getConfigValue('infill_pattern', 'rectilinear')),
        'infill_pattern': getConfigValue('infill_pattern', getConfigValue('fill_pattern', 'rectilinear')),
        'top_fill_pattern': getConfigValue('top_fill_pattern', 'rectilinear'),
        'bottom_fill_pattern': getConfigValue('bottom_fill_pattern', 'rectilinear'),
        
        // Ширины экструзии
        'perimeter_extrusion_width': getConfigValue('perimeter_extrusion_width', (nozzleDiameter * 1.125).toFixed(3)),
        'external_perimeter_extrusion_width': getConfigValue('external_perimeter_extrusion_width', (nozzleDiameter * 1.125).toFixed(3)),
        'infill_extrusion_width': getConfigValue('infill_extrusion_width', (nozzleDiameter * 1.125).toFixed(3)),
        'solid_infill_extrusion_width': getConfigValue('solid_infill_extrusion_width', (nozzleDiameter * 1.125).toFixed(3)),
        'top_infill_extrusion_width': getConfigValue('top_infill_extrusion_width', (nozzleDiameter * 1.125).toFixed(3)),
        
        // Параметры поддержек (не используются в PA тесте)
        'support_material': '0',
        'support_material_threshold': getConfigValue('support_material_threshold', '0'),
        'support_material_pattern': getConfigValue('support_material_pattern', 'rectilinear'),
        'support_material_spacing': getConfigValue('support_material_spacing', '2.5'),
        
        // Параметры охлаждения
        'cooling': getConfigValue('cooling', '1'),
        'fan_always_on': getConfigValue('fan_always_on', '0'),
        'max_fan_speed': getConfigValue('max_fan_speed', '100'),
        'min_fan_speed': getConfigValue('min_fan_speed', '35'),
        'min_print_speed': getConfigValue('min_print_speed', '10'),
        'slowdown_below_layer_time': getConfigValue('slowdown_below_layer_time', '5'),
        
        // Параметры принтера
        'printer_model': getConfigValue('printer_model', selectedPrinter.name),
        'printer_variant': getConfigValue('printer_variant', ''),
        'printer_vendor': getConfigValue('printer_vendor', ''),
        'z_offset': getConfigValue('z_offset', '0'),
        
        // Границы печати
        'first_layer_print_min[0]': printMinX.toFixed(2),
        'first_layer_print_max[0]': printMaxX.toFixed(2),
        'first_layer_print_min[1]': printMinY.toFixed(2),
        'first_layer_print_max[1]': printMaxY.toFixed(2),
        'print_bed_min[0]': printMinX.toFixed(2),
        'print_bed_max[0]': printMaxX.toFixed(2),
        'print_bed_min[1]': printMinY.toFixed(2),
        'print_bed_max[1]': printMaxY.toFixed(2),
        'bounding_box[0]': layout.totalWidth.toFixed(2),
        'bounding_box[1]': layout.totalHeight.toFixed(2),
        
        // Материал
        'filament_used[0]': filamentLength.toFixed(1),
        'filament_weight[0]': filamentWeight.toFixed(2),
        'total_weight': filamentWeight.toFixed(2),
        'total_cost': materialCost.toFixed(2),
        
        // Вычисляемые параметры
        'total_toolchanges': '0',
        'total_layer_count': layerCount.toString(),
        'version': 'PA_Generator_1.0',
        'preset_name': selPrint.value,
        
        // Временные параметры
        'timestamp': new Date().toISOString().replace(/[:.]/g, '-'),
        'date': new Date().toLocaleDateString('ru-RU'),
        'time': new Date().toLocaleTimeString('ru-RU'),
        
        // PA тест специфичные
        'pa_start': startPA.toString(),
        'pa_end': endPA.toString(),
        'pa_step': stepPA.toString(),
        'test_objects': paValues.length.toString(),
        'object_count': paValues.length.toString(),
        'pa_range': `${startPA}-${endPA}`
      };
    } catch (e) {
      console.error('Ошибка расчета плейсхолдеров:', e);
      return {};
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
      const allConfigs = {...printerConfig, ...filamentConfig, ...printConfig};
      
      // Базовые плейсхолдеры
      template = template.replace(/\{input_filename_base\}/g, 'PA_Test');
      template = template.replace(/\{printer_model\}/g, selectedPrinter.name);
      template = template.replace(/\{printer_preset\}/g, selectedPrinter.name);
      template = template.replace(/\{filament_preset\}/g, selFilament.value);
      template = template.replace(/\{print_preset\}/g, selPrint.value);
      
      // Время печати
      const printTimeMinutes = calculatePrintTime();
      const hours = Math.floor(printTimeMinutes / 60);
      const minutes = printTimeMinutes % 60;
      const seconds = (printTimeMinutes % 1) * 60;
      template = template.replace(/\{print_time\}/g, `${hours}h${minutes}m`);
      template = template.replace(/\{total_print_time\}/g, `${hours}h${minutes}m${Math.round(seconds)}s`);
      
      // Дата и время
      const now = new Date();
      template = template.replace(/\{timestamp\}/g, now.toISOString().replace(/[:.]/g, '-'));
      template = template.replace(/\{year\}/g, now.getFullYear());
      template = template.replace(/\{month\}/g, String(now.getMonth() + 1).padStart(2, '0'));
      template = template.replace(/\{day\}/g, String(now.getDate()).padStart(2, '0'));
      template = template.replace(/\{hour\}/g, String(now.getHours()).padStart(2, '0'));
      template = template.replace(/\{minute\}/g, String(now.getMinutes()).padStart(2, '0'));
      template = template.replace(/\{second\}/g, String(now.getSeconds()).padStart(2, '0'));
      
      // Версия слайсера
      template = template.replace(/\{version\}/g, 'PA_Generator_1.0');
      
      // Материал и настройки
      const filamentType = allConfigs.filament_type || 'Unknown';
      const layerHeight = allConfigs.layer_height || '0.2';
      const nozzleTemp = allConfigs.temperature?.[0] || allConfigs.temperature || '200';
      const bedTemp = allConfigs.bed_temperature?.[0] || allConfigs.bed_temperature || '60';
      
      template = template.replace(/\{filament_type\}/g, filamentType);
      template = template.replace(/\{layer_height\}/g, layerHeight);
      template = template.replace(/\{nozzle_temperature\}/g, nozzleTemp);
      template = template.replace(/\{bed_temperature\}/g, bedTemp);
      
      // Функция digits
      template = template.replace(/\{digits\(([^,]+),\s*(\d+),\s*(\d+)\)\}/g, (match, varName, minDigits, precision) => {
        const value = parseFloat(allConfigs[varName] || 0);
        return value.toFixed(parseInt(precision)).padStart(parseInt(minDigits), '0');
      });
      
      // Функция if
      template = template.replace(/\{if\s+([^}]+)\}([^{]*?)\{endif\}/g, (match, condition, content) => {
        try {
          const evalCondition = condition.replace(/\b(\w+)\b/g, (key) => {
            const value = allConfigs[key];
            return isNaN(value) ? `"${value}"` : value;
          });
          return eval(evalCondition) ? content : '';
        } catch (e) {
          return '';
        }
      });
      
      // Массивы с индексами
      template = template.replace(/\{([^}]+)\[(\d+)\]\}/g, (match, varName, index) => {
        const value = allConfigs[varName] || '';
        const array = value.split(';');
        return array[parseInt(index)] || value;
      });
      
      // Динамические плейсхолдеры для G-code
      const gcodePlaceholders = calculateGCodePlaceholders();
      for (const [key, value] of Object.entries(gcodePlaceholders)) {
        const regex = new RegExp(`\\{${key}\\}`, 'g');
        template = template.replace(regex, value);
      }
      
      // Обычные переменные из конфигов
      for (const [key, value] of Object.entries(allConfigs)) {
        const regex = new RegExp(`\\{${key}\\}`, 'g');
        template = template.replace(regex, value);
      }
      
      // Очистка недопустимых символов для имени файла
      template = template.replace(/[<>:"/\\|?*]/g, '_');
      
      return template.endsWith('.gcode') ? template : template + '.gcode';
    } catch (e) {
      return 'PA_Test.gcode';
    }
  }
  
  function showSendProgress(message, progress = 0) {
    let progressDiv = document.getElementById('sendProgress');
    if (!progressDiv) {
      progressDiv = document.createElement('div');
      progressDiv.id = 'sendProgress';
      progressDiv.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        border: 2px solid #007acc;
        border-radius: 8px;
        padding: 20px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 1000;
        min-width: 300px;
        text-align: center;
      `;
      document.body.appendChild(progressDiv);
    }
    
    progressDiv.innerHTML = `
      <div style="margin-bottom: 15px; font-weight: bold;">${message}</div>
      <div style="background: #f0f0f0; border-radius: 10px; height: 20px; overflow: hidden;">
        <div style="background: #007acc; height: 100%; width: ${progress}%; transition: width 0.3s;"></div>
      </div>
      <div style="margin-top: 10px; font-size: 12px; color: #666;">${progress}%</div>
    `;
  }
  
  function hideSendProgress() {
    const progressDiv = document.getElementById('sendProgress');
    if (progressDiv) {
      progressDiv.remove();
    }
  }

  async function sendToPrinter() {
    const gcode = document.getElementById('gcodeOutput').value;
    if (!gcode.trim()) {
      alert('Нет G-code для отправки');
      return;
    }
    
    if (!selectedPrinter || selectedPrinter.type !== 'physical') {
      alert('Выберите физический принтер для отправки');
      return;
    }
    
    try {
      showSendProgress('Подготовка к отправке...', 10);
      
      const physicalConfigPath = path.join(currentSlicerPath, 'physical_printer', selectedPrinter.physicalName + '.ini');
      const physicalConfig = parseIniFile(physicalConfigPath);
      const printerHost = physicalConfig.print_host;
      
      let hostUrl = printerHost;
      if (printerHost && !printerHost.startsWith('http')) {
        hostUrl = `http://${printerHost}`;
      }
      
      if (!printerHost || printerHost.trim() === '' || printerHost.includes('0.0.0.1')) {
        hideSendProgress();
        alert(`IP адрес принтера некорректный: "${printerHost}".\n\nПроверьте параметр print_host в настройках физического принтера.`);
        return;
      }
      
      showSendProgress('Создание файла...', 30);
      
      const filename = generateFilename();
      const formData = new FormData();
      const blob = new Blob([gcode], { type: 'text/plain' });
      formData.append('file', blob, filename);
      
      showSendProgress('Загрузка файла на принтер...', 50);
      
      const uploadResponse = await fetch(`${hostUrl}/server/files/upload`, {
        method: 'POST',
        body: formData
      });
      
      if (uploadResponse.ok) {
        showSendProgress('Запуск печати...', 80);
        
        const startResponse = await fetch(`${hostUrl}/printer/print/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: filename })
        });
        
        if (startResponse.ok) {
          showSendProgress('Печать запущена!', 100);
          setTimeout(() => {
            hideSendProgress();
            alert(`Файл отправлен и печать запущена на ${printerHost}`);
          }, 1000);
        } else {
          hideSendProgress();
          alert(`Файл загружен, но не удалось запустить печать`);
        }
      } else {
        throw new Error('Ошибка загрузки файла');
      }
    } catch (error) {
      hideSendProgress();
      alert(`Ошибка отправки: ${error.message}`);
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
        
        const outputPath = path.join(__dirname, 'ini_examples', filename);
        
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
      
      // Передаем плейсхолдеры в генератор
      const gcodePlaceholders = calculateGCodePlaceholders();
      generator.setPlaceholders(gcodePlaceholders);
      
      const gcode = generator.generate(
        currentSlicerPath,
        selectedPrinter.name,
        selFilament.value,
        selPrint.value,
        paValues
      );
      
      document.getElementById('gcodeOutput').value = gcode;
      document.getElementById('saveBtn').disabled = false;
      updateSendButton();
      
      saveSettings();
    } catch (error) {
      alert(`Ошибка генерации G-code:\n${error.message}`);
      console.error('G-code generation error:', error);
      document.getElementById('saveBtn').disabled = true;
    }
  }
  
  function loadSettings() {
    try {
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        
        if (settings.lastSlicer) {
          selSlicer.value = settings.lastSlicer;
          currentSlicer = settings.lastSlicer;
          loadPrinters(currentSlicer);
          
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
  
  function loadPrinterSettings(printerName) {
    try {
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        const printerSettings = settings.printers?.[printerName];
        
        if (printerSettings) {
          setTimeout(() => {
            if (printerSettings.filament && selFilament.querySelector(`option[value="${printerSettings.filament}"]`)) {
              selFilament.value = printerSettings.filament;
              updatePrintSettings();
              
              setTimeout(() => {
                if (printerSettings.print && selPrint.querySelector(`option[value="${printerSettings.print}"]`)) {
                  selPrint.value = printerSettings.print;
                }
                setTimeout(() => {
                  calculatePACount();
                }, 50);
              }, 100);
            }
          }, 200);
          
          if (printerSettings.paSettings) {
            const pa = printerSettings.paSettings;
            if (pa.startPA !== undefined) document.getElementById('startPA').value = pa.startPA;
            if (pa.endPA !== undefined) document.getElementById('endPA').value = pa.endPA;
            if (pa.stepPA !== undefined) document.getElementById('stepPA').value = pa.stepPA;
            setTimeout(() => {
              calculatePACount();
            }, 100);
          }
        }
      }
    } catch (e) {
      console.error('Ошибка загрузки настроек принтера:', e);
    }
  }
  
  function saveSettings() {
    try {
      let settings = {};
      
      if (fs.existsSync(settingsPath)) {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      }
      
      settings.lastSlicer = currentSlicer;
      settings.lastPrinter = selPrinter.value;
      
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