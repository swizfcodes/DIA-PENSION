const pool = require('../../config/db');

class ControlSheetService {

  // ========================================================================
  // PAYROLL CONTROL SHEET REPORT
  // ========================================================================
  async getControlSheet(filters = {}) {
    const { year, month, payrollClass } = filters;
    
    const query = `
      SELECT 
        ts.cyear as year,
        ts.pmonth as month,
        CASE ts.pmonth
          WHEN 1 THEN 'January' WHEN 2 THEN 'February' WHEN 3 THEN 'March'
          WHEN 4 THEN 'April' WHEN 5 THEN 'May' WHEN 6 THEN 'June'
          WHEN 7 THEN 'July' WHEN 8 THEN 'August' WHEN 9 THEN 'September'
          WHEN 10 THEN 'October' WHEN 11 THEN 'November' WHEN 12 THEN 'December'
        END as month_name,
        COUNT(*) as recordcount,
        ts.type1 as payment_type,
        COALESCE(et.elmDesc, ts.desc1) as payment_description,
        CASE 
          WHEN LEFT(ts.type1, 2) IN ('BP', 'BT', 'PT', 'FP') THEN 'DR'
          WHEN LEFT(ts.type1, 2) IN ('PR', 'PL', 'PY') THEN 'CR'
          ELSE 'DR'
        END as dr_cr_indicator,
        CASE 
          WHEN LEFT(ts.type1, 2) IN ('BP', 'BT', 'PT', 'FP') 
          THEN ROUND(SUM(ts.amt1), 2)
          ELSE 0.00
        END as dr_amount,
        CASE 
          WHEN ts.type1 = 'PY01' THEN ROUND(SUM(ts.net), 2)
          WHEN ts.type1 = 'PY02' THEN ROUND(SUM(ts.tax), 2)
          WHEN ts.type1 = 'PY03' THEN ROUND(SUM(ts.roundup), 2)
          WHEN LEFT(ts.type1, 2) IN ('PR', 'PL') THEN ROUND(SUM(ts.amt2), 2)
          ELSE 0.00
        END as cr_amount,
        COALESCE(ts.ledger1, '') as ledger_code,
        CASE 
          WHEN LEFT(ts.type1, 2) IN ('BP', 'BT') THEN 1
          WHEN LEFT(ts.type1, 2) = 'PT' THEN 2
          WHEN LEFT(ts.type1, 2) = 'FP' THEN 3
          WHEN LEFT(ts.type1, 2) = 'PR' THEN 4
          WHEN LEFT(ts.type1, 2) = 'PL' THEN 5
          WHEN LEFT(ts.type1, 2) = 'PY' THEN 6
          ELSE 7
        END as sort_order
      FROM py_tempsumm ts
      LEFT JOIN py_elementType et ON et.PaymentType = ts.type1
      WHERE (ts.amt1 != 0 OR ts.amt2 != 0 OR ts.tax != 0 OR ts.net != 0 OR ts.roundup != 0)
        ${year ? 'AND ts.cyear = ?' : ''}
        ${month ? 'AND ts.pmonth = ?' : ''}
        ${payrollClass ? 'AND ts.loc = ?' : ''}
      GROUP BY ts.cyear, ts.pmonth, ts.type1, ts.desc1, et.elmDesc, ts.ledger1, dr_cr_indicator, sort_order
      ORDER BY sort_order, ts.type1
    `;
    
    const params = [];
    if (year) params.push(year);
    if (month) params.push(month);
    if (payrollClass) params.push(payrollClass);
    
    const [rows] = await pool.query(query, params);
    
    // Calculate totals
    const drTotal = rows.reduce((sum, row) => sum + parseFloat(row.dr_amount || 0), 0);
    const crTotal = rows.reduce((sum, row) => sum + parseFloat(row.cr_amount || 0), 0);
    
    return {
      details: rows,
      totals: {
        dr_total: drTotal,
        cr_total: crTotal,
        balanced: Math.abs(drTotal - crTotal) < 0.01
      }
    };
  }

  // ========================================================================
  // HELPER: Get Current Period
  // ========================================================================
  async getCurrentPeriod() {
    const query = `
      SELECT ord as year, mth as month, pmth as prev_month
      FROM py_stdrate 
      WHERE type = 'BT05'
      LIMIT 1
    `;
    const [rows] = await pool.query(query);
    return rows[0];
  }
}

module.exports = new ControlSheetService();