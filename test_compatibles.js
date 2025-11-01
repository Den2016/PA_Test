const OrcaConfigParser = require('./orca_config_parser');

const parser = new OrcaConfigParser('./ini_examples/OrcaSlicer');

console.log('=== ТЕСТ СОВМЕСТИМОСТИ ORCA SLICER ===\n');

// Получаем все принтеры
const printers = parser.getPrinters();
console.log('Пользовательские принтеры:');
printers.forEach(printer => {
    console.log(`  - ${printer.name} (наследует: ${printer.inherits})`);
});
console.log();

// Тестируем каждый принтер
printers.forEach(printer => {
    console.log(`\n=== ПРИНТЕР: ${printer.name} ===`);
    console.log(`Системное имя: ${parser.getSystemPrinterName(printer.name)}`);
    
    // Совместимые филаменты
    const compatibleFilaments = parser.getCompatibleFilaments(printer.name);
    console.log(`\nСовместимые филаменты (${compatibleFilaments.length}):`);
    compatibleFilaments.forEach(filament => {
        const sysConfig = parser.getSystemConfig('filament', filament.inherits);
        const hasRestrictions = sysConfig?.compatible_printers ? 'ограничен' : 'без ограничений';
        console.log(`  - ${filament.name} (${filament.inherits}) - ${hasRestrictions}`);
        
        if (sysConfig?.compatible_printers) {
            console.log(`    Совместим с: ${sysConfig.compatible_printers.join(', ')}`);
        }
    });
    
    // Совместимые процессы
    const compatibleProcesses = parser.getCompatibleProcesses(printer.name);
    console.log(`\nСовместимые процессы (${compatibleProcesses.length}):`);
    compatibleProcesses.forEach(process => {
        const sysConfig = parser.getSystemConfig('process', process.inherits);
        const hasRestrictions = sysConfig?.compatible_printers ? 'ограничен' : 'без ограничений';
        console.log(`  - ${process.name} (${process.inherits}) - ${hasRestrictions}`);
        
        if (sysConfig?.compatible_printers) {
            console.log(`    Совместим с: ${sysConfig.compatible_printers.join(', ')}`);
        }
    });
});

// Детальный анализ проблемных случаев
console.log('\n\n=== ДЕТАЛЬНЫЙ АНАЛИЗ ===');

const testCases = [
    {
        printer: 'KP3S 0.4 klipper',
        filament: '123d white'
    },
    {
        printer: 'Qidi Q1 Pro 0.4 nozzle - Копировать',
        filament: 'MAKO Black'
    }
];

testCases.forEach(testCase => {
    console.log(`\n--- Тест: ${testCase.printer} + ${testCase.filament} ---`);
    
    const systemPrinterName = parser.getSystemPrinterName(testCase.printer);
    console.log(`Системное имя принтера: ${systemPrinterName}`);
    
    const filaments = parser.getFilaments();
    const filament = filaments.find(f => f.name === testCase.filament);
    
    if (filament) {
        console.log(`Филамент наследует: ${filament.inherits}`);
        
        const sysConfig = parser.getSystemConfig('filament', filament.inherits);
        if (sysConfig) {
            console.log(`Системный конфиг найден: ${sysConfig.name}`);
            if (sysConfig.compatible_printers) {
                console.log(`Ограничения совместимости: ${sysConfig.compatible_printers.join(', ')}`);
                
                const isCompatible = parser.isCompatibleWithPrinter(sysConfig, systemPrinterName);
                console.log(`Совместимость: ${isCompatible ? 'ДА' : 'НЕТ'}`);
                
                // Проверяем каждое ограничение
                sysConfig.compatible_printers.forEach(compatPrinter => {
                    const matches = compatPrinter === testCase.printer || compatPrinter === systemPrinterName;
                    console.log(`  "${compatPrinter}" === "${systemPrinterName}": ${matches}`);
                });
            } else {
                console.log('Нет ограничений совместимости - совместим со всеми');
            }
        } else {
            console.log('Системный конфиг не найден - совместим со всеми');
        }
    } else {
        console.log('Филамент не найден');
    }
});