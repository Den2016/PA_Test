const fs = require('fs');
const path = require('path');

class ConfigProvider {
    constructor(slicerType, slicerPath) {
        this.slicerType = slicerType;
        this.slicerPath = slicerPath;
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

    getConfigs(printerName, filamentName, printName) {
        if (this.slicerType === 'orca') {
            return this.getOrcaConfigs(printerName, filamentName);
        } else {
            return this.getStandardConfigs(printerName, filamentName, printName);
        }
    }

    getOrcaConfigs(printerName, filamentName) {
        const OrcaIntegration = require('./orca_integration');
        const orca = new OrcaIntegration();

        let partsPrinterName = printerName.split('*');
        printerName = partsPrinterName.length > 1 ? partsPrinterName[1] : printerName;

        const config = orca.getConfigForPATest(printerName, filamentName);

        if (!config) {
            throw new Error('Не удалось получить конфигурацию Orca');
        }

        // Конвертируем в стандартный формат
        const printerConfig = {
            nozzle_diameter: config.printer.nozzle_diameter.toString(),
            bed_shape: `0x0,${config.printer.bed_size_x}x0,${config.printer.bed_size_x}x${config.printer.bed_size_y},0x${config.printer.bed_size_y}`,
            start_gcode: 'G28\nM140 S[bed_temperature]\nM104 S[temperature]\nM190 S[bed_temperature]\nM109 S[temperature]\nG92 E0\nG1 Z2 F3000',
            end_gcode: 'M104 S0\nM140 S0\nG1 Z50 F600\nG28 X Y\nM84',
            max_print_height: config.printer.max_print_height.toString(),
            printer_model: config.printer.printer_model,
            gcode_flavor: config.printer.gcode_flavor,
            use_relative_e_distances: config.printer.use_relative_e_distances,
        };

        const filamentConfig = {
            temperature: config.filament.nozzle_temperature.toString(),
            bed_temperature: config.filament.bed_temperature.toString(),
            filament_diameter: '1.75',
            filament_type: config.filament.filament_type,
            start_filament_gcode: '',
            pressure_advance: config.filament.pressure_advance.toString()
        };

        const printConfig = {
            layer_height: '0.2',
            first_layer_height: '0.3',
            perimeter_speed: '50',
            external_perimeter_speed: '50%',
            infill_speed: '80',
            travel_speed: '150',
            extrusion_multiplier: config.filament.flow_ratio.toString(),
            infill_overlap: '10%',
            retract_length: '0.8',
            retract_speed: '35',
            deretract_speed: '40',
            retract_before_travel: '2',
            use_firmware_retraction: '0',
            disable_fan_first_layers: '1',
            min_fan_speed: '35',
            chamber_temperature: '0'
        };

        return {printerConfig, filamentConfig, printConfig};
    }

    getStandardConfigs(printerName, filamentName, printName) {
        const printerConfigPath = path.join(this.slicerPath, 'printer', printerName + '.ini');
        const filamentConfigPath = path.join(this.slicerPath, 'filament', filamentName + '.ini');
        const printConfigPath = path.join(this.slicerPath, 'print', printName + '.ini');

        const printerConfig = this.parseIniFile(printerConfigPath);
        const filamentConfig = this.parseIniFile(filamentConfigPath);
        const printConfig = this.parseIniFile(printConfigPath);

        // Добавляем недостающие параметры
        if (!filamentConfig.chamber_temperature) {
            filamentConfig.chamber_temperature = '0';
        }

        return {printerConfig, filamentConfig, printConfig};
    }

    calculateBedBounds(bedShape) {
        if (!bedShape) return null;

        try {
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

    getAllConfigs(printerName, filamentName, printName) {
        const {printerConfig, filamentConfig, printConfig} = this.getConfigs(printerName, filamentName, printName);
        const allConfigs = {...printerConfig, ...filamentConfig, ...printConfig};

        // Добавляем границы стола
        if (allConfigs.bed_shape) {
            const bedBounds = this.calculateBedBounds(allConfigs.bed_shape);
            if (bedBounds) {
                Object.assign(allConfigs, bedBounds);
            }
        }

        // Нормализуем переменные в массивы
        const normalizedConfigs = {};
        for (const [key, value] of Object.entries(allConfigs)) {
            if (typeof value === 'string') {
                normalizedConfigs[key] = value.includes(';') ? value.split(';') : [value];
            } else if (!Array.isArray(value)) {
                normalizedConfigs[key] = [value];
            } else {
                normalizedConfigs[key] = value;
            }
        }

        return normalizedConfigs;
    }
}

module.exports = ConfigProvider;