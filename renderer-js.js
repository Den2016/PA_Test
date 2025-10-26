const { calculate } = require('./calculator.js');

function runCalculation() {
  const resultDiv = document.getElementById('result');
  resultDiv.innerHTML = 'Выполняется расчет...';

  try {
    const result = calculate(10, 20);
    
    resultDiv.innerHTML = `
      Гипотенуза: ${result.hypotenuse}<br>
      sin(a)*cos(b): ${result.trigonometric}<br>
      Среднее: ${result.average}
    `;
  } catch (error) {
    resultDiv.innerHTML = `Ошибка: ${error.message}`;
  }
}