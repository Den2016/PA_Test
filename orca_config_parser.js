const fs = require('fs');
const path = require('path');

/**
 * Парсер конфигураций OrcaSlicer для PA Test Generator
 * 
 * ТАБЛИЦА РАЗЛИЧИЙ ПАРАМЕТРОВ МЕЖДУ PRUSA/QIDI И ORCA:
 * 
 * Принтер (Machine/Printer):
 * - start_gcode ↔ machine_start_gcode
 * - end_gcode ↔ machine_end_gcode  
 * - retract_length ↔ retraction_length
 * - retract_speed ↔ retraction_speed
 * - bed_shape ↔ printable_area
 * - max_print_height ↔ printable_height
 * 
 * Филамент:
 * - temperature ↔ nozzle_temperature
 * - first_layer_temperature ↔ nozzle_temperature_initial_layer
 * - bed_temperature ↔ hot_plate_temp
 * - first_layer_bed_temperature ↔ hot_plate_temp_initial_layer
 * - extrusion_multiplier ↔ filament_flow_ratio
 * - max_volumetric_speed ↔ filament_max_volumetric_speed
 * - disable_fan_first_layers ↔ close_fan_the_first_x_layers
 * 
 * Печать (Process/Print):
 * - first_layer_height ↔ initial_layer_print_height
 * - perimeter_speed ↔ inner_wall_speed
 * - external_perimeter_speed ↔ outer_wall_speed
 * - infill_speed ↔ sparse_infill_speed
 * - solid_infill_speed ↔ internal_solid_infill_speed
 * - top_solid_infill_speed ↔ top_surface_speed
 * - bridge_flow_ratio ↔ bridge_flow
 * - support_material_buildplate_only ↔ support_on_build_plate_only
 */
class OrcaConfigParser {
    /**
     * Конструктор парсера OrcaSlicer
     * @param {string} orcaPath - Путь к папке OrcaSlicer (опционально)
     */
    constructor(orcaPath) {
        if (!orcaPath) {
            const realPath = path.join(require('os').homedir(), 'AppData', 'Roaming', 'OrcaSlicer');
            const testPath = './ini_examples/orcaslicer';
            orcaPath = require('fs').existsSync(realPath) ? realPath : testPath;
        }
        this.orcaPath = orcaPath;
        this.userPath = path.join(orcaPath, 'user', 'default');
        this.systemPath = path.join(orcaPath, 'system');
        console.log('OrcaSlicer путь:', orcaPath);
    }

    /**
     * Получить список пользовательских принтеров
     * @returns {Array} Массив объектов с информацией о принтерах
     */
    getPrinters() {
        const printers = [];
        const machinePath = path.join(this.userPath, 'machine');

        if (!fs.existsSync(machinePath)) return printers;

        const files = fs.readdirSync(machinePath)
            .filter(f => f.endsWith('.json'));

        files.forEach(file => {
            try {
                const config = JSON.parse(fs.readFileSync(path.join(machinePath, file), 'utf8'));
                printers.push({
                    name: config.name,
                    inherits: config.inherits,
                    gcodeType: config.gcode_flavor || 'marlin',
                    file: path.join(machinePath, file),
                    print_host: config.print_host
                });
            } catch (e) {
                console.error(`Ошибка парсинга ${file}:`, e.message);
            }
        });

        return printers;
    }

    /**
     * Получить список пользовательских филаментов
     * @returns {Array} Массив объектов с информацией о филаментах
     */
    getFilaments() {
        const filaments = [];
        const filamentPath = path.join(this.userPath, 'filament');

        if (!fs.existsSync(filamentPath)) return filaments;

        const files = fs.readdirSync(filamentPath)
            .filter(f => f.endsWith('.json'));

        files.forEach(file => {
            try {
                const config = JSON.parse(fs.readFileSync(path.join(filamentPath, file), 'utf8'));
                const pressureAdvance = this.extractPressureAdvance(config);

                let flowRatio = config.filament_flow_ratio?.[0] || '1.000';
                if (flowRatio === '1.000' && config.inherits) {
                    const systemConfig = this.getSystemConfig('filament',config.inherits);
                    flowRatio = systemConfig?.filament_flow_ratio?.[0] || '1.0';
                }

                filaments.push({
                    name: config.name,
                    inherits: config.inherits,
                    pressureAdvance: pressureAdvance,
                    flowRatio: flowRatio,
                    maxVolumetricSpeed: config.filament_max_volumetric_speed?.[0],
                    nozzleTemp: config.nozzle_temperature?.[0],
                    bedTemp: config.hot_plate_temp?.[0],
                    file: path.join(filamentPath, file)
                });
            } catch (e) {
                console.error(`Ошибка парсинга ${file}:`, e.message);
            }
        });

        return filaments;
    }

    /**
     * Получить список пользовательских профилей печати
     * @returns {Array} Массив объектов с информацией о профилях печати
     */
    getPrintProfiles() {
        const profiles = [];
        const processPath = path.join(this.userPath, 'process');

        if (!fs.existsSync(processPath)) return profiles;

        const files = fs.readdirSync(processPath)
            .filter(f => f.endsWith('.json'));

        files.forEach(file => {
            try {
                const config = JSON.parse(fs.readFileSync(path.join(processPath, file), 'utf8'));
                profiles.push({
                    name: config.name,
                    inherits: config.inherits,
                    layerHeight: this.extractLayerHeight(config.name),
                    file: path.join(processPath, file)
                });
            } catch (e) {
                console.error(`Ошибка парсинга ${file}:`, e.message);
            }
        });

        return profiles;
    }

    /**
     * Извлечь высоту слоя из названия профиля
     * @param {string} name - Название профиля
     * @returns {number} Высота слоя в мм
     */
    extractLayerHeight(name) {
        const match = name.match(/(\d+\.?\d*)mm/);
        return match ? parseFloat(match[1]) : 0.2;
    }

    /**
     * Извлечь значение Pressure Advance из G-code филамента
     * @param {Object} config - Конфигурация филамента
     * @returns {string} Значение Pressure Advance
     */
    extractPressureAdvance(config) {
        const startGcode = config.filament_start_gcode?.[0] || '';
        const match = startGcode.match(/M900\s+K([\d.]+)/);
        return match ? match[1] : '0.03';
    }

    /**
     * Конвертировать конфигурацию принтера с нормализацией параметров
     * @param {string} printerName - Имя принтера
     * @returns {Object|null} Нормализованная конфигурация принтера
     */
    convertPrinterConfig(printerName) {
        const printers = this.getPrinters();
        const printer = printers.find(p => p.name === printerName);
        if (!printer) return null;

        const userConfig = JSON.parse(fs.readFileSync(printer.file, 'utf8'));
        const systemConfig = this.getSystemConfig('machine', printer.inherits);
        const merged = { ...systemConfig, ...userConfig };

        return this.convertArraysToValues(merged);
    }

    /**
     * Конвертировать конфигурацию филамента с нормализацией параметров
     * @param {string} filamentName - Имя филамента
     * @returns {Object|null} Нормализованная конфигурация филамента
     */
    convertFilamentConfig(filamentName) {
        const filaments = this.getFilaments();
        const filament = filaments.find(f => f.name === filamentName);
        if (!filament) return null;

        const userConfig = JSON.parse(fs.readFileSync(filament.file, 'utf8'));
        const systemConfig = this.getSystemConfig('filament', filament.inherits);
        const merged = { ...systemConfig, ...userConfig };

        return this.convertArraysToValues(merged);
    }

    /**
     * Конвертировать конфигурацию процесса печати с нормализацией параметров
     * @param {string} processName - Имя процесса
     * @returns {Object|null} Нормализованная конфигурация процесса
     */
    convertProcessConfig(processName) {
        const processes = this.getPrintProfiles();
        const process = processes.find(p => p.name === processName);
        if (!process) return null;

        const userConfig = JSON.parse(fs.readFileSync(process.file, 'utf8'));
        const systemConfig = this.getSystemConfig('process', process.inherits);
        const merged = { ...systemConfig, ...userConfig };

        return this.convertArraysToValues(merged);
    }

    /**
     * Преобразовать массивы с одним элементом в значения и нормализовать имена параметров
     * @param {Object} config - Исходная конфигурация
     * @returns {Object} Конфигурация с преобразованными массивами и нормализованными именами
     */
    convertArraysToValues(config) {
        const result = {};
        for (const [key, value] of Object.entries(config)) {
            if (Array.isArray(value) && value.length === 1) {
                result[key] = value[0];
            } else {
                result[key] = value;
            }
        }
        return this.normalizeOrcaToPrusaNames(result);
    }

    /**
     * Нормализовать имена параметров OrcaSlicer в имена PrusaSlicer/QIDISlicer
     * Дублирует параметры с разными именами для совместимости с генератором
     * @param {Object} config - Конфигурация с параметрами OrcaSlicer
     * @returns {Object} Конфигурация с дублированными параметрами
     */
    normalizeOrcaToPrusaNames(config) {
        // Принтер (Machine -> Printer)
        if (config.machine_start_gcode) config.start_gcode = config.machine_start_gcode;
        if (config.machine_end_gcode) config.end_gcode = config.machine_end_gcode;
        if (config.retraction_length) config.retract_length = config.retraction_length;
        if (config.retraction_speed) config.retract_speed = config.retraction_speed;
        if (config.printable_area) config.bed_shape = this.convertPrintableAreaToBedShape(config.printable_area);
        if (config.printable_height) config.max_print_height = config.printable_height;

        // Филамент
        if (config.nozzle_temperature) config.temperature = config.nozzle_temperature;
        if (config.nozzle_temperature_initial_layer) config.first_layer_temperature = config.nozzle_temperature_initial_layer;
        if (config.hot_plate_temp) config.bed_temperature = config.hot_plate_temp;
        if (config.hot_plate_temp_initial_layer) config.first_layer_bed_temperature = config.hot_plate_temp_initial_layer;
        if (config.filament_flow_ratio) config.extrusion_multiplier = config.filament_flow_ratio;
        if (config.filament_max_volumetric_speed) config.max_volumetric_speed = config.filament_max_volumetric_speed;
        if (config.close_fan_the_first_x_layers) config.disable_fan_first_layers = config.close_fan_the_first_x_layers;

        // Печать (Process -> Print)
        if (config.initial_layer_print_height) config.first_layer_height = config.initial_layer_print_height;
        if (config.inner_wall_speed) config.perimeter_speed = config.inner_wall_speed;
        if (config.outer_wall_speed) config.external_perimeter_speed = config.outer_wall_speed;
        if (config.sparse_infill_speed) config.infill_speed = config.sparse_infill_speed;
        if (config.internal_solid_infill_speed) config.solid_infill_speed = config.internal_solid_infill_speed;
        if (config.top_surface_speed) config.top_solid_infill_speed = config.top_surface_speed;
        if (config.bridge_flow) config.bridge_flow_ratio = config.bridge_flow;
        if (config.support_on_build_plate_only) config.support_material_buildplate_only = config.support_on_build_plate_only;

        return config;
    }

    /**
     * Преобразовать printable_area OrcaSlicer в bed_shape PrusaSlicer
     * @param {Array} printableArea - Массив точек области печати
     * @returns {string} Строка формата bed_shape
     */
    convertPrintableAreaToBedShape(printableArea) {
        if (!Array.isArray(printableArea)) return '0x0,200x0,200x200,0x200';
        return printableArea.join(',');
    }

    /**
     * Получить системную конфигурацию с обработкой наследования
     * @param {string} configType - Тип конфигурации (machine, filament, process)
     * @param {string} inheritsName - Имя родительской конфигурации
     * @returns {Object|null} Системная конфигурация или null
     */
    getSystemConfig(configType, inheritsName) {
        if (!inheritsName) return null;

        const dirs = fs.readdirSync(this.systemPath);
        for (const dir of dirs) {
            if (dir === '.' || dir === '..') continue;

            const configPath = path.join(this.systemPath, dir, configType, inheritsName + '.json');
            if (fs.existsSync(configPath)) {
                let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

                // Рекурсивная обработка наследования
                if (config.inherits) {
                    const parentConfig = this.getSystemConfig(configType, config.inherits);
                    if (parentConfig) {
                        config = {...parentConfig, ...config};
                    }
                }
                return config;
            }
        }
        return null;
    }

    /**
     * Извлечь размер стола из printable_area
     * @param {Array} printableArea - Массив точек области печати
     * @param {string} axis - Ось ('x' или 'y')
     * @returns {number} Размер по указанной оси
     */
    extractBedSize(printableArea, axis) {
        if (!printableArea || !Array.isArray(printableArea)) return 200;

        const coords = printableArea.map(point => {
            const [x, y] = point.split('x').map(Number);
            return axis === 'x' ? x : y;
        });

        return Math.max(...coords);
    }

    /**
     * Определить тип филамента по имени наследования
     * @param {string} inherits - Имя родительского профиля
     * @returns {string} Тип филамента
     */
    getFilamentType(inherits) {
        if (!inherits) return 'PLA';
        if (inherits.includes('PLA')) return 'PLA';
        if (inherits.includes('ABS')) return 'ABS';
        if (inherits.includes('PETG')) return 'PETG';
        if (inherits.includes('TPU')) return 'TPU';
        if (inherits.includes('PA')) return 'PA';
        if (inherits.includes('PC')) return 'PC';
        return 'PLA';
    }

    /**
     * Получить системное имя принтера
     * @param {string} userPrinterName - Пользовательское имя принтера
     * @returns {string} Системное имя принтера
     */
    getSystemPrinterName(userPrinterName) {
        const printers = this.getPrinters();
        const printer = printers.find(p => p.name === userPrinterName);
        return printer?.inherits || userPrinterName;
    }

    /**
     * Получить совместимые филаменты для принтера
     * @param {string} printerName - Имя принтера
     * @returns {Array} Массив совместимых филаментов
     */
    getCompatibleFilaments(printerName) {
        const allFilaments = this.getFilaments();
        const systemPrinterName = this.getSystemPrinterName(printerName);
        
        const compatibleFilaments = allFilaments.filter(filament => {
            const sysConfig = this.getSystemConfig('filament', filament.inherits);
            return !sysConfig || this.isCompatibleWithPrinter(sysConfig, systemPrinterName);
        });
        
        return compatibleFilaments.length > 0 ? compatibleFilaments : allFilaments;
    }

    /**
     * Получить совместимые процессы печати для принтера
     * @param {string} printerName - Имя принтера
     * @returns {Array} Массив совместимых процессов
     */
    getCompatibleProcesses(printerName) {
        const allProcesses = this.getPrintProfiles();
        const systemPrinterName = this.getSystemPrinterName(printerName);
        
        const compatibleProcesses = allProcesses.filter(process => {
            const sysConfig = this.getSystemConfig('process', process.inherits);
            return !sysConfig || this.isCompatibleWithPrinter(sysConfig, systemPrinterName);
        });
        
        return compatibleProcesses.length > 0 ? compatibleProcesses : allProcesses;
    }

    /**
     * Проверить совместимость конфигурации с принтером
     * @param {Object} config - Конфигурация для проверки
     * @param {string} printerName - Имя принтера
     * @returns {boolean} true если совместимо
     */
    isCompatibleWithPrinter(config, printerName) {
        if (!config.compatible_printers) return true;
        
        const systemPrinterName = this.getSystemPrinterName(printerName);
        
        return config.compatible_printers.includes(printerName) || 
               config.compatible_printers.includes(systemPrinterName);
    }
}

module.exports = OrcaConfigParser;