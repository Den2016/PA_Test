class BedVisualizer {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.bedMesh = null;
        this.objects = [];
        this.animationId = null;
    }

    init(container) {
        try {
            const width = container.clientWidth;
            const height = container.clientHeight;

            // Проверяем поддержку WebGL
            if (!this.isWebGLSupported()) {
                console.log('WebGL недоступен, используем 2D Canvas');
                this.create2DFallback(container);
                return;
            }

            // Пробуем Babylon.js
            try {
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.style.width = '100%';
                canvas.style.height = '100%';
                container.appendChild(canvas);

                this.engine = new BABYLON.Engine(canvas, true, {preserveDrawingBuffer: true, stencil: true});
                this.scene = new BABYLON.Scene(this.engine);

                // Камера
                this.camera = new BABYLON.ArcRotateCamera('camera', -Math.PI / 2, Math.PI / 2.5, 200, BABYLON.Vector3.Zero(), this.scene);
                this.camera.setTarget(BABYLON.Vector3.Zero());
                this.camera.attachControls(canvas);

                // Освещение
                const light = new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0, 1, 0), this.scene);
                light.intensity = 0.7;

                console.log('Babylon.js успешно инициализирован');
                this.is3D = true;
            } catch (e) {
                console.log('Переход на 2D Canvas из-за ошибки WebGL');
                this.create2DFallback(container);
                return;
            }

            // Запуск рендеринга
            this.engine.runRenderLoop(() => {
                this.scene.render();
            });

            // Обработка изменения размера
            window.addEventListener('resize', () => {
                this.engine.resize();
            });
        } catch (e) {
            console.error('Ошибка инициализации 3D:', e);
            this.create2DFallback(container);
        }
    }

    isWebGLSupported() {
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (!gl) return false;

            // Проверяем базовые возможности WebGL
            const hasRequiredExtensions = gl.getExtension('OES_element_index_uint') !== null;
            return hasRequiredExtensions;
        } catch (e) {
            return false;
        }
    }

    create2DFallback(container) {
        this.switchTo2D(container);
    }

    switchTo2D(container) {
        // Очищаем контейнер
        container.innerHTML = '';

        // Останавливаем 3D анимацию
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        container.appendChild(canvas);

        this.canvas2D = canvas;
        this.ctx2D = ctx;
        this.is2D = true;

        // Начальная отрисовка
        this.draw2D();
    }

    draw2D() {
        if (!this.is2D || !this.ctx2D) return;

        const ctx = this.ctx2D;
        const canvas = this.canvas2D;

        // Очищаем канвас
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (!this.bedData) return;

        const {bedWidth, bedHeight, objects = []} = this.bedData;
        if (!bedWidth || !bedHeight) return;

        const scale = Math.min(canvas.width / (bedWidth + 40), canvas.height / (bedHeight + 40));
        const offsetX = (canvas.width - bedWidth * scale) / 2;
        const offsetY = (canvas.height - bedHeight * scale) / 2;

        // Рисуем стол
        ctx.fillStyle = '#888888';
        ctx.fillRect(offsetX, offsetY, bedWidth * scale, bedHeight * scale);

        // Сетка
        ctx.strokeStyle = '#666666';
        ctx.lineWidth = 1;
        const gridSize = 20 * scale;
        for (let x = offsetX; x <= offsetX + bedWidth * scale; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, offsetY);
            ctx.lineTo(x, offsetY + bedHeight * scale);
            ctx.stroke();
        }
        for (let y = offsetY; y <= offsetY + bedHeight * scale; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(offsetX, y);
            ctx.lineTo(offsetX + bedWidth * scale, y);
            ctx.stroke();
        }

        // Рисуем объекты
        if (objects.length > 0) {
            objects.forEach((obj, i) => {
                const x = offsetX + obj.x * scale;
                const y = offsetY + obj.y * scale;
                const w = obj.width * scale;
                const h = obj.height * scale;

                // Цвет объекта
                const hue = (i / objects.length) * 240;
                ctx.fillStyle = `hsl(${hue}, 70%, 60%)`;
                ctx.fillRect(x, y, w, h);

                // Обводка
                ctx.strokeStyle = '#333';
                ctx.lineWidth = 2;
                ctx.strokeRect(x, y, w, h);

                // Текст
                ctx.fillStyle = '#000';
                ctx.font = `${Math.max(10, w / 8)}px Arial`;
                ctx.textAlign = 'center';
                ctx.fillText(`PA: ${obj.pa}`, x + w / 2, y + h / 2 + 4);
            });
        }
    }

    createBed(width, height) {
        if (this.is2D) {
            if (!this.bedData) this.bedData = {objects: []};
            this.bedData.bedWidth = width;
            this.bedData.bedHeight = height;
            if (!this.bedData.objects) this.bedData.objects = [];
            this.draw2D();
            return;
        }

        if (this.is3D && this.scene) {
            // Удаляем старый стол
            if (this.bedMesh) {
                this.bedMesh.dispose();
            }

            // Создаем новый стол
            this.bedMesh = BABYLON.MeshBuilder.CreateBox('bed', {width: width, height: 2, depth: height}, this.scene);
            this.bedMesh.position.y = -1;
            this.bedMesh.position.x = width / 2;
            this.bedMesh.position.z = height / 2;

            const bedMaterial = new BABYLON.StandardMaterial('bedMaterial', this.scene);
            bedMaterial.diffuseColor = new BABYLON.Color3(0.5, 0.5, 0.5);
            this.bedMesh.material = bedMaterial;
        }
    }

    updateObjects(bedWidth, bedHeight, paValues, layout, objectWidth, objectHeight) {
        if (this.is2D) {
            const objects = [];
            if (layout && paValues.length) {
                for (let i = 0; i < paValues.length; i++) {
                    const row = Math.floor(i / layout.cols);
                    const col = i % layout.cols;
                    const x = layout.startX + col * (objectWidth + 5);
                    const y = layout.startY + row * (objectHeight + 5);

                    objects.push({
                        x, y,
                        width: objectWidth,
                        height: objectHeight,
                        pa: paValues[i]
                    });
                }
            }

            this.bedData = {bedWidth, bedHeight, objects};
            this.draw2D();
            return;
        }

        if (this.is3D && this.scene) {
            // Удаляем старые объекты
            this.objects.forEach(obj => obj.dispose());
            this.objects = [];

            if (!layout || !paValues.length) return;

            for (let i = 0; i < paValues.length; i++) {
                const row = Math.floor(i / layout.cols);
                const col = i % layout.cols;
                const x = layout.startX + col * (objectWidth + 5) + objectWidth / 2;
                const z = layout.startY + row * (objectHeight + 5) + objectHeight / 2;

                // Объект
                const objectMesh = BABYLON.MeshBuilder.CreateBox(`object${i}`, {
                    width: objectWidth,
                    height: 5,
                    depth: objectHeight
                }, this.scene);
                objectMesh.position.x = x;
                objectMesh.position.y = 2.5;
                objectMesh.position.z = z;

                const hue = (i / paValues.length) * 0.7;
                const objectMaterial = new BABYLON.StandardMaterial(`objectMaterial${i}`, this.scene);
                objectMaterial.diffuseColor = BABYLON.Color3.FromHSV(hue * 360, 0.7, 0.8);
                objectMesh.material = objectMaterial;

                this.objects.push(objectMesh);
            }
        }
    }

    destroy() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        if (this.renderer) {
            this.renderer.dispose();
        }
    }
}

module.exports = BedVisualizer;