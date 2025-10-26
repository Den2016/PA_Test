const fs = require('fs');
const path = require('path');
const Extruder = require('./extruder.js');

class InfillGenerator {
  /**
   * Генерирует зигзагообразное заполнение под углом 45 градусов
   * @param {number} infillX1 - левая граница области заполнения
   * @param {number} infillY1 - нижняя граница области заполнения  
   * @param {number} infillX2 - правая граница области заполнения
   * @param {number} infillY2 - верхняя граница области заполнения
   * @param {number} extrusionWidth - ширина экструзии
   * @param {boolean} rotateLeft - направление поворота (true = влево-вверх, false = вправо-вверх)
   * @returns {Array} массив точек [{x, y}]
   */
  generateDiagonalZigzag(infillX1, infillY1, infillX2, infillY2, extrusionWidth, rotateLeft = true, minLineLengthFactor = 2.0) {
    const width = infillX2 - infillX1;
    const height = infillY2 - infillY1;
    const centerX = (infillX1 + infillX2) / 2;
    const centerY = (infillY1 + infillY2) / 2;
    
    // Создаем матрицу вертикальных линий
    const lines = [];
    const maxDimension = Math.max(width, height) * 1.5; // Увеличиваем для полного покрытия после поворота
    const lineCount = Math.ceil(maxDimension / extrusionWidth) + 2;
    
    for (let i = 0; i < lineCount; i++) {
      const x = -maxDimension / 2 + i * extrusionWidth;
      lines.push([
        {x: x, y: -maxDimension / 2},
        {x: x, y: maxDimension / 2}
      ]);
    }
    
    // Поворачиваем линии на 45 градусов
    const angle = rotateLeft ? Math.PI / 4 : -Math.PI / 4;
    const cos45 = Math.cos(angle);
    const sin45 = Math.sin(angle);
    
    const rotatedLines = lines.map(line => {
      return line.map(point => ({
        x: point.x * cos45 - point.y * sin45 + centerX,
        y: point.x * sin45 + point.y * cos45 + centerY
      }));
    });
    
    // Обрезаем линии по границам области заполнения и создаем зигзаг
    const points = [];
    let isFirstLine = true;
    const minLineLength = extrusionWidth * minLineLengthFactor; // Минимальная длина линии для сохранения угла 45°
    
    for (let i = 0; i < rotatedLines.length; i++) {
      const line = rotatedLines[i];
      const clippedLine = this.clipLineToRect(line[0], line[1], infillX1, infillY1, infillX2, infillY2);
      
      if (clippedLine) {
        // Проверяем длину линии
        const lineLength = Math.sqrt(
          Math.pow(clippedLine.end.x - clippedLine.start.x, 2) + 
          Math.pow(clippedLine.end.y - clippedLine.start.y, 2)
        );
        
        // Пропускаем слишком короткие линии
        if (lineLength < minLineLength) {
          continue;
        }
        
        if (isFirstLine) {
          points.push(clippedLine.start);
          points.push(clippedLine.end);
          isFirstLine = false;
        } else {
          // Для зигзага чередуем направление
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
  
  // Обрезает линию по прямоугольной области
  clipLineToRect(p1, p2, x1, y1, x2, y2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    
    let t0 = 0, t1 = 1;
    
    // Проверяем пересечение с каждой стороной прямоугольника
    const clipTest = (p, q) => {
      if (p === 0) {
        return q >= 0;
      }
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
    
    if (clipTest(-dx, p1.x - x1) &&
        clipTest(dx, x2 - p1.x) &&
        clipTest(-dy, p1.y - y1) &&
        clipTest(dy, y2 - p1.y)) {
      
      return {
        start: {
          x: p1.x + t0 * dx,
          y: p1.y + t0 * dy
        },
        end: {
          x: p1.x + t1 * dx,
          y: p1.y + t1 * dy
        }
      };
    }
    
    return null;
  }
  
  /**
   * Генерирует G-code для заполнения
   */
  generateInfillGCode(objX, objY, objectWidth, objectHeight, currentLayerHeight, perimeterCount, extrusionWidth, overlapDistance, extruder, configs, isFirstLayer = false, rotateLeft = true) {
    // Расчет границ области заполнения
    const perimeterOffset = perimeterCount * extrusionWidth - overlapDistance;
    const infillX1 = objX + perimeterOffset + extrusionWidth / 2;
    const infillY1 = objY + perimeterOffset + extrusionWidth / 2;
    const infillX2 = objX + objectWidth - perimeterOffset - extrusionWidth / 2;
    const infillY2 = objY + objectHeight - perimeterOffset - extrusionWidth / 2;
    
    if (infillX2 <= infillX1 || infillY2 <= infillY1) {
      return []; // Нет места для заполнения
    }
    
    const minLineLengthFactor = 2; // Коэффициент фильтрации коротких линий
    const points = this.generateDiagonalZigzag(infillX1, infillY1, infillX2, infillY2, extrusionWidth, rotateLeft, minLineLengthFactor);
    
    if (points.length === 0) return [];
    
    let infillGcode = [];
    infillGcode.push(';TYPE:Solid infill');
    infillGcode.push(`;WIDTH:${extrusionWidth.toFixed(3)}`);
    
    const getConfigValue = (key, defaultValue) => {
      const value = configs[key];
      if (Array.isArray(value)) {
        return parseFloat(value[0]) || defaultValue;
      }
      return parseFloat(value) || defaultValue;
    };
    
    const infillSpeed = getConfigValue('infill_speed', 80) * 60;
    const travelSpeed = getConfigValue('travel_speed', 150) * 60;
    
    // Перемещаемся к первой точке
    infillGcode.push(`G1 X${points[0].x.toFixed(3)} Y${points[0].y.toFixed(3)} F${travelSpeed}`);
    
    // Генерируем экструзию по точкам
    for (let i = 1; i < points.length; i++) {
      const prevPoint = points[i - 1];
      const currentPoint = points[i];
      
      const distance = Math.sqrt(
        Math.pow(currentPoint.x - prevPoint.x, 2) + 
        Math.pow(currentPoint.y - prevPoint.y, 2)
      );
      
      const extrusionAmount = extruder.calculateExtrusion(distance, extrusionWidth, currentLayerHeight);
      
      const useRelativeE = parseInt(configs.use_relative_e_distances[0]) === 1;
      if (useRelativeE) {
        infillGcode.push(`G1 X${currentPoint.x.toFixed(3)} Y${currentPoint.y.toFixed(3)} E${extrusionAmount.toFixed(5)} F${infillSpeed}`);
      } else {
        extruder.currentE += extrusionAmount;
        infillGcode.push(`G1 X${currentPoint.x.toFixed(3)} Y${currentPoint.y.toFixed(3)} E${extruder.currentE.toFixed(5)} F${infillSpeed}`);
      }
    }
    
    return infillGcode;
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
          config[key] = value.includes(';') ? value.split(';') : [value];
        }
      }
    }
    return config;
  } catch (e) {
    console.error('Error parsing file:', filePath, e);
    return {};
  }
}

function generatePerimeter(perimeterIndex, totalPerimeters, objX, objY, objectWidth, objectHeight, extrusionWidth, nozzleDiameter, currentLayerHeight, extruder, configs) {
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
  
  const perimeterSpeed = parseFloat(configs.perimeter_speed[0]) * 60;
  const externalPerimeterSpeed = parseFloat(configs.external_perimeter_speed[0]) * 60;
  const speed = isExternal ? externalPerimeterSpeed : perimeterSpeed;
  
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
    
    if (index === 0) {
      perimeterGcode.push(`G1 X${fromX.toFixed(3)} Y${fromY.toFixed(3)} F${parseFloat(configs.travel_speed[0]) * 60}`);
    }
    
    const useRelativeE = parseInt(configs.use_relative_e_distances[0]) === 1;
    if (useRelativeE) {
      perimeterGcode.push(`G1 X${toX.toFixed(3)} Y${toY.toFixed(3)} E${extrusionAmount.toFixed(5)} F${speed}`);
    } else {
      extruder.currentE += extrusionAmount;
      perimeterGcode.push(`G1 X${toX.toFixed(3)} Y${toY.toFixed(3)} E${extruder.currentE.toFixed(5)} F${speed}`);
    }
  });
  
  return perimeterGcode;
}

function testFullObject() {
  const printerConfig = parseIniFile(path.join(__dirname, 'ini_examples', 'printer', 'Kingroon klipper BMG.ini'));
  const filamentConfig = parseIniFile(path.join(__dirname, 'ini_examples', 'filament', 'INFILL natural (KP3S BMG).ini'));
  const printConfig = parseIniFile(path.join(__dirname, 'ini_examples', 'print', 'Kingroon без поддержек экструзия по соплу.ini'));
  
  const allConfigs = {...printerConfig, ...filamentConfig, ...printConfig};
  
  const nozzleDiameter = parseFloat(allConfigs.nozzle_diameter[0]);
  const layerHeight = parseFloat(allConfigs.layer_height[0]);
  const filamentDiameter = parseFloat(allConfigs.filament_diameter[0]);
  const extrusionMultiplier = parseFloat(allConfigs.extrusion_multiplier[0]);
  
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
  
  const extrusionWidth = nozzleDiameter * 1.125;
  const overlapDistance = extrusionWidth * 0.1;
  const objX = 50;
  const objY = 50;
  const paValue = 0.02;
  
  const extruder = new Extruder(filamentDiameter, extrusionMultiplier, 15.0);
  const generator = new InfillGenerator();
  
  const useRelativeE = parseInt(allConfigs.use_relative_e_distances[0]) === 1;
  
  let gcode = [];
  gcode.push('; PA Test Object');
  gcode.push('G21 ; set units to millimeters');
  gcode.push('G90 ; use absolute coordinates');
  gcode.push(useRelativeE ? 'M83 ; use relative distances for extrusion' : 'M82 ; use absolute distances for extrusion');
  gcode.push('G92 E0 ; reset extrusion distance');
  gcode.push('');
  
  for (let layer = 0; layer < 25; layer++) {
    const currentZ = (layer + 1) * layerHeight;
    
    gcode.push(';LAYER_CHANGE');
    gcode.push(`;Z:${currentZ.toFixed(3)}`);
    gcode.push(`;HEIGHT:${layerHeight.toFixed(3)}`);
    gcode.push(`G1 Z${currentZ.toFixed(3)} F300`);
    gcode.push(`M900 K${paValue}`);
    
    let perimeterCount, hasInfill;
    if (layer === 0 || layer === 1 || layer === 2) {
      perimeterCount = 5;
      hasInfill = true;
    } else {
      perimeterCount = 2;
      hasInfill = false;
    }
    
    // Генерируем периметры (от внешнего к внутреннему)
    for (let p = 0; p < perimeterCount; p++) {
      const perimeterGcode = generatePerimeter(p, perimeterCount, objX, objY, objectWidth, objectHeight, extrusionWidth, nozzleDiameter, layerHeight, extruder, allConfigs);
      gcode = gcode.concat(perimeterGcode);
    }
    
    // Генерируем заполнение
    if (hasInfill) {
      const rotateLeft = (layer + 1) % 2 === 1;
      const infillGcode = generator.generateInfillGCode(objX, objY, objectWidth, objectHeight, layerHeight, perimeterCount, extrusionWidth, overlapDistance, extruder, allConfigs, layer === 0, rotateLeft);
      gcode = gcode.concat(infillGcode);
    }
    
    gcode.push('');
  }
  
  gcode.push('G92 E0 ; reset extrusion distance');
  gcode.push('; End of object');
  
  const outputPath = path.join(__dirname, 'ini_examples', 'qq.gcode');
  fs.writeFileSync(outputPath, gcode.join('\n'), 'utf8');
  console.log(`G-code сохранен в: ${outputPath}`);
  console.log(`Всего строк: ${gcode.length}`);
}

if (require.main === module) {
  testFullObject();
}

module.exports = InfillGenerator;