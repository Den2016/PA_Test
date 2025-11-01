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

    // getSystemFilamentConfig(inherits, defReturns = {}) {
    //     //    const filamentPath = path.join(this.systemPath, 'filament');
    //     // let config = this.getSystemPrinterConfig(inherits)
    //     const dirs = fs.readdirSync(this.systemPath)
    //     let sysConfigFileName = defReturns;
    //     dirs.forEach(dir => {
    //         if (dir === '.' || dir === '..') return;
    //         let fullPath = path.join(this.systemPath, dir);
    //         const stats = fs.statSync(fullPath);
    //         if (stats.isDirectory()) {
    //             let filename = path.join(this.systemPath, dir, 'filament', inherits + '.json');
    //             if (fs.existsSync(filename)) {
    //                 sysConfigFileName = JSON.parse(fs.readFileSync(filename, 'utf8'));
    //             }
    //         }
    //     })
    //     return sysConfigFileName;
    // }

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

    // // Конвертировать пользовательскую конфигурацию принтера
    // convertPrinterConfig(printerName) {
    //     const printers = this.getPrinters();
    //     const printer = printers.find(p => p.name === printerName);
    //
    //     if (!printer) return null;
    //
    //     try {
    //         const config = JSON.parse(fs.readFileSync(printer.file, 'utf8'));
    //         const systemConfig = this.getSystemConfig('machine', printer.inherits);
    //
    //         return {
    //             printer_model: printer.name,
    //             nozzle_diameter: parseFloat(systemConfig?.nozzle_diameter?.[0] || 0.4),
    //             bed_size_x: this.extractBedSize(systemConfig?.printable_area, 'x'),
    //             bed_size_y: this.extractBedSize(systemConfig?.printable_area, 'y'),
    //             max_print_height: parseFloat(systemConfig?.printable_height || 200),
    //             retraction_length: parseFloat(systemConfig?.retraction_length?.[0] || 1.0),
    //             retraction_speed: parseFloat(systemConfig?.retraction_speed?.[0] || 40),
    //             travel_speed: 120,
    //             gcode_flavor: printer.gcodeType,
    //             start_gcode: config.machine_start_gcode || '',
    //             end_gcode: config.machine_end_gcode || ''
    //         };
    //     } catch (e) {
    //         console.error('Ошибка конвертации принтера:', e);
    //         return null;
    //     }
    // }

    convertPrinterConfig(printerName) {
        const printers = this.getPrinters();
        const printer = printers.find(p => p.name === printerName);
        if (!printer) return null;

        const userConfig = JSON.parse(fs.readFileSync(printer.file, 'utf8'));
        const systemConfig = this.getSystemConfig('machine',printer.inherits);
        const merged = { ...systemConfig, ...userConfig };

        return {
            // === ОСНОВНЫЕ ===
            printer_model: merged.name || printer.name,
            printer_variant: this.getArrayValue(merged.printer_variant, ''),
            printer_vendor: this.getArrayValue(merged.printer_vendor, ''),
            printer_notes: this.getArrayValue(merged.printer_notes, ''),

            // === ГЕОМЕТРИЯ ===
            nozzle_diameter: this.getArrayValue(merged.nozzle_diameter, 0.4),
            bed_shape: this.convertPrintableAreaToBedShape(merged.printable_area),
            max_print_height: parseFloat(merged.printable_height || 200),
            z_offset: this.getArrayValue(merged.z_offset, 0),

            // === ЭКСТРУЗИЯ ===
            retract_length: this.getArrayValue(merged.retraction_length, 1.0),
            retract_speed: this.getArrayValue(merged.retraction_speed, 35),
            retract_restart_extra: this.getArrayValue(merged.retract_restart_extra, 0),
            retract_before_travel: this.getArrayValue(merged.retract_before_travel, 2),
            retract_lift: this.getArrayValue(merged.retract_lift, 0),
            retract_lift_above: this.getArrayValue(merged.retract_lift_above, 0),
            retract_lift_below: this.getArrayValue(merged.retract_lift_below, 0),
            retract_layer_change: this.getBoolValue(merged.retract_layer_change, true),
            wipe: this.getBoolValue(merged.wipe, false),
            wipe_distance: this.getArrayValue(merged.wipe_distance, 0),

            // === СКОРОСТИ ===
            travel_speed: this.getArrayValue(merged.machine_max_feedrate_x, 150),
            max_print_speed: this.getArrayValue(merged.machine_max_feedrate_e, 120),
            max_volumetric_speed: this.getArrayValue(merged.max_volumetric_speed, 0),
            machine_max_feedrate_x: this.getArrayValue(merged.machine_max_feedrate_x, 500),
            machine_max_feedrate_y: this.getArrayValue(merged.machine_max_feedrate_y, 500),
            machine_max_feedrate_z: this.getArrayValue(merged.machine_max_feedrate_z, 12),
            machine_max_feedrate_e: this.getArrayValue(merged.machine_max_feedrate_e, 120),

            // === УСКОРЕНИЯ ===
            machine_max_acceleration_x: this.getArrayValue(merged.machine_max_acceleration_x, 3000),
            machine_max_acceleration_y: this.getArrayValue(merged.machine_max_acceleration_y, 3000),
            machine_max_acceleration_z: this.getArrayValue(merged.machine_max_acceleration_z, 500),
            machine_max_acceleration_e: this.getArrayValue(merged.machine_max_acceleration_e, 10000),
            machine_max_acceleration_extruding: this.getArrayValue(merged.machine_max_acceleration_extruding, 1500),
            machine_max_acceleration_retracting: this.getArrayValue(merged.machine_max_acceleration_retracting, 1500),

            // === РЫВКИ ===
            machine_max_jerk_x: this.getArrayValue(merged.machine_max_jerk_x, 10),
            machine_max_jerk_y: this.getArrayValue(merged.machine_max_jerk_y, 10),
            machine_max_jerk_z: this.getArrayValue(merged.machine_max_jerk_z, 0.3),
            machine_max_jerk_e: this.getArrayValue(merged.machine_max_jerk_e, 2.5),

            // === G-CODE ===
            gcode_flavor: this.getArrayValue(merged.gcode_flavor, 'marlin'),
            use_relative_e_distances: this.getBoolValue(merged.use_relative_e_distances, false),
            use_firmware_retraction: this.getBoolValue(merged.use_firmware_retraction, false),
            use_volumetric_e: this.getBoolValue(merged.use_volumetric_e, false),

            start_gcode: merged.machine_start_gcode || merged.start_gcode || '',
            end_gcode: merged.machine_end_gcode || merged.end_gcode || '',
            before_layer_gcode: merged.before_layer_change_gcode || '',
            layer_gcode: merged.layer_change_gcode || '',
            toolchange_gcode: merged.toolchange_gcode || '',
            between_objects_gcode: merged.between_objects_gcode || '',

            // === ДОПОЛНИТЕЛЬНЫЕ ===
            print_host: merged.print_host || '',
            printhost_apikey: merged.printhost_apikey || '',
            silent_mode: this.getBoolValue(merged.silent_mode, false),
            machine_limits_usage: this.getArrayValue(merged.machine_limits_usage, 'emit_to_gcode')
        };
    }

    getArrayValue(arrayOrValue, defaultValue) {
        if (Array.isArray(arrayOrValue)) {
            const val = arrayOrValue[0];
            return typeof defaultValue === 'number' ? parseFloat(val) || defaultValue : val || defaultValue;
        }
        return typeof defaultValue === 'number' ? parseFloat(arrayOrValue) || defaultValue : arrayOrValue || defaultValue;
    }

    getBoolValue(arrayOrValue, defaultValue) {
        if (Array.isArray(arrayOrValue)) return arrayOrValue[0] === '1' || arrayOrValue[0] === true;
        return arrayOrValue === '1' || arrayOrValue === true || defaultValue;
    }

    convertPrintableAreaToBedShape(printableArea) {
        if (!Array.isArray(printableArea)) return '0x0,200x0,200x200,0x200';
        return printableArea.join(',');
    }

    getSystemConfig(configType, inheritsName) {
        if (!inheritsName) return null;

        const dirs = fs.readdirSync(this.systemPath);
        for (const dir of dirs) {
            if (dir === '.' || dir === '..') continue;

            const configPath = path.join(this.systemPath, dir, configType, inheritsName + '.json');
            if (fs.existsSync(configPath)) {
                let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

                // Обрабатываем наследование рекурсивно
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

        const userConfig = JSON.parse(fs.readFileSync(filament.file, 'utf8'));
        const systemConfig = this.getSystemConfig('filament',filament.inherits);
        const merged = { ...systemConfig, ...userConfig };

        return {
            // === ОСНОВНЫЕ ===
            filament_type: this.getFilamentType(filament.inherits),
            filament_vendor: this.getArrayValue(merged.filament_vendor, 'Generic'),
            filament_colour: this.getArrayValue(merged.filament_colour, '#FFFFFF'),
            filament_notes: this.getArrayValue(merged.filament_notes, ''),
            filament_settings_id: this.getArrayValue(merged.filament_settings_id, ''),

            // === СОВМЕСТИМОСТЬ ===
            compatible_printers: merged.compatible_printers || [],
            compatible_printers_condition: this.getArrayValue(merged.compatible_printers_condition, ''),
            compatible_prints: merged.compatible_prints || [],
            compatible_prints_condition: this.getArrayValue(merged.compatible_prints_condition, ''),
            inherits: merged.inherits || '',

            // === ФИЗИЧЕСКИЕ СВОЙСТВА ===
            filament_diameter: this.getArrayValue(merged.filament_diameter, 1.75),
            filament_density: this.getArrayValue(merged.filament_density, 1.24),
            filament_cost: this.getArrayValue(merged.filament_cost, 25),
            filament_soluble: this.getBoolValue(merged.filament_soluble, false),
            filament_shrink: this.getArrayValue(merged.filament_shrink, 100),
            filament_max_overlap: this.getArrayValue(merged.filament_max_overlap, 100),

            // === ЭКСТРУЗИЯ ===
            extrusion_multiplier: this.getArrayValue(merged.filament_flow_ratio, 1.0),
            filament_flow_ratio: this.getArrayValue(merged.filament_flow_ratio, 1.0),
            filament_max_volumetric_speed: this.getArrayValue(merged.filament_max_volumetric_speed, 15),

            // === РЕТРАКТ ===
            filament_retraction_length: this.getArrayValue(merged.filament_retraction_length, 'nil'),
            filament_retraction_speed: this.getArrayValue(merged.filament_retraction_speed, 'nil'),
            filament_deretraction_speed: this.getArrayValue(merged.filament_deretraction_speed, 'nil'),
            filament_retract_restart_extra: this.getArrayValue(merged.filament_retract_restart_extra, 'nil'),
            filament_retraction_minimum_travel: this.getArrayValue(merged.filament_retraction_minimum_travel, 'nil'),
            filament_retract_before_wipe: this.getArrayValue(merged.filament_retract_before_wipe, 'nil'),
            filament_retract_when_changing_layer: this.getBoolValue(merged.filament_retract_when_changing_layer, 'nil'),
            filament_z_hop: this.getArrayValue(merged.filament_z_hop, 'nil'),
            filament_z_hop_types: this.getArrayValue(merged.filament_z_hop_types, 'nil'),
            filament_wipe: this.getArrayValue(merged.filament_wipe, 'nil'),
            filament_wipe_distance: this.getArrayValue(merged.filament_wipe_distance, 'nil'),

            // === ТЕМПЕРАТУРЫ ===
            temperature: this.getArrayValue(merged.nozzle_temperature, 210),
            first_layer_temperature: this.getArrayValue(merged.nozzle_temperature_initial_layer, 210),
            nozzle_temperature_range_low: this.getArrayValue(merged.nozzle_temperature_range_low, 190),
            nozzle_temperature_range_high: this.getArrayValue(merged.nozzle_temperature_range_high, 240),

            bed_temperature: this.getArrayValue(merged.hot_plate_temp, 60),
            first_layer_bed_temperature: this.getArrayValue(merged.hot_plate_temp_initial_layer, 60),
            cool_plate_temp: this.getArrayValue(merged.cool_plate_temp, 60),
            cool_plate_temp_initial_layer: this.getArrayValue(merged.cool_plate_temp_initial_layer, 60),
            eng_plate_temp: this.getArrayValue(merged.eng_plate_temp, 60),
            eng_plate_temp_initial_layer: this.getArrayValue(merged.eng_plate_temp_initial_layer, 60),
            textured_plate_temp: this.getArrayValue(merged.textured_plate_temp, 60),
            textured_plate_temp_initial_layer: this.getArrayValue(merged.textured_plate_temp_initial_layer, 60),

            chamber_temperature: this.getArrayValue(merged.chamber_temperature, 0),
            temperature_vitrification: this.getArrayValue(merged.temperature_vitrification, 45),

            // === ОХЛАЖДЕНИЕ ===
            fan_cooling_layer_time: this.getArrayValue(merged.fan_cooling_layer_time, 60),
            slow_down_layer_time: this.getArrayValue(merged.slow_down_layer_time, 8),
            slow_down_min_speed: this.getArrayValue(merged.slow_down_min_speed, 10),
            fan_always_on: this.getBoolValue(merged.fan_always_on, false),
            cooling: this.getBoolValue(merged.cooling, true),
            min_fan_speed: this.getArrayValue(merged.min_fan_speed, 35),
            max_fan_speed: this.getArrayValue(merged.max_fan_speed, 100),
            bridge_fan_speed: this.getArrayValue(merged.bridge_fan_speed, 100),
            overhang_fan_speed: this.getArrayValue(merged.overhang_fan_speed, 100),
            overhang_fan_threshold: this.getArrayValue(merged.overhang_fan_threshold, '50%'),
            close_fan_the_first_x_layers: this.getArrayValue(merged.close_fan_the_first_x_layers, 1),
            full_fan_speed_layer: this.getArrayValue(merged.full_fan_speed_layer, 3),
            disable_fan_first_layers: this.getArrayValue(merged.close_fan_the_first_x_layers, 1),
            additional_cooling_fan_speed: this.getArrayValue(merged.additional_cooling_fan_speed, 0),
            reduce_fan_stop_start_freq: this.getBoolValue(merged.reduce_fan_stop_start_freq, true),
            dont_slow_down_outer_wall: this.getBoolValue(merged.dont_slow_down_outer_wall, false),
            enable_overhang_bridge_fan: this.getBoolValue(merged.enable_overhang_bridge_fan, true),

            // === G-CODE ===
            start_filament_gcode: this.getArrayValue(merged.filament_start_gcode, ''),
            end_filament_gcode: this.getArrayValue(merged.filament_end_gcode, ''),

            // === ДОПОЛНИТЕЛЬНЫЕ ===
            filament_minimal_purge_on_wipe_tower: this.getArrayValue(merged.filament_minimal_purge_on_wipe_tower, 15),
            bed_type: this.getArrayValue(merged.bed_type, 'Cool Plate'),
            during_print_exhaust_fan_speed: this.getArrayValue(merged.during_print_exhaust_fan_speed, 100),
            complete_print_exhaust_fan_speed: this.getArrayValue(merged.complete_print_exhaust_fan_speed, 0),
            activate_air_filtration: this.getBoolValue(merged.activate_air_filtration, true),
            activate_chamber_temp_control: this.getBoolValue(merged.activate_chamber_temp_control, false),
            enable_pressure_advance: this.getBoolValue(merged.enable_pressure_advance, true),
            pressure_advance: this.extractPressureAdvance(merged)
        };
    }

    // convertFilamentConfig(filamentName) {
    //     const filaments = this.getFilaments();
    //     const filament = filaments.find(f => f.name === filamentName);
    //
    //     if (!filament) return null;
    //
    //     return {
    //         filament_type: this.getFilamentType(filament.inherits),
    //         filament_diameter: 1.75,
    //         pressure_advance: parseFloat(filament.pressureAdvance),
    //         flow_ratio: parseFloat(filament.flowRatio),
    //         filament_flow_ratio: parseFloat(filament.flowRatio), // Дублируем для совместимости
    //         max_volumetric_speed: parseFloat(filament.maxVolumetricSpeed),
    //         nozzle_temperature: parseFloat(filament.nozzleTemp),
    //         bed_temperature: parseFloat(filament.bedTemp),
    //         fan_speed: 100
    //     };
    // }



    convertProcessConfig(processName) {
        const processes = this.getPrintProfiles();
        const process = processes.find(p => p.name === processName);
        if (!process) return null;

        const userConfig = JSON.parse(fs.readFileSync(process.file, 'utf8'));
        const systemConfig = this.getSystemConfig('process',process.inherits);
        const merged = { ...systemConfig, ...userConfig };

        return {
            // === ОСНОВНЫЕ ===
            print_settings_id: this.getArrayValue(merged.print_settings_id, ''),
            inherits: merged.inherits || '',

            // === СОВМЕСТИМОСТЬ ===
            compatible_printers: merged.compatible_printers || [],
            compatible_printers_condition: this.getArrayValue(merged.compatible_printers_condition, ''),

            // === СЛОИ ===
            layer_height: this.getArrayValue(merged.layer_height, 0.2),
            first_layer_height: this.getArrayValue(merged.first_layer_height, 0.3),
            max_layer_height: this.getArrayValue(merged.max_layer_height, 0.3),
            min_layer_height: this.getArrayValue(merged.min_layer_height, 0.1),

            // === ПЕРИМЕТРЫ ===
            perimeters: this.getArrayValue(merged.perimeters, 2),
            spiral_vase: this.getBoolValue(merged.spiral_vase, false),
            only_one_perimeter_top: this.getBoolValue(merged.only_one_perimeter_top, false),
            only_one_perimeter_first_layer: this.getBoolValue(merged.only_one_perimeter_first_layer, false),

            // === ЗАПОЛНЕНИЕ ===
            fill_density: this.getArrayValue(merged.fill_density, '20%'),
            infill_density: this.getArrayValue(merged.infill_density, '20%'),
            fill_pattern: this.getArrayValue(merged.fill_pattern, 'cubic'),
            infill_pattern: this.getArrayValue(merged.infill_pattern, 'cubic'),
            top_fill_pattern: this.getArrayValue(merged.top_fill_pattern, 'monotonic'),
            bottom_fill_pattern: this.getArrayValue(merged.bottom_fill_pattern, 'monotonic'),
            solid_infill_below_area: this.getArrayValue(merged.solid_infill_below_area, 70),
            infill_only_where_needed: this.getBoolValue(merged.infill_only_where_needed, false),
            infill_first: this.getBoolValue(merged.infill_first, false),

            // === ВЕРХНИЕ/НИЖНИЕ СЛОИ ===
            top_solid_layers: this.getArrayValue(merged.top_solid_layers, 3),
            bottom_solid_layers: this.getArrayValue(merged.bottom_solid_layers, 3),
            solid_infill_extruder: this.getArrayValue(merged.solid_infill_extruder, 1),

            // === ШИРИНЫ ЭКСТРУЗИИ ===
            extrusion_width: this.getArrayValue(merged.extrusion_width, 0),
            first_layer_extrusion_width: this.getArrayValue(merged.first_layer_extrusion_width, 0),
            perimeter_extrusion_width: this.getArrayValue(merged.perimeter_extrusion_width, 0),
            external_perimeter_extrusion_width: this.getArrayValue(merged.external_perimeter_extrusion_width, 0),
            infill_extrusion_width: this.getArrayValue(merged.infill_extrusion_width, 0),
            solid_infill_extrusion_width: this.getArrayValue(merged.solid_infill_extrusion_width, 0),
            top_infill_extrusion_width: this.getArrayValue(merged.top_infill_extrusion_width, 0),

            // === СКОРОСТИ ===
            print_speed: this.getArrayValue(merged.print_speed, 50),
            perimeter_speed: this.getArrayValue(merged.perimeter_speed, 50),
            small_perimeter_speed: this.getArrayValue(merged.small_perimeter_speed, '50%'),
            external_perimeter_speed: this.getArrayValue(merged.external_perimeter_speed, '50%'),
            infill_speed: this.getArrayValue(merged.infill_speed, 80),
            solid_infill_speed: this.getArrayValue(merged.solid_infill_speed, '80%'),
            top_solid_infill_speed: this.getArrayValue(merged.top_solid_infill_speed, '60%'),
            support_material_speed: this.getArrayValue(merged.support_material_speed, 60),
            support_material_interface_speed: this.getArrayValue(merged.support_material_interface_speed, '100%'),
            bridge_speed: this.getArrayValue(merged.bridge_speed, 60),
            gap_fill_speed: this.getArrayValue(merged.gap_fill_speed, 20),
            travel_speed: this.getArrayValue(merged.travel_speed, 120),
            first_layer_speed: this.getArrayValue(merged.first_layer_speed, 30),
            first_layer_infill_speed: this.getArrayValue(merged.first_layer_infill_speed, 30),

            // === УСКОРЕНИЯ ===
            default_acceleration: this.getArrayValue(merged.default_acceleration, 0),
            perimeter_acceleration: this.getArrayValue(merged.perimeter_acceleration, 0),
            infill_acceleration: this.getArrayValue(merged.infill_acceleration, 0),
            bridge_acceleration: this.getArrayValue(merged.bridge_acceleration, 0),
            first_layer_acceleration: this.getArrayValue(merged.first_layer_acceleration, 0),

            // === ПОДДЕРЖКИ ===
            support_material: this.getBoolValue(merged.support_material, false),
            support_material_auto: this.getBoolValue(merged.support_material_auto, true),
            support_material_threshold: this.getArrayValue(merged.support_material_threshold, 0),
            support_material_pattern: this.getArrayValue(merged.support_material_pattern, 'rectilinear'),
            support_material_with_sheath: this.getBoolValue(merged.support_material_with_sheath, true),
            support_material_spacing: this.getArrayValue(merged.support_material_spacing, 2.5),
            support_material_synchronize_layers: this.getBoolValue(merged.support_material_synchronize_layers, false),
            support_material_angle: this.getArrayValue(merged.support_material_angle, 0),
            support_material_interface_layers: this.getArrayValue(merged.support_material_interface_layers, 3),
            support_material_interface_spacing: this.getArrayValue(merged.support_material_interface_spacing, 0),
            support_material_interface_contact_loops: this.getBoolValue(merged.support_material_interface_contact_loops, false),
            support_material_contact_distance: this.getArrayValue(merged.support_material_contact_distance, 0.2),
            support_material_buildplate_only: this.getBoolValue(merged.support_material_buildplate_only, false),
            dont_support_bridges: this.getBoolValue(merged.dont_support_bridges, true),
            support_material_xy_spacing: this.getArrayValue(merged.support_material_xy_spacing, '50%'),

            // === ЮБКА И КАЙМА ===
            skirts: this.getArrayValue(merged.skirts, 1),
            skirt_distance: this.getArrayValue(merged.skirt_distance, 6),
            skirt_height: this.getArrayValue(merged.skirt_height, 1),
            min_skirt_length: this.getArrayValue(merged.min_skirt_length, 0),
            brim_width: this.getArrayValue(merged.brim_width, 0),
            brim_separation: this.getArrayValue(merged.brim_separation, 0),
            brim_type: this.getArrayValue(merged.brim_type, 'no_brim'),

            // === ЗАПОЛНЕНИЕ ПРОБЕЛОВ ===
            gap_fill_enabled: this.getBoolValue(merged.gap_fill_enabled, true),
            filter_out_gap_fill: this.getArrayValue(merged.filter_out_gap_fill, 0),

            // === ПЕРЕКРЫТИЯ ===
            infill_overlap: this.getArrayValue(merged.infill_overlap, '25%'),
            infill_anchor: this.getArrayValue(merged.infill_anchor, 600),
            infill_anchor_max: this.getArrayValue(merged.infill_anchor_max, 50),

            // === МОСТЫ ===
            bridge_angle: this.getArrayValue(merged.bridge_angle, 0),
            bridge_flow_ratio: this.getArrayValue(merged.bridge_flow_ratio, 1),
            bridge_type: this.getArrayValue(merged.bridge_type, 'nozzle'),

            // === ШВЫ ===
            seam_position: this.getArrayValue(merged.seam_position, 'aligned'),
            seam_preferred_direction: this.getArrayValue(merged.seam_preferred_direction, 0),
            seam_preferred_direction_jitter: this.getArrayValue(merged.seam_preferred_direction_jitter, 30),

            // === РАЗРЕШЕНИЕ ===
            resolution: this.getArrayValue(merged.resolution, 0),
            gcode_resolution: this.getArrayValue(merged.gcode_resolution, 0.0125),

            // === ДОПОЛНИТЕЛЬНЫЕ ===
            avoid_crossing_perimeters: this.getBoolValue(merged.avoid_crossing_perimeters, false),
            avoid_crossing_perimeters_max_detour: this.getArrayValue(merged.avoid_crossing_perimeters_max_detour, 0),
            thin_walls: this.getBoolValue(merged.thin_walls, true),
            overhangs: this.getBoolValue(merged.overhangs, true),

            // === ПОСТОБРАБОТКА ===
            post_process: merged.post_process || [],

            // === G-CODE ===
            output_filename_format: this.getArrayValue(merged.output_filename_format, '[input_filename_base].gcode'),

            // === ДОПОЛНИТЕЛЬНЫЕ ORCA ===
            fuzzy_skin: this.getArrayValue(merged.fuzzy_skin, 'none'),
            fuzzy_skin_thickness: this.getArrayValue(merged.fuzzy_skin_thickness, 0.3),
            fuzzy_skin_point_dist: this.getArrayValue(merged.fuzzy_skin_point_dist, 0.8),

            // === АДАПТИВНЫЕ СЛОИ ===
            adaptive_layer_height: this.getBoolValue(merged.adaptive_layer_height, false),
            adaptive_layer_height_variation: this.getArrayValue(merged.adaptive_layer_height_variation, 0.4),
            adaptive_layer_height_threshold: this.getArrayValue(merged.adaptive_layer_height_threshold, 0.2),

            // === ПЕРЕМЕННАЯ ВЫСОТА СЛОЯ ===
            variable_layer_height: this.getBoolValue(merged.variable_layer_height, false),

            // === IRONING ===
            ironing: this.getBoolValue(merged.ironing, false),
            ironing_type: this.getArrayValue(merged.ironing_type, 'top'),
            ironing_flowrate: this.getArrayValue(merged.ironing_flowrate, '15%'),
            ironing_spacing: this.getArrayValue(merged.ironing_spacing, 0.1),
            ironing_speed: this.getArrayValue(merged.ironing_speed, 15),

            // === МОДИФИКАТОРЫ ===
            xy_size_compensation: this.getArrayValue(merged.xy_size_compensation, 0),
            xy_inner_size_compensation: this.getArrayValue(merged.xy_inner_size_compensation, 0),
            hole_size_compensation: this.getArrayValue(merged.hole_size_compensation, 0),

            // === СЛАЙСИНГ ===
            slice_closing_radius: this.getArrayValue(merged.slice_closing_radius, 0.049),
            slicing_mode: this.getArrayValue(merged.slicing_mode, 'regular'),

            // === ДОПОЛНИТЕЛЬНЫЕ НАСТРОЙКИ ===
            complete_objects: this.getBoolValue(merged.complete_objects, false),
            extruder_clearance_radius: this.getArrayValue(merged.extruder_clearance_radius, 20),
            extruder_clearance_height: this.getArrayValue(merged.extruder_clearance_height, 20),

            // === WIPE TOWER ===
            wipe_tower: this.getBoolValue(merged.wipe_tower, false),
            wipe_tower_x: this.getArrayValue(merged.wipe_tower_x, 180),
            wipe_tower_y: this.getArrayValue(merged.wipe_tower_y, 140),
            wipe_tower_width: this.getArrayValue(merged.wipe_tower_width, 60),
            wipe_tower_rotation_angle: this.getArrayValue(merged.wipe_tower_rotation_angle, 0),
            wipe_tower_brimming: this.getBoolValue(merged.wipe_tower_brimming, false),

            // === ЗАМЕТКИ ===
            notes: this.getArrayValue(merged.notes, '')
        };
    }


    // convertProcessConfig(processName) {
    //     const processes = this.getPrintProfiles();
    //     const process = processes.find(p => p.name === processName);
    //
    //     if (!process) return null;
    //
    //     try {
    //         const config = JSON.parse(fs.readFileSync(process.file, 'utf8'));
    //         const systemConfig = this.getSystemConfig('process', process.inherits);
    //
    //         // Объединяем пользовательский и системный конфиги
    //         const fullConfig = {...systemConfig, ...config};
    //
    //         return {
    //             layer_height: fullConfig.layer_height || '0.2',
    //             first_layer_height: fullConfig.initial_layer_print_height || '0.3',
    //             perimeter_speed: fullConfig.outer_wall_speed || '50',
    //             external_perimeter_speed: fullConfig.outer_wall_speed || '50',
    //             infill_speed: fullConfig.sparse_infill_speed || '80',
    //             travel_speed: fullConfig.travel_speed || '150',
    //             bridge_speed: fullConfig.bridge_speed || '30',
    //             gap_fill_speed: fullConfig.gap_infill_speed || '40',
    //             small_perimeter_speed: fullConfig.inner_wall_speed || '70',
    //             solid_infill_speed: fullConfig.internal_solid_infill_speed || '70',
    //             top_solid_infill_speed: fullConfig.top_surface_speed || '40'
    //         };
    //     } catch (e) {
    //         console.error('Ошибка конвертации процесса:', e);
    //         return null;
    //     }
    // }

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


    // Получить системное имя принтера
    getSystemPrinterName(userPrinterName) {
        const printers = this.getPrinters();
        const printer = printers.find(p => p.name === userPrinterName);
        return printer?.inherits || userPrinterName;
    }

    // Получить совместимые филаменты для принтера
    getCompatibleFilaments(printerName) {
        const allFilaments = this.getFilaments();
        const systemPrinterName = this.getSystemPrinterName(printerName);
        
        const compatibleFilaments = allFilaments.filter(filament => {
            const sysConfig = this.getSystemConfig('filament', filament.inherits);
            return !sysConfig || this.isCompatibleWithPrinter(sysConfig, systemPrinterName);
        });
        
        return compatibleFilaments.length > 0 ? compatibleFilaments : allFilaments;
    }

    // Получить совместимые процессы для принтера  
    getCompatibleProcesses(printerName) {
        const allProcesses = this.getPrintProfiles();
        const systemPrinterName = this.getSystemPrinterName(printerName);
        
        const compatibleProcesses = allProcesses.filter(process => {
            const sysConfig = this.getSystemConfig('process', process.inherits);
            return !sysConfig || this.isCompatibleWithPrinter(sysConfig, systemPrinterName);
        });
        
        return compatibleProcesses.length > 0 ? compatibleProcesses : allProcesses;
    }

    // Проверка совместимости с принтером
    isCompatibleWithPrinter(config, printerName) {
        if (!config.compatible_printers) return true;
        
        // Получаем системное имя принтера через наследование
        const systemPrinterName = this.getSystemPrinterName(printerName);
        
        return config.compatible_printers.includes(printerName) || 
               config.compatible_printers.includes(systemPrinterName);
    }


}

module.exports = OrcaConfigParser;