const fs = require('fs');
const path = require('path');
const OrcaIntegration = require('./orca_integration');


class SlicerInfo {
    constructor(slicerFolderPath, slicerType = 'prusa') {
        let appData = process.env.APPDATA;
        let slicerFullPath = slicerFolderPath.startsWith(appData) ? slicerFolderPath : path.join(appData, slicerFolderPath);
        this.isPresent = fs.existsSync(slicerFullPath);
        this.fullPath = slicerFullPath;
        this.slicerType = slicerType;
        this.printerConfig = {};
        this.filamentConfig = {};
        this.printConfig = {};
        this._printerName = '';
        this._filamentName = '';
        this._printName = '';
        this.print_host = '';
        this.isPhysicalPrinter = false;
    }

    get printerName() {
        return this._printerName
    }

    set printerName(printerName) {
        const printer = this.printers.find(p => p.name === printerName);
        const physicalPrinter = this.physicalPrinters.find(p => p.name === printerName);
        if (printer) {
            this._printerName = printerName;
            this.print_host = '';
        }
        if (physicalPrinter) {
            const pp = this.parsePrinterName(printerName);
            this.physicalPrinterName = pp.physicalName
            this._printerName = pp.name;

            if (this.slicerType === 'prusa' || this.slicerType === 'qidi') {
                const phConfig = this.parseIniFile(path.join(this.fullPath, 'physical_printer', this.physicalPrinterName + '.ini'))
                this.print_host = phConfig.host;
                this.physicalPrinteConfig = phConfig;
            }
            if (this.slicerType === 'orca') {
                this.print_host = physicalPrinter.print_host;
            }
            this.isPhysicalPrinter = true;

        }
        this.loadPrinterConfig();
    }

    get filamentName() {
        return this._filamentName
    }

    set filamentName(filamentName) {
        this._filamentName = filamentName;
        this.loadFilamentConfig();
    }

    get printName() {
        return this._printName
    }

    set printName(printName) {
        this._printName = printName;
        this.loadPrintConfig();
    }

    parsePrinterName(printerName) {
        if (printerName.includes('*')) {
            const [physicalName, actualPrinter] = printerName.split('*');
            return {type: 'physical', name: actualPrinter, physicalName};
        } else {
            return {type: 'printer', name: printerName};
        }
    }

    loadPrinters() {
        const physicalPrinters = []
        if (this.slicerType === 'orca') {
            const orca = new OrcaIntegration();
            const printers = orca.getAvailablePrinters();
            printers.forEach(p => {
                if (p.print_host) {
                    physicalPrinters.push({
                        name: `*${p.name}`,
                        type: 'physical',
                        print_host: p.print_host,
                    });
                }
            });
            printers.sort((a, b) => a.name.localeCompare(b.name));
            physicalPrinters.sort((a, b) => a.name.localeCompare(b.name));

            this.printers = printers;
            this.physicalPrinters = physicalPrinters;

        } else {
            const printers = [];
            const printersPath = path.join(this.fullPath, 'printer');
            if (fs.existsSync(printersPath)) {
                const files = fs.readdirSync(printersPath).filter(f => f.endsWith('.ini'));
                files.forEach(file => {
                    const name = path.basename(file, '.ini');
                    printers.push({name, type: 'printer'});
                });
            }

            const physicalPath = path.join(this.fullPath, 'physical_printer');
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
                            let params = this.parseIniFile(path.join(physicalPath,file));
                            physicalPrinters.push({
                                name: `${physicalName}*${presetName}`,
                                type: 'physical',
                                print_host: params.print_host,
                            });
                        }
                    } catch (e) {
                        console.error('Ошибка чтения файла:', file, e);
                    }
                });
            }
            printers.sort((a, b) => a.name.localeCompare(b.name));
            physicalPrinters.sort((a, b) => a.name.localeCompare(b.name));

            this.printers = printers;
            this.physicalPrinters = physicalPrinters;

        }
    }

    getOrcaConfigType(configType) {
        const mapping = {
            'printer': 'machine',
            'filament': 'filament',
            'print': 'process'
        };
        return mapping[configType] || configType;
    }

    loadConfig(configType, configName) {
        if (this.slicerType === 'orca') {
            const orca = new OrcaIntegration();

            if (configType === 'printer') {
                return  orca.parser.convertPrinterConfig(configName);
            } else if (configType === 'filament') {
                return orca.parser.convertFilamentConfig(configName);
            } else if (configType === 'print') {
                // Для процессов пока возвращаем базовые значения
                return orca.parser.convertProcessConfig(configName);
            }
        } else {
            const configPath = path.join(this.fullPath, configType, configName + '.ini');
            if (fs.existsSync(configPath)) {
                return this.parseIniFile(configPath);
            }
        }
        return {};
        // if (this.slicerType === 'prusa' || this.slicerType === 'qidi') {
        //     const printerConfigPath = path.join(this.fullPath, configType, configName + '.ini');
        //     if (fs.existsSync(printerConfigPath)) {
        //         return this.parseIniFile(printerConfigPath);
        //     }
        // }
        // return [];
    }

    loadPrinterConfig() {
        this.printerConfig = this.loadConfig('printer', this._printerName);
    }

    loadFilamentConfig() {
        this.filamentConfig = this.loadConfig('filament', this._filamentName);
    }

    loadPrintConfig() {
        this.printConfig = this.loadConfig('print', this._printName)
    }


    getCompatibleFilaments() {
        this.filaments = [];
        if (!this._printerName) return;

        if (this.slicerType === 'orca') {
            const orca = new OrcaIntegration();
            const compatibleFilaments = orca.getCompatibleFilaments(this._printerName);
            this.filaments = compatibleFilaments.map(f => f.name);
        } else {
            const filamentPath = path.join(this.fullPath, 'filament');
            if (!fs.existsSync(filamentPath)) return;

            const compatible = [];
            const files = fs.readdirSync(filamentPath).filter(f => f.endsWith('.ini'));
            files.forEach(file => {
                const name = path.basename(file, '.ini');
                if (this.checkCompatibility(name, 'filament')) {
                    compatible.push(name);
                }
            });
            this.filaments = compatible;
        }
    }

    getCompatiblePrints() {
        this.prints = [];
        if (!this._printerName) return;

        if (this.slicerType === 'orca') {
            const orca = new OrcaIntegration();
            const compatibleProcesses = orca.getCompatibleProcesses(this._printerName);
            this.prints = compatibleProcesses.map(p => p.name);
        } else {
            const printPath = path.join(this.fullPath, 'print');
            if (!fs.existsSync(printPath)) return;

            const compatible = [];
            const files = fs.readdirSync(printPath).filter(f => f.endsWith('.ini'));
            files.forEach(file => {
                const name = path.basename(file, '.ini');
                if (this.checkCompatibility(name, 'print')) {
                    compatible.push(name);
                }
            });
            this.prints = compatible;
        }
    }


    /**
     * Проверка совместимости филамента с текущим профилем печати.
     */
    checkCompatibility(configName, configType) {
        if (this.slicerType === 'orca') {
            // Для Orca совместимость уже проверена в getCompatibleFilaments/Processes
            return true;
        }
        
        if (this.slicerType === 'prusa' || this.slicerType === 'qidi') {
            const configPath = path.join(this.fullPath, configType, configName + '.ini');
            if (fs.existsSync(configPath)) {
                const config = this.parseIniFile(configPath);
                const compatiblePrinters = config.compatible_printers || '';
                const compatibleCondition = config.compatible_printers_condition || '';
                const compatiblePrints = config.compatible_prints || '';
                const compatiblePrintsCondition = config.compatible_prints_condition || '';
                
                if (!compatiblePrinters && !compatibleCondition && !compatiblePrints && !compatiblePrintsCondition) {
                    return true;
                }

                if (compatiblePrinters) {
                    const printers = compatiblePrinters.split(';').map(p => p.trim().replace(/"/g, ''));
                    if (!printers.includes(this._printerName)) {
                        return false;
                    }
                }

                if (compatibleCondition) {
                    try {
                        if (!this.evaluateCondition(compatibleCondition)) {
                            return false;
                        }
                    } catch (e) {
                        console.error(e);
                        return false;
                    }
                }
            }
        }
        return true;
    }

    evaluateCondition(condition) {
        let evalCondition = condition
            .replace(/\band\b/g, '&&')
            .replace(/\bor\b/g, '||');

        const allConfigs = {...this.printerConfig};
        if (this.filamentConfig) Object.assign(allConfigs, this.filamentConfig);
        if (this.printConfig) Object.assign(allConfigs, this.printConfig);


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
            return eval(evalCondition);
        } catch (e) {
            return false;
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
            console.error('Ошибка парсинга файла:', filePath, e);
            return {};
        }
    }

}


module.exports = SlicerInfo;