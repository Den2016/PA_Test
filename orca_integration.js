const OrcaConfigParser = require('./orca_config_parser');
const fs = require('fs');
const path = require('path');

class OrcaIntegration {
    constructor() {
        this.parser = new OrcaConfigParser();
    }


    // Получить список пользовательских принтеров для UI
    getAvailablePrinters() {
        return this.parser.getPrinters().map(p => ({
            id: p.name,
            name: p.name,
            inherits: p.inherits,
            gcodeType: p.gcodeType,
            print_host: p.print_host,
        }));
    }

    // Получить список пользовательских филаментов для UI
    getAvailableFilaments(printerName = null) {
        const filaments = printerName ?
            this.parser.getCompatibleFilaments(printerName) :
            this.parser.getFilaments();

        return filaments.map(f => ({
            id: f.name,
            name: f.name,
            inherits: f.inherits,
            pressureAdvance: f.pressureAdvance
        }));
    }

    // Получить список профилей печати для UI
    getAvailableProcesses(printerName = null) {
        const processes = printerName ?
            this.parser.getCompatibleProcesses(printerName) :
            this.parser.getPrintProfiles();

        return processes.map(p => ({
            id: p.name,
            name: p.name,
            inherits: p.inherits,
            layerHeight: p.layerHeight
        }));
    }

    // Получить совместимые филаменты для принтера
    getCompatibleFilaments(printerName) {
        return this.parser.getCompatibleFilaments(printerName);
    }

    // Получить совместимые процессы для принтера
    getCompatibleProcesses(printerName) {
        return this.parser.getCompatibleProcesses(printerName);
    }

    // Получить конфигурацию для PA Test Generator
    getConfigForPATest(printerId, filamentId) {
        const printers = this.parser.getPrinters();
        const filaments = this.parser.getFilaments();

        let partsPrinterName = printerId.split('*');
        printerId = partsPrinterName.length > 1 ? partsPrinterName[1] : printerId;

        const printer = printers.find(p => p.name === printerId);
        const filament = filaments.find(f => f.name === filamentId);

        if (!printer || !filament) return null;

        const printerConfig = this.parser.convertPrinterConfig(printer.name);
        const filamentConfig = this.parser.convertFilamentConfig(filament.name);

        return {
            printer: printerConfig,
            filament: filamentConfig,
            combined: {
                ...printerConfig,
                ...filamentConfig,
                test_start_pa: 0.0,
                test_end_pa: parseFloat(filament.pressureAdvance) * 2,
                test_pa_step: 0.005,
                test_layers_per_step: 5
            }
        };
    }
}

module.exports = OrcaIntegration;