const Extruder = require('./extruder.js');
const fs = require('fs');
const path = require('path');

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

console.log('=== Генерация 25 слоев ===');

function generatePerimeter(perimeterIndex, totalPerimeters, currentZ, currentLayerHeight) {
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
  
  const isExternal = perimeterIndex === 0; // П1 - внешний периметр
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

function generateInfillOdd(currentZ, currentLayerHeight, perimeterCount) {
  const overlapDistance = extrusionWidth * infillOverlap;
  const perimeterOffset = perimeterCount * extrusionWidth - overlapDistance;
  const infillX1 = startX + perimeterOffset;
  const infillY1 = startY + perimeterOffset;
  const infillX2 = startX + objectWidth - perimeterOffset;
  const infillY2 = startY + objectHeight - perimeterOffset;
  
  let infillGcode = [];
  infillGcode.push(';TYPE:Solid infill');
  infillGcode.push(`;WIDTH:${extrusionWidth.toFixed(3)}`);
  
  let currentX = infillX1;
  let currentY = infillY1;
  
  infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} F3000 ; Переход к началу заполнения`);
  
  while (true) {
    // Шаг 1: Движение вправо
    if (currentX + extrusionWidth > infillX2) break;
    const extrusionAmount1 = extruder.calculateExtrusion(extrusionWidth, extrusionWidth, currentLayerHeight);
    extruder.currentE += extrusionAmount1;
    currentX += extrusionWidth;
    infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount1.toFixed(5)} F1800`);
    
    // Шаг 2: Диагональ влево-вверх
    const leftDistance = currentX - infillX1;
    const upDistance = infillY2 - currentY;
    const diagonalDistance = Math.min(leftDistance, upDistance);
    
    if (diagonalDistance <= 0) break;
    
    const diagonalLength = Math.sqrt(2) * diagonalDistance;
    const extrusionAmount2 = extruder.calculateExtrusion(diagonalLength, extrusionWidth, currentLayerHeight);
    extruder.currentE += extrusionAmount2;
    currentX -= diagonalDistance;
    currentY += diagonalDistance;
    infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount2.toFixed(5)} F1800`);
    
    if (currentY >= infillY2) {
      // Блок 5-8: достигнута верхняя граница
      while (true) {
        // Шаг 5: Движение вправо
        if (currentX + extrusionWidth > infillX2) break;
        const extrusionAmount5 = extruder.calculateExtrusion(extrusionWidth, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount5;
        currentX += extrusionWidth;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount5.toFixed(5)} F1800`);
        
        // Шаг 6: Диагональ вправо-вниз
        const rightDistance6 = infillX2 - currentX;
        const downDistance6 = currentY - infillY1;
        const diagonalDistance6 = Math.min(rightDistance6, downDistance6);
        
        if (diagonalDistance6 <= 0) break;
        
        const diagonalLength6 = Math.sqrt(2) * diagonalDistance6;
        const extrusionAmount6 = extruder.calculateExtrusion(diagonalLength6, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount6;
        currentX += diagonalDistance6;
        currentY -= diagonalDistance6;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount6.toFixed(5)} F1800`);
        
        if (currentX >= infillX2) {
          // Блок 9-12: достигнута правая граница
          while (true) {
            // Шаг 9: Движение вверх
            if (currentY + extrusionWidth > infillY2) break;
            const extrusionAmount9 = extruder.calculateExtrusion(extrusionWidth, extrusionWidth, currentLayerHeight);
            extruder.currentE += extrusionAmount9;
            currentY += extrusionWidth;
            infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount9.toFixed(5)} F1800`);
            
            if (currentY >= infillY2) break;
            
            // Шаг 10: Диагональ влево-вверх
            const leftDistance10 = currentX - infillX1;
            const upDistance10 = infillY2 - currentY;
            const diagonalDistance10 = Math.min(leftDistance10, upDistance10);
            
            if (diagonalDistance10 <= 0) break;
            
            const diagonalLength10 = Math.sqrt(2) * diagonalDistance10;
            const extrusionAmount10 = extruder.calculateExtrusion(diagonalLength10, extrusionWidth, currentLayerHeight);
            extruder.currentE += extrusionAmount10;
            currentX -= diagonalDistance10;
            currentY += diagonalDistance10;
            infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount10.toFixed(5)} F1800`);
            
            // Шаг 11: Движение вправо
            if (currentX + extrusionWidth > infillX2) break;
            const extrusionAmount11 = extruder.calculateExtrusion(extrusionWidth, extrusionWidth, currentLayerHeight);
            extruder.currentE += extrusionAmount11;
            currentX += extrusionWidth;
            infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount11.toFixed(5)} F1800`);
            
            if (currentX >= infillX2) break;
            
            // Шаг 12: Диагональ вправо-вниз
            const rightDistance12 = infillX2 - currentX;
            const downDistance12 = currentY - infillY1;
            const diagonalDistance12 = Math.min(rightDistance12, downDistance12);
            
            if (diagonalDistance12 <= 0) break;
            
            const diagonalLength12 = Math.sqrt(2) * diagonalDistance12;
            const extrusionAmount12 = extruder.calculateExtrusion(diagonalLength12, extrusionWidth, currentLayerHeight);
            extruder.currentE += extrusionAmount12;
            currentX += diagonalDistance12;
            currentY -= diagonalDistance12;
            infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount12.toFixed(5)} F1800`);
          }
          break;
        }
        
        // Шаг 7: Движение вправо
        if (currentX + extrusionWidth > infillX2) break;
        const extrusionAmount7 = extruder.calculateExtrusion(extrusionWidth, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount7;
        currentX += extrusionWidth;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount7.toFixed(5)} F1800`);
        
        // Шаг 8: Диагональ влево-вверх
        const leftDistance8 = currentX - infillX1;
        const upDistance8 = infillY2 - currentY;
        const diagonalDistance8 = Math.min(leftDistance8, upDistance8);
        
        if (diagonalDistance8 <= 0) break;
        
        const diagonalLength8 = Math.sqrt(2) * diagonalDistance8;
        const extrusionAmount8 = extruder.calculateExtrusion(diagonalLength8, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount8;
        currentX -= diagonalDistance8;
        currentY += diagonalDistance8;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount8.toFixed(5)} F1800`);
      }
      break;
    }
    
    // Шаг 3: Движение вверх
    if (currentY + extrusionWidth > infillY2) break;
    const extrusionAmount3 = extruder.calculateExtrusion(extrusionWidth, extrusionWidth, currentLayerHeight);
    extruder.currentE += extrusionAmount3;
    currentY += extrusionWidth;
    infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount3.toFixed(5)} F1800`);
    
    // Шаг 4: Диагональ вправо-вниз
    const rightDistance = infillX2 - currentX;
    const downDistance = currentY - infillY1;
    const diagonalDistance2 = Math.min(rightDistance, downDistance);
    
    if (diagonalDistance2 <= 0) break;
    
    const diagonalLength2 = Math.sqrt(2) * diagonalDistance2;
    const extrusionAmount4 = extruder.calculateExtrusion(diagonalLength2, extrusionWidth, currentLayerHeight);
    extruder.currentE += extrusionAmount4;
    currentX += diagonalDistance2;
    currentY -= diagonalDistance2;
    infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount4.toFixed(5)} F1800`);
    
    if (currentX >= infillX2) break;
  }
  
  return infillGcode;
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
  
  let currentX = infillX2;
  let currentY = infillY1;
  
  infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} F3000 ; Переход к началу заполнения`);
  
  while (true) {
    if (currentX - extrusionWidth < infillX1) break;
    const extrusionAmount1 = extruder.calculateExtrusion(extrusionWidth, extrusionWidth, currentLayerHeight);
    extruder.currentE += extrusionAmount1;
    currentX -= extrusionWidth;
    infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount1.toFixed(5)} F1800`);
    
    const rightDistance = infillX2 - currentX;
    const upDistance = infillY2 - currentY;
    const diagonalDistance = Math.min(rightDistance, upDistance);
    
    if (diagonalDistance <= 0) break;
    
    const diagonalLength = Math.sqrt(2) * diagonalDistance;
    const extrusionAmount2 = extruder.calculateExtrusion(diagonalLength, extrusionWidth, currentLayerHeight);
    extruder.currentE += extrusionAmount2;
    currentX += diagonalDistance;
    currentY += diagonalDistance;
    infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount2.toFixed(5)} F1800`);
    
    if (currentY >= infillY2) {
      while (true) {
        if (currentX - extrusionWidth < infillX1) break;
        const extrusionAmount5 = extruder.calculateExtrusion(extrusionWidth, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount5;
        currentX -= extrusionWidth;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount5.toFixed(5)} F1800`);
        
        const leftDistance6 = currentX - infillX1;
        const downDistance6 = currentY - infillY1;
        const diagonalDistance6 = Math.min(leftDistance6, downDistance6);
        
        if (diagonalDistance6 <= 0) break;
        
        const diagonalLength6 = Math.sqrt(2) * diagonalDistance6;
        const extrusionAmount6 = extruder.calculateExtrusion(diagonalLength6, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount6;
        currentX -= diagonalDistance6;
        currentY -= diagonalDistance6;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount6.toFixed(5)} F1800`);
        
        if (currentX <= infillX1) {
          while (true) {
            if (currentY + extrusionWidth > infillY2) break;
            const extrusionAmount9 = extruder.calculateExtrusion(extrusionWidth, extrusionWidth, currentLayerHeight);
            extruder.currentE += extrusionAmount9;
            currentY += extrusionWidth;
            infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount9.toFixed(5)} F1800`);
            
            if (currentY >= infillY2) break;
            
            const rightDistance10 = infillX2 - currentX;
            const upDistance10 = infillY2 - currentY;
            const diagonalDistance10 = Math.min(rightDistance10, upDistance10);
            
            if (diagonalDistance10 <= 0) break;
            
            const diagonalLength10 = Math.sqrt(2) * diagonalDistance10;
            const extrusionAmount10 = extruder.calculateExtrusion(diagonalLength10, extrusionWidth, currentLayerHeight);
            extruder.currentE += extrusionAmount10;
            currentX += diagonalDistance10;
            currentY += diagonalDistance10;
            infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount10.toFixed(5)} F1800`);
            
            if (currentX - extrusionWidth < infillX1) break;
            const extrusionAmount11 = extruder.calculateExtrusion(extrusionWidth, extrusionWidth, currentLayerHeight);
            extruder.currentE += extrusionAmount11;
            currentX -= extrusionWidth;
            infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount11.toFixed(5)} F1800`);
            
            if (currentX <= infillX1) break;
            
            const leftDistance12 = currentX - infillX1;
            const downDistance12 = currentY - infillY1;
            const diagonalDistance12 = Math.min(leftDistance12, downDistance12);
            
            if (diagonalDistance12 <= 0) break;
            
            const diagonalLength12 = Math.sqrt(2) * diagonalDistance12;
            const extrusionAmount12 = extruder.calculateExtrusion(diagonalLength12, extrusionWidth, currentLayerHeight);
            extruder.currentE += extrusionAmount12;
            currentX -= diagonalDistance12;
            currentY -= diagonalDistance12;
            infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount12.toFixed(5)} F1800`);
          }
          break;
        }
        
        if (currentX - extrusionWidth < infillX1) break;
        const extrusionAmount7 = extruder.calculateExtrusion(extrusionWidth, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount7;
        currentX -= extrusionWidth;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount7.toFixed(5)} F1800`);
        
        const rightDistance8 = infillX2 - currentX;
        const upDistance8 = infillY2 - currentY;
        const diagonalDistance8 = Math.min(rightDistance8, upDistance8);
        
        if (diagonalDistance8 <= 0) break;
        
        const diagonalLength8 = Math.sqrt(2) * diagonalDistance8;
        const extrusionAmount8 = extruder.calculateExtrusion(diagonalLength8, extrusionWidth, currentLayerHeight);
        extruder.currentE += extrusionAmount8;
        currentX += diagonalDistance8;
        currentY += diagonalDistance8;
        infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount8.toFixed(5)} F1800`);
      }
      break;
    }
    
    if (currentY + extrusionWidth > infillY2) break;
    const extrusionAmount3 = extruder.calculateExtrusion(extrusionWidth, extrusionWidth, currentLayerHeight);
    extruder.currentE += extrusionAmount3;
    currentY += extrusionWidth;
    infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount3.toFixed(5)} F1800`);
    
    const leftDistance = currentX - infillX1;
    const downDistance = currentY - infillY1;
    const diagonalDistance2 = Math.min(leftDistance, downDistance);
    
    if (diagonalDistance2 <= 0) break;
    
    const diagonalLength2 = Math.sqrt(2) * diagonalDistance2;
    const extrusionAmount4 = extruder.calculateExtrusion(diagonalLength2, extrusionWidth, currentLayerHeight);
    extruder.currentE += extrusionAmount4;
    currentX -= diagonalDistance2;
    currentY -= diagonalDistance2;
    infillGcode.push(`G1 X${currentX.toFixed(3)} Y${currentY.toFixed(3)} E${extrusionAmount4.toFixed(5)} F1800`);
    
    if (currentX <= infillX1) break;
  }
  
  return infillGcode;
}

// Генерируем 25 слоев
function generate25Layers() {
  let gcode = [];
  
  // Заголовок
  gcode.push(';Generated by PA Test Generator');
  gcode.push('M83 ; Относительные координаты экструдера');
  
  for (let layer = 0; layer < 25; layer++) {
    const currentZ = (layer + 1) * layerHeight;
    const isOdd = (layer + 1) % 2 === 1;
    
    console.log(`\n=== СЛОЙ ${layer + 1} ===`);
    
    extruder.reset();
    
    // Комментарии между слоями
    gcode.push(';LAYER_CHANGE');
    gcode.push(`;Z:${currentZ.toFixed(3)}`);
    gcode.push(`;HEIGHT:${layerHeight.toFixed(3)}`);
    gcode.push(`G1 Z${currentZ.toFixed(3)} F300`);
    
    // Определяем количество периметров
    let perimeterCount;
    let hasInfill = false;
    
    if (layer === 0) {
      // Первый слой: 1 периметр + заполнение
      perimeterCount = 1;
      hasInfill = true;
    } else if (layer === 1 || layer === 2) {
      // Слои 2-3: 5 периметров + заполнение
      perimeterCount = 5;
      hasInfill = true;
    } else {
      // Остальные слои: только 2 периметра
      perimeterCount = 2;
      hasInfill = false;
    }
    
    // Генерируем периметры в правильном порядке: от внутреннего к внешнему
    for (let p = perimeterCount - 1; p >= 0; p--) {
      const perimeterGcode = generatePerimeter(p, perimeterCount, currentZ, layerHeight);
      gcode = gcode.concat(perimeterGcode);
    }
    
    // Генерируем заполнение если нужно
    if (hasInfill) {
      let infillGcode;
      if (isOdd) {
        infillGcode = generateInfillOdd(currentZ, layerHeight, perimeterCount);
      } else {
        infillGcode = generateInfillEven(currentZ, layerHeight, perimeterCount);
      }
      gcode = gcode.concat(infillGcode);
    }
  }
  
  // Сохраняем в файл
  const outputPath = path.join(__dirname, 'ini_examples', 'q.gcode');
  fs.writeFileSync(outputPath, gcode.join('\n'), 'utf8');
  console.log(`\nG-code сохранен в файл: ${outputPath}`);
  console.log(`Всего строк G-code: ${gcode.length}`);
}

generate25Layers();