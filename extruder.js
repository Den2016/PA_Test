class Extruder {
  constructor(filamentDiameter = 1.75, extrusionMultiplier = 1.0, maxVolumetricFlow = 15.0) {
    this.filamentDiameter = filamentDiameter;
    this.extrusionMultiplier = extrusionMultiplier;
    this.maxVolumetricFlow = maxVolumetricFlow; // мм³/с - максимальный объемный расход
    this.currentE = 0.0;
    this.isRetracted = false;
    this.retractLength = 0.0;
    this.retractSpeed = 40.0;
    this.retractBeforeTravel = 2.0;
    this.useFirmwareRetraction = false;
    
    // Площадь поперечного сечения филамента
    this.filamentArea = Math.PI * Math.pow(filamentDiameter / 2, 2);
    
    // Параметры слоя и ширин экструзии
    this.nozzleDiameter = 0.4;
    this.layerHeight = 0.2;
    this.firstLayerHeight = 0.3;
    this.isFirstLayer = false;
    
    // Ширины экструзии
    this.extrusionWidth = 0;
    this.perimeterExtrusionWidth = 0;
    this.externalPerimeterExtrusionWidth = 0;
    this.infillExtrusionWidth = 0;
    this.firstLayerExtrusionWidth = 0;
  }

  initializeWidths(configs, nozzleDiameter, layerHeight, firstLayerHeight) {
    this.nozzleDiameter = nozzleDiameter;
    this.layerHeight = layerHeight;
    this.firstLayerHeight = firstLayerHeight;
    
    // Базовая ширина экструзии
    this.extrusionWidth = this.calculateExtrusionWidth(
      configs.extrusion_width, 
      nozzleDiameter, 
      layerHeight, 
      nozzleDiameter * 1.125
    );
    
    // Специфичные ширины
    this.perimeterExtrusionWidth = this.calculateExtrusionWidth(
      configs.perimeter_extrusion_width,
      nozzleDiameter,
      layerHeight,
      this.extrusionWidth
    );
    
    this.externalPerimeterExtrusionWidth = this.calculateExtrusionWidth(
      configs.external_perimeter_extrusion_width,
      nozzleDiameter,
      layerHeight,
      this.extrusionWidth
    );
    
    this.infillExtrusionWidth = this.calculateExtrusionWidth(
      configs.infill_extrusion_width,
      nozzleDiameter,
      layerHeight,
      this.extrusionWidth
    );
    
    this.firstLayerExtrusionWidth = this.calculateExtrusionWidth(
      configs.first_layer_extrusion_width,
      nozzleDiameter,
      firstLayerHeight,
      this.extrusionWidth
    );
  }

  calculateExtrusionWidth(configValue, nozzleDiameter, layerHeight, defaultValue) {
    // Получаем значение из конфига (может быть массивом)
    let value = configValue;
    if (Array.isArray(value)) {
      value = value[0];
    }
    
    // Если не задано или равно 0 - используем значение по умолчанию
    if (!value || value === '0' || value === '') {
      return defaultValue;
    }
    
    // Если в процентах - рассчитываем от высоты слоя
    if (typeof value === 'string' && value.endsWith('%')) {
      const percentage = parseFloat(value) / 100;
      return layerHeight * percentage;
    }
    
    // Иначе используем числовое значение
    return parseFloat(value);
  }

  setLayer(isFirstLayer) {
    this.isFirstLayer = isFirstLayer;
  }

  getExtrusionWidth(type) {
    // Если первый слой и задана специальная ширина - используем её для всех типов
    if (this.isFirstLayer && this.firstLayerExtrusionWidth !== this.extrusionWidth) {
      return this.firstLayerExtrusionWidth;
    }
    
    // Иначе используем специфичную ширину для типа
    switch (type) {
      case 'external_perimeter':
        return this.externalPerimeterExtrusionWidth;
      case 'perimeter':
        return this.perimeterExtrusionWidth;
      case 'infill':
        return this.infillExtrusionWidth;
      default:
        return this.extrusionWidth;
    }
  }

  setRetractSettings(length, speed, beforeTravel, useFirmware = false) {
    this.retractLength = length;
    this.retractSpeed = speed;
    this.retractBeforeTravel = beforeTravel;
    this.useFirmwareRetraction = useFirmware;
  }

  /**
   * Рассчитывает площадь поперечного сечения экструзии (сплющенный эллипс)
   * @param {number} width - ширина экструзии (мм)
   * @param {number} height - высота слоя (мм)
   * @returns {number} площадь сечения (мм²)
   */
  calculateExtrusionCrossSection(width, height) {
    if (height >= width) {
      // Если высота больше ширины, используем круглое сечение
      return Math.PI * Math.pow(height / 2, 2);
    }
    
    // Формула для сплющенного эллипса: height*(width-height) + π*(height/2)²
    const rectangularPart = height * (width - height);
    const circularPart = Math.PI * Math.pow(height / 2, 2);
    
    return rectangularPart + circularPart;
  }

  /**
   * Рассчитывает максимально допустимую скорость для данного сечения
   * @param {number} extrusionCrossSection - площадь сечения экструзии (мм²)
   * @returns {number} максимальная скорость (мм/с)
   */
  getMaxSpeedForCrossSection(extrusionCrossSection) {
    if (extrusionCrossSection <= 0) return 0;
    return this.maxVolumetricFlow / extrusionCrossSection;
  }

  /**
   * Ограничивает скорость по объемному расходу
   * @param {number} requestedSpeed - запрашиваемая скорость (мм/с)
   * @param {number} width - ширина экструзии (мм)
   * @param {number} height - высота слоя (мм)
   * @returns {number} ограниченная скорость (мм/с)
   */
  limitSpeedByVolumetricFlow(requestedSpeed, width, height) {
    // Если ограничение объемного расхода равно нулю - не контролируем
    if (this.maxVolumetricFlow <= 0) {
      return requestedSpeed;
    }
    
    const crossSection = this.calculateExtrusionCrossSection(width, height);
    const maxSpeed = this.getMaxSpeedForCrossSection(crossSection);
    
    if (requestedSpeed > maxSpeed) {
      //console.warn(`Скорость ${requestedSpeed.toFixed(1)} мм/с ограничена до ${maxSpeed.toFixed(1)} мм/с по объемному расходу`);
      return maxSpeed;
    }
    
    return requestedSpeed;
  }

  calculateExtrusion(extrusionLength, extrusionWidth, layerHeight) {
    // Рассчитываем площадь сечения экструзии по новой формуле
    const extrusionCrossSection = this.calculateExtrusionCrossSection(extrusionWidth, layerHeight);
    
    // Объем экструзии
    const extrusionVolume = extrusionCrossSection * extrusionLength;
    
    // Длина филамента = объем экструзии / площадь филамента * множитель
    return (extrusionVolume / this.filamentArea) * this.extrusionMultiplier;
  }

  calcExtrusionOnLengthByCoords(x1, y1, x2, y2, width, height) {
    const length = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    return this.calculateExtrusion(length, width, height);
  }

  extrude(length, width, height) {
    const extrusionAmount = this.calculateExtrusion(length, width, height);
    this.currentE += extrusionAmount;
    this.isRetracted = false;
    return this.currentE;
  }

  retract() {
    if (this.isRetracted || this.retractLength <= 0) {
      return null;
    }
    
    this.isRetracted = true;
    
    if (this.useFirmwareRetraction) {
      return 'G10';
    } else {
      this.currentE -= this.retractLength;
      return `G1 E${this.currentE.toFixed(5)} F${this.retractSpeed * 60}`;
    }
  }

  unretract() {
    if (!this.isRetracted) {
      return null;
    }
    
    this.isRetracted = false;
    
    if (this.useFirmwareRetraction) {
      return 'G11';
    } else {
      this.currentE += this.retractLength;
      return `G1 E${this.currentE.toFixed(5)} F${this.retractSpeed * 60}`;
    }
  }

  shouldRetract(travelDistance) {
    return !this.isRetracted && 
           this.retractLength > 0 && 
           travelDistance >= this.retractBeforeTravel;
  }

  reset() {
    this.currentE = 0.0;
    this.isRetracted = false;
  }

  setPosition(e) {
    this.currentE = e;
    this.isRetracted = false;
  }

  getCurrentE() {
    return this.currentE;
  }

  isCurrentlyRetracted() {
    return this.isRetracted;
  }

  /**
   * Вспомогательный метод для получения информации о расчете
   * @param {number} width - ширина экструзии (мм)
   * @param {number} height - высота слоя (мм)
   * @param {number} speed - скорость (мм/с)
   * @returns {Object} объект с информацией о расчете
   */
  getExtrusionInfo(width, height, speed) {
    const crossSection = this.calculateExtrusionCrossSection(width, height);
    const volumetricFlow = crossSection * speed;
    const maxSpeed = this.getMaxSpeedForCrossSection(crossSection);
    
    return {
      crossSection: crossSection.toFixed(4),
      volumetricFlow: volumetricFlow.toFixed(2),
      maxSpeed: maxSpeed.toFixed(1),
      isFlowValid: volumetricFlow <= this.maxVolumetricFlow
    };
  }
}

module.exports = Extruder;