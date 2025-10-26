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
    const crossSection = this.calculateExtrusionCrossSection(width, height);
    const maxSpeed = this.getMaxSpeedForCrossSection(crossSection);
    
    if (requestedSpeed > maxSpeed) {
      console.warn(`Скорость ${requestedSpeed.toFixed(1)} мм/с ограничена до ${maxSpeed.toFixed(1)} мм/с по объемному расходу`);
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