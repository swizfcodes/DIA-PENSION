const pool = require('../../config/db');
const { startLog, updateLog } = require('../helpers/logService');

exports.getInputVariables = async (year, month, user) => {
  const logId = await startLog('FileUpdate', 'InputVariables', year, month, user);
  try {
    // Use the simplified view
    const [rows] = await pool.query(`
      SELECT 
        Empl_id,
        full_name,
        Location,
        pay_type,
        element_name,
        function_type_desc,
        function_type_code,
        pay_indicator_desc,
        pay_indicator_code,
        element_category,
        mak1,
        amtp,
        mak2,
        amt,
        amtad,
        amttd,
        nomth,
        created_at
      FROM vw_input_variables
      ORDER BY 
        full_name,
        pay_type
    `);

    await updateLog(logId, 'SUCCESS', `Retrieved ${rows.length} input variable records.`);
    
    // Return summary statistics
    const summary = {
      totalRecords: rows.length,
      byElementType: {
        required: rows.filter(r => r.element_category === 'REQUIRED_FOR_ALL').length,
        notRequired: rows.filter(r => r.element_category === 'NOT_REQUIRED_FOR_ALL').length,
        allowances: rows.filter(r => r.element_category === 'ALLOWANCE').length,
        deductions: rows.filter(r => r.element_category === 'DEDUCTION').length,
        other: rows.filter(r => r.element_category === 'OTHER').length
      },
      byFunctionType: {
        loans: rows.filter(r => r.function_type_code === 'L').length,
        permanent: rows.filter(r => r.function_type_code === 'P').length,
        temporary: rows.filter(r => r.function_type_code === 'T').length,
        hourly: rows.filter(r => r.function_type_code === 'H').length,
        freePay: rows.filter(r => r.function_type_code === 'F').length,
        independent: rows.filter(r => r.function_type_code === 'X').length
      },
      byPayIndicator: rows.reduce((acc, r) => {
        const indicator = r.pay_indicator_desc || 'NO_INDICATOR';
        acc[indicator] = (acc[indicator] || 0) + 1;
        return acc;
      }, {}),
      financialTotals: {
        totalAmt: rows.reduce((sum, r) => sum + (r.amt || 0), 0),
        totalAmtp: rows.reduce((sum, r) => sum + (r.amtp || 0), 0),
        totalAmttd: rows.reduce((sum, r) => sum + (r.amttd || 0), 0),
        totalAllowances: rows
          .filter(r => r.amtad === 'Add')
          .reduce((sum, r) => sum + (r.amt || 0), 0),
        totalDeductions: rows
          .filter(r => r.amtad === 'Deduct')
          .reduce((sum, r) => sum + (r.amt || 0), 0)
      },
      topAmounts: {
        highestAmounts: rows
          .sort((a, b) => (b.amt || 0) - (a.amt || 0))
          .slice(0, 10)
          .map(r => ({
            Empl_id: r.Empl_id,
            full_name: r.full_name,
            element_name: r.element_name,
            amt: r.amt,
            amtad: r.amtad
          })),
        lowestAmounts: rows
          .filter(r => (r.amt || 0) > 0)
          .sort((a, b) => (a.amt || 0) - (b.amt || 0))
          .slice(0, 10)
          .map(r => ({
            Empl_id: r.Empl_id,
            full_name: r.full_name,
            element_name: r.element_name,
            amt: r.amt,
            amtad: r.amtad
          }))
      }
    };

    return { 
      summary, records: rows,
      message: 'Input Variables loaded successfully'
    };
  } catch (err) {
    await updateLog(logId, 'FAILED', err.message);
    throw err;
  }
};

// Optional: Get filtered records by element category
exports.getInputVariablesByCategory = async (category, year, month, user) => {
  const logId = await startLog('FileUpdate', `InputVariables_${category}`, year, month, user);
  try {
    const [rows] = await pool.query(`
      SELECT * FROM vw_input_variables
      WHERE element_category = ?
      ORDER BY full_name, pay_type
    `, [category]);

    await updateLog(logId, 'SUCCESS', `Found ${rows.length} ${category} records.`);
    return { totalRecords: rows.length, records: rows };
  } catch (err) {
    await updateLog(logId, 'FAILED', err.message);
    throw err;
  }
};

// Optional: Get records by payment indicator (e.g., LOAN)
exports.getInputVariablesByIndicator = async (indicator, year, month, user) => {
  const logId = await startLog('FileUpdate', `InputVariables_${indicator}`, year, month, user);
  try {
    const [rows] = await pool.query(`
      SELECT * FROM vw_input_variables
      WHERE pay_indicator_code = ?
      ORDER BY full_name
    `, [indicator]);

    await updateLog(logId, 'SUCCESS', `Found ${rows.length} ${indicator} records.`);
    return { totalRecords: rows.length, records: rows };
  } catch (err) {
    await updateLog(logId, 'FAILED', err.message);
    throw err;
  }
};


