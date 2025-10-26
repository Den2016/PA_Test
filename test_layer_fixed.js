const Extruder = require('./extruder.js');

// Параметры
const nozzleDiameter = 0.6;
const extrusionWidth = nozzleDiameter * 1.125; // 0.675 мм
const layerHeight = 0.2;
const filamentDiameter = 1.75;
const extrusionMultiplier = 1.0;

const objectWidth = 25;
const objectHeight = 18;
const startX = 5;
const startY = 5;
const infillOverlap = 0.1; // 10% перекрытие заполнения с периметром

// Создаем экструдер
const extruder = new Extruder(filamentDiameter, extrusionMultiplier);

console.log('=== Тест: 1 слой с 1 периметром, затем 2 слоя по 5 периметров ===');

function generatePerimeter(perimeterIndex, currentZ, currentLayerHeight, isExternal = false) {
  const offset = perimeterIndex * extrusionWidth;
  const x1 = startX + extrusionWidth / 2 + offset;
  const y1 = startY + extrusionWidth / 2 + offset;
  const x2 = startX + objectWidth - extrusionWidth / 2 - offset;
  const y2 = startY + objectHeight - extrusionWidth / 2 - offset;
  
  if (x2 <= x1 || y2 <= y1) return [];
  
  const sides = [
    { name: `Нижняя сторона П${perimeterIndex + 1}`, from: [x1, y1], to: [x2, y1] },
    { name: `Правая сторона П${perimeterIndex + 1}`, from: [x2, y1], to: [x2, y2] },
    { name: `Верхняя сторона П${perimeterIndex + 1}`, from: [x2, y2], to: [x1, y2] },
    { name: `Левая сторона П${perimeterIndex + 1}`, from: [x1, y2], to: [x1, y1] }
  ];
  
  let perimeterGcode = [];
  
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
      perimeterGcode.push(`G1 X${fromX.toFixed(3)} Y${fromY.toFixed(3)} F3000 ; Переход к началу периметра ${perimeterIndex + 1}`);
    }
    perimeterGcode.push(`G1 X${toX.toFixed(3)} Y${toY.toFixed(3)} E${extrusionAmount.toFixed(5)} F1800 ; ${side.name}`);
  });
  
  return perimeterGcode;
}

function generateInfillEven(currentZ, currentLayerHeight, perimeterCount) {
  const overlapDistance = extrusionWidth * infillOverlap;
  const perimeterOffset = perimeterCount * extrusionWidth - overlapDistance;
  const infillX1 = startX + perimeterOffset;
  const infillY1 = startY + perimeterOffset;
  const infillX2 = startX + objectWidth - perimeterOffset;
  const infillY2 = startY + objectHeight - perimeterOffset;
  
  let infillGcode = [];
  infillGcode.push(';TYPE:Solid infill');
  infillGcode.push(`;WIDTH:${extrusionWidth.toFixed(3)}`);
  
  // Начинаем с правого нижнего угла для обратного наклона
  let currentX = infillX2;
  let currentY = infillY1;
  
  infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} F3000 ; Переход к началу заполнения`);
  
  while (true) {
    // Шаг 1: Горизонтальный катет влево
    if (currentX - extrusionWidth < infillX1) {
      infillGcode.push('; STOP: Шаг 1 - достигнута левая граница');
      break;
    }
    const extrusionAmount1 = extruder.calculateExtrusion(extrusionWidth, extrusionWidth, currentLayerHeight);
    extruder.currentE += extrusionAmount1;
    currentX -= extrusionWidth;
    infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount1.toFixed(5)} F1800`);
    
    // Шаг 2: Гипотенуза вправо-вверх
    const rightDistance = infillX2 - currentX;
    const upDistance = infillY2 - currentY;
    const diagonalDistance = Math.min(rightDistance, upDistance);
    
    if (diagonalDistance <= 0) {
      infillGcode.push('; STOP: Шаг 2 - нет места для диагонали');
      break;
    }
    
    const diagonalLength = Math.sqrt(2) * diagonalDistance;
    const extrusionAmount2 = extruder.calculateExtrusion(diagonalLength, extrusionWidth, currentLayerHeight);
    extruder.currentE += extrusionAmount2;
    currentX += diagonalDistance;
    currentY += diagonalDistance;
    infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount2.toFixed(5)} F1800`);
    
    if (currentY >= infillY2) {
      infillGcode.push('; START: Блок 5-8 - достигнута верхняя граница');
      
      while (true) {
        // Шаг 5: Катет влево
        if (currentX - extrusionWidth < infillX1) {
          infillGcode.push('; STOP: Шаг 5 - достигнута левая граница');
          break;
        }
        const extrusionAmount5 = extruder.calculateExtrusion(extrusionWidth, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount5;
        currentX -= extrusionWidth;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount5.toFixed(5)} F1800`);
        
        // Шаг 6: Гипотенуза влево-вниз до левой границы
        const leftDistance6 = currentX - infillX1;
        const downDistance6 = currentY - infillY1;
        const diagonalDistance6 = Math.min(leftDistance6, downDistance6);
        
        if (diagonalDistance6 <= 0) {
          infillGcode.push('; STOP: Шаг 6 - нет места для диагонали');
          break;
        }
        
        const diagonalLength6 = Math.sqrt(2) * diagonalDistance6;
        const extrusionAmount6 = extruder.calculateExtrusion(diagonalLength6, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount6;
        currentX -= diagonalDistance6;
        currentY -= diagonalDistance6;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount6.toFixed(5)} F1800`);
        
        if (currentX <= infillX1) {
          infillGcode.push('; START: Блок 9-12 - достигнута левая граница');
          
          while (true) {
            // Шаг 9: Катет вверх
            if (currentY + extrusionWidth > infillY2) {
              infillGcode.push('; STOP: Шаг 9 - достигнута верхняя граница');
              break;
            }
            const extrusionAmount9 = extruder.calculateExtrusion(extrusionWidth, extrusionWidth, currentLayerHeight);
            extruder.currentE += extrusionAmount9;
            currentY += extrusionWidth;
            infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount9.toFixed(5)} F1800`);
            
            if (currentY >= infillY2) {
              infillGcode.push('; STOP: Шаг 9 - достигнута верхняя граница после шага');
              break;
            }
            
            // Шаг 10: Гипотенуза вправо-вверх
            const rightDistance10 = infillX2 - currentX;
            const upDistance10 = infillY2 - currentY;
            const diagonalDistance10 = Math.min(rightDistance10, upDistance10);
            
            if (diagonalDistance10 <= 0) {
              infillGcode.push('; STOP: Шаг 10 - нет места для диагонали');
              break;
            }
            
            const diagonalLength10 = Math.sqrt(2) * diagonalDistance10;
            const extrusionAmount10 = extruder.calculateExtrusion(diagonalLength10, extrusionWidth, currentLayerHeight);
            extruder.currentE += extrusionAmount10;
            currentX += diagonalDistance10;
            currentY += diagonalDistance10;
            infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount10.toFixed(5)} F1800`);
            
            // Шаг 11: Катет влево
            if (currentX - extrusionWidth < infillX1) {
              infillGcode.push('; STOP: Шаг 11 - достигнута левая граница');
              break;
            }
            const extrusionAmount11 = extruder.calculateExtrusion(extrusionWidth, extrusionWidth, currentLayerHeight);
            extruder.currentE += extrusionAmount11;
            currentX -= extrusionWidth;
            infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount11.toFixed(5)} F1800`);
            
            if (currentX <= infillX1) {
              infillGcode.push('; STOP: Шаг 11 - достигнута левая граница после шага');
              break;
            }
            
            // Шаг 12: Гипотенуза влево-вниз
            const leftDistance12 = currentX - infillX1;
            const downDistance12 = currentY - infillY1;
            const diagonalDistance12 = Math.min(leftDistance12, downDistance12);
            
            if (diagonalDistance12 <= 0) {
              infillGcode.push('; STOP: Шаг 12 - нет места для диагонали');
              break;
            }
            
            const diagonalLength12 = Math.sqrt(2) * diagonalDistance12;
            const extrusionAmount12 = extruder.calculateExtrusion(diagonalLength12, extrusionWidth, currentLayerHeight);
            extruder.currentE += extrusionAmount12;
            currentX -= diagonalDistance12;
            currentY -= diagonalDistance12;
            infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount12.toFixed(5)} F1800`);
          }
          break;
        }
        
        // Шаг 7: Катет влево
        if (currentX - extrusionWidth < infillX1) {
          infillGcode.push('; STOP: Шаг 7 - достигнута левая граница');
          break;
        }
        const extrusionAmount7 = extruder.calculateExtrusion(extrusionWidth, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount7;
        currentX -= extrusionWidth;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount7.toFixed(5)} F1800`);
        
        // Шаг 8: Гипотенуза вправо-вверх
        const rightDistance8 = infillX2 - currentX;
        const upDistance8 = infillY2 - currentY;
        const diagonalDistance8 = Math.min(rightDistance8, upDistance8);
        
        if (diagonalDistance8 <= 0) {
          infillGcode.push('; STOP: Шаг 8 - нет места для диагонали');
          break;
        }
        
        const diagonalLength8 = Math.sqrt(2) * diagonalDistance8;
        const extrusionAmount8 = extruder.calculateExtrusion(diagonalLength8, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount8;
        currentX += diagonalDistance8;
        currentY += diagonalDistance8;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount8.toFixed(5)} F1800`);
      }
      break;
    }
    
    // Шаг 3: Катет вверх
    if (currentY + extrusionWidth > infillY2) {
      infillGcode.push('; STOP: Шаг 3 - достигнута верхняя граница');
      break;
    }
    const extrusionAmount3 = extruder.calculateExtrusion(extrusionWidth, extrusionWidth, currentLayerHeight);
    extruder.currentE += extrusionAmount3;
    currentY += extrusionWidth;
    infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount3.toFixed(5)} F1800`);
    
    // Шаг 4: Гипотенуза влево-вниз
    const leftDistance = currentX - infillX1;
    const downDistance = currentY - infillY1;
    const diagonalDistance2 = Math.min(leftDistance, downDistance);
    
    if (diagonalDistance2 <= 0) {
      infillGcode.push('; STOP: Шаг 4 - нет места для диагонали');
      break;
    }
    
    const diagonalLength2 = Math.sqrt(2) * diagonalDistance2;
    const extrusionAmount4 = extruder.calculateExtrusion(diagonalLength2, extrusionWidth, currentLayerHeight);
    extruder.currentE += extrusionAmount4;
    currentX -= diagonalDistance2;
    currentY -= diagonalDistance2;
    infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount4.toFixed(5)} F1800`);
    
    if (currentX <= infillX1) {
      infillGcode.push('; STOP: Шаг 4 - достигнута левая граница');
      break;
    }
  }
  
  return infillGcode;
}

let gcode = [];
let currentZ = 0;

gcode.push('M83 ; Относительные координаты экструдера');

// Слой 2: 5 периметров (четный слой)
currentZ += layerHeight;

console.log(`\n=== СЛОЙ 2 (5 периметров, четный) ===`);

gcode.push(';LAYER_CHANGE');
gcode.push(`;Z:${currentZ.toFixed(3)}`);
gcode.push(`;HEIGHT:${layerHeight.toFixed(3)}`);
gcode.push(`G1 Z${currentZ.toFixed(3)} F300`);

for (let perimeter = 0; perimeter < 5; perimeter++) {
  const isExternal = perimeter === 4;
  const perimeterGcode = generatePerimeter(perimeter, currentZ, layerHeight, isExternal);
  gcode.push(...perimeterGcode);
}

console.log('\n--- Заполнение (четный слой) ---');
const infillGcode = generateInfillEven(currentZ, layerHeight, 5);
gcode.push(...infillGcode);

console.log('\n=== G-CODE ===');
gcode.forEach(line => console.log(line));

const fs = require('fs');
const path = require('path');
const outputPath = path.join(__dirname, 'ini_examples', 'test_even.gcode');
fs.writeFileSync(outputPath, gcode.join('\n'), 'utf8');
console.log(`\nФайл сохранен: ${outputPath}`);