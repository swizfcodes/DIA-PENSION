const pool = require('../../config/db');
const { startLog, updateLog } = require('../helpers/logService');

exports.runUpdates = async (year, month, indicator, user, userId) => {
  const logId = await startLog('FileUpdate', 'MasterFileUpdates', year, month, user);
  
  // Get current database from session instead of mapping
  const sessionId = userId.toString();
  const dbName = pool.getCurrentDatabase(sessionId);
  
  if (!dbName) {
    throw new Error('No database context found for user session');
  }
  
  console.log(`Using current database: ${dbName} for user session: ${sessionId}`);
  
  // Get a connection from the pool
  const connection = await pool.getConnection();

  try {
    // Database is already set by pool.getConnection() via session context
    // No need to manually switch - just verify
    const [currentDb] = await connection.query('SELECT DATABASE() as db');
    console.log(`✅ Connected to database: ${currentDb[0].db}`);

    // Rest of your code stays the same...
    console.log(`Setting payroll period: ${year}-${month}...`);
    await connection.query(
      `UPDATE py_stdrate SET mth = ?, ord = ? WHERE type = 'BT05'`,
      [month, year]
    );

    console.log('Running sp_extractrec_optimized...');
    const [extractResult] = await connection.query(
      `CALL sp_extractrec_optimized(?, ?, ?, ?)`, 
      ['NAVY', indicator, 'Yes', user]
    );
    console.log(`Extraction completed`);

    const [wkempCount] = await connection.query(
      `SELECT COUNT(*) as count FROM py_wkemployees`
    );
    console.log(`Working employees: ${wkempCount[0].count}`);

    // Get from py_paysystem table
    const [systemConfig] = await pool.query(`
      SELECT comp_code, salaryscale 
      FROM py_paysystem 
      LIMIT 1
    `);

    const compcode = systemConfig[0]?.comp_code || 'NAVY';
    const salaryscale = systemConfig[0]?.salaryscale || 'Yes';

    console.log(`Running py_update_payrollfiles... Company: ${compcode}, Salary  Scale: ${salaryscale}`);
    const [updateResult] = await connection.query(
      `CALL py_update_payrollfiles(?, ?)`, 
      [compcode, salaryscale]
    );
    console.log(`Master file updates completed`);

    // Check for failures
    const executionStartTime = new Date();
    const [perfLog] = await connection.query(`
      SELECT procedure_name, status, records_processed, execution_time_ms, error_details
      FROM py_performance_log 
      WHERE started_at >= ?
        AND status = 'FAILED'
      ORDER BY started_at DESC
    `, [executionStartTime]);

    if (perfLog.length > 0) {
      console.warn('⚠️  Some procedures reported failures:', perfLog);
      const failureDetails = perfLog.map(p => 
        `${p.procedure_name}: ${p.error_details || 'Unknown error'}`
      ).join('; ');
      throw new Error(`Master file update failed. ${failureDetails}`);
    }

    const [summary] = await connection.query(`
      SELECT 
        COUNT(DISTINCT his_empno) as employees_processed,
        COUNT(*) as total_records,
        COALESCE(SUM(amtthismth), 0) as total_amount
      FROM py_masterpayded
      WHERE amtthismth != 0
    `);

    const summaryMsg = `Master file update completed successfully for ${dbName}. ` +
      `Employees: ${summary[0].employees_processed || 0}, ` +
      `Records: ${summary[0].total_records || 0}, ` +
      `Total Amount: ₦${parseFloat(summary[0].total_amount || 0).toFixed(2)}`;

    await updateLog(logId, 'SUCCESS', summaryMsg);
    
    return {
      status: 'SUCCESS',
      message: summaryMsg,
      data: {
        database: dbName,
        year,
        month,
        employeesProcessed: summary[0].employees_processed || 0,
        totalRecords: summary[0].total_records || 0,
        totalAmount: parseFloat(summary[0].total_amount || 0).toFixed(2)
      }
    };

  } catch (err) {
    console.error('❌ Error in runUpdates:', err);
    await updateLog(logId, 'FAILED', err.message);
    throw err;
  } finally {
    connection.release();
    console.log('Database connection released');
  }
};


