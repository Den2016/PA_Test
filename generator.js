const fs = require('fs');
const path = require('path');
const Extruder = require('./extruder.js');

/**
 * Класс для генерации цифр PA на 4-м слое
 */
class DigitGenerator {
  constructor() {
    this.x0 = 0.0;
    this.xmax = 2.5;
    this.y0 = 0.0;
    this.ymax = 5.0;
    
    // Определения цифр как массивы координат [x, y, extrude]
    // extrude: 1 = экструзия, 0 = перемещение без экструзии
    this.digits = {
      '0': [[this.x0,this.ymax,1],[this.xmax,this.ymax,1],[this.xmax,this.y0,1],[this.x0,this.y0,1],[this.xmax+1,this.y0,0]],
      '1': [[this.xmax*0.4,this.y0,0],[this.xmax*0.4,this.ymax,1],[this.xmax+1,this.y0,0]],
      '2': [[this.xmax,this.y0,0],[this.x0,this.y0,1],[this.x0,this.ymax/2,1],[this.xmax,this.ymax/2,1],[this.xmax,this.ymax,1],[this.x0,this.ymax,1],[this.xmax+1,this.y0,0]],
      '3': [[this.xmax,this.y0,1],[this.xmax,this.ymax/2,1],[this.x0,this.ymax/2,0],[this.xmax,this.ymax/2,1],[this.xmax,this.ymax,1],[this.x0,this.ymax,1],[this.xmax+1,this.y0,0]],
      '4': [[this.xmax,this.y0,0],[this.xmax,this.ymax,1],[this.xmax,this.ymax/2,0],[this.x0,this.ymax/2,1],[this.x0,this.ymax,1],[this.xmax+1,this.y0,0]],
      '5': [[this.xmax,this.y0,1],[this.xmax,this.ymax/2,1],[this.x0,this.ymax/2,1],[this.x0,this.ymax,1],[this.xmax,this.ymax,1],[this.xmax+1,this.y0,0]],
      '6': [[this.xmax,this.ymax,0],[this.x0,this.ymax,1],[this.x0,this.y0,1],[this.xmax,this.y0,1],[this.xmax,this.ymax/2,1],[this.x0,this.ymax/2,1],[this.xmax+1,this.y0,0]],
      '7': [[this.xmax,this.y0,0],[this.xmax,this.ymax,1],[this.x0,this.ymax,1],[this.xmax+1,this.y0,0]],
      '8': [[this.x0,this.ymax,1],[this.xmax,this.ymax,1],[this.xmax,this.y0,1],[this.x0,this.y0,1],[this.x0,this.ymax/2,0],[this.xmax,this.ymax/2,1],[this.xmax+1,this.y0,0]],
      '9': [[this.xmax,this.y0,1],[this.xmax,this.ymax,1],[this.x0,this.ymax,1],[this.x0,this.ymax/2,1],[this.xmax,this.ymax/2,1],[this.xmax+1,this.y0,0]],
      '.': [[this.xmax/2-0.3,this.y0,0],[this.xmax/2-0.3,this.y0+0.3,1],[this.xmax/2,this.y0+0.3,1],[this.xmax/2,this.y0,1],[this.xmax+0.8,this.y0,0]]
    };
  }
  
  generateDigits(paValue, startX, startY, extruder, configs) {
    const gcode = [];
    
    // Правильно получаем скорости из конфигов
    const getConfigValue = (key, defaultValue) => {
      const value = configs[key];
      if (Array.isArray(value)) {
        return parseFloat(value[0]) || defaultValue;
      }
      return parseFloat(value) || defaultValue;
    };
    
    const travelSpeed = getConfigValue('travel_speed', 150) * 60; // мм/мин
    const perimeterSpeed = getConfigValue('external_perimeter_speed', 50) * 60; // мм/мин
    
    let currentX = startX;
    let currentY = startY;
    let deltaX = 0;
    let isRetracted = false;
    
    gcode.push(`; Рисуем цифры PA: ${paValue}`);
    gcode.push(`G1 X${startX.toFixed(3)} Y${startY.toFixed(3)} F${travelSpeed} ; Начальная точка цифр`);
    
    if (configs.use_firmware_retraction?.[0] === '1') {
      gcode.push('G11 ; Unretract');
    } else {
      const retractLength = getConfigValue('retract_length', 0.8);
      const deretractSpeed = getConfigValue('deretract_speed', 40) * 60;
      gcode.push(`G1 E${retractLength.toFixed(3)} F${deretractSpeed} ; Unretract`);
    }
    
    for (const char of paValue.toString()) {
      if (this.digits[char]) {
        const digit = this.digits[char];
        gcode.push(`G1 F${perimeterSpeed}`);
        
        for (const coords of digit) {
          const pointX = startX + deltaX + coords[0];
          const pointY = startY + coords[1];
          
          if (coords[2] === 1) {
            if (isRetracted) {
              if (configs.use_firmware_retraction?.[0] === '1') {
                gcode.push('G11 ; Unretract');
              } else {
                const retractLength = getConfigValue('retract_length', 0.8);
                const deretractSpeed = getConfigValue('deretract_speed', 40) * 60;
                gcode.push(`G1 E${retractLength.toFixed(3)} F${deretractSpeed} ; Unretract`);
              }
              isRetracted = false;
            }
            
            const distance = Math.sqrt(Math.pow(pointX - currentX, 2) + Math.pow(pointY - currentY, 2));
            const extrusionAmount = extruder.calculateExtrusion(distance, 0.4, 0.2);
            extruder.currentE += extrusionAmount;
            gcode.push(`G1 X${pointX.toFixed(3)} Y${pointY.toFixed(3)} E${extrusionAmount.toFixed(5)}`);
          } else {
            const distance = Math.sqrt(Math.pow(pointX - currentX, 2) + Math.pow(pointY - currentY, 2));
            if (distance > 2.0) {
              if (!isRetracted) {
                if (configs.use_firmware_retraction?.[0] === '1') {
                  gcode.push('G10 ; Retract');
                } else {
                  const retractLength = getConfigValue('retract_length', 0.8);
                  const retractSpeed = getConfigValue('retract_speed', 35) * 60;
                  gcode.push(`G1 E-${retractLength.toFixed(3)} F${retractSpeed} ; Retract`);
                }
                isRetracted = true;
              }
            }
            gcode.push(`G1 X${pointX.toFixed(3)} Y${pointY.toFixed(3)} F${travelSpeed}`);
          }
          
          currentX = pointX;
          currentY = pointY;
        }
        
        deltaX = currentX - startX;
      }
    }
    
    gcode.push('G92 E0 ; Сброс экструдера');
    return gcode;
  }
}

class GCodeGenerator {
  constructor() {
    this.variables = {};
    this.currentX = 0;
    this.currentY = 0;
    this.isRetracted = false;
    this.dynamicPlaceholders = {};
  }
  
  setPlaceholders(placeholders) {
    this.dynamicPlaceholders = placeholders || {};
  }

  addRetract(gcode, configs) {
    if (this.isRetracted) return;
    
    const useFirmwareRetraction = parseInt(configs.use_firmware_retraction?.[0] || '0') === 1;
    
    if (useFirmwareRetraction) {
      gcode.push('G10 ; Retract');
    } else {
      const retractLength = parseFloat(configs.retract_length?.[0] || '0.8');
      const retractSpeed = parseFloat(configs.retract_speed?.[0] || '35') * 60;
      gcode.push(`G1 E-${retractLength.toFixed(3)} F${retractSpeed} ; Retract`);
    }
    
    this.isRetracted = true;
  }

  addDeretract(gcode, configs) {
    if (!this.isRetracted) return;
    
    const useFirmwareRetraction = parseInt(configs.use_firmware_retraction?.[0] || '0') === 1;
    
    if (useFirmwareRetraction) {
      gcode.push('G11 ; Unretract');
    } else {
      const retractLength = parseFloat(configs.retract_length?.[0] || '0.8');
      const deretractSpeed = parseFloat(configs.deretract_speed?.[0] || '40') * 60;
      gcode.push(`G1 E${retractLength.toFixed(3)} F${deretractSpeed} ; Unretract`);
    }
    
    this.isRetracted = false;
  }

  addTravelMove(gcode, x, y, configs) {
    const distance = Math.sqrt(Math.pow(x - this.currentX, 2) + Math.pow(y - this.currentY, 2));
    const retractBeforeTravel = parseFloat(configs.retract_before_travel?.[0] || '2');
    
    const getConfigValue = (key, defaultValue) => {
      const value = configs[key];
      if (Array.isArray(value)) {
        return parseFloat(value[0]) || defaultValue;
      }
      return parseFloat(value) || defaultValue;
    };
    
    const travelSpeed = getConfigValue('travel_speed', 150) * 60;
    
    if (distance > retractBeforeTravel) {
      this.addRetract(gcode, configs);
    }
    
    gcode.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${travelSpeed}`);
    this.currentX = x;
    this.currentY = y;
    
    if (distance > retractBeforeTravel) {
      this.addDeretract(gcode, configs);
    }
  }

  parseIniFile(filePath) {
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
      console.error('Error parsing file:', filePath, e);
      return {};
    }
  }

  calculateBedBounds(bedShape) {
    if (!bedShape) return null;
    
    try {
      // Если bedShape - массив, берем первый элемент
      const shapeString = Array.isArray(bedShape) ? bedShape[0] : bedShape;
      if (!shapeString || typeof shapeString !== 'string') return null;
      
      const points = shapeString.split(',').map(point => {
        const [x, y] = point.split('x').map(Number);
        return { x, y };
      });
      
      if (points.length === 0) return null;
      
      const xs = points.map(p => p.x);
      const ys = points.map(p => p.y);
      
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      
      return {
        print_bed_min: [minX, minY],
        print_bed_max: [maxX, maxY],
        print_bed_size: [maxX - minX, maxY - minY],
        first_layer_print_min: [minX, minY],
        first_layer_print_max: [maxX, maxY]
      };
    } catch (e) {
      console.warn('Error parsing bed_shape:', bedShape, e);
      return null;
    }
  }
  processGCodeTemplate(template, configs) {
    if (!template) return '';
    
    this.variables = {...configs};
    
    if (this.variables.bed_shape) {
      const bedBounds = this.calculateBedBounds(this.variables.bed_shape);
      if (bedBounds) {
        Object.assign(this.variables, bedBounds);
      }
    }
    
    // Нормализуем переменные в массивы
    for (const [key, value] of Object.entries(this.variables)) {
      if (typeof value === 'string') {
        this.variables[key] = value.includes(';') ? value.split(';') : [value];
      } else if (!Array.isArray(value)) {
        this.variables[key] = [value];
      }
    }
    
    // Добавляем отсутствующие переменные
    if (!this.variables.max_layer_z) {
      this.variables.max_layer_z = ['5.0']; // 25 слоев * 0.2мм
    }
    if (!this.variables.max_print_height) {
      this.variables.max_print_height = ['250']; // По умолчанию
    }
    if (!this.variables.total_layer_count) {
      this.variables.total_layer_count = ['25']; // Количество слоев PA теста
    }
    
    // Обрабатываем условные блоки построчно
    const lines = template.split('\n');
    const resultLines = [];
    let skipLines = false;
    let ifStack = [];
    
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      
      // Обрабатываем условные блоки в строке
      line = line.replace(/\{if\s+([^}]+)\}([^{]*?)\{endif\}/g, (match, condition, content) => {
        let evalCondition = condition;
        
        // Заменяем переменные
        for (const [key, value] of Object.entries(this.variables)) {
          for (let idx = 0; idx < 10; idx++) {
            evalCondition = evalCondition.replace(new RegExp(`\\b${key}\\[${idx}\\]`, 'g'), value[idx] || '0');
            evalCondition = evalCondition.replace(new RegExp(`\\b${key}_${idx}\\b`, 'g'), value[idx] || '0');
          }
          evalCondition = evalCondition.replace(new RegExp(`\\b${key}\\b(?!\\[|_)`, 'g'), value[0] || '0');
        }
        
        evalCondition = evalCondition.replace(/</g, ' < ').replace(/>/g, ' > ');
        evalCondition = evalCondition.replace(/\btrue\b/g, '1').replace(/\bfalse\b/g, '0');
        
        try {
          const conditionResult = eval(evalCondition);
          return conditionResult ? content : '';
        } catch (e) {
          return '';
        }
      });
      
      // Проверяем многострочные условные конструкции
      const ifMatch = line.match(/\{if\s+([^}]+)\}/);
      const elseMatch = line.match(/\{else\}/);
      const endifMatch = line.match(/\{endif\}/);
      
      if (ifMatch) {
        const condition = ifMatch[1];
        let evalCondition = condition;
        
        // Заменяем переменные
        for (const [key, value] of Object.entries(this.variables)) {
          for (let idx = 0; idx < 10; idx++) {
            evalCondition = evalCondition.replace(new RegExp(`\\b${key}\\[${idx}\\]`, 'g'), value[idx] || '0');
            evalCondition = evalCondition.replace(new RegExp(`\\b${key}_${idx}\\b`, 'g'), value[idx] || '0');
          }
          evalCondition = evalCondition.replace(new RegExp(`\\b${key}\\b(?!\\[|_)`, 'g'), value[0] || '0');
        }
        
        evalCondition = evalCondition.replace(/</g, ' < ').replace(/>/g, ' > ');
        evalCondition = evalCondition.replace(/\btrue\b/g, '1').replace(/\bfalse\b/g, '0');
        
        try {
          const conditionResult = eval(evalCondition);
          ifStack.push({ condition: conditionResult, hasElse: false });
          skipLines = !conditionResult;
        } catch (e) {
          ifStack.push({ condition: false, hasElse: false });
          skipLines = true;
        }
        continue;
      }
      
      if (elseMatch) {
        if (ifStack.length > 0) {
          const currentIf = ifStack[ifStack.length - 1];
          currentIf.hasElse = true;
          skipLines = currentIf.condition;
        }
        continue;
      }
      
      if (endifMatch) {
        ifStack.pop();
        skipLines = ifStack.length > 0 && !ifStack[ifStack.length - 1].condition;
        continue;
      }
      
      if (!skipLines) {
        resultLines.push(line);
      }
    }
    
    // Обрабатываем плейсхолдеры
    const finalLines = resultLines.map(line => {
      // Обрабатываем плейсхолдеры в фигурных скобках {}
      line = line.replace(/\{([^}]+)\}/g, (match, expression) => {
        try {
          // Проверяем на присваивание
          const assignMatch = expression.match(/^([^=]+)\s*=\s*(.+)$/);
          if (assignMatch) {
            let varName = assignMatch[1].trim();
            const expr = assignMatch[2].trim();
            
            // Обрабатываем индексы массивов
            const indexMatch = varName.match(/^(.+)\[(\d+)\]$/);
            let baseVarName = varName;
            let index = 0;
            if (indexMatch) {
              baseVarName = indexMatch[1];
              index = parseInt(indexMatch[2]);
            }
            
            let evalExpr = expr;
            // Заменяем переменные
            for (const [key, value] of Object.entries(this.variables)) {
              for (let i = 0; i < 10; i++) {
                evalExpr = evalExpr.replace(new RegExp(`\\b${key}\\[${i}\\]`, 'g'), value[i] || '0');
                evalExpr = evalExpr.replace(new RegExp(`\\b${key}_${i}\\b`, 'g'), value[i] || '0');
              }
              evalExpr = evalExpr.replace(new RegExp(`\\b${key}\\b(?!\\[|_)`, 'g'), value[0] || '0');
            }
            
            evalExpr = evalExpr.replace(/\bmax\(/g, 'Math.max(');
            evalExpr = evalExpr.replace(/\bmin\(/g, 'Math.min(');
            
            const result = eval(evalExpr);
            
            // Сохраняем результат
            if (!this.variables[baseVarName]) {
              this.variables[baseVarName] = [];
            }
            this.variables[baseVarName][index] = result;
            
            return ''; // Присваивание не выводит текст
          } else {
            // Обычное выражение
            let evalExpr = expression;
            
            // Заменяем переменные
            for (const [key, value] of Object.entries(this.variables)) {
              for (let i = 0; i < 10; i++) {
                evalExpr = evalExpr.replace(new RegExp(`\\b${key}\\[${i}\\]`, 'g'), value[i] || '0');
                evalExpr = evalExpr.replace(new RegExp(`\\b${key}_${i}\\b`, 'g'), value[i] || '0');
              }
              evalExpr = evalExpr.replace(new RegExp(`\\b${key}\\b(?!\\[|_)`, 'g'), value[0] || '0');
            }
            
            // Обрабатываем математические выражения
            evalExpr = evalExpr.replace(/\bmax\(/g, 'Math.max(');
            evalExpr = evalExpr.replace(/\bmin\(/g, 'Math.min(');
            
            return eval(evalExpr);
          }
        } catch (e) {
          return match;
        }
      });
      
      // Обрабатываем плейсхолдеры в квадратных скобках [] (для Klipper)
      line = line.replace(/\[([^\]]+)\]/g, (match, varName) => {
        if (this.variables[varName]) {
          return this.variables[varName][0] || '0';
        }
        return match;
      });
      
      return line;
    });
    
    return finalLines.join('\n').replace(/\\n/g, '\n');
  }

  calculateExtrusion(length, width, height, filamentDiameter, multiplier = 1) {
    const volume = length * width * height;
    const filamentArea = Math.PI * Math.pow(filamentDiameter / 2, 2);
    return (volume / filamentArea) * multiplier;
  }

  parseSpeed(speedValue, baseSpeed) {
    if (typeof speedValue === 'string' && speedValue.endsWith('%')) {
      return parseFloat(baseSpeed) * parseFloat(speedValue) / 100;
    }
    return parseFloat(speedValue);
  }

  parseInfillOverlap(overlapValue, extrusionWidth) {
    if (typeof overlapValue === 'string' && overlapValue.endsWith('%')) {
      return extrusionWidth * parseFloat(overlapValue) / 100;
    }
    return parseFloat(overlapValue);
  }

  generateDiagonalZigzag(infillX1, infillY1, infillX2, infillY2, extrusionWidth, rotateLeft = true, minLineLengthFactor = 2.0) {
    const width = infillX2 - infillX1;
    const height = infillY2 - infillY1;
    const centerX = (infillX1 + infillX2) / 2;
    const centerY = (infillY1 + infillY2) / 2;
    
    const lines = [];
    const maxDimension = Math.max(width, height) * 1.5;
    const lineCount = Math.ceil(maxDimension / extrusionWidth) + 2;
    
    for (let i = 0; i < lineCount; i++) {
      const x = -maxDimension / 2 + i * extrusionWidth;
      lines.push([
        {x: x, y: -maxDimension / 2},
        {x: x, y: maxDimension / 2}
      ]);
    }
    
    const angle = rotateLeft ? Math.PI / 4 : -Math.PI / 4;
    const cos45 = Math.cos(angle);
    const sin45 = Math.sin(angle);
    
    const rotatedLines = lines.map(line => {
      return line.map(point => ({
        x: point.x * cos45 - point.y * sin45 + centerX,
        y: point.x * sin45 + point.y * cos45 + centerY
      }));
    });
    
    const points = [];
    let isFirstLine = true;
    const minLineLength = extrusionWidth * minLineLengthFactor;
    
    for (let i = 0; i < rotatedLines.length; i++) {
      const line = rotatedLines[i];
      const clippedLine = this.clipLineToRect(line[0], line[1], infillX1, infillY1, infillX2, infillY2);
      
      if (clippedLine) {
        const lineLength = Math.sqrt(
          Math.pow(clippedLine.end.x - clippedLine.start.x, 2) + 
          Math.pow(clippedLine.end.y - clippedLine.start.y, 2)
        );
        
        if (lineLength < minLineLength) continue;
        
        if (isFirstLine) {
          points.push(clippedLine.start);
          points.push(clippedLine.end);
          isFirstLine = false;
        } else {
          if (i % 2 === 1) {
            points.push(clippedLine.start);
            points.push(clippedLine.end);
          } else {
            points.push(clippedLine.end);
            points.push(clippedLine.start);
          }
        }
      }
    }
    
    return points;
  }

  clipLineToRect(p1, p2, x1, y1, x2, y2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    let t0 = 0, t1 = 1;
    
    const clipTest = (p, q) => {
      if (p === 0) return q >= 0;
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
      return true;
    };
    
    if (clipTest(-dx, p1.x - x1) && clipTest(dx, x2 - p1.x) && clipTest(-dy, p1.y - y1) && clipTest(dy, y2 - p1.y)) {
      return {
        start: { x: p1.x + t0 * dx, y: p1.y + t0 * dy },
        end: { x: p1.x + t1 * dx, y: p1.y + t1 * dy }
      };
    }
    return null;
  }

  generateNewInfill(objX, objY, objectWidth, objectHeight, currentLayerHeight, perimeterCount, extrusionWidth, overlapDistance, extruder, configs, isFirstLayer = false, rotateLeft = true) {
    const perimeterOffset = perimeterCount * extrusionWidth - overlapDistance;
    const infillX1 = objX + perimeterOffset + extrusionWidth / 2;
    const infillY1 = objY + perimeterOffset + extrusionWidth / 2;
    const infillX2 = objX + objectWidth - perimeterOffset - extrusionWidth / 2;
    const infillY2 = objY + objectHeight - perimeterOffset - extrusionWidth / 2;
    
    if (infillX2 <= infillX1 || infillY2 <= infillY1) return [];
    
    const minLineLengthFactor = 2;
    const points = this.generateDiagonalZigzag(infillX1, infillY1, infillX2, infillY2, extrusionWidth, rotateLeft, minLineLengthFactor);
    
    if (points.length === 0) return [];
    
    let infillGcode = [];
    infillGcode.push(';TYPE:Solid infill');
    infillGcode.push(`;WIDTH:${extrusionWidth.toFixed(3)}`);
    
    const speeds = this.calculateSpeeds(configs, isFirstLayer, extruder, extrusionWidth, currentLayerHeight);
    const travelSpeed = parseFloat(configs.travel_speed[0]) * 60;
    
    this.addTravelMove(infillGcode, points[0].x, points[0].y, configs);
    
    for (let i = 1; i < points.length; i++) {
      const prevPoint = points[i - 1];
      const currentPoint = points[i];
      
      const distance = Math.sqrt(
        Math.pow(currentPoint.x - prevPoint.x, 2) + 
        Math.pow(currentPoint.y - prevPoint.y, 2)
      );
      
      const extrusionAmount = extruder.calculateExtrusion(distance, extrusionWidth, currentLayerHeight);
      extruder.currentE += extrusionAmount;
      
      infillGcode.push(`G1 X${currentPoint.x.toFixed(3)} Y${currentPoint.y.toFixed(3)} E${extrusionAmount.toFixed(5)} F${speeds.infill}`);
      this.currentX = currentPoint.x;
      this.currentY = currentPoint.y;
    }
    
    return infillGcode;
  }

  calculateSpeeds(configs, isFirstLayer, extruder = null, extrusionWidth = 0.4, layerHeight = 0.2) {
    const getConfigValue = (key, defaultValue) => {
      const value = configs[key];
      if (Array.isArray(value)) {
        return value[0] || defaultValue;
      }
      return value || defaultValue;
    };
    
    const perimeterSpeed = parseFloat(getConfigValue('perimeter_speed', '50'));
    const externalPerimeterSpeed = this.parseSpeed(getConfigValue('external_perimeter_speed', '50%'), perimeterSpeed);
    const infillSpeed = parseFloat(getConfigValue('infill_speed', '80'));
    
    let speeds;
    if (isFirstLayer) {
      const firstLayerSpeed = getConfigValue('first_layer_speed', '30');
      const firstLayerInfillSpeed = getConfigValue('first_layer_infill_speed', firstLayerSpeed);
      
      if (firstLayerSpeed.endsWith('%')) {
        speeds = {
          external: this.parseSpeed(firstLayerSpeed, externalPerimeterSpeed),
          perimeter: this.parseSpeed(firstLayerSpeed, perimeterSpeed),
          infill: this.parseSpeed(firstLayerInfillSpeed, infillSpeed)
        };
      } else {
        const absoluteSpeed = parseFloat(firstLayerSpeed);
        speeds = {
          external: absoluteSpeed,
          perimeter: absoluteSpeed,
          infill: parseFloat(firstLayerInfillSpeed)
        };
      }
    } else {
      speeds = {
        external: externalPerimeterSpeed,
        perimeter: perimeterSpeed,
        infill: infillSpeed
      };
    }
    
    // Ограничиваем скорости по объемному расходу если есть экструдер
    if (extruder) {
      speeds.external = extruder.limitSpeedByVolumetricFlow(speeds.external, extrusionWidth, layerHeight);
      speeds.perimeter = extruder.limitSpeedByVolumetricFlow(speeds.perimeter, extrusionWidth, layerHeight);
      speeds.infill = extruder.limitSpeedByVolumetricFlow(speeds.infill, extrusionWidth, layerHeight);
    }
    
    // Конвертируем в мм/мин
    return {
      external: speeds.external * 60,
      perimeter: speeds.perimeter * 60,
      infill: speeds.infill * 60
    };
  }

  generatePerimeter(perimeterIndex, totalPerimeters, objX, objY, objectWidth, objectHeight, extrusionWidth, nozzleDiameter, currentLayerHeight, extruder, configs, isFirstLayer = false) {
    const offset = perimeterIndex * extrusionWidth;
    const x1 = objX + extrusionWidth / 2 + offset;
    const y1 = objY + extrusionWidth / 2 + offset;
    const x2 = objX + objectWidth - extrusionWidth / 2 - offset;
    const y2 = objY + objectHeight - extrusionWidth / 2 - offset;
    
    if (x2 <= x1 || y2 <= y1) return [];
    
    const sides = [
      { from: [x1, y1], to: [x2, y1] },
      { from: [x2, y1], to: [x2, y2] },
      { from: [x2, y2], to: [x1, y2] },
      { from: [x1, y2], to: [x1, y1] }
    ];
    
    let perimeterGcode = [];
    
    const isExternal = perimeterIndex === 0;
    if (isExternal) {
      perimeterGcode.push(';TYPE:External perimeter');
    } else {
      perimeterGcode.push(';TYPE:Perimeter');
    }
    perimeterGcode.push(`;WIDTH:${extrusionWidth.toFixed(3)}`);
    
    sides.forEach((side, index) => {
      let [fromX, fromY] = side.from;
      let [toX, toY] = side.to;
      
      if (index === sides.length - 1) {
        const dx = toX - fromX;
        const dy = toY - fromY;
        const length = Math.sqrt(dx * dx + dy * dy);
        const gapDistance = nozzleDiameter * 0.15;
        const ratio = (length - gapDistance) / length;
        toX = fromX + dx * ratio;
        toY = fromY + dy * ratio;
      }
      
      const actualLength = Math.sqrt(Math.pow(toX - fromX, 2) + Math.pow(toY - fromY, 2));
      const extrusionAmount = extruder.calculateExtrusion(actualLength, extrusionWidth, currentLayerHeight);
      extruder.currentE += extrusionAmount;
      
      if (index === 0) {
        this.addTravelMove(perimeterGcode, fromX, fromY, configs);
      }
      const speeds = this.calculateSpeeds(configs, isFirstLayer, extruder, extrusionWidth, currentLayerHeight);
      const speed = isExternal ? speeds.external : speeds.perimeter;
      perimeterGcode.push(`G1 X${toX.toFixed(3)} Y${toY.toFixed(3)} E${extrusionAmount.toFixed(5)} F${speed}`);
      this.currentX = toX;
      this.currentY = toY;
    });
    
    return perimeterGcode;
  }

  generateInfillOdd(objX, objY, objectWidth, objectHeight, currentLayerHeight, perimeterCount, extrusionWidth, overlapDistance, extruder, configs, isFirstLayer = false) {
    // Расчет границ области заполнения
    const perimeterOffset = perimeterCount * extrusionWidth - overlapDistance;
    const infillX1 = objX + perimeterOffset + extrusionWidth/2; // Левая граница
    const infillY1 = objY + perimeterOffset + extrusionWidth/2; // Нижняя граница
    const infillX2 = objX + objectWidth - perimeterOffset - extrusionWidth/2; // Правая граница
    const infillY2 = objY + objectHeight - perimeterOffset - extrusionWidth/2; // Верхняя граница
    
    let infillGcode = [];
    infillGcode.push(';TYPE:Solid infill');
    infillGcode.push(`;WIDTH:${extrusionWidth.toFixed(3)}`);
    
    // Начальная точка - левый нижний угол области заполнения
    let currentX = infillX1;
    let currentY = infillY1;
    const startX = infillX1; // Запоминаем начальную точку для расчета катетов
    const startY = infillY1;
    
    this.addTravelMove(infillGcode, currentX, currentY, configs);
    
    const speeds = this.calculateSpeeds(configs, isFirstLayer, extruder, extrusionWidth, currentLayerHeight);
    
    // Определяем короткое движение экструзии
    const shortExtrude = extrusionWidth * 1.3275;
    
    // ФАЗА 1: Движение снизу вверх с зигзагом
    infillGcode.push('; phase 1 start');
    while (true) {
      // ШАГ 1: Делаем shortExtrude вправо (горизонтальный катет)
      if (currentX + shortExtrude > infillX2) break; // Проверяем правую границу
      
      const extrusionAmount1 = extruder.calculateExtrusion(shortExtrude, extrusionWidth, currentLayerHeight);
      extruder.currentE += extrusionAmount1;
      currentX += shortExtrude;
      infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount1.toFixed(5)} F${speeds.infill}`);
      
      // ШАГ 2: Экструдируем гипотенузу влево-вверх
      // Катет = расстояние от начальной точки по горизонтали
      const horizontalCathet = currentX - startX;
      const maxVerticalMove = infillY2 - currentY; // Максимально возможное движение вверх
      const actualVerticalMove = Math.min(horizontalCathet, maxVerticalMove);
      
      if (actualVerticalMove <= 0) break; // Достигли верхней границы
      
      const diagonalLength = Math.sqrt(actualVerticalMove * actualVerticalMove + actualVerticalMove * actualVerticalMove);
      const extrusionAmount2 = extruder.calculateExtrusion(diagonalLength, extrusionWidth, currentLayerHeight);
      extruder.currentE += extrusionAmount2;
      currentX -= actualVerticalMove;
      currentY += actualVerticalMove;
      infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount2.toFixed(5)} F${speeds.infill}`);
      
      // Если достигли верхней границы, переходим к ФАЗЕ 2
      if (currentY >= infillY2) break;
      
      // ШАГ 3: Делаем shortExtrude вверх (вертикальный катет)
      if (currentY + shortExtrude > infillY2) break; // Проверяем верхнюю границу
      
      const extrusionAmount3 = extruder.calculateExtrusion(shortExtrude, extrusionWidth, currentLayerHeight);
      extruder.currentE += extrusionAmount3;
      currentY += shortExtrude;
      infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount3.toFixed(5)} F${speeds.infill}`);
      
      // ШАГ 4: Экструдируем гипотенузу вправо-вниз
      // Катет = расстояние от начальной точки по вертикали
      const verticalCathet = currentY - startY;
      const maxHorizontalMove = infillX2 - currentX; // Максимально возможное движение вправо
      const actualHorizontalMove = Math.min(verticalCathet, maxHorizontalMove);
      
      if (actualHorizontalMove <= 0) break; // Достигли правой границы
      
      const diagonalLength2 = Math.sqrt(actualHorizontalMove * actualHorizontalMove + actualHorizontalMove * actualHorizontalMove);
      const extrusionAmount4 = extruder.calculateExtrusion(diagonalLength2, extrusionWidth, currentLayerHeight);
      extruder.currentE += extrusionAmount4;
      currentX += actualHorizontalMove;
      currentY -= actualHorizontalMove;
      infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount4.toFixed(5)} F${speeds.infill}`);
      
      // Если достигли правой границы, переходим к ФАЗЕ 3
      if (currentX >= infillX2) break;
    }
    infillGcode.push('; phase 1 end');
    
    // ФАЗА 2: Движение по верхней границе (если достигли верха)
    if (currentY >= infillY2) {
      infillGcode.push('; phase 2 start');
      while (true) {
        // ШАГ 5: Делаем shortExtrude вправо
        if (currentX + shortExtrude > infillX2) break; // Проверяем правую границу
        
        const extrusionAmount5 = extruder.calculateExtrusion(shortExtrude, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount5;
        currentX += shortExtrude;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount5.toFixed(5)} F${speeds.infill}`);
        
        // ШАГ 6: Экструдируем гипотенузу вправо-вниз
        // В фазе 2 катет = высота области заполнения (перпендикулярно движению)
        const verticalCathet = infillY2 - infillY1;
        const maxDownMove = currentY - infillY1; // Максимально возможное движение вниз
        const maxRightMove = infillX2 - currentX; // Максимально возможное движение вправо
        const actualMove = Math.min(verticalCathet, Math.min(maxDownMove, maxRightMove));
        
        if (actualMove <= 0) break;
        
        const diagonalLength6 = Math.sqrt(actualMove * actualMove + actualMove * actualMove);
        const extrusionAmount6 = extruder.calculateExtrusion(diagonalLength6, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount6;
        currentX += actualMove;
        currentY -= actualMove;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount6.toFixed(5)} F${speeds.infill}`);
        
        // Если достигли правой границы, переходим к ФАЗЕ 3
        if (currentX >= infillX2) break;
        
        // ШАГ 7: Делаем shortExtrude вправо
        if (currentX + shortExtrude > infillX2) break;
        
        const extrusionAmount7 = extruder.calculateExtrusion(shortExtrude, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount7;
        currentX += shortExtrude;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount7.toFixed(5)} F${speeds.infill}`);
        
        // ШАГ 8: Экструдируем гипотенузу влево-вверх
        // В фазе 2 катет = высота области заполнения (перпендикулярно движению)
        const verticalCathet2 = infillY2 - infillY1;
        const maxUpMove = infillY2 - currentY;
        const maxLeftMove = currentX - infillX1;
        const actualMove2 = Math.min(verticalCathet2, Math.min(maxUpMove, maxLeftMove));
        
        if (actualMove2 <= 0) break;
        
        const diagonalLength8 = Math.sqrt(actualMove2 * actualMove2 + actualMove2 * actualMove2);
        const extrusionAmount8 = extruder.calculateExtrusion(diagonalLength8, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount8;
        currentX -= actualMove2;
        currentY += actualMove2;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount8.toFixed(5)} F${speeds.infill}`);
      }
      infillGcode.push('; phase 2 end');
    }
    
    // ФАЗА 3: Движение по правой границе (если достигли правого края)
    if (currentX >= infillX2 - shortExtrude) {
      infillGcode.push(`; phase 3 start - current: ${currentX.toFixed(3)},${currentY.toFixed(3)} origin: ${infillX2.toFixed(3)},${infillY2.toFixed(3)}`);
      // ШАГ 9: Устанавливаем новую начальную точку для фазы 3 (правый верхний угол)
      const phase3StartX = infillX2;
      const phase3StartY = infillY2;

      while (true) {

        // ШАГ 10: Делаем shortExtrude вверх
        if (currentY + shortExtrude > infillY2) break; // Достигли верхней границы
        

        const extrusionAmount10 = extruder.calculateExtrusion(shortExtrude, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount10;
        currentY += shortExtrude;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount10.toFixed(5)} F${speeds.infill}`);
        
        // ШАГ 11: Экструдируем гипотенузу влево-вверх
        // Катет = расстояние от начальной точки фазы 3 по вертикали
        const verticalCathet = phase3StartY - currentY;
        const maxLeftMove11 = currentX - infillX1;
        const maxUpMove11 = infillY2 - currentY;
        const actualMove11 = Math.min(verticalCathet, Math.min(maxLeftMove11, maxUpMove11));
        
        if (actualMove11 <= 0) break;
        
        const diagonalLength11 = Math.sqrt(actualMove11 * actualMove11 + actualMove11 * actualMove11);
        const extrusionAmount11 = extruder.calculateExtrusion(diagonalLength11, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount11;
        currentX -= actualMove11;
        currentY += actualMove11;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount11.toFixed(5)} F${speeds.infill}`);
        
        // ШАГ 12: Делаем shortExtrude вправо
        if (currentX + shortExtrude > infillX2) break; // Достигли правой границы
        
        const extrusionAmount12 = extruder.calculateExtrusion(shortExtrude, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount12;
        currentX += shortExtrude;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount12.toFixed(5)} F${speeds.infill}`);
        
        // ШАГ 13: Экструдируем гипотенузу вправо-вниз
        // Катет = расстояние от начальной точки фазы 3 по горизонтали
        const horizontalCathet = phase3StartX - currentX;
        const maxRightMove13 = infillX2 - currentX;
        const maxDownMove13 = currentY - infillY1;
        const actualMove13 = Math.min(horizontalCathet, Math.min(maxRightMove13, maxDownMove13));
        
        if (actualMove13 <= 0) break;
        
        const diagonalLength13 = Math.sqrt(actualMove13 * actualMove13 + actualMove13 * actualMove13);
        const extrusionAmount13 = extruder.calculateExtrusion(diagonalLength13, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount13;
        currentX += actualMove13;
        currentY -= actualMove13;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount13.toFixed(5)} F${speeds.infill}`);
        
      }
      infillGcode.push('; phase 3 end');
    }
    
    return infillGcode;
  }

  /**
   * Оптимизирует порядок печати объектов для минимизации холостых ходов
   * @param {number} totalObjects - Общее количество объектов
   * @param {number} objectsPerRow - Количество объектов в ряду
   * @param {number} layer - Номер слоя (0-24)
   * @returns {Array} Оптимизированный порядок индексов объектов
   */
  getOptimizedPrintOrder(totalObjects, objectsPerRow, layer) {
    const totalRows = Math.ceil(totalObjects / objectsPerRow);
    const isOddLayer = (layer + 1) % 2 === 1;
    const order = [];
    
    if (isOddLayer) {
      // Нечетный слой: ряды снизу вверх, нечетные ряды слева направо, четные справа налево
      for (let row = 0; row < totalRows; row++) {
        const isOddRow = row % 2 === 0; // Первый ряд (row=0) считаем нечетным
        const isLastRow = row === totalRows - 1;
        const objectsInRow = isLastRow ? totalObjects - row * objectsPerRow : objectsPerRow;
        const isRowFull = objectsInRow === objectsPerRow;
        
        // Для четного неполного ряда печатаем справа налево
        const shouldReverse = !isOddRow && (!isRowFull || !isOddRow);
        const startCol = shouldReverse ? objectsInRow - 1 : 0;
        const endCol = shouldReverse ? -1 : objectsInRow;
        const step = shouldReverse ? -1 : 1;
        
        for (let col = startCol; col !== endCol; col += step) {
          const objIndex = row * objectsPerRow + col;
          if (objIndex < totalObjects) {
            order.push(objIndex);
          }
        }
      }
    } else {
      // Четный слой: ряды сверху вниз, нечетные ряды справа налево, четные слева направо
      for (let row = totalRows - 1; row >= 0; row--) {
        const isOddRow = row % 2 === 0;
        const isLastRow = row === totalRows - 1;
        const objectsInRow = isLastRow ? totalObjects - row * objectsPerRow : objectsPerRow;
        const isRowFull = objectsInRow === objectsPerRow;
        
        // Для нечетного неполного ряда печатаем справа налево
        const shouldReverse = isOddRow && (!isRowFull || isOddRow);
        const startCol = shouldReverse ? objectsInRow - 1 : 0;
        const endCol = shouldReverse ? -1 : objectsInRow;
        const step = shouldReverse ? -1 : 1;
        
        for (let col = startCol; col !== endCol; col += step) {
          const objIndex = row * objectsPerRow + col;
          if (objIndex < totalObjects) {
            order.push(objIndex);
          }
        }
      }
    }
    
    return order;
  }

  generateInfillEven(objX, objY, objectWidth, objectHeight, currentLayerHeight, perimeterCount, extrusionWidth, overlapDistance, extruder, configs, isFirstLayer = false) {
    // Расчет границ области заполнения
    const perimeterOffset = perimeterCount * extrusionWidth - overlapDistance;
    const infillX1 = objX + perimeterOffset + extrusionWidth/2; // Левая граница
    const infillY1 = objY + perimeterOffset + extrusionWidth/2; // Нижняя граница
    const infillX2 = objX + objectWidth - perimeterOffset - extrusionWidth/2; // Правая граница
    const infillY2 = objY + objectHeight - perimeterOffset - extrusionWidth/2; // Верхняя граница
    
    let infillGcode = [];
    infillGcode.push(';TYPE:Solid infill');
    infillGcode.push(`;WIDTH:${extrusionWidth.toFixed(3)}`);
    
    // Начальная точка - правый нижний угол области заполнения
    let currentX = infillX2;
    let currentY = infillY1;
    const startX = infillX2; // Запоминаем начальную точку для расчета катетов
    const startY = infillY1;
    
    this.addTravelMove(infillGcode, currentX, currentY, configs);
    
    const speeds = this.calculateSpeeds(configs, isFirstLayer, extruder, extrusionWidth, currentLayerHeight);
    
    // Определяем короткое движение экструзии
    const shortExtrude = extrusionWidth * 1.3275;
    
    // ФАЗА 1: Движение снизу вверх с зигзагом (начинаем справа)
    infillGcode.push('; phase 1 start');
    while (true) {
      // ШАГ 1: Делаем shortExtrude влево (горизонтальный катет)
      if (currentX - shortExtrude < infillX1) break; // Проверяем левую границу
      
      const extrusionAmount1 = extruder.calculateExtrusion(shortExtrude, extrusionWidth, currentLayerHeight);
      extruder.currentE += extrusionAmount1;
      currentX -= shortExtrude;
      infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount1.toFixed(5)} F${speeds.infill}`);
      
      // ШАГ 2: Экструдируем гипотенузу вправо-вверх
      // Катет = расстояние от начальной точки по горизонтали
      const horizontalCathet = startX - currentX;
      const maxVerticalMove = infillY2 - currentY; // Максимально возможное движение вверх
      const actualVerticalMove = Math.min(horizontalCathet, maxVerticalMove);
      
      if (actualVerticalMove <= 0) break; // Достигли верхней границы
      
      const diagonalLength = Math.sqrt(actualVerticalMove * actualVerticalMove + actualVerticalMove * actualVerticalMove);
      const extrusionAmount2 = extruder.calculateExtrusion(diagonalLength, extrusionWidth, currentLayerHeight);
      extruder.currentE += extrusionAmount2;
      currentX += actualVerticalMove;
      currentY += actualVerticalMove;
      infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount2.toFixed(5)} F${speeds.infill}`);
      
      // Если достигли верхней границы, переходим к ФАЗЕ 2
      if (currentY >= infillY2) break;
      
      // ШАГ 3: Делаем shortExtrude вверх (вертикальный катет)
      if (currentY + shortExtrude > infillY2) break; // Проверяем верхнюю границу
      
      const extrusionAmount3 = extruder.calculateExtrusion(shortExtrude, extrusionWidth, currentLayerHeight);
      extruder.currentE += extrusionAmount3;
      currentY += shortExtrude;
      infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount3.toFixed(5)} F${speeds.infill}`);
      
      // ШАГ 4: Экструдируем гипотенузу влево-вниз
      // Катет = расстояние от начальной точки по вертикали
      const verticalCathet = currentY - startY;
      const maxHorizontalMove = currentX - infillX1; // Максимально возможное движение влево
      const actualHorizontalMove = Math.min(verticalCathet, maxHorizontalMove);
      
      if (actualHorizontalMove <= 0) break; // Достигли левой границы
      
      const diagonalLength2 = Math.sqrt(actualHorizontalMove * actualHorizontalMove + actualHorizontalMove * actualHorizontalMove);
      const extrusionAmount4 = extruder.calculateExtrusion(diagonalLength2, extrusionWidth, currentLayerHeight);
      extruder.currentE += extrusionAmount4;
      currentX -= actualHorizontalMove;
      currentY -= actualHorizontalMove;
      infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount4.toFixed(5)} F${speeds.infill}`);
      
      // Если достигли левой границы, переходим к ФАЗЕ 3
      if (currentX <= infillX1) break;
    }
    infillGcode.push('; phase 1 end');
    
    // ФАЗА 2: Движение по верхней границе (если достигли верха)
    if (currentY >= infillY2) {
      infillGcode.push('; phase 2 start');
      while (true) {
        // ШАГ 5: Делаем shortExtrude влево
        if (currentX - shortExtrude < infillX1) break; // Проверяем левую границу
        
        const extrusionAmount5 = extruder.calculateExtrusion(shortExtrude, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount5;
        currentX -= shortExtrude;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount5.toFixed(5)} F${speeds.infill}`);
        
        // ШАГ 6: Экструдируем гипотенузу влево-вниз
        // В фазе 2 катет = высота области заполнения (перпендикулярно движению)
        const verticalCathet = infillY2 - infillY1;
        const maxDownMove = currentY - infillY1; // Максимально возможное движение вниз
        const maxLeftMove = currentX - infillX1; // Максимально возможное движение влево
        const actualMove = Math.min(verticalCathet, Math.min(maxDownMove, maxLeftMove));
        
        if (actualMove <= 0) break;
        
        const diagonalLength6 = Math.sqrt(actualMove * actualMove + actualMove * actualMove);
        const extrusionAmount6 = extruder.calculateExtrusion(diagonalLength6, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount6;
        currentX -= actualMove;
        currentY -= actualMove;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount6.toFixed(5)} F${speeds.infill}`);
        
        // Если достигли левой границы, переходим к ФАЗЕ 3
        if (currentX <= infillX1) break;
        
        // ШАГ 7: Делаем shortExtrude влево
        if (currentX - shortExtrude < infillX1) break;
        
        const extrusionAmount7 = extruder.calculateExtrusion(shortExtrude, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount7;
        currentX -= shortExtrude;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount7.toFixed(5)} F${speeds.infill}`);
        
        // ШАГ 8: Экструдируем гипотенузу вправо-вверх
        // В фазе 2 катет = высота области заполнения (перпендикулярно движению)
        const verticalCathet2 = infillY2 - infillY1;
        const maxUpMove = infillY2 - currentY;
        const maxRightMove = infillX2 - currentX;
        const actualMove2 = Math.min(verticalCathet2, Math.min(maxUpMove, maxRightMove));
        
        if (actualMove2 <= 0) break;
        
        const diagonalLength8 = Math.sqrt(actualMove2 * actualMove2 + actualMove2 * actualMove2);
        const extrusionAmount8 = extruder.calculateExtrusion(diagonalLength8, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount8;
        currentX += actualMove2;
        currentY += actualMove2;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount8.toFixed(5)} F${speeds.infill}`);
      }
      infillGcode.push('; phase 2 end');
    }
    
    // ФАЗА 3: Движение по левой границе (если достигли левого края)
    if (currentX <= infillX1 + shortExtrude) {
      infillGcode.push(`; phase 3 start - current: ${currentX.toFixed(3)},${currentY.toFixed(3)} origin: ${infillX1.toFixed(3)},${infillY2.toFixed(3)}`);
      // ШАГ 9: Устанавливаем новую начальную точку для фазы 3 (левый верхний угол)
      const phase3StartX = infillX1;
      const phase3StartY = infillY2;


      // Временно уменьшаем extrusionWidth для запуска одного цикла фазы 3
      const originalExtrusionWidth = extrusionWidth;
      const reducedExtrusionWidth = extrusionWidth;// currentX - infillX1; // Разница между текущим X и левой границей

      while (true) {

        // ШАГ 10: Делаем shortExtrude вверх
        if (currentY + shortExtrude > infillY2) break; // Достигли верхней границы
        

        const extrusionAmount10 = extruder.calculateExtrusion(shortExtrude, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount10;
        currentY += shortExtrude;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount10.toFixed(5)} F${speeds.infill}`);

        // ШАГ 11: Экструдируем гипотенузу вправо-вверх
        // Катет = расстояние от начальной точки фазы 3 по вертикали
        const verticalCathet = phase3StartY - currentY;
        const maxRightMove11 = infillX2 - currentX;
        const maxUpMove11 = infillY2 - currentY;
        const actualMove11 = Math.min(verticalCathet, Math.min(maxRightMove11, maxUpMove11));
        
        if (actualMove11 <= 0) break;
        
        const diagonalLength11 = Math.sqrt(actualMove11 * actualMove11 + actualMove11 * actualMove11);
        const extrusionAmount11 = extruder.calculateExtrusion(diagonalLength11, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount11;
        currentX += actualMove11;
        currentY += actualMove11;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount11.toFixed(5)} F${speeds.infill}`);
        
        // ШАГ 12: Делаем shortExtrude влево
        if (currentX - shortExtrude < infillX1) break; // Достигли левой границы
        
        const extrusionAmount12 = extruder.calculateExtrusion(shortExtrude, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount12;
        currentX -= shortExtrude;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount12.toFixed(5)} F${speeds.infill}`);
        
        // ШАГ 13: Экструдируем гипотенузу влево-вниз
        // Катет = расстояние от начальной точки фазы 3 по горизонтали
        const horizontalCathet = currentX - phase3StartX;
        const maxLeftMove13 = currentX - infillX1;
        const maxDownMove13 = currentY - infillY1;
        const actualMove13 = Math.min(horizontalCathet, Math.min(maxLeftMove13, maxDownMove13));
        
        if (actualMove13 <= 0) break;
        
        const diagonalLength13 = Math.sqrt(actualMove13 * actualMove13 + actualMove13 * actualMove13);
        const extrusionAmount13 = extruder.calculateExtrusion(diagonalLength13, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount13;
        currentX -= actualMove13;
        currentY -= actualMove13;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount13.toFixed(5)} F${speeds.infill}`);
        
      }
      infillGcode.push('; phase 3 end');
    }
    
    return infillGcode;
  }
  /**
   * Рассчитывает оптимальное расположение объектов на столе
   */
  calculateOptimalLayout(objectCount, objectWidth, objectHeight, spacing, bedWidth, bedHeight) {
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
  
  /**
   * Рассчитывает максимальное количество объектов на столе
   */
  calculateMaxObjects(objectWidth, objectHeight, spacing, bedWidth, bedHeight) {
    const margin = 10;
    const availableWidth = bedWidth - 2 * margin;
    const availableHeight = bedHeight - 2 * margin;
    
    const maxCols = Math.floor((availableWidth + spacing) / (objectWidth + spacing));
    const maxRows = Math.floor((availableHeight + spacing) / (objectHeight + spacing));
    
    return maxCols * maxRows;
  }

  generatePAObjects(slicerPath, printerName, filamentName, printName, paValues) {
    const printerConfig = this.parseIniFile(path.join(slicerPath, 'printer', printerName + '.ini'));
    const filamentConfig = this.parseIniFile(path.join(slicerPath, 'filament', filamentName + '.ini'));
    const printConfig = this.parseIniFile(path.join(slicerPath, 'print', printName + '.ini'));
    
    const allConfigs = {...printerConfig, ...filamentConfig, ...printConfig};
    this.variables = {...allConfigs};
    
    if (this.variables.bed_shape) {
      const bedBounds = this.calculateBedBounds(this.variables.bed_shape);
      if (bedBounds) Object.assign(this.variables, bedBounds);
    }
    
    for (const [key, value] of Object.entries(this.variables)) {
      if (typeof value === 'string') {
        this.variables[key] = value.includes(';') ? value.split(';') : [value];
      } else if (!Array.isArray(value)) {
        this.variables[key] = [value];
      }
    }

    const nozzleDiameter = parseFloat(this.variables.nozzle_diameter[0]);
    
    // Определяем размеры объекта в зависимости от диаметра сопла
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
    
    const bedWidth = parseFloat(this.variables.print_bed_size[0]);
    const bedHeight = parseFloat(this.variables.print_bed_size[1]);
    
    // Проверяем максимальное количество объектов
    const maxObjects = this.calculateMaxObjects(objectWidth, objectHeight, spacing, bedWidth, bedHeight);
    if (paValues.length > maxObjects) {
      throw new Error(`Слишком много объектов! Максимум ${maxObjects} объектов для сопла ${nozzleDiameter}мм на столе ${bedWidth}×${bedHeight}мм`);
    }
    
    // Рассчитываем оптимальное расположение
    const layout = this.calculateOptimalLayout(paValues.length, objectWidth, objectHeight, spacing, bedWidth, bedHeight);
    if (!layout) {
      throw new Error(`Невозможно разместить ${paValues.length} объектов на столе`);
    }
    
    // Рассчитываем границы первого слоя для всех объектов
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    for (let objIndex = 0; objIndex < paValues.length; objIndex++) {
      const row = Math.floor(objIndex / layout.cols);
      const col = objIndex % layout.cols;
      const objX = layout.startX + col * (objectWidth + spacing);
      const objY = layout.startY + row * (objectHeight + spacing);
      
      minX = Math.min(minX, objX);
      minY = Math.min(minY, objY);
      maxX = Math.max(maxX, objX + objectWidth);
      maxY = Math.max(maxY, objY + objectHeight);
    }
    
    // Добавляем вычисленные переменные
    this.variables.total_layer_count = ['25'];
    this.variables.first_layer_print_min = [minX, minY];
    this.variables.first_layer_print_max = [maxX, maxY];
    this.variables.first_layer_print_size = [maxX - minX, maxY - minY];
    const layerHeight = parseFloat(this.variables.layer_height[0]);
    const firstLayerHeight = parseFloat(this.variables.first_layer_height[0]);
    const filamentDiameter = parseFloat(this.variables.filament_diameter[0]);
    const extrusionMultiplier = parseFloat(this.variables.extrusion_multiplier?.[0] || 1);
    
    const extrusionWidth = nozzleDiameter * 1.125;
    const overlapDistance = this.parseInfillOverlap(this.variables.infill_overlap?.[0] || '10%', extrusionWidth);
    
    let gcode = [];
    const digitGenerator = new DigitGenerator();
    
    for (let layer = 0; layer < 25; layer++) {
      const currentZ = (layer + 1) * layerHeight;
      const isOdd = (layer + 1) % 2 === 1;
      
      gcode.push(';LAYER_CHANGE');
      gcode.push(`;Z:${currentZ.toFixed(3)}`);
      gcode.push(`;HEIGHT:${layerHeight.toFixed(3)}`);
      gcode.push(`G1 Z${currentZ.toFixed(3)} F300`);
      
      // Управление вентилятором
      const getConfigValue = (key, defaultValue) => {
        const value = allConfigs[key];
        if (Array.isArray(value)) {
          return parseFloat(value[0]) || defaultValue;
        }
        return parseFloat(value) || defaultValue;
      };
      
      const disableFanFirstLayers = parseInt(getConfigValue('disable_fan_first_layers', 1));
      const minFanSpeed = getConfigValue('min_fan_speed', 35);
      
      if (layer + 1 === disableFanFirstLayers + 1) {
        // Включаем вентилятор на первом разрешенном слое
        const fanSpeed = Math.round((minFanSpeed / 100) * 255);
        gcode.push(`M106 S${fanSpeed} ; Enable fan at ${minFanSpeed}%`);
      }
      
      let perimeterCount;
      let hasInfill = false;
      
      if (layer === 0 || layer === 1 || layer === 2) {
        perimeterCount = 5;
        hasInfill = true;
      } else {
        perimeterCount = 2;
        hasInfill = false;
      }
      
      // Оптимизируем порядок печати объектов для минимизации холостых ходов
      const optimizedOrder = this.getOptimizedPrintOrder(paValues.length, layout.cols, layer);
      
      for (const objIndex of optimizedOrder) {
        const paValue = paValues[objIndex];
        const row = Math.floor(objIndex / layout.cols);
        const col = objIndex % layout.cols;
        const objX = layout.startX + col * (objectWidth + spacing);
        const objY = layout.startY + row * (objectHeight + spacing);
        
        gcode.push(`; Object ${objIndex + 1}, PA: ${paValue}`);
        gcode.push(`M900 K${paValue}`);
        
        const maxVolumetricSpeed = getConfigValue('max_volumetric_speed', 15.0);
        const extruder = new Extruder(filamentDiameter, extrusionMultiplier, maxVolumetricSpeed);
        
        const isFirstLayer = layer === 0;
        
        for (let p = perimeterCount - 1; p >= 0; p--) {
          const perimeterGcode = this.generatePerimeter(p, perimeterCount, objX, objY, objectWidth, objectHeight, extrusionWidth, nozzleDiameter, layerHeight, extruder, allConfigs, isFirstLayer);
          gcode = gcode.concat(perimeterGcode);
        }
        
        if (hasInfill) {
          const infillGcode = this.generateNewInfill(objX, objY, objectWidth, objectHeight, layerHeight, perimeterCount, extrusionWidth, overlapDistance, extruder, allConfigs, isFirstLayer, isOdd);
          gcode = gcode.concat(infillGcode);
        }
        
        // Генерируем цифры PA на 4-м слое (layer === 3)
        if (layer === 3) {
          // Виртуально рассчитываем позицию заполнения как если бы было 6 периметров
          const virtualPerimeterCount = 6;
          const virtualPerimeterOffset = virtualPerimeterCount * extrusionWidth - overlapDistance;
          const digitStartX = objX + virtualPerimeterOffset;
          const digitStartY = objY + virtualPerimeterOffset;
          
          const digitGcode = digitGenerator.generateDigits(paValue, digitStartX, digitStartY, extruder, allConfigs);
          gcode = gcode.concat(digitGcode);
        }
      }
    }
    
    return gcode.join('\n');
  }

  generate(slicerPath, printerName, filamentName, printName, paValues = null) {
    const printerConfigPath = path.join(slicerPath, 'printer', printerName + '.ini');
    const filamentConfigPath = path.join(slicerPath, 'filament', filamentName + '.ini');
    const printConfigPath = path.join(slicerPath, 'print', printName + '.ini');
    
    const printerConfig = this.parseIniFile(printerConfigPath);
    const filamentConfig = this.parseIniFile(filamentConfigPath);
    const printConfig = this.parseIniFile(printConfigPath);
    
    const allConfigs = {...printerConfig, ...filamentConfig, ...printConfig};
    
    let objectsGCode = '';
    
    // Сначала генерируем объекты, чтобы получить переменные
    if (paValues && paValues.length > 0) {
      objectsGCode = this.generatePAObjects(slicerPath, printerName, filamentName, printName, paValues);
      
      // Выводим полученные переменные в консоль
      console.log('=== Вычисленные переменные ===');
      console.log('total_layer_count:', this.variables.total_layer_count);
      console.log('first_layer_print_min:', this.variables.first_layer_print_min);
      console.log('first_layer_print_max:', this.variables.first_layer_print_max);
      console.log('first_layer_print_size:', this.variables.first_layer_print_size);
      console.log('==============================');
    }
    
    // Теперь обрабатываем шаблоны с полученными переменными
    const configsWithVariables = {...allConfigs, ...this.variables, ...this.dynamicPlaceholders};
    const startGCode = this.processGCodeTemplate(printerConfig.start_gcode, configsWithVariables);
    const filamentGCode = this.processGCodeTemplate(filamentConfig.start_filament_gcode, configsWithVariables);
    const endGCode = this.processGCodeTemplate(printerConfig.end_gcode, configsWithVariables);
    
    const useRelativeE = parseInt(allConfigs.use_relative_e_distances?.[0] || '0') === 1;
    
    let result = [
      '; PA Test Generator',
      '; Start G-code',
      startGCode,
      '',
      'G21 ; set units to millimeters',
      'G90 ; use absolute coordinates',
      useRelativeE ? 'M83' : 'M82',
      '',
      '; Filament G-code', 
      filamentGCode,
      ''
    ];
    
    if (objectsGCode) {
      result.push('; PA Test Objects');
      result.push(objectsGCode);
      result.push('');
    }
    
    result.push('; End G-code');
    result.push(endGCode);
    result.push(';');
    return result.join('\n');
  }
}

module.exports = GCodeGenerator;