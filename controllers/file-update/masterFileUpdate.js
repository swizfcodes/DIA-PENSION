const pool = require('../../config/db');
const masterFileUpdate = require('../../services/file-update/masterFileUpdate');

exports.masterFileUpdate = async (req, res) => {
  try {
    const userId = req.user_id || req.userId;
    
    if (!userId) {
      return res.status(401).json({ 
        error: 'User ID not found. Please log in again.' 
      });
    }

    // ✅ Get the CURRENT database from session context (the one they switched to)
    const sessionId = userId.toString();
    const databaseName = pool.getCurrentDatabase(sessionId);
    
    if (!databaseName) {
      return res.status(400).json({ 
        error: 'No database selected. Please select a payroll class first.'
      });
    }

    console.log(`✅ Using session database: ${databaseName} for user: ${sessionId}`);

    // ✅ Reverse-map database name to get the indicator
    const dbToIndicator = {
      [process.env.DB_OFFICERS]: '1',
      [process.env.DB_WOFFICERS]: '2',
      [process.env.DB_RATINGS]: '3',
      [process.env.DB_RATINGS_A]: '4',
      [process.env.DB_RATINGS_B]: '5',
      [process.env.DB_JUNIOR_TRAINEE]: '6'
    };

    const dbToClass = {
      [process.env.DB_OFFICERS]: 'OFFICERS',
      [process.env.DB_WOFFICERS]: 'W/OFFICERS',
      [process.env.DB_RATINGS]: 'RATE A',
      [process.env.DB_RATINGS_A]: 'RATE B',
      [process.env.DB_RATINGS_B]: 'RATE C',
      [process.env.DB_JUNIOR_TRAINEE]: 'TRAINEE'
    };
    
    const indicator = dbToIndicator[databaseName];
    const className = dbToClass[databaseName] || 'Unknown';
    
    if (!indicator) {
      return res.status(400).json({ 
        error: `Invalid database: '${databaseName}'. Please select a valid payroll class.`
      });
    }

    console.log(`Database: ${databaseName}, Class: ${className}, Indicator: ${indicator}`);

    // Query using fully qualified table name
    const [bt05Rows] = await pool.query(
      `SELECT ord AS year, mth AS month, sun FROM ${databaseName}.py_stdrate WHERE type='BT05' LIMIT 1`
    );
    
    if (!bt05Rows.length) {
      return res.status(404).json({ 
        error: 'Payroll period not found. Please ensure BT05 record exists.' 
      });
    }

    const { year, month, sun } = bt05Rows[0];
    
    if (sun < 777) {
      return res.status(400).json({ 
        error: 'Input Variable Report must be processed first before updating master files.' 
      });
    }
    
    if (sun >= 888) {
      return res.status(400).json({ 
        error: 'Master file update has already been completed for this period.' 
      });
    }

    const user = req.user_fullname || 'System Update';
    
    console.log(`Master file update - Class: ${className}, Database: ${databaseName}, Indicator: ${indicator}, User: ${user}, UserID: ${userId}`);
    
    // ✅ Call service - it will get the database from session using userId
    const result = await masterFileUpdate.runUpdates(year, month, indicator, user, userId);

    // Update the stage to 888 using fully qualified table name
    await pool.query(
      `UPDATE ${databaseName}.py_stdrate SET sun = 888, createdby = ? WHERE type = 'BT05'`, 
      [user]
    );

    res.json({
      status: 'SUCCESS',
      message: 'Master file updated successfully',
      stage: 888,
      year,
      month,
      database: databaseName,
      class: className,
      indicator,
      employeesProcessed: result.data?.employeesProcessed || 0,
      totalRecords: result.data?.totalRecords || 0,
      totalAmount: result.data?.totalAmount || '0.00'
    });
    
  } catch (err) {
    console.error('❌ Error running master file update:', err);
    
    const errorMessage = err.message || 'An unexpected error occurred during master file update';
    
    res.status(500).json({ 
      status: 'FAILED', 
      error: errorMessage
    });
  }
};


