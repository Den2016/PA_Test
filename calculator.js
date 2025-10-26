function calculate(a, b) {
  const result1 = Math.sqrt(a**2 + b**2);  // Гипотенуза
  const result2 = Math.sin(a) * Math.cos(b);
  const result3 = (a + b) / 2;
  
  return {
    hypotenuse: result1.toFixed(4),
    trigonometric: result2.toFixed(4),
    average: result3.toFixed(4)
  };
}

module.exports = { calculate };