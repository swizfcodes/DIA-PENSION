// dbMapper.js
module.exports = function getDatabaseForIndicator(indicator) {
  switch (String(indicator)) {
    case '1': return process.env.DB_OFFICERS;
    case '2': return process.env.DB_WOFFICERS;
    case '3': return process.env.DB_RATINGS;
    case '4': return process.env.DB_RATINGS_A;
    case '5': return process.env.DB_RATINGS_B;
    case '6': return process.env.DB_JUNIOR_TRAINEE;
    default: throw new Error(`Unknown payroll indicator: ${indicator}`);
  }
};



