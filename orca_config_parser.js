const fs = require('fs');
const path = require('path');

class OrcaConfigParser {
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

    // Получить список пользовательских принтеров
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

    getSystemFilamentConfig(inherits,defReturns = {}) {
        //    const filamentPath = path.join(this.systemPath, 'filament');
        // let config = this.getSystemPrinterConfig(inherits)
        const dirs = fs.readdirSync(this.systemPath)
        let sysConfigFileName = defReturns;
        dirs.forEach(dir => {
            if (dir === '.' || dir === '..') return;
            let fullPath = path.join(this.systemPath, dir);
            const stats = fs.statSync(fullPath);
            if (stats.isDirectory()){
                let filename=path.join(this.systemPath,dir,'filament',inherits+'.json');
                if (fs.existsSync(filename)){
                    sysConfigFileName = JSON.parse(fs.readFileSync(filename,'utf8'));
                }
            }
        })
        return sysConfigFileName;
    }

    // Получить список пользовательских филаментов
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

                // Получаем filament_flow_ratio из конфига или из системного конфига
                let flowRatio = config.filament_flow_ratio?.[0] || '1.000';
                if (flowRatio === '1.000' && config.inherits) {
                    const systemConfig = this.getSystemFilamentConfig(config.inherits);
                    flowRatio = systemConfig?.filament_flow_ratio?.[0] || '1.0';
                }

                filaments.push({
                    name: config.name,
                    inherits: config.inherits,
                    pressureAdvance: pressureAdvance,
                    flowRatio: flowRatio,
                    maxVolumetricSpeed: config.filament_max_volumetric_speed?.[0] || '15',
                    nozzleTemp: config.nozzle_temperature?.[0] || '210',
                    bedTemp: config.hot_plate_temp?.[0] || '60',
                    file: path.join(filamentPath, file)
                });
            } catch (e) {
                console.error(`Ошибка парсинга ${file}:`, e.message);
            }
        });

        return filaments;
    }

    // Получить пользовательские профили печати
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

    // Извлечь высоту слоя из названия профиля
    extractLayerHeight(name) {
        const match = name.match(/(\d+\.?\d*)mm/);
        return match ? parseFloat(match[1]) : 0.2;
    }

    // Извлечь Pressure Advance из G-code
    extractPressureAdvance(config) {
        const startGcode = config.filament_start_gcode?.[0] || '';
        const match = startGcode.match(/M900\s+K([\d.]+)/);
        return match ? match[1] : '0.03';
    }

    // Конвертировать пользовательскую конфигурацию принтера
    convertPrinterConfig(printerName) {
        const printers = this.getPrinters();
        const printer = printers.find(p => p.name === printerName);

        if (!printer) return null;

        try {
            const config = JSON.parse(fs.readFileSync(printer.file, 'utf8'));
            const systemConfig = this.getSystemPrinterConfig(printer.inherits);

            return {
                printer_model: printer.name,
                nozzle_diameter: parseFloat(systemConfig?.nozzle_diameter?.[0] || 0.4),
                bed_size_x: this.extractBedSize(systemConfig?.printable_area, 'x'),
                bed_size_y: this.extractBedSize(systemConfig?.printable_area, 'y'),
                max_print_height: parseFloat(systemConfig?.printable_height || 200),
                retraction_length: parseFloat(systemConfig?.retraction_length?.[0] || 1.0),
                retraction_speed: parseFloat(systemConfig?.retraction_speed?.[0] || 40),
                travel_speed: 120,
                gcode_flavor: printer.gcodeType,
                start_gcode: config.machine_start_gcode || '',
                end_gcode: config.machine_end_gcode || ''
            };
        } catch (e) {
            console.error('Ошибка конвертации принтера:', e);
            return null;
        }
    }

    // Получить системную конфигурацию принтера по имени
    getSystemPrinterConfig(inheritsName) {
        if (!inheritsName) return null;
        try {
            const dirs = fs.readdirSync(this.systemPath);
            for (let i = 0; i < dirs.length; i++) {
                const dir = dirs[i];
                if (dir === '.' || dir === '..') continue;
                let fullPath = path.join(this.systemPath, dir);
                const stats = fs.statSync(fullPath);
                if (stats.isDirectory()) {
                    let filename = path.join(this.systemPath, dir, 'machine', inheritsName + '.json');
                    if (fs.existsSync(filename)) {
                        let config = JSON.parse(fs.readFileSync(filename, 'utf8'));

                        if (config.inherits) {
                            let inheritConfig = {'inherits': config.inherits};
                            while(inheritConfig['inherits']) {
                                let icPath = path.join(this.systemPath, dir, 'machine', inheritConfig.inherits+'.json');
                                if(fs.existsSync(icPath)) {
                                    inheritConfig = JSON.parse(fs.readFileSync(icPath, 'utf8'));
                                    if (inheritConfig !== null) {
                                        config = { ...inheritConfig, ...config };
                                    }
                                }
                            };
                        }
                        return config; // Возвращаем найденную конфигурацию
                    }
                }
            }
            return null; // Ничего не найдено
        } catch (err) {
            console.error("Error reading system printer configuration:", err.message);
            return null;
        }
    }

    // Извлечь размер стола из printable_area
    extractBedSize(printableArea, axis) {
        if (!printableArea || !Array.isArray(printableArea)) return 200;

        const coords = printableArea.map(point => {
            const [x, y] = point.split('x').map(Number);
            return axis === 'x' ? x : y;
        });

        return Math.max(...coords);
    }

    // Конвертировать пользовательскую конфигурацию филамента
    convertFilamentConfig(filamentName) {
        const filaments = this.getFilaments();
        const filament = filaments.find(f => f.name === filamentName);

        if (!filament) return null;

        return {
            filament_type: this.getFilamentType(filament.inherits),
            filament_diameter: 1.75,
            pressure_advance: parseFloat(filament.pressureAdvance),
            flow_ratio: parseFloat(filament.flowRatio),
            filament_flow_ratio: parseFloat(filament.flowRatio), // Дублируем для совместимости
            max_volumetric_speed: parseFloat(filament.maxVolumetricSpeed),
            nozzle_temperature: parseFloat(filament.nozzleTemp),
            bed_temperature: parseFloat(filament.bedTemp),
            fan_speed: 100
        };
    }

    // Определить тип филамента по наследованию
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


    // Получить совместимые филаменты для принтера
    getCompatibleFilaments(printerName) {
        const allFilaments = this.getFilaments();

        let partsPrinterName = printerName.split('*');
        printerName = partsPrinterName.length > 1 ? partsPrinterName[1] : printerName;

        const compatibleFilaments = allFilaments.filter(x=>{
            const sysConfig = this.getSystemFilamentConfig(x.inherits,null);
            if(sysConfig==null) return true;
            return this.isCompatibleWithPrinter(sysConfig, printerName);
        });

        //
        //
        // // Определяем вендора принтера
        // const vendors = ['Qidi', 'Kingroon', 'Custom'];
        //
        // for (const vendor of vendors) {
        //     const systemFilamentPath = path.join(this.systemPath, vendor, 'filament');
        //     if (fs.existsSync(systemFilamentPath)) {
        //         const files = fs.readdirSync(systemFilamentPath).filter(f => f.endsWith('.json'));
        //         files.forEach(file => {
        //             try {
        //                 const config = JSON.parse(fs.readFileSync(path.join(systemFilamentPath, file), 'utf8'));
        //                 if (this.isCompatibleWithPrinter(config, printerName)) {
        //                     const userFilament = allFilaments.find(f => f.inherits === config.name);
        //                     if (userFilament) {
        //                         compatibleFilaments.push(userFilament);
        //                     }
        //                 }
        //             } catch (e) {
        //             }
        //         });
        //     }
        // }

        // Если ничего не найдено, возвращаем все пользовательские филаменты
        return compatibleFilaments.length > 0 ? compatibleFilaments : allFilaments;
    }

    // Получить совместимые процессы для принтера
    getCompatibleProcesses(printerName) {
        const allProcesses = this.getPrintProfiles();
        const compatibleProcesses = [];

        // Определяем вендора принтера
        const vendors = ['Qidi', 'Kingroon', 'Custom'];

        for (const vendor of vendors) {
            const systemProcessPath = path.join(this.systemPath, vendor, 'process');
            if (fs.existsSync(systemProcessPath)) {
                const files = fs.readdirSync(systemProcessPath).filter(f => f.endsWith('.json'));
                files.forEach(file => {
                    try {
                        const config = JSON.parse(fs.readFileSync(path.join(systemProcessPath, file), 'utf8'));
                        if (this.isCompatibleWithPrinter(config, printerName)) {
                            const userProcess = allProcesses.find(p => p.inherits === config.name);
                            if (userProcess) {
                                compatibleProcesses.push(userProcess);
                            }
                        }
                    } catch (e) {
                    }
                });
            }
        }

        // Если ничего не найдено, возвращаем все пользовательские процессы
        return compatibleProcesses.length > 0 ? compatibleProcesses : allProcesses;
    }

    // Проверка совместимости с принтером
    isCompatibleWithPrinter(config, printerName) {
        if (!config.compatible_printers) return true; // Если нет ограничений, считаем совместимым

        // Прямая совместимость
        if (config.compatible_printers.includes(printerName)) return true;

        // Совместимость с базовой моделью (без "- Копировать")
        const basePrinterName = printerName.replace(' - Копировать', '');
        if (config.compatible_printers.includes(basePrinterName)) return true;

        // Поиск по частичному совпадению имени принтера
        const printerModel = this.extractPrinterModel(printerName);
        return config.compatible_printers.some(cp =>
            cp.includes(printerModel) || printerModel.includes(cp.split(' ')[0])
        );
    }

    // Извлечение модели принтера
    extractPrinterModel(printerName) {
        // Убираем суффиксы типа "0.4 klipper", "- Копировать"
        return printerName
            .replace(/ - Копировать$/, '')
            .replace(/ \d+\.\d+ \w+$/, '')
            .replace(/ 0\.\d+ nozzle$/, '');
    }

    // Получить пресеты из основного конфига
    getPresets() {
        const configPath = path.join(this.orcaPath, 'OrcaSlicer.conf');
        if (!fs.existsSync(configPath)) return [];

        try {
            const content = fs.readFileSync(configPath, 'utf8');
            const config = JSON.parse(content);

            return config.orca_presets || [];
        } catch (e) {
            console.error('Ошибка чтения пресетов:', e);
            return [];
        }
    }
}

module.exports = OrcaConfigParser;