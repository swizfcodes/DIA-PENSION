// routes/monthend.js
const express = require('express');
const router = express.Router();
const pool = require('../../config/db');
const verifyToken = require('../../middware/authentication');

// ==================== GET CURRENT PAYROLL PERIOD & STATUS ====================
router.get('/payroll-period', verifyToken, async (req, res) => {
  try {
    const currentDb = req.current_class;
    
    if (!currentDb) {
      return res.status(400).json({ 
        success: false, 
        error: 'No active payroll class' 
      });
    }
    
    const [rows] = await pool.query(
      `SELECT ord AS year, mth AS month, pmth AS prev_month, sun AS status 
       FROM ${currentDb}.py_stdrate 
       WHERE type = 'BT05' 
       LIMIT 1`
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Payroll period not found. Please initialize BT05 in py_stdrate.' 
      });
    }
    
    const period = rows[0];
    
    // Determine if month-end can be processed
    const canProcessMonthEnd = period.status === 999;
    const statusMessage = getStatusMessage(period.status);
    
    res.json({
      success: true,
      year: period.year,
      month: period.month,
      prevMonth: period.prev_month,
      status: period.status,
      statusMessage: statusMessage,
      canProcessMonthEnd: canProcessMonthEnd,
      blockReason: canProcessMonthEnd ? null : `Month-end can only be processed when status is 999 (Calculation Completed). Current status: ${period.status} - ${statusMessage}`
    });
    
  } catch (error) {
    console.error('Error fetching payroll period:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch payroll period',
      message: error.message 
    });
  }
});

// Helper function for status messages
function getStatusMessage(status) {
  const statusMap = {
    0: 'Data Entry Open',
    666: 'Data Entry Closed',
    775: 'First Report Generated',
    777: 'Two Reports Generated',
    888: 'Update Completed',
    999: 'Calculation Completed - Ready for Month-End'
  };
  return statusMap[status] || `Unknown Status (${status})`;
}

// ==================== MONTH END PROCESSING ====================
router.post('/process-monthend', verifyToken, async (req, res) => {
  const currentDb = req.current_class;
  const userId = req.user_id;
  const userFullname = req.user_fullname || 'System';
  
  let connection = null;
  
  try {
    // Step 1: Get current period and validate status
    const [periodRows] = await pool.query(
      `SELECT ord AS year, mth AS month, pmth AS prev_month, sun AS status 
       FROM ${currentDb}.py_stdrate 
       WHERE type = 'BT05' 
       LIMIT 1`
    );
    
    if (periodRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Payroll period not found. Please initialize BT05 in py_stdrate.'
      });
    }
    
    const currentPeriod = periodRows[0];
    
    // Validate status is 999 (Calculation Completed)
    if (currentPeriod.status !== 999) {
      return res.status(400).json({
        success: false,
        error: 'Month-end processing blocked',
        message: `Month-end can only be processed when status is 999 (Calculation Completed). Current status: ${currentPeriod.status} - ${getStatusMessage(currentPeriod.status)}`,
        currentStatus: currentPeriod.status,
        requiredStatus: 999
      });
    }
    
    // Step 2: Check if already processed for this period
    const [existingProcess] = await pool.query(
      `SELECT COUNT(*) as count FROM ${currentDb}.py_monthend
       WHERE process_year = ? AND process_month = ?`,
      [currentPeriod.year, currentPeriod.month]
    );
    
    if (existingProcess[0].count > 0) {
      return res.status(400).json({
        success: false,
        error: `Month-end for ${getMonthName(currentPeriod.month)} ${currentPeriod.year} has already been processed`,
        details: {
          message: 'Data already exists in py_monthend for this period'
        }
      });
    }
    
    console.log(`🔄 Starting month-end processing: ${currentPeriod.year}-${currentPeriod.month}`);
    console.log(`   Database: ${currentDb}`);
    console.log(`   User: ${userFullname} (${userId})`);
    console.log(`   Current Status: ${currentPeriod.status} - ${getStatusMessage(currentPeriod.status)}`);
    
    // Step 3: Get database connection and switch to current database
    connection = await pool.getConnection();
    await connection.query(`USE \`${currentDb}\``);
    
    // Step 4: Start transaction
    await connection.beginTransaction();
    
    try {
      // Step 5: Call the month-end stored procedure (handles transfer and clearing)
      console.log('📊 Calling py_py37Monthend stored procedure...');
      await connection.query(
        `CALL py_py37Monthend(?, ?, ?)`,
        [currentPeriod.month, currentPeriod.year, userId]
      );
      
      console.log('✅ Stored procedure completed successfully');
      
      // Step 6: Get processing statistics from py_performance_logs
      const [extractRecLog] = await connection.query(
        `SELECT records_processed
          FROM py_performance_log
          WHERE procedure_name IN (
                  'sp_extractrec_optimized',
                  'sp_calculate_01_complete_optimized'
                )
            AND process_year = ?
            AND process_month = ?
            AND status = 'SUCCESS'
          ORDER BY
            (procedure_name = 'sp_extractrec_optimized') DESC,
            completed_at DESC
          LIMIT 1;
`,
        [currentPeriod.year, currentPeriod.month]
      );
      
      const [monthendLog] = await connection.query(
        `SELECT records_processed, execution_time_ms
         FROM py_performance_log 
         WHERE procedure_name = 'py_py37Monthend'
           AND process_year = ? 
           AND process_month = ?
           AND status = 'SUCCESS'
         ORDER BY completed_at DESC 
         LIMIT 1`,
        [currentPeriod.year, currentPeriod.month]
      );
      
      const employeesProcessed = extractRecLog.length > 0 ? extractRecLog[0].records_processed : 0;
      const recordsProcessed = monthendLog.length > 0 ? monthendLog[0].records_processed : 0;
      const executionTime = monthendLog.length > 0 ? monthendLog[0].execution_time_ms : 0;
      
      console.log(`📊 Statistics: Employees=${employeesProcessed}, Records=${recordsProcessed}`);
      
      // Step 7: Insert into py_monthend table
      await connection.query(
        `INSERT INTO py_monthend 
         (employees_processed, records_processed, process_year, process_month, datecreated, createdby)
         VALUES (?, ?, ?, ?, NOW(), ?)`,
        [employeesProcessed, recordsProcessed, currentPeriod.year, currentPeriod.month, userFullname]
      );
      
      console.log('✅ Month-end record inserted into py_monthend');
      
      // Step 8: Calculate next month and year
      let nextMonth = currentPeriod.month + 1;
      let nextYear = currentPeriod.year;
      
      if (nextMonth > 12) {
        nextMonth = 12;
        nextYear = currentPeriod.year;
      }
      
      console.log(`📅 Moving period: ${currentPeriod.month}/${currentPeriod.year} → ${nextMonth}/${nextYear}`);
      
      // Step 9: Update BT05 status - advance to next period and reset status to 0
      const [updateResult] = await connection.query(
        `UPDATE py_stdrate 
         SET mth = ?, 
             pmth = ?, 
             ord = ?,
             sun = 0, 
             createdby = ?
         WHERE type = 'BT05'`,
        [nextMonth, currentPeriod.month, nextYear, userFullname]
      );
      
      if (updateResult.affectedRows === 0) {
        throw new Error('Failed to update BT05 status');
      }
      
      console.log('✅ BT05 status updated: sun=0 (Data Entry Open), period advanced');
      
      // Step 10: Commit transaction
      await connection.commit();
      
      console.log('✅ Month-end processing completed successfully');
      
      res.json({
        success: true,
        message: `Month-end processed successfully for ${getMonthName(currentPeriod.month)} ${currentPeriod.year}`,
        data: {
          processedPeriod: {
            year: currentPeriod.year,
            month: currentPeriod.month,
            monthName: getMonthName(currentPeriod.month)
          },
          newPeriod: {
            year: nextYear,
            month: nextMonth,
            monthName: getMonthName(nextMonth)
          },
          statistics: {
            recordsProcessed: recordsProcessed,
            employeesProcessed: employeesProcessed,
            executionTime: executionTime ? `${(executionTime / 1000).toFixed(2)}s` : 'N/A'
          },
          processedBy: userFullname,
          timestamp: new Date().toISOString(),
          newStatus: 0,
          newStatusMessage: 'Data Entry Open'
        }
      });
      
    } catch (procError) {
      // Rollback transaction on error
      await connection.rollback();
      console.error('❌ Month-end processing failed, transaction rolled back:', procError);
      throw procError;
    }
    
  } catch (error) {
    console.error('❌ Month-end processing error:', error);
    
    res.status(500).json({
      success: false,
      error: 'Month-end processing failed',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// ==================== GET PROCESSING LOGS (FROM py_monthend) ====================
router.get('/processing-logs', verifyToken, async (req, res) => {
  try {
    const currentDb = req.current_class;
    const limit = parseInt(req.query.limit) || 10;
    
    const [logs] = await pool.query(
      `SELECT 
         process_year AS year,
         process_month AS month,
         employees_processed,
         records_processed,
         datecreated AS processed_on,
         createdby AS processed_by
       FROM ${currentDb}.py_monthend
       ORDER BY process_year DESC, process_month DESC
       LIMIT ?`,
      [limit]
    );
    
    // Format the results
    const formattedLogs = logs.map(log => ({
      year: log.year,
      month: log.month,
      status: 'SUCCESS',
      start_time: log.processed_on,
      end_time: log.processed_on,
      duration_seconds: 0,
      payments_processed: log.records_processed,
      employees_processed: log.employees_processed,
      processed_by: log.processed_by || 'System'
    }));
    
    res.json({
      success: true,
      data: formattedLogs
    });
    
  } catch (error) {
    console.error('Error fetching processing logs:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch processing logs',
      message: error.message 
    });
  }
});

// ==================== GET MONTH-END STATUS ====================
router.get('/monthend-status/:year/:month', verifyToken, async (req, res) => {
  const { year, month } = req.params;
  const currentDb = req.current_class;
  
  try {
    const monthColumn = `amtthismth${month}`;
    
    const [records] = await pool.query(
      `SELECT COUNT(*) as count, SUM(${monthColumn}) as total
       FROM ${currentDb}.py_payhistory
       WHERE his_year = ? AND ${monthColumn} > 0`,
      [year]
    );
    
    if (records.length === 0 || records[0].count === 0) {
      return res.json({
        processed: false,
        message: 'Month-end not yet processed for this period'
      });
    }
    
    res.json({
      processed: true,
      status: 'SUCCESS',
      statistics: {
        recordsProcessed: records[0].count,
        totalAmount: records[0].total
      }
    });
    
  } catch (error) {
    console.error('Error fetching month-end status:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch status',
      message: error.message 
    });
  }
});

// Helper function
function getMonthName(month) {
  const months = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  return months[parseInt(month)] || `Month ${month}`;
}


// ==================== YEAR-END PROCESSING ====================
router.post('/process-yearend', verifyToken, async (req, res) => {
  const { year } = req.body;
  
  if (!year || year < 2020 || year > new Date().getFullYear() + 1) {
    return res.status(400).json({
      success: false,
      error: 'Invalid year'
    });
  }
  
  const currentDb = req.current_class;
  const userFullname = req.user_fullname || 'System';
  
  let connection = null;
  
  try {
    console.log(`🎯 Starting year-end processing: ${year} for ${currentDb}`);
    console.log(`   User: ${userFullname}`);

    // Validate company
    const [companyRows] = await pool.query(
      `SELECT comp_code, comp_name FROM ${currentDb}.py_paysystem;`
    );

    if (companyRows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No company found. Year-end processing requires a valid company.'
      });
    }
    
    const companyName = companyRows[0].comp_name;
    const isNavyCompany = companyName === 'NAVY';
    
    // Step 1: Get current period from py_stdrate
    const [periodRows] = await pool.query(
      `SELECT mth AS month, pmth AS prev_month, ord AS year
       FROM ${currentDb}.py_stdrate 
       WHERE type = 'BT05' 
       LIMIT 1`
    );
    
    if (periodRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Payroll period not found. Please initialize BT05 in py_stdrate.'
      });
    }
    
    const currentPeriod = periodRows[0];
    
    // Step 2: Validate that previous month is December (12)
    if (currentPeriod.month !== 12 || currentPeriod.prev_month !== 12) {
      return res.status(400).json({
        success: false,
        error: 'Year-end can only be processed when in December',
        details: {
          currentMonth: currentPeriod.month,
          previousMonth: currentPeriod.prev_month,
          message: `Current period: Month ${currentPeriod.month}, Previous Month ${currentPeriod.prev_month}`
        }
      });
    }
    
    // Step 3: Validate year matches
    if (currentPeriod.year !== parseInt(year)) {
      return res.status(400).json({
        success: false,
        error: `Year mismatch. Expected ${currentPeriod.year} but got ${year}`,
        details: {
          expectedYear: currentPeriod.year,
          providedYear: year
        }
      });
    }
    
    console.log('✅ Validation passed: Month=1, Previous Month=12, Year matches');
    
    // Step 4: Get database connection and start transaction
    connection = await pool.getConnection();
    await connection.query(`USE \`${currentDb}\``);
    await connection.beginTransaction();
    
    try {
      // Step 5: Update py_stdrate - increment ord (year) by 1
      console.log('📝 Incrementing year (ord) by 1...');
      
      const [yearUpdateResult] = await connection.query(
        `UPDATE py_stdrate 
         SET ord = ord + 1, mth = 1, pmth = 0
         WHERE type = 'BT05'`
      );
      
      console.log(`✅ Updated year from ${currentPeriod.year} to ${currentPeriod.year + 1}`);
      
      // Step 6: Update hr_employees emolumentform (NAVY only)
      let employeesUpdated = 0;
      
      if (isNavyCompany) {
        console.log('📝 Updating emolumentform to "No" (NAVY company)...');
        
        const [updateResult] = await connection.query(
          `UPDATE hr_employees 
           SET emolumentform = 'No'
           WHERE emolumentform IS NOT NULL OR emolumentform != 'No'`
        );
        
        employeesUpdated = updateResult.affectedRows;
        console.log(`✅ Updated ${employeesUpdated} employee records`);
      } else {
        console.log(`ℹ️  Skipping emolumentform update (Company: ${companyName}, not NAVY)`);
      }
      
      // Step 7: Commit transaction
      await connection.commit();
      
      console.log('✅ Year-end processing completed successfully');
      
      res.json({
        success: true,
        message: `Year-end processed successfully for ${year}`,
        data: {
          year: year,
          newYear: currentPeriod.year + 1,
          employeesUpdated: employeesUpdated,
          emolumentFormUpdated: isNavyCompany,
          companyName: companyName,
          processedBy: userFullname,
          timestamp: new Date().toISOString()
        }
      });
      
    } catch (procError) {
      // Rollback transaction on error
      await connection.rollback();
      console.error('❌ Year-end processing failed, transaction rolled back:', procError);
      throw procError;
    }
    
  } catch (error) {
    console.error('❌ Year-end processing error:', error);
    
    res.status(500).json({
      success: false,
      error: 'Year-end processing failed',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// ==================== GET YEAR-END STATUS (for autofill) ====================
router.get('/yearend-status', verifyToken, async (req, res) => {
  try {
    const currentDb = req.current_class;
    
    const [rows] = await pool.query(
      `SELECT ord AS year, mth AS month, pmth AS prev_month 
       FROM ${currentDb}.py_stdrate 
       WHERE type = 'BT05' 
       LIMIT 1`
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Payroll period not found' 
      });
    }
    
    const period = rows[0];
    const canProcessYearEnd = period.month === 12 && period.prev_month === 12;
    
    res.json({
      success: true,
      year: period.year,
      month: period.month,
      prevMonth: period.prev_month,
      canProcessYearEnd: canProcessYearEnd,
      blockReason: canProcessYearEnd 
        ? null 
        : `Year-end can only be processed with previous month December (12).Previous Month ${period.prev_month}`
    });
    
  } catch (error) {
    console.error('Error fetching year-end status:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch year-end status',
      message: error.message 
    });
  }
});

module.exports = router;


