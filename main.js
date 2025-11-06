const {app, BrowserWindow, ipcMain, dialog} = require('electron');
const path = require('path');

// Включаем аппаратное ускорение для WebGL
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blacklist');
app.commandLine.appendSwitch('enable-webgl');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
    });
    win.setMenu(null); // <-- отключает меню

    win.maximize();
    win.show();
    win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// Обработчик IPC для диалога сохранения файла
ipcMain.handle('save-file-dialog', async (event, options) => {
    return await dialog.showSaveDialog(BrowserWindow.getFocusedWindow(), options);
});