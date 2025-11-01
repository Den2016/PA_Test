const SlicerInfo = require('./slicer');

console.log('=== ТЕСТ ИНТЕГРАЦИИ SLICER.JS С ORCA ===\n');

// Создаем экземпляр SlicerInfo для Orca
const orcaSlicer = new SlicerInfo('./ini_examples/OrcaSlicer', 'orca');

console.log(`Orca Slicer найден: ${orcaSlicer.isPresent}`);
console.log(`Путь: ${orcaSlicer.fullPath}`);
console.log(`Тип слайсера: ${orcaSlicer.slicerType}\n`);

// Загружаем принтеры
console.log('=== ЗАГРУЗКА ПРИНТЕРОВ ===');
orcaSlicer.loadPrinters();

console.log(`Найдено принтеров: ${orcaSlicer.printers.length}`);
orcaSlicer.printers.forEach(printer => {
    console.log(`  - ${printer.name} (${printer.type})`);
});

console.log(`\nНайдено физических принтеров: ${orcaSlicer.physicalPrinters.length}`);
orcaSlicer.physicalPrinters.forEach(printer => {
    console.log(`  - ${printer.name} (${printer.type}) - ${printer.print_host || 'без хоста'}`);
});

// Тестируем каждый принтер
console.log('\n=== ТЕСТ СОВМЕСТИМОСТИ ===');
orcaSlicer.printers.forEach(printer => {
    console.log(`\n--- Принтер: ${printer.name} ---`);
    
    // Устанавливаем принтер
    orcaSlicer.printerName = printer.name;
    console.log(`Установлен принтер: ${orcaSlicer.printerName}`);
    
    // Загружаем совместимые филаменты
    orcaSlicer.getCompatibleFilaments();
    console.log(`Совместимые филаменты (${orcaSlicer.filaments.length}):`);
    orcaSlicer.filaments.forEach(filament => {
        console.log(`  - ${filament}`);
    });
    
    // Загружаем совместимые процессы
    orcaSlicer.getCompatiblePrints();
    console.log(`Совместимые процессы (${orcaSlicer.prints.length}):`);
    orcaSlicer.prints.forEach(process => {
        console.log(`  - ${process}`);
    });
});

// Тест загрузки конфигураций
console.log('\n=== ТЕСТ ЗАГРУЗКИ КОНФИГУРАЦИЙ ===');

if (orcaSlicer.printers.length > 0) {
    const testPrinter = orcaSlicer.printers[0].name;
    orcaSlicer.printerName = testPrinter;
    
    console.log(`\nТестовый принтер: ${testPrinter}`);
    console.log('Конфигурация принтера:');
    console.log(JSON.stringify(orcaSlicer.printerConfig, null, 2));
    
    if (orcaSlicer.filaments.length > 0) {
        const testFilament = orcaSlicer.filaments[0];
        orcaSlicer.filamentName = testFilament;
        
        console.log(`\nТестовый филамент: ${testFilament}`);
        console.log('Конфигурация филамента:');
        console.log(JSON.stringify(orcaSlicer.filamentConfig, null, 2));
    }
    
    if (orcaSlicer.prints.length > 0) {
        const testProcess = orcaSlicer.prints[0];
        orcaSlicer.printName = testProcess;
        
        console.log(`\nТестовый процесс: ${testProcess}`);
        console.log('Конфигурация процесса:');
        console.log(JSON.stringify(orcaSlicer.printConfig, null, 2));
    }
}

console.log('\n=== ТЕСТ ЗАВЕРШЕН ===');