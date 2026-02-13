const pool = require('../../config/db');
const payrollCalculationService = require('../../services/payroll-calculations/payrollCalculation');

exports.calculatePayroll = async (req, res) => {
  try {
    const [bt05Rows] = await pool.query("SELECT ord AS year, mth AS month, sun FROM py_stdrate WHERE type='BT05' LIMIT 1");
    if (!bt05Rows.length) return res.status(404).json({ error: 'BT05 not found' });
    const { year, month, sun } = bt05Rows[0];

    if (sun < 888) return res.status(400).json({ error: 'Master File Updated must be completed first.' });
    if (sun >= 999) return res.status(400).json({ error: 'Calculations already completed.' });

    const user = req.user_fullname || 'System Auto';
    const userId = req.user_id;
    const result = await payrollCalculationService.runCalculations(year, month, user, userId);

    await pool.query("UPDATE py_stdrate SET sun = 999, createdby = ? WHERE type = 'BT05'", [user]);

    res.json({ status: 'SUCCESS', stage: 999, 
               progress: 'Payroll calculations completed',
               message: 'Payroll calculations have been successfully computed.',
               nextStage: 'Month-End', 
               result });
  } catch (err) {
    console.error('Payroll calculation error:', err);
    res.status(500).json({ status: 'FAILED', message: err.message });
  }
};


// Callback to get calculation results

exports.getCalculationResults = async (req, res) => {
  try {
    const [bt05Rows] = await pool.query("SELECT ord AS year, mth AS month, sun FROM py_stdrate WHERE type='BT05' LIMIT 1");
    if (!bt05Rows.length) return res.status(404).json({ success: false, error: 'BT05 not found' });
    const { year, month, sun } = bt05Rows[0];

    if (sun < 999) {
      return res.status(400).json({ 
        success: false, 
        error: 'Calculations not yet completed' 
      });
    }

    // Fetch reconciliation data
    const reconciliationQuery = `
      SELECT 
          sr.ord as year,
          sr.mth as month,
          (SELECT ROUND(COALESCE(SUM(his_netmth), 0), 2) 
          FROM py_mastercum WHERE his_type = sr.mth) as total_net_cumulative,
          (SELECT ROUND(
              COALESCE(SUM(CASE WHEN LEFT(his_type, 2) IN ('BP', 'BT') THEN amtthismth ELSE 0 END), 0) -
              COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PR' THEN amtthismth ELSE 0 END), 0) -
              COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PL' THEN amtthismth ELSE 0 END), 0) +
              COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PT' THEN amtthismth ELSE 0 END), 0), 2)
          FROM py_masterpayded) as total_net_detail,
          (SELECT ROUND(COALESCE(SUM(his_grossmth), 0), 2) 
          FROM py_mastercum WHERE his_type = sr.mth) as total_gross,
          (SELECT ROUND(COALESCE(SUM(his_taxmth), 0), 2) 
          FROM py_mastercum WHERE his_type = sr.mth) as total_tax,
          (SELECT ROUND(COALESCE(SUM(CASE WHEN LEFT(his_type, 2) IN ('PR', 'PL') THEN amtthismth ELSE 0 END), 0), 2)
          FROM py_masterpayded) as total_deductions,
          (SELECT ROUND(COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PT' THEN amtthismth ELSE 0 END), 0), 2)
          FROM py_masterpayded) as total_allowances,
          (SELECT COUNT(DISTINCT Empl_ID) 
            FROM py_wkemployees) as employee_count,
          ABS((SELECT COALESCE(SUM(his_netmth), 0) FROM py_mastercum WHERE his_type = sr.mth) - 
              (SELECT COALESCE(SUM(CASE WHEN LEFT(his_type, 2) IN ('BP', 'BT') THEN amtthismth ELSE 0 END), 0) -
                      COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PR' THEN amtthismth ELSE 0 END), 0) -
                      COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PL' THEN amtthismth ELSE 0 END), 0) +
                      COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PT' THEN amtthismth ELSE 0 END), 0)
              FROM py_masterpayded)) as variance,
          CASE 
              WHEN ABS((SELECT COALESCE(SUM(his_netmth), 0) FROM py_mastercum WHERE his_type = sr.mth) - 
                      (SELECT COALESCE(SUM(CASE WHEN LEFT(his_type, 2) IN ('BP', 'BT') THEN amtthismth ELSE 0 END), 0) -
                              COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PR' THEN amtthismth ELSE 0 END), 0) -
                              COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PL' THEN amtthismth ELSE 0 END), 0) +
                              COALESCE(SUM(CASE WHEN LEFT(his_type, 2) = 'PT' THEN amtthismth ELSE 0 END), 0)
                        FROM py_masterpayded)) < 1
              THEN 'BALANCED'
              ELSE 'VARIANCE_DETECTED'
          END as reconciliation_status
      FROM (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
    `;
    
    const [reconciliation] = await pool.query(reconciliationQuery);
    const recon = reconciliation[0] || {};

    res.json({
      success: true,
      data: {
        year: recon.year || year,
        month: recon.month || month,
        employees_processed: parseInt(recon.employee_count) || 0,
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
      }
    });
  } catch (err) {
    console.error('Error fetching calculation results:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch calculation results',
      error: err.message
    });
  }
};


