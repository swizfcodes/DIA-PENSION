const pool = require('../../config/db');

exports.runCalculations = async (year, month, user, userId) => {
  const startTime = Date.now();
  
  try {
    // Get current database from session
    const sessionId = userId.toString();
    const dbName = pool.getCurrentDatabase(sessionId);
    
    if (!dbName) {
      throw new Error('No database context found for user session');
    }
    
    console.log(`Running calculations in database: ${dbName} for user session: ${sessionId}`);
    
    // Get system configuration dynamically from py_paysystem
    const [systemConfig] = await pool.query(`
      SELECT comp_code, mthly_tax 
      FROM py_paysystem 
      LIMIT 1
    `);
    
    const compcode = systemConfig[0]?.comp_code || 'NAVY';
    const mthly_tax = systemConfig[0]?.mthly_tax || 'No';
    
    console.log(`System config - Company: ${compcode}, Monthly Tax: ${mthly_tax}`);
    
    // Run calculation procedure with dynamic parameters
    const procedures = [
      'py_calculate_pay'
    ];
    
    for (const py of procedures) {
      console.log(`Executing ${py}...`);
      await pool.query(`CALL ${py}(?, ?, ?, ?)`, [user, 500, compcode, mthly_tax]);
      console.log(`✅ ${py} completed`);
    }

    // Get reconciliation after calculations
    const reconciliationQuery = `
      SELECT 
          sr.ord as year,
          sr.mth as month,
          
          -- From cumulative (summary) - NET only
          (SELECT ROUND(COALESCE(SUM(his_netmth), 0), 2) 
          FROM py_mastercum WHERE his_type = sr.mth) as total_net_cumulative,
          
          -- ROUNDUP from cumulative
          (SELECT ROUND(COALESCE(SUM(his_roundup), 0), 2) 
          FROM py_mastercum WHERE his_type = sr.mth) as total_roundup,
          
          -- NET + ROUNDUP (actual payout) - FIXED: Handle NULLs properly
          (SELECT ROUND(COALESCE(SUM(COALESCE(his_netmth, 0) + COALESCE(his_roundup, 0)), 0), 2) 
          FROM py_mastercum WHERE his_type = sr.mth) as total_net_with_roundup,
          
          -- From detail breakdown
          (SELECT ROUND(
              COALESCE(SUM(CASE WHEN LEFT(his_type, 2) IN ('BP', 'BT') THEN amtthismth ELSE 0 END), 0) -
              COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PR' THEN amtthismth ELSE 0 END), 0) -
              COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PL' THEN amtthismth ELSE 0 END), 0) +
              COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PT' THEN amtthismth ELSE 0 END), 0), 2)
          FROM py_masterpayded) as total_net_detail,
          
          -- Gross pay
          (SELECT ROUND(COALESCE(SUM(his_grossmth), 0), 2) 
          FROM py_mastercum WHERE his_type = sr.mth) as total_gross,
          
          -- Tax
          (SELECT ROUND(COALESCE(SUM(his_taxmth), 0), 2) 
          FROM py_mastercum WHERE his_type = sr.mth) as total_tax,
          
          -- Deductions
          (SELECT ROUND(COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PR' THEN amtthismth ELSE 0 END), 0), 2)
          FROM py_masterpayded) as total_deductions,
          
          -- Allowances
          (SELECT ROUND(COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PT' THEN amtthismth ELSE 0 END), 0), 2)
          FROM py_masterpayded) as total_allowances,
          
          -- Employee count
          (SELECT COUNT(DISTINCT his_empno) 
          FROM py_mastercum WHERE his_type = sr.mth) as employee_count,
          
          -- Variance - FIXED: Handle NULLs properly
          ROUND(ABS(
              (SELECT COALESCE(SUM(COALESCE(his_netmth, 0) + COALESCE(his_roundup, 0)), 0) 
              FROM py_mastercum WHERE his_type = sr.mth) - 
              (SELECT COALESCE(SUM(CASE WHEN LEFT(his_type, 2) IN ('BP', 'BT') THEN amtthismth ELSE 0 END), 0) -
                      COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PR' THEN amtthismth ELSE 0 END), 0) -
                      COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PL' THEN amtthismth ELSE 0 END), 0) +
                      COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PT' THEN amtthismth ELSE 0 END), 0)
              FROM py_masterpayded)
          ), 2) as variance,
          
          -- Status check - FIXED: Handle NULLs properly
          CASE 
              WHEN ABS(
                  (SELECT COALESCE(SUM(COALESCE(his_netmth, 0) + COALESCE(his_roundup, 0)), 0) 
                  FROM py_mastercum WHERE his_type = sr.mth) - 
                  (SELECT COALESCE(SUM(CASE WHEN LEFT(his_type, 2) IN ('BP', 'BT') THEN amtthismth ELSE 0 END), 0) -
                          COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PR' THEN amtthismth ELSE 0 END), 0) -
                          COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PL' THEN amtthismth ELSE 0 END), 0) +
                          COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PT' THEN amtthismth ELSE 0 END), 0)
                  FROM py_masterpayded)
              ) < 1
              THEN 'BALANCED'
              ELSE 'VARIANCE_DETECTED'
          END as reconciliation_status
      FROM (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
    `;
    
    console.log('Fetching reconciliation data...');
    const [reconciliation] = await pool.query(reconciliationQuery);
    const recon = reconciliation[0] || {};
    
    const executionTime = Math.round((Date.now() - startTime) / 1000);

    console.log(`✅ Calculations completed in ${executionTime}s`);
    console.log(`Employees processed: ${recon.employee_count || 0}`);
    console.log(`Total net: ₦${parseFloat(recon.total_net_cumulative || 0).toLocaleString()}`);
    console.log(`Status: ${recon.reconciliation_status}`);

    return {
      year: recon.year || year,
      month: recon.month || month,
      database: dbName,
      employees_processed: parseInt(recon.employee_count) || 0,
      time_seconds: executionTime,
      system_config: {
        compcode,
        mthly_tax
      },
      reconciliation: {
        total_net_cumulative: parseFloat(recon.total_net_cumulative) || 0,
        total_net_detail: parseFloat(recon.total_net_detail) || 0,
        total_gross: parseFloat(recon.total_gross) || 0,
        total_tax: parseFloat(recon.total_tax) || 0,
        total_deductions: parseFloat(recon.total_deductions) || 0,
        total_allowances: parseFloat(recon.total_allowances) || 0,
        variance: parseFloat(recon.variance) || 0,
        status: recon.reconciliation_status,
        is_balanced: recon.reconciliation_status === 'BALANCED'
      }
    };
  } catch (err) {
    console.error('❌ Payroll calculation service error:', err);
    throw err;
  }
};


