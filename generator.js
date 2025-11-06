const fs = require('fs');
const path = require('path');
const Extruder = require('./extruder.js');
const ConfigProvider = require('./config_provider.js');
const extruder = require("./extruder");

class PrintTimeEstimator {
    constructor() {
        this.currentX = 0;
        this.currentY = 0;
        this.currentZ = 0;
        this.currentF = 1500;
        this.totalTime = 0;
    }

    processLine(line) {
        if (!line || line.startsWith(';')) return;

        const moveMatch = line.match(/^G[01]\s/);
        if (!moveMatch) return;

        const coords = this.parseCoordinates(line);
        const feedrate = this.parseFeedrate(line);

        if (feedrate) this.currentF = feedrate;

        const distance = this.calculateDistance(coords);
        if (distance > 0) {
            this.totalTime += (distance / this.currentF) * 60;
        }

        if (coords.X !== undefined) this.currentX = coords.X;
        if (coords.Y !== undefined) this.currentY = coords.Y;
        if (coords.Z !== undefined) this.currentZ = coords.Z;
    }

    parseCoordinates(line) {
        const coords = {};
        const xMatch = line.match(/X([-\d.]+)/);
        const yMatch = line.match(/Y([-\d.]+)/);
        const zMatch = line.match(/Z([-\d.]+)/);

        if (xMatch) coords.X = parseFloat(xMatch[1]);
        if (yMatch) coords.Y = parseFloat(yMatch[1]);
        if (zMatch) coords.Z = parseFloat(zMatch[1]);

        return coords;
    }

    parseFeedrate(line) {
        const fMatch = line.match(/F([\d.]+)/);
        return fMatch ? parseFloat(fMatch[1]) : null;
    }

    calculateDistance(coords) {
        const dx = (coords.X !== undefined) ? coords.X - this.currentX : 0;
        const dy = (coords.Y !== undefined) ? coords.Y - this.currentY : 0;
        const dz = (coords.Z !== undefined) ? coords.Z - this.currentZ : 0;

        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    formatTime() {
        const hours = Math.floor(this.totalTime / 3600);
        const minutes = Math.floor((this.totalTime % 3600) / 60);

        if (hours > 0) {
            return `${hours}h${minutes}m`;
        } else {
            return `${minutes}m`;
        }
    }

    reset() {
        this.currentX = 0;
        this.currentY = 0;
        this.currentZ = 0;
        this.currentF = 1500;
        this.totalTime = 0;
    }
}

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
            '0': [[this.x0, this.ymax, 1], [this.xmax, this.ymax, 1], [this.xmax, this.y0, 1], [this.x0, this.y0, 1], [this.xmax + 1, this.y0, 0]],
            '1': [[this.xmax * 0.4, this.y0, 0], [this.xmax * 0.4, this.ymax, 1], [this.xmax + 1, this.y0, 0]],
            '2': [[this.xmax, this.y0, 0], [this.x0, this.y0, 1], [this.x0, this.ymax / 2, 1], [this.xmax, this.ymax / 2, 1], [this.xmax, this.ymax, 1], [this.x0, this.ymax, 1], [this.xmax + 1, this.y0, 0]],
            '3': [[this.xmax, this.y0, 1], [this.xmax, this.ymax / 2, 1], [this.x0, this.ymax / 2, 0], [this.xmax, this.ymax / 2, 1], [this.xmax, this.ymax, 1], [this.x0, this.ymax, 1], [this.xmax + 1, this.y0, 0]],
            '4': [[this.xmax, this.y0, 0], [this.xmax, this.ymax, 1], [this.xmax, this.ymax / 2, 0], [this.x0, this.ymax / 2, 1], [this.x0, this.ymax, 1], [this.xmax + 1, this.y0, 0]],
            '5': [[this.xmax, this.y0, 1], [this.xmax, this.ymax / 2, 1], [this.x0, this.ymax / 2, 1], [this.x0, this.ymax, 1], [this.xmax, this.ymax, 1], [this.xmax + 1, this.y0, 0]],
            '6': [[this.xmax, this.ymax, 0], [this.x0, this.ymax, 1], [this.x0, this.y0, 1], [this.xmax, this.y0, 1], [this.xmax, this.ymax / 2, 1], [this.x0, this.ymax / 2, 1], [this.xmax + 1, this.y0, 0]],
            '7': [[this.xmax, this.y0, 0], [this.xmax, this.ymax, 1], [this.x0, this.ymax, 1], [this.xmax + 1, this.y0, 0]],
            '8': [[this.x0, this.ymax, 1], [this.xmax, this.ymax, 1], [this.xmax, this.y0, 1], [this.x0, this.y0, 1], [this.x0, this.ymax / 2, 0], [this.xmax, this.ymax / 2, 1], [this.xmax + 1, this.y0, 0]],
            '9': [[this.xmax, this.y0, 1], [this.xmax, this.ymax, 1], [this.x0, this.ymax, 1], [this.x0, this.ymax / 2, 1], [this.xmax, this.ymax / 2, 1], [this.xmax + 1, this.y0, 0]],
            '.': [[this.xmax / 2 - 0.3, this.y0, 0], [this.xmax / 2 - 0.3, this.y0 + 0.3, 1], [this.xmax / 2, this.y0 + 0.3, 1], [this.xmax / 2, this.y0, 1], [this.xmax + 0.8, this.y0, 0]]
        };
    }

    generateDigits(paValue, startX, startY, extruder, configs) {
        const gcode = [];
        let extrusionAmount = 0;
        // Правильно получаем скорости из конфигов
        const getConfigValue = (key, defaultValue) => {
            const value = configs[key];
            if (Array.isArray(value)) {
                return parseFloat(value[0]) || defaultValue;
            }
            return parseFloat(value) || defaultValue;
        };
        const useRelativeE = parseInt(configs.use_relative_e_distances || '0') === 1;
        const travelSpeed = getConfigValue('travel_speed', 150) * 60; // мм/мин
        const perimeterSpeed = getConfigValue('external_perimeter_speed', 50) * 60; // мм/мин

        let currentX = startX;
        let currentY = startY;
        let deltaX = 0;
        let isRetracted = false;

        gcode.push(`; Digits PA: ${paValue}`);
        gcode.push(`G1 X${startX.toFixed(5)} Y${startY.toFixed(5)} F${travelSpeed} ; Начальная точка цифр`);

        for (const char of paValue.toString()) {
            if (this.digits[char]) {
                const digit = this.digits[char];
                gcode.push(`G1 F${perimeterSpeed}`);

                for (const coords of digit) {
                    const pointX = startX + deltaX + coords[0];
                    const pointY = startY + coords[1];

                    if (coords[2] === 1) {
                        if (isRetracted) {
                            if (configs.use_firmware_retraction === '1') {
                                gcode.push('G11 ; Unretract');
                            } else {
                                const retractLength = getConfigValue('retract_length', 0.8);
                                const deretractSpeed = getConfigValue('deretract_speed', 40) * 60;
                                if (useRelativeE) {
                                    extrusionAmount = retractLength;
                                } else {
                                    extruder.currentE = extruder.currentE + retractLength
                                    extrusionAmount = extruder.currentE
                                }
                                gcode.push(`G1 E${extrusionAmount.toFixed(5)} F${deretractSpeed} ; Unretract`);
                            }
                            isRetracted = false;
                        }

                        const distance = Math.sqrt(Math.pow(pointX - currentX, 2) + Math.pow(pointY - currentY, 2));
                        extrusionAmount = extruder.calculateExtrusion(distance, 0.4, 0.2);
                        extruder.currentE += extrusionAmount;
                        if (!useRelativeE) extrusionAmount = extruder.currentE;
                        gcode.push(`G1 X${pointX.toFixed(5)} Y${pointY.toFixed(5)} E${extrusionAmount.toFixed(5)}`);
                    } else {
                        const distance = Math.sqrt(Math.pow(pointX - currentX, 2) + Math.pow(pointY - currentY, 2));
                        if (distance > 2.0) {
                            if (!isRetracted) {
                                if (configs.use_firmware_retraction === '1') {
                                    gcode.push('G10 ; Retract');
                                } else {
                                    const retractLength = getConfigValue('retract_length', 0.8);
                                    const retractSpeed = getConfigValue('retract_speed', 35) * 60;
                                    if (useRelativeE) {
                                        extrusionAmount = 0 - retractLength;
                                    } else {
                                        extruder.currentE = extruder.currentE - retractLength;
                                        extrusionAmount = extruder.currentE;
                                    }
                                    gcode.push(`G1 E${extrusionAmount.toFixed(5)} F${retractSpeed} ; Retract`);
                                }
                                isRetracted = true;
                            }
                        }
                        gcode.push(`G1 X${pointX.toFixed(5)} Y${pointY.toFixed(5)} F${travelSpeed}`);
                    }

                    currentX = pointX;
                    currentY = pointY;
                }

                deltaX = currentX - startX;
            }
        }

        //gcode.push('G92 E0 ; Сброс экструдера');
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
        this.timeEstimator = new PrintTimeEstimator();
    }

    addGCodeLine(gcode, line) {
        gcode.push(line);
        this.timeEstimator.processLine(line);
    }

    processLayerGCode(template, layerNum, layerZ, configs) {
        if (!template) return '';

        const layerVariables = {
            ...configs,
            layer_num: [layerNum],
            layer_z: [layerZ.toFixed(5)],
            previous_layer: [Math.max(0, layerNum - 1)],
            next_layer: [layerNum + 1]
        };

        return this.processGCodeTemplate(template, layerVariables);
    }

    setPlaceholders(placeholders) {
        this.dynamicPlaceholders = placeholders || {};
    }

    addRetract(gcode, configs, extruder) {
        if (this.isRetracted) return;
        let extrusionAmount = 0;
        const useFirmwareRetraction = parseInt(configs.use_firmware_retraction || '0') === 1;

        if (useFirmwareRetraction) {
            gcode.push('G10 ; Retract');
        } else {
            const retractLength = parseFloat(configs.retract_length || '0.8');
            const retractSpeed = parseFloat(configs.retract_speed || '35') * 60;
            if (parseInt(configs.use_relative_e_distances || '0') === 1) {
                extrusionAmount = 0 - retractLength;
            } else {
                extruder.currentE -= retractLength;
                extrusionAmount = extruder.currentE;
            }
            gcode.push(`G1 E${extrusionAmount.toFixed(5)} F${retractSpeed} ; Retract`);
        }

        this.isRetracted = true;
    }

    addDeretract(gcode, configs, extruder) {
        if (!this.isRetracted) return;
        let extrusionAmount = 0;
        const useFirmwareRetraction = parseInt(configs.use_firmware_retraction || '0') === 1;

        if (useFirmwareRetraction) {
            gcode.push('G11 ; Unretract');
        } else {
            const retractLength = parseFloat(configs.retract_length || '0.8');
            const deretractSpeed = parseFloat(configs.deretract_speed || '40') * 60;
            if (parseInt(configs.use_relative_e_distances || '0') === 1) {
                extrusionAmount = retractLength;
            } else {
                extruder.currentE += retractLength;
                extrusionAmount = extruder.currentE;
            }
            gcode.push(`G1 E${extrusionAmount.toFixed(5)} F${deretractSpeed} ; Unretract`);
        }

        this.isRetracted = false;
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

    addTravelMove(gcode, x, y, configs, extruder) {
        const distance = Math.sqrt(Math.pow(x - this.currentX, 2) + Math.pow(y - this.currentY, 2));
        const retractBeforeTravel = parseFloat(configs.retract_before_travel || '2');

        const getConfigValue = (key, defaultValue) => {
            const value = configs[key];
            if (Array.isArray(value)) {
                return parseFloat(value[0]) || defaultValue;
            }
            return parseFloat(value) || defaultValue;
        };

        const travelSpeed = getConfigValue('travel_speed', 150) * 60;

        if (distance > retractBeforeTravel) {
            this.addRetract(gcode, configs, extruder);
        }

        this.addGCodeLine(gcode, `G1 X${x.toFixed(5)} Y${y.toFixed(5)} F${travelSpeed}`);
        this.currentX = x;
        this.currentY = y;

        if (distance > retractBeforeTravel) {
            this.addDeretract(gcode, configs, extruder);
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
                return {x, y};
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

        // Заменяем экранированные \n на реальные переводы строк
        template = template.replace(/\\n/g, '\n');

        // Нормализуем многострочные условия с учетом всех пробельных символов
        template = template.replace(/\{\s*if\s+([^}]+?)\s*\}/gs, '{if $1}')
                         .replace(/\{\s*else\s*\}/gs, '{else}')
                         .replace(/\{\s*endif\s*\}/gs, '{endif}');

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
        if (!this.variables.total_layer_count) {
            this.variables.total_layer_count = 25; // Количество слоев PA теста
        }
        if (!this.variables.max_layer_z) {
            this.variables.max_layer_z = parseFloat(this.variables.first_layer_height) + parseFloat(this.variables.layer_height) * (parseFloat(this.variables.total_layer_count) - 1); // 25 слоев * 0.2мм
        }
        if (!this.variables.max_print_height) {
            this.variables.max_print_height = 250; // По умолчанию
        }

        // Обрабатываем условные блоки построчно
        const lines = template.split('\n');
        const resultLines = [];
        let skipLines = false;
        let ifStack = [];

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];

            // Обрабатываем условные блоки в строке (с else)
            line = line.replace(/\{if\s+([^}]+)\}([\s\S]*?)\{endif\}/g, (match, condition, content) => {
                // Проверяем наличие else
                const elseMatch = content.match(/^([\s\S]*?)\{else\}([\s\S]*)$/);
                let ifContent = content;
                let elseContent = '';

                if (elseMatch) {
                    ifContent = elseMatch[1];
                    elseContent = elseMatch[2];
                }
                console.log('Обработка условия:', condition, 'Контент:', content);
                let evalCondition = condition;

                // Заменяем переменные
                for (const [key, value] of Object.entries(this.variables)) {
                    for (let idx = 0; idx < 10; idx++) {
                        evalCondition = evalCondition.replace(new RegExp(`\\b${key}\\[${idx}\\]`, 'g'), value[idx] || '0');
                        evalCondition = evalCondition.replace(new RegExp(`\\b${key}_${idx}\\b`, 'g'), value[idx] || '0');
                    }
                    evalCondition = evalCondition.replace(new RegExp(`\\b${key}\\b(?!\\[|_)`, 'g'), Array.isArray(value) ? (value[0] || '0') : value);
                }

                evalCondition = evalCondition.replace(/</g, ' < ').replace(/>/g, ' > ');
                evalCondition = evalCondition.replace(/\btrue\b/g, '1').replace(/\bfalse\b/g, '0');
                evalCondition = evalCondition.replace(/==\s*true/g, '== 1').replace(/==\s*false/g, '== 0');

                console.log('После обработки:', evalCondition);

                try {
                    const conditionResult = eval(evalCondition);
                    console.log('Результат условия:', conditionResult);
                    return conditionResult ? ifContent : elseContent;
                } catch (e) {
                    console.warn('Ошибка вычисления условия:', evalCondition, e.message);
                    return elseContent;
                }
            });

            // Проверяем многострочные условные конструкции
            const ifMatch = line.match(/\{if\s+([^}]+)\}/);
            const elseMatch = line.match(/\{else\}/);
            const endifMatch = line.match(/\{endif\}/);

            if (ifMatch) {
                let evalCondition = ifMatch[1];

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
                    ifStack.push({condition: conditionResult, hasElse: false});
                    skipLines = !conditionResult;
                } catch (e) {
                    ifStack.push({condition: false, hasElse: false});
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

            // Обрабатываем плейсхолдеры в квадратных скобках [] (для Klipper и других)
            line = line.replace(/\[([^\]]+)\]/g, (match, varName) => {
                if (this.variables[varName]) {
                    return Array.isArray(this.variables[varName]) ? this.variables[varName][0] : this.variables[varName];
                }
                console.warn('Необработанный плейсхолдер:', match);
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
                start: {x: p1.x + t0 * dx, y: p1.y + t0 * dy},
                end: {x: p1.x + t1 * dx, y: p1.y + t1 * dy}
            };
        }
        return null;
    }

    generateNewInfill(objX, objY, objectWidth, objectHeight, currentLayerHeight, perimeterCount, overlapDistance, extruder, configs, isFirstLayer = false, rotateLeft = true) {
        const extrusionWidth = extruder.getExtrusionWidth('infill');

        // Рассчитываем смещение с учетом разных ширин периметров
        let perimeterOffset = 0;
        for (let i = 0; i < perimeterCount; i++) {
            const isExternal = i === 0;
            const perimWidth = extruder.getExtrusionWidth(isExternal ? 'external_perimeter' : 'perimeter');
            perimeterOffset += perimWidth;
        }
        perimeterOffset -= overlapDistance;
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
        infillGcode.push(`;WIDTH:${extrusionWidth.toFixed(5)}`);

        const speeds = this.calculateSpeeds(configs, isFirstLayer, extruder, extrusionWidth, currentLayerHeight);
        const travelSpeed = parseFloat(configs.travel_speed) * 60;

        this.addTravelMove(infillGcode, points[0].x, points[0].y, configs, extruder);

        for (let i = 1; i < points.length; i++) {
            const prevPoint = points[i - 1];
            const currentPoint = points[i];

            const distance = Math.sqrt(
                Math.pow(currentPoint.x - prevPoint.x, 2) +
                Math.pow(currentPoint.y - prevPoint.y, 2)
            );

            let extrusionAmount = extruder.calculateExtrusion(distance, extrusionWidth, currentLayerHeight);
            extruder.currentE += extrusionAmount;
            if (parseInt(configs.use_relative_e_distances || '0') !== 1) extrusionAmount = extruder.currentE;
            this.addGCodeLine(infillGcode, `G1 X${currentPoint.x.toFixed(5)} Y${currentPoint.y.toFixed(5)} E${extrusionAmount.toFixed(5)} F${speeds.infill}`);
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

            if (typeof firstLayerSpeed === 'string' && firstLayerSpeed.endsWith('%')) {
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

    generatePerimeter(perimeterIndex, totalPerimeters, objX, objY, objectWidth, objectHeight, nozzleDiameter, currentLayerHeight, extruder, configs, isFirstLayer = false) {
        const isExternal = perimeterIndex === 0;
        const extrusionWidth = extruder.getExtrusionWidth(isExternal ? 'external_perimeter' : 'perimeter');

        // Рассчитываем смещение с учетом разных ширин периметров
        let offset = 0;
        for (let i = 0; i < perimeterIndex; i++) {
            const isExternalPrev = i === 0;
            const prevWidth = extruder.getExtrusionWidth(isExternalPrev ? 'external_perimeter' : 'perimeter');
            offset += prevWidth;
        }
        const x1 = objX + extrusionWidth / 2 + offset;
        const y1 = objY + extrusionWidth / 2 + offset;
        const x2 = objX + objectWidth - extrusionWidth / 2 - offset;
        const y2 = objY + objectHeight - extrusionWidth / 2 - offset;

        if (x2 <= x1 || y2 <= y1) return [];

        const sides = [
            {from: [x1, y1], to: [x2, y1]},
            {from: [x2, y1], to: [x2, y2]},
            {from: [x2, y2], to: [x1, y2]},
            {from: [x1, y2], to: [x1, y1]}
        ];

        let perimeterGcode = [];

        if (isExternal) {
            perimeterGcode.push(';TYPE:External perimeter');
        } else {
            perimeterGcode.push(';TYPE:Perimeter');
        }
        perimeterGcode.push(`;WIDTH:${extrusionWidth.toFixed(5)}`);

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
            if (index === 0) {
                this.addTravelMove(perimeterGcode, fromX, fromY, configs, extruder);
            }
            let extrusionAmount = extruder.calculateExtrusion(actualLength, extrusionWidth, currentLayerHeight);
            extruder.currentE += extrusionAmount;
            if (parseInt(configs.use_relative_e_distances || '0') !== 1) extrusionAmount = extruder.currentE
            const speeds = this.calculateSpeeds(configs, isFirstLayer, extruder, extrusionWidth, currentLayerHeight);
            const speed = isExternal ? speeds.external : speeds.perimeter;
            this.addGCodeLine(perimeterGcode, `G1 X${toX.toFixed(5)} Y${toY.toFixed(5)} E${extrusionAmount.toFixed(5)} F${speed}`);
            this.currentX = toX;
            this.currentY = toY;
        });

        return perimeterGcode;
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

    generatePAObjects(slicerInfo, paValues) {
        const allConfigs = {...slicerInfo.printerConfig, ...slicerInfo.filamentConfig, ...slicerInfo.printConfig};
        this.variables = {...allConfigs};
        this.timeEstimator.reset();

        const nozzleDiameter = parseFloat(this.variables.nozzle_diameter);

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

        const bedWidth = parseFloat(this.variables.print_bed_size?.[0] || this.variables.bed_size_x || '200');
        const bedHeight = parseFloat(this.variables.print_bed_size?.[1] || this.variables.bed_size_y || '200');

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
        const layerHeight = parseFloat(this.variables.layer_height);
        const firstLayerHeight = parseFloat(this.variables.first_layer_height);
        const filamentDiameter = parseFloat(this.variables.filament_diameter);
        // Поддерживаем как extrusion_multiplier (PrusaSlicer), так и filament_flow_ratio (OrcaSlicer)
        const extrusionMultiplier = parseFloat(this.variables.extrusion_multiplier || this.variables.filament_flow_ratio || 1);

        // Создаем экструдер и инициализируем ширины
        const maxVolumetricSpeedValue = this.variables.max_volumetric_speed;
        const maxVolumetricSpeed = maxVolumetricSpeedValue !== undefined ? parseFloat(maxVolumetricSpeedValue) : 15.0;
        const extruder = new Extruder(filamentDiameter, extrusionMultiplier, maxVolumetricSpeed);
        extruder.initializeWidths(this.variables, nozzleDiameter, layerHeight, firstLayerHeight);

        const infillExtrusionWidth = extruder.getExtrusionWidth('infill');
        const overlapDistance = this.parseInfillOverlap(this.variables.infill_overlap || '10%', infillExtrusionWidth);

        let gcode = [];
        const digitGenerator = new DigitGenerator();

        for (let layer = 0; layer < 25; layer++) {
            const currentZ = (layer + 1) * layerHeight;
            const layerNum = layer + 1;
            const isOdd = (layer + 1) % 2 === 1;

            const beforeLayerGCode = this.processLayerGCode(
                allConfigs.before_layer_gcode,
                layerNum,
                currentZ,
                allConfigs
            );
            if (beforeLayerGCode && beforeLayerGCode.trim()) {
                const beforeLines = beforeLayerGCode.split('\n');
                beforeLines.forEach(line => {
                    if (line.trim()) gcode.push(line);
                });
            }

            gcode.push(';LAYER_CHANGE');
            gcode.push(`;Z:${currentZ.toFixed(5)}`);
            gcode.push(`;HEIGHT:${layerHeight.toFixed(5)}`);
            this.addGCodeLine(gcode, `G1 Z${currentZ.toFixed(5)} F300`);

            const layerGCode = this.processLayerGCode(
                allConfigs.layer_gcode,
                layerNum,
                currentZ,
                allConfigs
            );
            if (layerGCode && layerGCode.trim()) {
                const layerLines = layerGCode.split('\n');
                layerLines.forEach(line => {
                    if (line.trim()) gcode.push(line);
                });
            }

            if (parseInt(allConfigs.use_relative_e_distances || '0') !== 1) {
                gcode.push('G92 E0');
                extruder.currentE = 0;
            }
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

                const isFirstLayer = layer === 0;
                extruder.setLayer(isFirstLayer);

                for (let p = perimeterCount - 1; p >= 0; p--) {
                    const perimeterGcode = this.generatePerimeter(p, perimeterCount, objX, objY, objectWidth, objectHeight, nozzleDiameter, layerHeight, extruder, allConfigs, isFirstLayer);
                    gcode = gcode.concat(perimeterGcode);
                }

                if (hasInfill) {
                    const infillGcode = this.generateNewInfill(objX, objY, objectWidth, objectHeight, layerHeight, perimeterCount, overlapDistance, extruder, allConfigs, isFirstLayer, isOdd);
                    gcode = gcode.concat(infillGcode);
                }

                // Генерируем цифры PA на 4-м слое (layer === 3)
                if (layer === 3) {
                    // Виртуально рассчитываем позицию заполнения как если бы было 6 периметров
                    const virtualPerimeterCount = 6;
                    const perimeterWidth = extruder.getExtrusionWidth('perimeter');
                    const virtualPerimeterOffset = virtualPerimeterCount * perimeterWidth - overlapDistance;
                    const digitStartX = objX + virtualPerimeterOffset;
                    const digitStartY = objY + virtualPerimeterOffset;

                    const digitGcode = digitGenerator.generateDigits(paValue, digitStartX, digitStartY, extruder, allConfigs);
                    gcode = gcode.concat(digitGcode);
                }
            }
        }

        return gcode.join('\n');
    }

    generateFilename(slicerInfo, paValues) {
        const allConfigs = {...slicerInfo.printerConfig, ...slicerInfo.filamentConfig, ...slicerInfo.printConfig, ...this.variables, ...this.dynamicPlaceholders};

        const startPA = paValues[0] || 0;
        const endPA = paValues[paValues.length - 1] || 0;
        const stepPA = paValues.length > 1 ? (paValues[1] - paValues[0]) : 0.001;


        allConfigs.input_filename_base = ['PA_Test_' + startPA.toString() + '_' + endPA.toString() + '_' + stepPA.toString()];
        allConfigs.timestamp = [new Date().toISOString().replace(/[:.]/g, '-')];
        allConfigs.year = [new Date().getFullYear()];
        allConfigs.month = [String(new Date().getMonth() + 1).padStart(2, '0')];
        allConfigs.day = [String(new Date().getDate()).padStart(2, '0')];
        allConfigs.hour = [String(new Date().getHours()).padStart(2, '0')];
        allConfigs.minute = [String(new Date().getMinutes()).padStart(2, '0')];
        allConfigs.second = [String(new Date().getSeconds()).padStart(2, '0')];
        allConfigs.default_output_extension = ['.gcode'];
        allConfigs.version = ['1.2.0'];


        let template = allConfigs.output_filename_format?.[0] || allConfigs.filename_format?.[0] || '{input_filename_base}';
        template = template.replace(/\{([^}]+)\}/g, (match, expr) => {
            try {
                // 1. Обработка digits(varName, min, max)
                const digitsMatch = expr.match(/^digits\(\s*([a-zA-Z_]\w*)\s*,\s*\d+\s*,\s*(\d+)\s*\)$/);
                if (digitsMatch) {
                    const varName = digitsMatch[1];
                    const maxDigits = parseInt(digitsMatch[2], 10);
                    const arr = allConfigs[varName];
                    if (!Array.isArray(arr) || arr.length === 0) {
                        console.warn(`[Шаблон] digits: ${varName} не массив или пуст`);
                        return match;
                    }
                    const value = arr[0]; // всегда первый элемент для digits()
                    const num = Number(value);
                    if (isNaN(num)) {
                        console.warn(`[Шаблон] digits: некорректное число в ${varName}[0]: ${value}`);
                        return match;
                    }
                    return num.toFixed(maxDigits);
                }

                // 2. Обработка varName[index] — например, temperature[1]
                const arrayAccessMatch = expr.match(/^([a-zA-Z_]\w*)\s*\[\s*(\d+)\s*\]$/);
                if (arrayAccessMatch) {
                    const varName = arrayAccessMatch[1];
                    const index = parseInt(arrayAccessMatch[2], 10);
                    const arr = allConfigs[varName];
                    if (!Array.isArray(arr)) {
                        console.warn(`[Шаблон] ${varName} не является массивом`);
                        return match;
                    }
                    if (index >= arr.length) {
                        console.warn(`[Шаблон] индекс ${index} выходит за пределы массива ${varName} (длина ${arr.length})`);
                        return match;
                    }
                    return String(arr[index]);
                }

                // 3. Простое имя: {printer_model} → printer_model[0]
                if (/^[a-zA-Z_]\w*$/.test(expr)) {
                    const arr = allConfigs[expr];
                    if (!Array.isArray(arr) || arr.length === 0) {
                        console.warn(`[Шаблон] переменная ${expr} не массив или пуста`);
                        return match;
                    }
                    return String(arr[0]);
                }

                // 4. Неизвестный синтаксис
                console.warn(`[Шаблон] неизвестное выражение: ${expr}`);
                return match;

            } catch (e) {
                console.error(`Ошибка при обработке выражения ${expr}:`, e);
                return match;
            }
        });

        template = template.replace(/[<>:"/\\|?*]/g, '_');
        return template.endsWith('.gcode') ? template : template + '.gcode';
    }

    generate(slicerInfo, paValues = null) {
        const allConfigs = {...slicerInfo.printerConfig, ...slicerInfo.filamentConfig, ...slicerInfo.printConfig};

        let objectsGCode = '';

        // Сначала генерируем объекты, чтобы получить переменные
        if (paValues && paValues.length > 0) {
            objectsGCode = this.generatePAObjects(slicerInfo, paValues);
        }

        // Теперь обрабатываем шаблоны с полученными переменными
        const printTimeFormatted = this.timeEstimator.formatTime();
        const configsWithVariables = {...allConfigs, ...this.variables, ...this.dynamicPlaceholders};
        configsWithVariables.print_time = [printTimeFormatted];

        // Добавляем значения по умолчанию для отсутствующих переменных
        // if (!configsWithVariables.enable_advance_pressure) configsWithVariables.enable_advance_pressure = ['0'];
        // if (!configsWithVariables.advance_pressure) configsWithVariables.advance_pressure = ['0'];
        // if (!configsWithVariables.smooth_time) configsWithVariables.smooth_time = ['0.04'];
        const startGCode = this.processGCodeTemplate(slicerInfo.printerConfig.start_gcode, configsWithVariables);
        const filamentGCode = this.processGCodeTemplate(slicerInfo.filamentConfig.start_filament_gcode, configsWithVariables);
        const endFilamentGCode = this.processGCodeTemplate(slicerInfo.filamentConfig.end_filament_gcode, configsWithVariables);
        const endGCode = this.processGCodeTemplate(slicerInfo.printerConfig.end_gcode, configsWithVariables);


        const useRelativeE = parseInt(allConfigs.use_relative_e_distances || '0') === 1;

        let result = [
            '; PA Test Generator',
            '; Start G-code',
            startGCode,
            '',
            'G21 ; set units to millimeters',
            'G90 ; use absolute coordinates',
            useRelativeE ? 'M83' : 'M82',
            ''
        ];

        // Добавляем код филамента только если он не пустой
        if (filamentGCode && filamentGCode.trim()) {
            result.push('; Filament G-code');
            result.push(filamentGCode);
            result.push('');
        }

        if (objectsGCode) {
            result.push('; PA Test Objects');
            result.push(objectsGCode);
            result.push('');
        }

        // Добавляем завершающий код филамента если он не пустой
        if (endFilamentGCode && endFilamentGCode.trim()) {
            result.push('; End Filament G-code');
            result.push(endFilamentGCode);
            result.push('');
        }

        result.push('; End G-code');
        result.push(endGCode);
        result.push(';');

        // Генерируем имя файла и сохраняем в SlicerInfo
        if (paValues && paValues.length > 0) {
            slicerInfo.outputFilename = this.generateFilename(slicerInfo, paValues);
        }

        return result.join('\n');
    }
}

module.exports = GCodeGenerator;