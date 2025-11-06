const fs = require('fs');
const path = require('path');
const os = require('os');
const GCodeGenerator = require('./generator.js');
const OrcaIntegration = require('./orca_integration');
const BedVisualizer = require('./bed_visualizer');

let currentSlicer = '';
let currentSlicerPath = '';
let selectedPrinter = null;

const SlicerInfo = require('./slicer');
const printer = require("./slicer");

const OrcaSlicer = new SlicerInfo('OrcaSlicer', 'orca');
const PrusaSlicer = new SlicerInfo('PrusaSlicer', 'prusa');
const QIDISlicer = new SlicerInfo('QIDISlicer', 'qidi');

const slicers = {
    'orca': OrcaSlicer,
    'prusa': PrusaSlicer,
    'qidi': QIDISlicer,
}

// Путь к файлу настроек
const settingsPath = path.join(__dirname, 'settings.json');


let bedVisualizer = null;

document.addEventListener('DOMContentLoaded', () => {
    const selSlicer = document.getElementById('selSlicer');
    const selPrinter = document.getElementById('selPrinter');
    const selFilament = document.getElementById('selFilament');
    const selPrint = document.getElementById('selPrint');

    // необходимо создать список слайсеров, присутствующих на компьютере
    let html = '';
    if (OrcaSlicer.isPresent) html += `<option value="orca">Orca slicer</option>`;
    if (PrusaSlicer.isPresent) html += `<option value="prusa">Prusa slicer</option>`;
    if (QIDISlicer.isPresent) html += `<option value="qidi">QIDI slicer</option>`
    selSlicer.innerHTML = html;
    currentSlicer = selSlicer.value;


    selSlicer.addEventListener('change', (e) => {
        currentSlicer = e.target.value;
        slicerChanged();
    });

    selPrinter.addEventListener('change', (e) => {
        const slicer = slicers[currentSlicer];
        slicer.printerName = e.target.value;
        slicer.getCompatibleFilaments();
        slicer.getCompatiblePrints();
        printerChanged();
    });

    selFilament.addEventListener('change', (e) => {
        const slicer = slicers[currentSlicer];
        slicer.filamentName = e.target.value;
        clearGeneratedGCode();
        checkGenerateReady();
        updatePrintSettings();
        updateConfigInfo();
    });

    selPrint.addEventListener('change', (e) => {
        const slicer = slicers[currentSlicer];
        slicer.printName = e.target.value;
        clearGeneratedGCode();
        checkGenerateReady();
        updateConfigInfo();
    });


    document.getElementById('startPA').addEventListener('input', () => {
        clearGeneratedGCode();
        calculatePACount();
    });
    document.getElementById('endPA').addEventListener('input', () => {
        clearGeneratedGCode();
        calculatePACount();
    });
    document.getElementById('stepPA').addEventListener('input', () => {
        clearGeneratedGCode();
        calculatePACount();
    });

    if(!loadSettings()){
        slicerChanged()
    }
    updateConfigInfo();
    setTimeout(() => {
        calculatePACount();

    }, 1000)


    document.getElementById('generateBtn').addEventListener('click', generateGCode);
    document.getElementById('saveBtn').addEventListener('click', saveGCode);
    const sendBtn = document.getElementById('sendBtn');
    sendBtn.addEventListener('click', () => {
        sendBtn.disabled = true;
        sendToPrinter().finally(() => {
            sendBtn.disabled = false;
        });
    });

    window.addEventListener('beforeunload', saveSettings);


    function getSettings() {
        if (fs.existsSync(settingsPath)) {
            return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        }
        return {}
    }

    function calculateMaxObjects() {
        const slicer = slicers[currentSlicer];
        if (!slicer.printName) return null;

        try {

            const bedShape = slicer.bed?.bedShape;
            if (!bedShape) return null;

            const spacing = 5;
            const margin = 10;
            const availableWidth = slicer.bed.bedWidth - 2 * margin;
            const availableHeight = slicer.bed.bedHeight - 2 * margin;

            const maxCols = Math.floor((availableWidth + spacing) / (slicer.objectSize.width + spacing));
            const maxRows = Math.floor((availableHeight + spacing) / (slicer.objectSize.height + spacing));

            return maxCols * maxRows;
        } catch (e) {
            return null;
        }
    }

    function calculateOptimalLayout(objectCount, objectWidth, objectHeight, spacing, bedWidth, bedHeight) {
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

    function calculatePACount() {
        const startPA = parseFloat(document.getElementById('startPA').value) || 0;
        const endPA = parseFloat(document.getElementById('endPA').value) || 0;
        const stepPA = parseFloat(document.getElementById('stepPA').value) || 0.001;

        if (stepPA <= 0 || endPA < startPA) {
            document.getElementById('countDisplay').textContent = '0';
            document.getElementById('paValues').textContent = '';
            return;
        }

        const values = [];
        for (let value = startPA; value <= endPA; value += stepPA) {
            values.push(value.toFixed(3));
        }

        const maxObjects = calculateMaxObjects();
        let displayText = values.length.toString();

        if (maxObjects && values.length > maxObjects) {
            displayText += ` (Макс: ${maxObjects})`;
            document.getElementById('countDisplay').style.color = 'red';
        } else {
            document.getElementById('countDisplay').style.color = '';
        }

        document.getElementById('countDisplay').textContent = displayText;
        document.getElementById('paValues').textContent = values.join(', ');

        updateBedVisualization(values);
    }

    function checkGCodeIssues(gcode) {
        const issues = [];
        const lines = gcode.split('\n');

        // Определяем источник проблемы
        const getSourceContext = (lineNum) => {
            if (lineNum <= 5) return 'в стартовом коде принтера';

            // Проверяем комментарии вокруг строки
            for (let i = Math.max(0, lineNum - 3); i < Math.min(lines.length, lineNum + 3); i++) {
                const line = lines[i];
                if (line.includes('; Filament G-code') || line.includes('; Filament gcode')) {
                    return 'в коде филамента';
                }
                if (line.includes('; End Filament G-code')) {
                    return 'в завершающем коде филамента';
                }
                if (line.includes('; End G-code')) {
                    return 'в завершающем коде принтера';
                }
            }
            return 'в основном коде';
        };

        // Проверяем необработанные плейсхолдеры в фигурных скобках
        const unresolvedPlaceholders = gcode.match(/\{[^}]+\}/g);
        if (unresolvedPlaceholders) {
            const uniquePlaceholders = [...new Set(unresolvedPlaceholders)];
            const locations = [];
            uniquePlaceholders.forEach(placeholder => {
                const lineNum = lines.findIndex(line => line.includes(placeholder)) + 1;
                if (lineNum > 0) {
                    const context = getSourceContext(lineNum);
                    locations.push(`${placeholder} ${context}`);
                }
            });
            issues.push(`Необработанные плейсхолдеры: ${locations.join(', ')}`);
        }

        // Проверяем необработанные плейсхолдеры в квадратных скобках
        const klipperPlaceholders = gcode.match(/\[[^\]]+\]/g);
        if (klipperPlaceholders) {
            const uniqueKlipperPlaceholders = [...new Set(klipperPlaceholders)];
            const locations = [];
            uniqueKlipperPlaceholders.forEach(placeholder => {
                const lineNum = lines.findIndex(line => line.includes(placeholder)) + 1;
                if (lineNum > 0) {
                    const context = getSourceContext(lineNum);
                    locations.push(`${placeholder} ${context}`);
                }
            });
            issues.push(`Необработанные плейсхолдеры []: ${locations.join(', ')}`);
        }

        // Проверяем неудачные условные операторы
        const failedConditions = gcode.match(/\{if\s+[^}]+\}[\s\S]*?\{endif\}/g);
        if (failedConditions) {
            issues.push(`Необработанные условные операторы: ${failedConditions.length} шт.`);
        }

        // Проверяем одиночные теги if/endif
        const orphanedIf = gcode.match(/\{if\s+[^}]+\}/g);
        const orphanedEndif = gcode.match(/\{endif\}/g);
        if (orphanedIf || orphanedEndif) {
            const ifCount = orphanedIf ? orphanedIf.length : 0;
            const endifCount = orphanedEndif ? orphanedEndif.length : 0;
            if (ifCount !== endifCount) {
                issues.push(`Несоответствие {if}/{endif}: ${ifCount} if, ${endifCount} endif`);
            }
        }

        return issues;
    }

    function checkGenerateReady() {
        const slicer = slicers[currentSlicer];
        const ready = slicer.printerConfig && slicer.filamentConfig && slicer.printConfig;
        document.getElementById('generateBtn').disabled = !ready;
    }

    function clearGeneratedGCode() {
        document.getElementById('gcodeOutput').value = '';
        document.getElementById('saveBtn').disabled = true;
        document.getElementById('sendBtn').disabled = true;
        document.getElementById('warningGenerate').innerHTML = '';
        // Удаляем предупреждения из блока визуализации
        const bedContainer = document.getElementById('bedVisualization');
        if (bedContainer) {
            const existingWarning = bedContainer.parentElement.querySelector('.gcode-warning');
            if (existingWarning) {
                existingWarning.remove();
            }
        }
    }

    function generateGCode() {
        if (!selPrinter.value || !selFilament.value || !selPrint.value) {
            alert('Выберите принтер, материал и настройки печати');
            return;
        }

        try {
            const startPA = parseFloat(document.getElementById('startPA').value) || 0;
            const endPA = parseFloat(document.getElementById('endPA').value) || 0;
            const stepPA = parseFloat(document.getElementById('stepPA').value) || 0.001;

            const paValues = [];
            if (stepPA > 0 && endPA >= startPA) {
                for (let value = startPA; value <= endPA; value += stepPA) {
                    paValues.push(parseFloat(value.toFixed(3)));
                }
            }

            const slicer = slicers[currentSlicer];
            const generator = new GCodeGenerator();
            const gcode = generator.generate(slicer, paValues);

            document.getElementById('gcodeOutput').value = gcode;
            document.getElementById('saveBtn').disabled = false;
            updateSendButton();

            const issues = checkGCodeIssues(gcode);
            updateVisualizationOrWarnings(issues);

            saveSettings();
            updateSendButton();

        } catch (error) {
            alert(`Ошибка генерации G-code:\n${error.message}`);
            console.error('G-code generation error:', error);
            document.getElementById('saveBtn').disabled = true;
        }
    }


    function hideSendProgress() {
        const progressDiv = document.getElementById('sendProgress');
        if (progressDiv) {
            progressDiv.remove();
        }
    }


    // function loadPrinters(slicer) {
    //     let sl = slicers[slicer]
    //     sl.loadPrinters()
    //     let options = '';
    //     sl.printers.forEach(p => {
    //         options += `<option value="${p.name}">${p.name}</option>`;
    //     });
    //
    //     if (sl.physicalPrinters.length > 0) {
    //         options += '<option disabled>--- Физические принтеры ---</option>';
    //         sl.physicalPrinters.forEach(p => {
    //             options += `<option value="${p.name}">${p.name}</option>`;
    //         });
    //     }
    //
    //     selPrinter.innerHTML = options;
    //     selPrinter.disabled = false;
    // }

    function loadSettings() {
        try {
            if (fs.existsSync(settingsPath)) {
                const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
                if (settings.lastSlicer) {
                    // то выставляем его в select
                    selSlicer.value = settings.lastSlicer;
                    // и обновляем текущий слайсер
                    currentSlicer = settings.lastSlicer;
                }

                let lastPrinter = settings.slicers?.[currentSlicer]?.lastPrinter;

                const slicer = slicers[currentSlicer];
                slicer.loadPrinters();
                updatePrinterSelect();
                const p = slicer.printers.find(x => x.name === lastPrinter)
                const pp = slicer.physicalPrinters.find(x => x.name === lastPrinter)
                if (lastPrinter && (p || pp)) {
                    selPrinter.value = lastPrinter;
                    slicer.printerName = lastPrinter;
                    slicer.filamentName = settings.slicers?.[currentSlicer]?.printers?.[lastPrinter]?.filament;
                    if (!slicer.filamentName) {
                        printerChanged();
                        if (slicer.filaments?.length) slicer.filamentName = slicer.filaments[0];
                        if (slicer.prints?.length) slicer.printName = slicer.prints[0];
                        return;
                    }
                    updateFilamentSettings();
                    slicer.printName = settings.slicers?.[currentSlicer]?.printers?.[settings.lastPrinter]?.print;
                    if (!slicer.printName) {
                        if (slicer.prints?.length) slicer.printName = slicer.prints;

                        return;
                    }
                    updatePrintSettings();
                    const pa = settings.slicers?.[currentSlicer]?.printers?.[settings.lastPrinter]?.paSettings;
                    if (pa) {
                        if (pa.startPA !== undefined) document.getElementById('startPA').value = pa.startPA;
                        if (pa.endPA !== undefined) document.getElementById('endPA').value = pa.endPA;
                        if (pa.stepPA !== undefined) document.getElementById('stepPA').value = pa.stepPA;
                    }

                    printerChanged();
                    calculatePACount();
                    checkGenerateReady();
                    updateConfigInfo();
                } else {
                    slicer.printerName = selPrinter.value;
                    slicer.filamentName = selFilament.value;
                    slicer.printName = selPrint.value;
                    updateFilamentSettings();
                    updatePrintSettings();
                    printerChanged();
                    calculatePACount();
                    checkGenerateReady();
                    updateConfigInfo();
                }
                return true;
            }
        } catch
            (e) {
            console.error('Ошибка загрузки настроек:', e);
        }
    }

    function printerChanged() {
        clearGeneratedGCode();
        const slicer = slicers[currentSlicer];
        const settings = getSettings();
        let lastPrinter = slicer.printerName
        if (slicer.physicalPrinterName) {
            lastPrinter = slicer.physicalPrinterName + '*' + lastPrinter
        }
        const savedFilament = settings.slicers?.[currentSlicer]?.printers?.[lastPrinter]?.filament
        const savedPrint = settings.slicers?.[currentSlicer]?.printers?.[lastPrinter]?.print
        if (savedFilament && slicer.filaments.includes(savedFilament)) {
            //пруток в настройках есть и есть в загруженном списке прутков
            slicer.filamentName = savedFilament;
        } else {
            slicer.filamentName = slicer.filaments?.[0]
        }
        if (savedPrint && slicer.prints.includes(savedPrint)) {
            //процесс в настройках есть и есть в загруженном списке прутков
            slicer.printName = savedPrint;
        } else {
            slicer.printName = slicer.prints?.[0]
        }
        updateFilamentSelect();
        updatePrintSelect();
        updateStandardConfigInfo();
        checkGenerateReady();
    }

    async function saveGCode() {
        const gcode = document.getElementById('gcodeOutput').value;
        if (!gcode.trim()) {
            alert('Нет G-code для сохранения');
            return;
        }

        try {
            const slicer = slicers[currentSlicer];
            const filename = slicer.outputFilename || 'PA_Test.gcode';

            try {
                const {ipcRenderer} = require('electron');

                const result = await ipcRenderer.invoke('save-file-dialog', {
                    defaultPath: filename,
                    filters: [
                        {name: 'G-code files', extensions: ['gcode']},
                        {name: 'All files', extensions: ['*']}
                    ]
                });

                if (result && !result.canceled && result.filePath) {
                    fs.writeFileSync(result.filePath, gcode, 'utf8');
                    alert('Файл сохранен: ' + result.filePath);
                }
            } catch (ipcError) {
                console.warn('IPC не работает, используем fallback:', ipcError.message);

                const outputPath = path.join(__dirname, 'ini_examples', filename);

                const outputDir = path.dirname(outputPath);
                if (!fs.existsSync(outputDir)) {
                    fs.mkdirSync(outputDir, {recursive: true});
                }

                fs.writeFileSync(outputPath, gcode, 'utf8');
                alert(`Файл сохранен: ${outputPath}\n\nПримечание: Диалог сохранения недоступен. Перезапустите приложение.`);
            }
        } catch (err) {
            console.error('Ошибка сохранения:', err);
            alert('Ошибка сохранения файла: ' + err.message);
        }
    }

    function saveSettings() {
        try {
            if(!currentSlicer) return;
            const slicer = slicers[currentSlicer];
            if(!slicer.printerName || !slicer.filamentName || !slicer.printName) return;

            let settings = {};

            if (fs.existsSync(settingsPath)) {
                settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            }

            settings.lastSlicer = currentSlicer;
            settings.lastPrinter = slicer.printerName;
            const printerName = slicer.isPhysicalPrinter?slicer.physicalPrinterName+'*'+slicer.printerName:slicer.printerName;
            if(slicer.isPhysicalPrinter) settings.lastPrinter = printerName;

                if (!settings.slicers) settings.slicers = {};
                if (!settings.slicers[currentSlicer]) settings.slicers[currentSlicer] = {};
                if (!settings.slicers[currentSlicer].printers) settings.slicers[currentSlicer].printers = {};

                settings.slicers[currentSlicer].lastPrinter = printerName
                settings.slicers[currentSlicer].printers[printerName] = {
                    filament: slicer.filamentName,
                    print: slicer.printName,
                    paSettings: {
                        startPA: parseFloat(document.getElementById('startPA').value) || 0,
                        endPA: parseFloat(document.getElementById('endPA').value) || 0.1,
                        stepPA: parseFloat(document.getElementById('stepPA').value) || 0.01
                    }
                }

            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
        } catch (e) {
            console.error('Ошибка сохранения настроек:', e);
        }
    }

    async function sendToPrinter() {
        const gcode = document.getElementById('gcodeOutput').value;
        if (!gcode.trim()) {
            alert('Нет G-code для отправки');
            return;
        }
        const slicer = slicers[currentSlicer];

        if (!slicer.print_host) {
            alert('Выберите физический принтер для отправки');
            return;
        }

        try {
            showSendProgress('Подготовка к отправке...', 10);
//            const physicalConfigPath = path.join(currentSlicerPath, 'physical_printer', selectedPrinter.physicalName + '.ini');
            let printerHost = slicer.print_host;

            let hostUrl = printerHost;
            if (printerHost && !printerHost.startsWith('http')) {
                hostUrl = `http://${printerHost}`;
            }

            if (!printerHost || printerHost.trim() === '' || printerHost.includes('0.0.0.1')) {
                hideSendProgress();
                alert(`IP адрес принтера некорректный: "${printerHost}".\n\nПроверьте параметр print_host в настройках физического принтера.`);
                return;
            }

            showSendProgress('Создание файла...', 30);

            const filename = slicer.outputFilename || 'PA_Test.gcode';
            const formData = new FormData();
            const blob = new Blob([gcode], {type: 'text/plain'});
            formData.append('file', blob, filename);

            showSendProgress('Загрузка файла на принтер...', 50);

            const uploadResponse = await fetch(`${hostUrl}/server/files/upload`, {
                method: 'POST',
                body: formData
            });

            if (uploadResponse.ok) {
                showSendProgress('Запуск печати...', 80);

                const startResponse = await fetch(`${hostUrl}/printer/print/start`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({filename: filename})
                });

                if (startResponse.ok) {
                    showSendProgress('Печать запущена!', 100);
                    setTimeout(() => {
                        hideSendProgress();
                        //alert(`Файл отправлен и печать запущена на ${printerHost}`);
                    }, 1000);
                } else {
                    hideSendProgress();
                    alert(`Файл загружен, но не удалось запустить печать`);
                }
            } else {
                throw new Error('Ошибка загрузки файла');
            }
        } catch (error) {
            hideSendProgress();
            alert(`Ошибка отправки: ${error.message}`);
        }
    }

    function showSendProgress(message, progress = 0) {
        let progressDiv = document.getElementById('sendProgress');
        if (!progressDiv) {
            progressDiv = document.createElement('div');
            progressDiv.id = 'sendProgress';
            progressDiv.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        border: 2px solid #007acc;
        border-radius: 8px;
        padding: 20px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 1000;
        min-width: 300px;
        text-align: center;
      `;
            document.body.appendChild(progressDiv);
        }

        progressDiv.innerHTML = `
      <div style="margin-bottom: 15px; font-weight: bold;">${message}</div>
      <div style="background: #f0f0f0; border-radius: 10px; height: 20px; overflow: hidden;">
        <div style="background: #007acc; height: 100%; width: ${progress}%; transition: width 0.3s;"></div>
      </div>
      <div style="margin-top: 10px; font-size: 12px; color: #666;">${progress}%</div>
    `;
    }

    function slicerChanged() {
        clearGeneratedGCode();
        const slicer = slicers[currentSlicer];
        const settings = getSettings();
        let lastPrinter = settings.slicers?.[currentSlicer]?.lastPrinter;
        // settings have printer for this slicer
        slicer.loadPrinters();
        if (lastPrinter) {
            slicer.printerName = lastPrinter;
            slicer.getCompatibleFilaments();
            slicer.getCompatiblePrints();
            const lastFilament = settings.slicers?.[currentSlicer]?.printers?.[lastPrinter]?.filament;
            const lastPrint = settings.slicers?.[currentSlicer]?.printers?.[lastPrinter]?.print;
            if (lastFilament && slicer.filaments.includes(lastFilament)) {
                //пруток в настройках есть и есть в загруженном списке прутков
                slicer.filamentName = lastFilament;
            } else {
                slicer.filamentName = slicer.filaments?.[0]
            }
            if (lastPrint && slicer.prints.includes(lastPrint)) {
                //процесс в настройках есть и есть в загруженном списке прутков
                slicer.printName = lastPrint;
            } else {
                slicer.printName = slicer.prints?.[0]
            }
            const pa = settings.slicers?.[currentSlicer]?.printers?.[lastPrinter]?.paSettings;
            if (pa) {
                if (pa.startPA !== undefined) document.getElementById('startPA').value = pa.startPA;
                if (pa.endPA !== undefined) document.getElementById('endPA').value = pa.endPA;
                if (pa.stepPA !== undefined) document.getElementById('stepPA').value = pa.stepPA;
            }

        } else {
            // not printer for this slicer
            slicer.printerName = slicer.printers?.[0]?.name;
            slicer.getCompatibleFilaments();
            slicer.getCompatiblePrints();
            slicer.filamentName = slicer.filaments?.[0];
            slicer.printName = slicer.prints?.[0];
        }
        calculatePACount();
        updatePrinterSelect();
        updateFilamentSelect();
        updatePrintSelect();
        updateStandardConfigInfo();

    }

    function updateBedVisualization(paValues) {
        const slicer = slicers[currentSlicer];
        if (!slicer.printName || !slicer.printName) return;

        if (!bedVisualizer) {
            const bedContainer = document.getElementById('bedVisualization');
            if (bedContainer) {
                bedVisualizer = new BedVisualizer();
                bedVisualizer.init(bedContainer);
            }
        }

        try {
            const bedShape = slicer.bed?.bedShape;
            if (!bedShape) return;
            const bedWidth = slicer.bed.bedWidth
            const bedHeight = slicer.bed.bedHeight
            const spacing = 5;
            const layout = calculateOptimalLayout(paValues.length, slicer.objectSize.width, slicer.objectSize.height, spacing, bedWidth, bedHeight);
            bedVisualizer.createBed(bedWidth, bedHeight);
            bedVisualizer.updateObjects(bedWidth, bedHeight, paValues, layout, slicer.objectSize.width, slicer.objectSize.height);
        } catch (e) {
            console.error('Ошибка обновления визуализации:', e);
        }
    }

    function updateConfigInfo() {
        const infoDiv = document.getElementById('config-info');
        if (!infoDiv) return;
        const slicer = slicers[currentSlicer];
        if (!slicer.printerName || !slicer.filamentName || !slicer.printName) {
            infoDiv.innerHTML = '<p>Выберите слайсер, принтер, филамент и настройки печати</p>';
            return;
        }

        updateStandardConfigInfo(infoDiv);
        checkGenerateReady();
    }

    function updateFilamentSelect(options, selectedValue) {
        let html = '';
        if (!options) {
            options = slicers[currentSlicer].filaments;
        }
        if (!selectedValue) {
            selectedValue = slicers[currentSlicer].filamentName;
        }
        options.forEach(name => {
            html += `<option value="${name}">${name}</option>`;
        });
        selFilament.innerHTML = html;
        selFilament.value = selectedValue;
        selFilament.disabled = options.length === 0;
        checkGenerateReady();
    }

    function updateFilamentSettings() {
        const slicer = slicers[currentSlicer];
        slicer.getCompatibleFilaments();
        const filaments = slicer.filaments;
        const currentFilament = slicer.filamentName;
        const finalFilament = filaments.includes(currentFilament) ? currentFilament : (filaments[0] || '');
        slicer.filamentName = finalFilament
        updateFilamentSelect(filaments, finalFilament);
    }

    function updatePrinterSelect() {
        let sl = slicers[currentSlicer]
        let options = '';
        sl.printers.forEach(p => {
            options += `<option value="${p.name}">${p.name}</option>`;
        });

        if (sl.physicalPrinters.length > 0) {
            options += '<option disabled>--- Физические принтеры ---</option>';
            sl.physicalPrinters.forEach(p => {
                options += `<option value="${p.name}">${p.name}</option>`;
            });
        }

        selPrinter.innerHTML = options;
        selPrinter.disabled = false;
        selPrinter.value = sl.isPhysicalPrinter?sl.physicalPrinterName+'*'+sl.printerName:sl.printerName;
    }


    function updatePrintSelect(options, selectedValue) {
        let html = '';
        if (!options) {
            options = slicers[currentSlicer].prints;
        }
        if (!selectedValue) {
            selectedValue = slicers[currentSlicer].printName;
        }
        options.forEach(name => {
            html += `<option value="${name}">${name}</option>`;
        });
        selPrint.innerHTML = html;
        selPrint.value = selectedValue;
        selPrint.disabled = options.length === 0;
        checkGenerateReady();
    }

    function updatePrintSettings() {
        const slicer = slicers[currentSlicer];
        slicer.getCompatiblePrints();
        const printSettings = slicer.prints;
        const currentPrint = slicer.printName;
        const finalPrint = printSettings.includes(currentPrint) ? currentPrint : (printSettings[0] || '');
        slicer.printName = finalPrint
        updatePrintSelect(printSettings, finalPrint);
    }

    function updateSendButton() {
        const hasGcode = document.getElementById('gcodeOutput').value.trim();
        const slicer = slicers[currentSlicer];
        document.getElementById('sendBtn').disabled = !hasGcode || !slicer.isPhysicalPrinter;
    }

    function updateStandardConfigInfo(info) {
        if (!info) info = document.getElementById('config-info');
        try {
            const slicer = slicers[currentSlicer];

            const printerConfig = slicer.printerConfig;
            const filamentConfig = slicer.filamentConfig;
            const printConfig = slicer.printConfig;
            if (!printerConfig || !filamentConfig || !printConfig) {
                info.innerHTML = '<p>Выберите принтер, пруток и настройки печати</p>';

                return;
            }
            const bedShape = printerConfig.bed_shape || '';
            let bedSize = 'Неизвестно';
            if (bedShape) {
                const points = bedShape.split(',').map(point => {
                    const [x, y] = point.split('x').map(Number);
                    return {x, y};
                });
                const xs = points.map(p => p.x);
                const ys = points.map(p => p.y);
                const bedWidth = Math.max(...xs) - Math.min(...xs);
                const bedHeight = Math.max(...ys) - Math.min(...ys);
                bedSize = `${bedWidth}×${bedHeight}мм`;
            }

            const maxVolumetricSpeed = filamentConfig.max_volumetric_speed || printConfig.max_volumetric_speed || printerConfig.max_volumetric_speed || '0';
            const volumetricDisplay = maxVolumetricSpeed === '0' ? 'Отключено' : `${maxVolumetricSpeed} мм³/с`;

            let html = `<div class="config-details">`;
            html += `<div><strong>Принтер:</strong> ${slicer.printerName}</div>`;
            html += `<div><strong>Диаметр сопла:</strong> ${printerConfig.nozzle_diameter || 'Неизвестно'}мм</div>`;
            html += `<div><strong>Размер стола:</strong> ${bedSize}</div>`;
            html += `<div><strong>Тип филамента:</strong> ${filamentConfig.filament_type || 'Неизвестно'}</div>`;
            html += `<div><strong>Температура сопла:</strong> ${filamentConfig.temperature || 'Неизвестно'}°C</div>`;
            html += `<div><strong>Температура стола:</strong> ${filamentConfig.bed_temperature || 'Неизвестно'}°C</div>`;
            html += `<div><strong>Высота слоя:</strong> ${printConfig.layer_height || 'Неизвестно'}мм</div>`;
            html += `<div><strong>Коэффициент потока:</strong> ${filamentConfig.extrusion_multiplier}</div>`;
            html += `<div><strong>Объемный расход:</strong> ${volumetricDisplay}</div>`;
            html += `</div>`;
            info.innerHTML = html;
        } catch (e) {
            console.error(e)
            info.innerHTML = '<p>Ошибка загрузки конфигурации</p>';
        }
    }

    function updateVisualizationOrWarnings(issues) {
        const bedContainer = document.getElementById('bedVisualization');

        const existingWarning = bedContainer.parentElement.querySelector('.gcode-warning');
        if (existingWarning) {
            existingWarning.remove();
        }

        if (issues.length > 0) {
            const warningDiv = document.createElement('div');
            warningDiv.className = 'gcode-warning';
            warningDiv.innerHTML = `
        <div style="padding: 15px; background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; margin-bottom: 10px;">
          <h4 style="color: #856404; margin: 0 0 10px 0;">⚠️ Проблемы с G-code</h4>
          <ul style="margin: 0; padding-left: 20px; font-size: 13px;">
            ${issues.map(issue => `<li style="color: #856404; margin: 3px 0;">${issue}</li>`).join('')}
          </ul>
        </div>
      `;
            bedContainer.parentElement.insertBefore(warningDiv, bedContainer);
        }

        document.getElementById('warningGenerate').innerHTML = '';
    }


})
;