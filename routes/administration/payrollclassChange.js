const express = require('express');
const router = express.Router();
const verifyToken = require('../../middware/authentication');
//const { attachPayrollClass } = require('../../middware/attachPayrollClass');
const pool  = require('../../config/db'); // mysql2 pool

// ==================== DATABASE CONFIGURATION ====================
// ==================== DATABASE CONFIGURATION ====================
let DATABASE_MAP = {};
let PAYROLL_CLASS_TO_DB_MAP = {};

const initDatabaseMaps = async () => {
  const masterDb = pool.getMasterDb();
  const connection = await pool.getConnection();
  
  try {
    await connection.query(`USE \`${masterDb}\``);
    const [rows] = await connection.query(
      'SELECT db_name, classname, classcode FROM py_payrollclass'
    );

    DATABASE_MAP = {};
    PAYROLL_CLASS_TO_DB_MAP = {};

    rows.forEach(({ db_name, classname, classcode }) => {
      DATABASE_MAP[db_name] = { name: classname, code: classcode };

      PAYROLL_CLASS_TO_DB_MAP[classcode] = db_name;          // '1' → db
      PAYROLL_CLASS_TO_DB_MAP[classname] = db_name;          // 'OFFICERS' → db
      PAYROLL_CLASS_TO_DB_MAP[db_name] = db_name;            // 'hicaddata' → db
      // Normalized variant (no spaces/slashes)
      PAYROLL_CLASS_TO_DB_MAP[classname.replace(/[\s/\.]/g, '')] = db_name;
    });

    console.log('✅ Database maps initialized from py_payrollclass');
  } finally {
    connection.release();
  }
};

/**
 * Maps database name to payroll class code
 * @param {string} dbName - Current database name
 * @returns {string} Payroll class code
 */
function getPayrollClassFromDb(dbName) {
  const entry = DATABASE_MAP[dbName];
  const result = entry ? entry.code : null;
  console.log('🔍 Database:', dbName, '→ Payroll Class:', result);
  return result;
}

// Ensure maps are loaded before routes are used
const ensureMapsLoaded = async () => {
  if (Object.keys(DATABASE_MAP).length === 0) {
    await initDatabaseMaps();
  }
};

router.use(async (req, res, next) => {
  try {
    await ensureMapsLoaded();
    next();
  } catch (err) {
    console.error('Failed to load database maps:', err);
    res.status(500).json({ error: 'Database configuration unavailable' });
  }
});

// ==================== COLUMN NAME STANDARDIZATION ====================
async function standardizeEmployeeIdColumns(connection, database, tables) {
  const standardizedTables = [];
  
  for (const table of tables) {
    try {
      // Check if table exists
      const [tableExists] = await connection.query(
        `SELECT COUNT(*) as count FROM information_schema.tables 
         WHERE table_schema = ? AND table_name = ?`,
        [database, table]
      );
      
      if (tableExists[0].count === 0) continue;
      
      // Get column information
      const [columns] = await connection.query(
        `SELECT COLUMN_NAME FROM information_schema.columns 
         WHERE table_schema = ? AND table_name = ? 
         AND COLUMN_NAME REGEXP '^[Ee]mpl_[Ii][Dd]$'`,
        [database, table]
      );
      
      if (columns.length === 0) continue;
      
      const actualColumnName = columns[0].COLUMN_NAME;
      
      // If it's not 'Empl_ID', rename it
      if (actualColumnName !== 'Empl_ID') {
        console.log(`  Standardizing ${table}.${actualColumnName} → Empl_ID`);
        await connection.query(
          `ALTER TABLE \`${database}\`.\`${table}\` 
           CHANGE COLUMN \`${actualColumnName}\` \`Empl_ID\` VARCHAR(20)`
        );
        standardizedTables.push(table);
      }
    } catch (err) {
      console.log(`⚠️ Could not standardize ${table}: ${err.message}`);
    }
  }
  
  return standardizedTables;
}

// ==================== DYNAMIC TABLE AND COLUMN DISCOVERY ====================
async function discoverMigrationTables(connection, database) {
  try {
    console.log(` Scanning database: ${database}`);
    
    // Get all tables in the database that start with 'py_' (payroll tables)
    const [tables] = await connection.query(
      `SELECT table_name 
       FROM information_schema.tables 
       WHERE table_schema = ? 
       AND table_type = 'BASE TABLE'
       AND table_name LIKE 'py_%'
       AND table_name NOT IN ('py_payrollclass', 'py_setup')
       ORDER BY table_name`,
      [database]
    );
    
    console.log(` Found ${tables.length} py_ tables in ${database}`);
    
    if (tables.length === 0) {
      // Debug: Show what tables exist
      const [allTables] = await connection.query(
        `SELECT table_name FROM information_schema.tables 
         WHERE table_schema = ? AND table_type = 'BASE TABLE' 
         LIMIT 10`,
        [database]
      );
      console.log(`  ⚠️ Sample tables in ${database}:`, allTables.map(t => t.table_name).join(', '));
    }
    
    const migrationTables = [];
    
    for (const { table_name } of tables) {
      // Find employee ID column in this table
      // Look for columns that match common patterns
      const [columns] = await connection.query(
        `SELECT COLUMN_NAME, DATA_TYPE
         FROM information_schema.columns 
         WHERE table_schema = ? 
         AND table_name = ?
         AND (
           COLUMN_NAME REGEXP '^[Ee]mpl_?[Ii][Dd]$'
           OR COLUMN_NAME REGEXP '^his_[Ee]mpno$'
           OR COLUMN_NAME = 'doc_numb'
           OR COLUMN_NAME = 'numb'
           OR LOWER(COLUMN_NAME) IN ('empl_id', 'emplid', 'empl_no', 'his_empno', 'doc_numb', 'numb')
         )
         ORDER BY 
           CASE 
             WHEN COLUMN_NAME = 'Empl_ID' THEN 1
             WHEN LOWER(COLUMN_NAME) = 'empl_id' THEN 2
             WHEN LOWER(COLUMN_NAME) = 'emplid' THEN 3
             WHEN LOWER(COLUMN_NAME) = 'his_empno' THEN 4
             WHEN COLUMN_NAME = 'doc_numb' THEN 5
             WHEN COLUMN_NAME = 'numb' THEN 6
             ELSE 7
           END
         LIMIT 1`,
        [database, table_name]
      );
      
      if (columns.length > 0) {
        migrationTables.push({
          table: table_name,
          emplIdCol: columns[0].COLUMN_NAME
        });
        console.log(`    ✓ ${table_name} → ${columns[0].COLUMN_NAME}`);
      } else {
        // Debug: Show what columns this table has
        const [allCols] = await connection.query(
          `SELECT COLUMN_NAME FROM information_schema.columns 
           WHERE table_schema = ? AND table_name = ?
           LIMIT 5`,
          [database, table_name]
        );
        console.log(`    ⚠️ ${table_name} has no matching employee ID column. Sample columns:`, 
                    allCols.map(c => c.COLUMN_NAME).join(', '));
      }
    }
    
    return migrationTables;
  } catch (error) {
    console.error(`  ❌ Error discovering migration tables in ${database}:`, error.message);
    return [];
  }
}

// ==================== DYNAMIC TABLE AND COLUMN DISCOVERY ====================
// Fallback function with hardcoded table list
function getDefaultMigrationTables() {
  return [
    // INPUT TABLES
    { table: 'py_payded', emplIdCol: 'Empl_ID' },
    { table: 'py_cumulated', emplIdCol: 'Empl_ID' },
    { table: 'py_header', emplIdCol: 'Empl_ID' },
    { table: 'py_operative', emplIdCol: 'Empl_ID' },
    { table: 'py_overtime', emplIdCol: 'Empl_ID' },
    { table: 'py_documentation', emplIdCol: 'doc_numb' },

    // ARCHIVE TABLES
    { table: 'py_ipis_payhistory', emplIdCol: 'numb' },
    { table: 'py_payhistory', emplIdCol: 'his_empno' },    
    { table: 'py_inputhistory', emplIdCol: 'Empl_ID' },
    
    // MASTER TABLES
    { table: 'py_masterpayded', emplIdCol: 'his_Empno' },
    { table: 'py_mastercum', emplIdCol: 'his_Empno' },
    { table: 'py_masterover', emplIdCol: 'his_Empno' },
    { table: 'py_masterope', emplIdCol: 'his_Empno' },
    { table: 'py_calculation', emplIdCol: 'his_empno' },
    { table: 'py_oneoffhistory', emplIdCol: 'his_empno' },
  ];
}

// Enhanced discovery function with fallback
async function discoverOrGetDefaultMigrationTables(connection, database) {
  // Try dynamic discovery first
  const discovered = await discoverMigrationTables(connection, database);
  
  if (discovered.length > 0) {
    console.log(`  ✓ Using ${discovered.length} discovered tables`);
    return discovered;
  }
  
  // Fallback to hardcoded list
  console.log(`  ⚠️ No tables discovered, using default list`);
  const defaultTables = getDefaultMigrationTables();
  
  // Verify which tables actually exist
  const existingTables = [];
  for (const { table, emplIdCol } of defaultTables) {
    try {
      const [tableExists] = await connection.query(
        `SELECT COUNT(*) as count FROM information_schema.tables 
         WHERE table_schema = ? AND table_name = ?`,
        [database, table]
      );
      
      if (tableExists[0].count > 0) {
        // Verify column exists
        const [colExists] = await connection.query(
          `SELECT COLUMN_NAME FROM information_schema.columns 
           WHERE table_schema = ? AND table_name = ? 
           AND LOWER(COLUMN_NAME) = LOWER(?)`,
          [database, table, emplIdCol]
        );
        
        if (colExists.length > 0) {
          existingTables.push({
            table: table,
            emplIdCol: colExists[0].COLUMN_NAME
          });
        }
      }
    } catch (err) {
      // Skip tables that don't exist
    }
  }
  
  console.log(`  ✓ Found ${existingTables.length} existing tables from default list`);
  return existingTables;
}

// Helper to get actual column name (case-insensitive)
async function getActualColumnName(connection, database, table, columnPattern) {
  try {
    const [columns] = await connection.query(
      `SELECT COLUMN_NAME FROM information_schema.columns 
       WHERE table_schema = ? AND table_name = ? 
       AND LOWER(COLUMN_NAME) = LOWER(?)`,
      [database, table, columnPattern]
    );
    
    return columns.length > 0 ? columns[0].COLUMN_NAME : columnPattern;
  } catch (error) {
    return columnPattern;
  }
}

// ==================== HELPER FUNCTIONS ====================
function getDbNameFromPayrollClass(payrollClass) {
  if (PAYROLL_CLASS_TO_DB_MAP[payrollClass]) {
    return PAYROLL_CLASS_TO_DB_MAP[payrollClass];
  }
  
  const upperClass = payrollClass.toString().toUpperCase();
  for (const [key, value] of Object.entries(PAYROLL_CLASS_TO_DB_MAP)) {
    if (key.toUpperCase() === upperClass) {
      return value;
    }
  }
  
  const cleanClass = payrollClass.toString().replace(/[\s\/\-_]/g, '').toUpperCase();
  for (const [key, value] of Object.entries(PAYROLL_CLASS_TO_DB_MAP)) {
    if (key.replace(/[\s\/\-_]/g, '').toUpperCase() === cleanClass) {
      return value;
    }
  }
  
  return payrollClass;
}

function getFriendlyDbName(dbId) {
  return DATABASE_MAP[dbId]?.name || dbId;
}

function isValidDatabase(dbId) {
  return Object.keys(DATABASE_MAP).includes(dbId);
}

async function checkDatabaseExists(dbName) {
  let connection = null;
  try {
    connection = await pool.getConnection();
    const [rows] = await connection.query(`SHOW DATABASES LIKE ?`, [dbName]);
    connection.release();
    return rows.length > 0;
  } catch (error) {
    if (connection) connection.release();
    return false;
  }
}

// ==================== GET ALL EMPLOYEES ====================
router.get('/active-employees', verifyToken, async (req, res) => {
  try {
    const currentDb = pool.getCurrentDatabase(req.user_id.toString());
    const payrollClass = await getPayrollClassFromDb(currentDb);

    const limit = parseInt(req.query.limit) || 1000;
    const offset = parseInt(req.query.offset) || 0;
    const search = req.query.search || ''; // Add search parameter

    // Build WHERE clause with search
    let whereClause = `
      WHERE (DateLeft IS NULL OR DateLeft = '')
        AND (exittype IS NULL OR exittype = '')
        AND payrollclass = ?
    `;
    
    const queryParams = [payrollClass];
    
    if (search) {
      whereClause += ` AND (
        Empl_ID LIKE ? OR 
        Surname LIKE ? OR 
        OtherName LIKE ? OR
        CONCAT(Surname, ' ', OtherName) LIKE ?
      )`;
      const searchParam = `%${search}%`;
      queryParams.push(searchParam, searchParam, searchParam, searchParam);
    }

    // Get total count with search
    const [countResult] = await pool.query(`
      SELECT COUNT(*) as total
      FROM hr_employees
      ${whereClause}
    `, queryParams);
    const total = countResult[0].total;

    // Get paginated results with search
    const query = `
      SELECT Empl_ID, Title, Surname, OtherName, payrollclass
      FROM hr_employees
      ${whereClause}
      ORDER BY Empl_ID ASC
      LIMIT ? OFFSET ?;
    `;

    const [rows] = await pool.query(query, [...queryParams, limit, offset]);

    res.status(200).json({
      message: 'Employees retrieved successfully',
      data: rows,
      payrollClass,
      count: rows.length,
      total: total,
      limit: limit,
      offset: offset,
      hasMore: (offset + rows.length) < total,
      search: search
    });

  } catch (error) {
    console.error('Error fetching employees:', error);
    res.status(500).json({ 
      error: 'Failed to fetch employees', 
      details: error.message 
    });
  }
});

// ==================== GET PAYROLL CLASS STATISTICS ====================
router.get('/payroll-class-stats', verifyToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        e.payrollclass,
        pc.classname,
        COUNT(*) AS count
      FROM hr_employees e
      LEFT JOIN py_payrollclass pc 
        ON e.payrollclass = pc.classcode
      WHERE 
        (e.DateLeft IS NULL OR e.DateLeft = '')
        AND (e.exittype IS NULL OR e.exittype = '')
        AND e.payrollclass IS NOT NULL
        AND e.payrollclass != ''
      GROUP BY 
        e.payrollclass, pc.classname
      ORDER BY 
        e.payrollclass ASC;
    `;

    const [rows] = await pool.query(query);

    if (!rows || rows.length === 0) {
      return res.status(200).json({
        message: 'No payroll class statistics found',
        data: {}
      });
    }

    const stats = {};
    rows.forEach(row => {
      stats[row.payrollclass] = {
        classname: row.classname || '',
        count: row.count
      };
    });

    res.status(200).json({
      message: 'Payroll class statistics retrieved successfully',
      data: stats
    });

  } catch (error) {
    console.error('Error fetching payroll class statistics:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// ==================== UPDATE EMPLOYEE PAYROLL CLASS WITH DATABASE MIGRATION ====================
router.post('/payroll-class', verifyToken, async (req, res) => {
  const { Empl_ID, PayrollClass } = req.body;

  if (!Empl_ID || Empl_ID.trim() === '') {
    return res.status(400).json({ success: false, error: 'Employee ID is required' });
  }

  if (!PayrollClass || PayrollClass.trim() === '') {
    return res.status(400).json({ success: false, error: 'Payroll class is required' });
  }

  const employeeId = Empl_ID.trim();
  const payrollClassInput = PayrollClass.toString().trim();
  const targetDb = getDbNameFromPayrollClass(payrollClassInput);
  const officersDb = process.env.DB_OFFICERS || 'hicaddata';

  console.log(`   Payroll class mapping:`);
  console.log(`   Input: ${payrollClassInput}`);
  console.log(`   Resolved Target DB: ${targetDb}`);

  let tempConnection = null;
  let sourceConnection = null;
  let targetConnection = null;

  try {
    // Step 1: Find employee's current payrollclass from hr_employees in officers DB
    tempConnection = await pool.getConnection();
    await tempConnection.query(`USE \`${officersDb}\``);
    
    const [employeeRows] = await tempConnection.query(
      `SELECT payrollclass, Surname, OtherName FROM hr_employees 
       WHERE Empl_ID = ? 
       AND (DateLeft IS NULL OR DateLeft = '') 
       AND (exittype IS NULL OR exittype = '')`,
      [employeeId]
    );

    if (employeeRows.length === 0) {
      tempConnection.release();
      return res.status(404).json({ 
        success: false, 
        error: `Employee not found or inactive in ${officersDb}` 
      });
    }

    const employee = employeeRows[0];
    const employeeName = `${employee.Surname} ${employee.OtherName || ''}`.trim();
    const currentPayrollClass = employee.payrollclass;
    
    tempConnection.release();
    tempConnection = null;

    console.log(`✓ Employee found: ${employeeName}`);
    console.log(`   Current Payroll Class: ${currentPayrollClass || 'Not Assigned'}`);

    // Determine source database from current payrollclass
    let sourceDb;
    
    if (!currentPayrollClass || currentPayrollClass === '' || currentPayrollClass === '0') {
      // No payroll class assigned, default to officers DB
      sourceDb = officersDb;
      console.log(`   Source DB: ${sourceDb} (default - no class assigned)`);
    } else {
      sourceDb = getDbNameFromPayrollClass(currentPayrollClass);
      console.log(`   Source DB: ${sourceDb} (from payrollclass ${currentPayrollClass})`);
    }

    if (!isValidDatabase(sourceDb)) {
      return res.status(400).json({ 
        success: false, 
        error: `Invalid source database: ${sourceDb}`,
        debug: { sourceDb, validDatabases: Object.keys(DATABASE_MAP) }
      });
    }

    if (!isValidDatabase(targetDb)) {
      return res.status(400).json({ 
        success: false, 
        error: `Invalid target database: ${targetDb}. Could not map payroll class "${payrollClassInput}" to a database.`,
        debug: {
          payrollClassInput,
          resolvedDb: targetDb,
          availableMappings: Object.keys(PAYROLL_CLASS_TO_DB_MAP).slice(0, 20),
          hint: 'The payroll class code does not match any known database'
        }
      });
    }

    const targetExists = await checkDatabaseExists(targetDb);
    if (!targetExists) {
      return res.status(400).json({
        success: false,
        error: `Target database "${targetDb}" does not exist on the server.`,
        details: `The payroll class "${payrollClassInput}" maps to database "${targetDb}", but this database has not been created yet.`,
        action: 'Please create the database or update your payroll class configuration.',
        debug: {
          payrollClass: payrollClassInput,
          expectedDatabase: targetDb,
          friendlyName: getFriendlyDbName(targetDb)
        }
      });
    }

    const sourceName = getFriendlyDbName(sourceDb);
    const targetName = getFriendlyDbName(targetDb);
    
    console.log(`🔄 Starting migration for ${employeeId}`);
    console.log(`   From: ${sourceName} (${sourceDb})`);
    console.log(`   To: ${targetName} (${targetDb})`);

    // Special handling: If no payroll class assigned in officers DB
    if (sourceDb === officersDb && (!currentPayrollClass || currentPayrollClass === '' || currentPayrollClass === '0')) {
      console.log(`Employee in OFFICERS database has no payroll class. Assigning class '${payrollClassInput}'...`);
      
      sourceConnection = await pool.getConnection();
      await sourceConnection.beginTransaction();
      await sourceConnection.query(`USE \`${officersDb}\``);
      
      await sourceConnection.query(
        `UPDATE hr_employees SET payrollclass = ? WHERE Empl_ID = ?`,
        [payrollClassInput, employeeId]
      );
      
      const [payrollClassCheck] = await sourceConnection.query(
        `SELECT classcode FROM py_payrollclass WHERE classcode = ?`,
        [payrollClassInput]
      );
      
      if (payrollClassCheck.length === 0) {
        const className = getFriendlyDbName(targetDb);
        await sourceConnection.query(
          `INSERT INTO py_payrollclass (classcode, classname) VALUES (?, ?)`,
          [payrollClassInput, className]
        );
        console.log(`✓ Created payroll class '${payrollClassInput}' in py_payrollclass`);
      }
      
      await sourceConnection.commit();
      sourceConnection.release();
      
      console.log(`✅ Assigned payroll class '${payrollClassInput}' to employee ${employeeId}`);
      
      return res.status(200).json({
        success: true,
        message: `Employee assigned to payroll class '${payrollClassInput}' (${targetName})`,
        data: {
          Empl_ID: employeeId,
          Name: employeeName,
          AssignedPayrollClass: payrollClassInput,
          PayrollClassName: targetName,
          Database: officersDb,
          Action: 'Payroll class assigned (no migration)',
          Timestamp: new Date().toISOString()
        }
      });
    }

    // Check if employee already has the target payroll class
    if (currentPayrollClass === payrollClassInput) {
      return res.status(400).json({ 
        success: false, 
        error: 'Employee is already in this payroll class' 
      });
    }

    // Check if migrating to same database
    if (sourceDb === targetDb) {
      return res.status(400).json({ 
        success: false, 
        error: 'Employee is already in this payroll class database' 
      });
    }

    sourceConnection = await pool.getConnection();
    targetConnection = await pool.getConnection();

    try {
      await sourceConnection.query(`USE \`${sourceDb}\``);
    } catch (err) {
      throw new Error(`Source database "${sourceDb}" does not exist or is not accessible.`);
    }

    try {
      await targetConnection.query(`USE \`${targetDb}\``);
    } catch (err) {
      throw new Error(`Target database "${targetDb}" (${targetName}) does not exist. Please create it first.`);
    }

    // Standardize column names in both databases
    console.log(`Standardizing column names...`);
    const standardTables = ['hr_employees', 'py_payded', 'py_inputhistory'];
    
    await sourceConnection.query(`USE \`${sourceDb}\``);
    const sourceStandardized = await standardizeEmployeeIdColumns(sourceConnection, sourceDb, standardTables);
    if (sourceStandardized.length > 0) {
      console.log(`  ✓ Standardized ${sourceStandardized.length} tables in source database`);
    }
    
    await targetConnection.query(`USE \`${targetDb}\``);
    const targetStandardized = await standardizeEmployeeIdColumns(targetConnection, targetDb, standardTables);
    if (targetStandardized.length > 0) {
      console.log(`  ✓ Standardized ${targetStandardized.length} tables in target database`);
    }

    await sourceConnection.beginTransaction();
    await targetConnection.beginTransaction();

    // Discover migration tables dynamically
    console.log(`Discovering migration tables in source and target databases...`);
    await sourceConnection.query(`USE \`${sourceDb}\``);
    const sourceMigrationTables = await discoverOrGetDefaultMigrationTables(sourceConnection, sourceDb);

    await targetConnection.query(`USE \`${targetDb}\``);
    const targetMigrationTables = await discoverOrGetDefaultMigrationTables(targetConnection, targetDb);

    console.log(`  ✓ Found ${sourceMigrationTables.length} tables in source`);
    console.log(`  ✓ Found ${targetMigrationTables.length} tables in target`);

    // Create a map of tables that exist in both source and target
    const migrationTables = sourceMigrationTables.filter(sourceTable => 
      targetMigrationTables.some(targetTable => targetTable.table === sourceTable.table)
    );

    console.log(`  ✓ ${migrationTables.length} tables will be migrated`);

    // Log discovered tables for debugging
    if (migrationTables.length > 0) {
      console.log(`Tables: ${migrationTables.map(t => `${t.table}(${t.emplIdCol})`).join(', ')}`);
    }

    // SOURCE OF TRUTH: Check migration tables in target DB to see if records exist
    console.log(`Checking for existing records in ${targetName}...`);
    await targetConnection.query(`USE \`${targetDb}\``);

    let existsInTarget = false;
    const recordsToDelete = {};

    for (const { table, emplIdCol } of migrationTables) {
      try {
        const actualColName = await getActualColumnName(targetConnection, targetDb, table, emplIdCol);
        
        const [existingRecords] = await targetConnection.query(
          `SELECT COUNT(*) as count FROM \`${table}\` WHERE \`${actualColName}\` = ?`,
          [employeeId]
        );
        
        const count = existingRecords[0].count;
        if (count > 0) {
          existsInTarget = true;
          recordsToDelete[table] = { count, emplIdCol: actualColName };
          console.log(`  ⚠️ Found ${count} existing record(s) in ${table}`);
        }
      } catch (err) {
        console.log(`  ⚠️ Could not check ${table}: ${err.message}`);
      }
    }

    // If records exist in target, delete them first
    if (existsInTarget) {
      console.log(`Clearing existing records from ${targetName}...`);
      
      for (const table in recordsToDelete) {
        const { emplIdCol } = recordsToDelete[table];
        try {
          const [result] = await targetConnection.query(
            `DELETE FROM ${table} WHERE \`${emplIdCol}\` = ?`,
            [employeeId]
          );
          console.log(`  ✓ Deleted ${result.affectedRows} record(s) from ${table}`);
        } catch (err) {
          console.log(`  ⚠️ Could not delete from ${table}: ${err.message}`);
        }
      }
    }

    // Now migrate ALL records from source tables
    console.log(` Migrating records from ${sourceName} to ${targetName}...`);
    await sourceConnection.query(`USE \`${sourceDb}\``);
    await targetConnection.query(`USE \`${targetDb}\``);
    
    let totalMigratedRecords = 0;

    for (const { table, emplIdCol } of migrationTables) {
      try {
        // Check if table exists in source
        const [sourceTableExists] = await sourceConnection.query(
          `SELECT COUNT(*) as count FROM information_schema.tables 
           WHERE table_schema = ? AND table_name = ?`,
          [sourceDb, table]
        );
        
        // Check if table exists in target
        const [targetTableExists] = await targetConnection.query(
          `SELECT COUNT(*) as count FROM information_schema.tables 
           WHERE table_schema = ? AND table_name = ?`,
          [targetDb, table]
        );

        if (sourceTableExists[0].count > 0 && targetTableExists[0].count > 0) {
          // Get actual column name in source (case-insensitive)
          const [sourceColumns] = await sourceConnection.query(
            `SELECT COLUMN_NAME FROM information_schema.columns 
             WHERE table_schema = ? AND table_name = ? 
             AND LOWER(COLUMN_NAME) = LOWER(?)`,
            [sourceDb, table, emplIdCol]
          );
          
          const sourceColName = sourceColumns.length > 0 ? sourceColumns[0].COLUMN_NAME : emplIdCol;
          
          // Fetch ALL records for this employee from source
          const [records] = await sourceConnection.query(
            `SELECT * FROM ${table} WHERE \`${sourceColName}\` = ?`,
            [employeeId]
          );

          if (records.length > 0) {
            // Insert ALL records into target
            for (const record of records) {
              const cols = Object.keys(record);
              const vals = Object.values(record);
              const placeholders = cols.map(() => '?').join(', ');

              await targetConnection.query(
                `INSERT INTO ${table} (\`${cols.join('`, `')}\`) VALUES (${placeholders})`,
                vals
              );
            }
            totalMigratedRecords += records.length;
            console.log(`  ✓ Migrated ${records.length} record(s) from ${table}`);
          }
        }
      } catch (err) {
        console.log(`  ⚠️ Could not migrate from ${table}: ${err.message}`);
      }
    }

    // Update payrollclass in hr_employees (always in officers DB)
    console.log(`Updating payrollclass in ${officersDb}.hr_employees...`);
    const officersConnection = await pool.getConnection();
    await officersConnection.query(`USE \`${officersDb}\``);
    await officersConnection.query(
      `UPDATE hr_employees SET payrollclass = ? WHERE Empl_ID = ?`,
      [payrollClassInput, employeeId]
    );
    console.log(`  ✓ Updated payrollclass to '${payrollClassInput}'`);
    officersConnection.release();

    // Delete migrated records from source tables
    console.log(`Removing migrated records from ${sourceName}...`);
    await sourceConnection.query(`USE \`${sourceDb}\``);
    
    for (const { table, emplIdCol } of migrationTables) {
      try {
        // Get actual column name in source
        const [sourceColumns] = await sourceConnection.query(
          `SELECT COLUMN_NAME FROM information_schema.columns 
           WHERE table_schema = ? AND table_name = ? 
           AND LOWER(COLUMN_NAME) = LOWER(?)`,
          [sourceDb, table, emplIdCol]
        );
        
        const sourceColName = sourceColumns.length > 0 ? sourceColumns[0].COLUMN_NAME : emplIdCol;
        
        const [result] = await sourceConnection.query(
          `DELETE FROM ${table} WHERE \`${sourceColName}\` = ?`,
          [employeeId]
        );
        if (result.affectedRows > 0) {
          console.log(`  ✓ Deleted ${result.affectedRows} record(s) from ${table}`);
        }
      } catch (err) {
        console.log(`  ⚠️ Could not delete from ${table}: ${err.message}`);
      }
    }

    await targetConnection.commit();
    await sourceConnection.commit();

    console.log(`✅ Migration completed successfully`);

    res.status(200).json({
      success: true,
      message: `Employee successfully migrated from ${sourceName} to ${targetName}`,
      data: {
        Empl_ID: employeeId,
        Name: employeeName,
        PreviousPayrollClass: currentPayrollClass,
        NewPayrollClass: payrollClassInput,
        SourceDatabase: sourceDb,
        TargetDatabase: targetDb,
        SourceDatabaseName: sourceName,
        TargetDatabaseName: targetName,
        RecordsMigrated: totalMigratedRecords,
        PayrollClassUpdated: true,
        MigrationTimestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Migration failed:', error);

    try {
      if (sourceConnection) await sourceConnection.rollback();
      if (targetConnection) await targetConnection.rollback();
      console.log('⚠️ Transactions rolled back');
    } catch (rollbackError) {
      console.error('❌ Rollback error:', rollbackError);
    }

    res.status(500).json({
      success: false,
      error: 'Failed to migrate employee',
      message: error.message,
      Empl_ID: employeeId
    });

  } finally {
    if (tempConnection) tempConnection.release();
    if (sourceConnection) sourceConnection.release();
    if (targetConnection) targetConnection.release();
    console.log('🔓 Database connections released');
  }
});

// ==================== OPTIMIZED BULK MIGRATION ====================
// Bulk Migration - Migrate ALL employees in current class to target class
router.post('/payroll-class/bulk', verifyToken, async (req, res) => {
  const { TargetPayrollClass } = req.body;

  if (!TargetPayrollClass || TargetPayrollClass.trim() === '') {
    return res.status(400).json({ success: false, error: 'Target payroll class is required' });
  }

  const payrollClassInput = TargetPayrollClass.toString().trim();
  const targetDb = getDbNameFromPayrollClass(payrollClassInput);
  const sourceDb = req.current_class;
  const officersDb = process.env.DB_OFFICERS || 'hicaddata';

  console.log(`   Bulk Migration Request:`);
  console.log(`   From DB: ${sourceDb} (${getFriendlyDbName(sourceDb)})`);
  console.log(`   To DB: ${targetDb} (${getFriendlyDbName(targetDb)})`);

  if (!sourceDb) {
    return res.status(400).json({ 
      success: false, 
      error: 'Source payroll class context not found.' 
    });
  }

  if (!isValidDatabase(sourceDb) || !isValidDatabase(targetDb)) {
    return res.status(400).json({ 
      success: false, 
      error: 'Invalid source or target payroll class' 
    });
  }

  if (sourceDb === targetDb) {
    return res.status(400).json({ 
      success: false, 
      error: 'Source and target payroll classes are the same' 
    });
  }

  const targetExists = await checkDatabaseExists(targetDb);
  if (!targetExists) {
    return res.status(400).json({
      success: false,
      error: `Target database "${targetDb}" does not exist.`
    });
  }

  let connection = null;
  let officersConnection = null;

  try {
    const startTime = Date.now();
    connection = await pool.getConnection();
    
    await connection.beginTransaction();

    // Standardize column names
    console.log(`Standardizing column names...`);
    const standardTables = ['py_payded', 'py_inputhistory'];
    
    await connection.query(`USE \`${sourceDb}\``);
    await standardizeEmployeeIdColumns(connection, sourceDb, standardTables);
    
    await connection.query(`USE \`${targetDb}\``);
    await standardizeEmployeeIdColumns(connection, targetDb, standardTables);
    
    console.log(`✓ Column standardization complete`);

    // Discover migration tables dynamically
    console.log(`Discovering migration tables...`);
    await connection.query(`USE \`${sourceDb}\``);
    const sourceMigrationTables = await discoverOrGetDefaultMigrationTables(connection, sourceDb);

    await connection.query(`USE \`${targetDb}\``);
    const targetMigrationTables = await discoverOrGetDefaultMigrationTables(connection, targetDb);

    const migrationTables = sourceMigrationTables.filter(sourceTable => 
      targetMigrationTables.some(targetTable => targetTable.table === sourceTable.table)
    );

    console.log(`  ✓ Found ${migrationTables.length} migration tables`);
    console.log(`  Tables: ${migrationTables.map(t => `${t.table}(${t.emplIdCol})`).join(', ')}`);

    await connection.query(`USE \`${sourceDb}\``);

    // Get list of employees to migrate - dynamically build UNION query
    const unionQueries = migrationTables.map(({ table, emplIdCol }) => 
      `SELECT DISTINCT \`${emplIdCol}\` as Empl_ID FROM \`${table}\``
    ).join(' UNION ');

    if (!unionQueries) {
      throw new Error('No migration tables found in source database');
    }

    const [employees] = await connection.query(unionQueries);

    const totalEmployees = employees.length;
    console.log(` Found ${totalEmployees} employees with records to migrate`);

    if (totalEmployees === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({
        success: false,
        error: 'No employees found in source database with migration records'
      });
    }

    const emplIdList = employees.map(row => row.Empl_ID);

    // Delete existing records in target database for these employees
    await connection.query(`USE \`${targetDb}\``);
    console.log(`Clearing existing records in target database...`);
    
    if (emplIdList.length > 0) {
      const batchSize = 1000;
      for (let i = 0; i < emplIdList.length; i += batchSize) {
        const batch = emplIdList.slice(i, i + batchSize);
        const placeholders = batch.map(() => '?').join(',');
        
        for (const { table, emplIdCol } of migrationTables) {
          try {
            const [tableExists] = await connection.query(
              `SELECT COUNT(*) as count FROM information_schema.tables 
               WHERE table_schema = ? AND table_name = ?`,
              [targetDb, table]
            );
            
            if (tableExists[0].count > 0) {
              // Get actual column name
              const [columns] = await connection.query(
                `SELECT COLUMN_NAME FROM information_schema.columns 
                 WHERE table_schema = ? AND table_name = ? 
                 AND LOWER(COLUMN_NAME) = LOWER(?)`,
                [targetDb, table, emplIdCol]
              );
              
              const actualColName = columns.length > 0 ? columns[0].COLUMN_NAME : emplIdCol;
              
              await connection.query(
                `DELETE FROM ${table} WHERE \`${actualColName}\` IN (${placeholders})`,
                batch
              );
            }
          } catch (err) {
            console.log(`  ⚠️ Could not delete from ${table}: ${err.message}`);
          }
        }
      }
      console.log(`✓ Cleaned up existing records in target database`);
    }

    // Bulk copy records from source to target
    console.log(` Migrating records from source to target...`);
    let totalRelatedRecords = 0;

    for (const { table, emplIdCol } of migrationTables) {
      try {
        const [sourceTableExists] = await connection.query(
          `SELECT COUNT(*) as count FROM information_schema.tables 
           WHERE table_schema = ? AND table_name = ?`,
          [sourceDb, table]
        );
        
        const [targetTableExists] = await connection.query(
          `SELECT COUNT(*) as count FROM information_schema.tables 
           WHERE table_schema = ? AND table_name = ?`,
          [targetDb, table]
        );

        if (sourceTableExists[0].count > 0 && targetTableExists[0].count > 0) {
          // Get actual column name in source
          const [sourceColumns] = await connection.query(
            `SELECT COLUMN_NAME FROM information_schema.columns 
             WHERE table_schema = ? AND table_name = ? 
             AND LOWER(COLUMN_NAME) = LOWER(?)`,
            [sourceDb, table, emplIdCol]
          );
          
          const sourceColName = sourceColumns.length > 0 ? sourceColumns[0].COLUMN_NAME : emplIdCol;
          
          // Get count first
          const batchSize = 1000;
          let processedCount = 0;
          
          for (let i = 0; i < emplIdList.length; i += batchSize) {
            const batch = emplIdList.slice(i, i + batchSize);
            const placeholders = batch.map(() => '?').join(',');
            
            const [countRes] = await connection.query(
              `SELECT COUNT(*) as count FROM \`${sourceDb}\`.${table} 
               WHERE \`${sourceColName}\` IN (${placeholders})`,
              batch
            );
            const recordCount = countRes[0].count;

            if (recordCount > 0) {
              // Fetch and insert records
              const [records] = await connection.query(
                `SELECT * FROM \`${sourceDb}\`.${table} 
                 WHERE \`${sourceColName}\` IN (${placeholders})`,
                batch
              );
              
              for (const record of records) {
                const cols = Object.keys(record);
                const vals = Object.values(record);
                const colPlaceholders = cols.map(() => '?').join(', ');

                await connection.query(
                  `INSERT INTO \`${targetDb}\`.${table} (\`${cols.join('`, `')}\`) VALUES (${colPlaceholders})`,
                  vals
                );
              }
              
              processedCount += recordCount;
            }
          }
          
          totalRelatedRecords += processedCount;
          console.log(`  ✓ Migrated ${processedCount} records from ${table}`);
        }
      } catch (err) {
        console.log(`  ⚠️ Could not migrate ${table}: ${err.message}`);
      }
    }

    // Bulk delete from source database
    await connection.query(`USE \`${sourceDb}\``);
    console.log(`Removing migrated records from source database...`);
    
    for (const { table, emplIdCol } of migrationTables) {
      try {
        const [sourceColumns] = await connection.query(
          `SELECT COLUMN_NAME FROM information_schema.columns 
           WHERE table_schema = ? AND table_name = ? 
           AND LOWER(COLUMN_NAME) = LOWER(?)`,
          [sourceDb, table, emplIdCol]
        );
        
        const sourceColName = sourceColumns.length > 0 ? sourceColumns[0].COLUMN_NAME : emplIdCol;
        
        const batchSize = 1000;
        let totalDeleted = 0;
        
        for (let i = 0; i < emplIdList.length; i += batchSize) {
          const batch = emplIdList.slice(i, i + batchSize);
          const placeholders = batch.map(() => '?').join(',');
          
          const [result] = await connection.query(
            `DELETE FROM ${table} WHERE \`${sourceColName}\` IN (${placeholders})`,
            batch
          );
          totalDeleted += result.affectedRows;
        }
        
        if (totalDeleted > 0) {
          console.log(`  ✓ Deleted ${totalDeleted} records from ${table}`);
        }
      } catch (err) {
        console.log(`  ⚠️ Could not delete from ${table}: ${err.message}`);
      }
    }

    // Update payrollclass in hr_employees (always in officers DB)
    console.log(`Updating payrollclass in ${officersDb}.hr_employees...`);
    officersConnection = await pool.getConnection();
    await officersConnection.query(`USE \`${officersDb}\``);
    
    const batchSize = 1000;
    let totalUpdated = 0;
    
    for (let i = 0; i < emplIdList.length; i += batchSize) {
      const batch = emplIdList.slice(i, i + batchSize);
      const placeholders = batch.map(() => '?').join(',');
      
      const [result] = await officersConnection.query(
        `UPDATE hr_employees SET payrollclass = ? WHERE Empl_ID IN (${placeholders})`,
        [payrollClassInput, ...batch]
      );
      totalUpdated += result.affectedRows;
    }
    
    console.log(`  ✓ Updated payrollclass for ${totalUpdated} employees`);
    officersConnection.release();
    officersConnection = null;

    await connection.commit();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Bulk migration completed in ${duration} seconds`);

    res.status(200).json({
      success: true,
      message: `Bulk migration completed successfully`,
      data: {
        TotalEmployees: totalEmployees,
        EmployeesUpdated: totalUpdated,
        TotalRelatedRecords: totalRelatedRecords,
        TotalRecordsMigrated: totalRelatedRecords,
        SourceDatabase: sourceDb,
        TargetDatabase: targetDb,
        SourceDatabaseName: getFriendlyDbName(sourceDb),
        TargetDatabaseName: getFriendlyDbName(targetDb),
        DurationSeconds: duration,
        Timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Bulk migration failed:', error);
    
    if (connection) {
      try {
        await connection.rollback();
        console.log('⚠️ Transaction rolled back');
      } catch (rollbackError) {
        console.error('❌ Rollback error:', rollbackError);
      }
    }

    res.status(500).json({
      success: false,
      error: 'Bulk migration failed',
      message: error.message
    });
  } finally {
    if (connection) connection.release();
    if (officersConnection) officersConnection.release();
  }
});

// ==================== OPTIMIZED RANGE MIGRATION ====================
router.post('/payroll-class/range', verifyToken, async (req, res) => {
  const { StartEmpl_ID, EndEmpl_ID, TargetPayrollClass } = req.body;

  if (!StartEmpl_ID || !EndEmpl_ID || !TargetPayrollClass) {
    return res.status(400).json({ 
      success: false, 
      error: 'Start employee ID, end employee ID, and target payroll class are required' 
    });
  }

  const startId = StartEmpl_ID.trim();
  const endId = EndEmpl_ID.trim();
  const payrollClassInput = TargetPayrollClass.toString().trim();
  const targetDb = getDbNameFromPayrollClass(payrollClassInput);
  const sourceDb = req.current_class;
  const officersDb = process.env.DB_OFFICERS || 'hicaddata';

  console.log(`   Range Migration Request:`);
  console.log(`   Range: ${startId} to ${endId}`);
  console.log(`   From DB: ${sourceDb} (${getFriendlyDbName(sourceDb)})`);
  console.log(`   To DB: ${targetDb} (${getFriendlyDbName(targetDb)})`);

  if (!sourceDb) {
    return res.status(400).json({ 
      success: false, 
      error: 'Source payrollclass context not found.' 
    });
  }

  if (!isValidDatabase(sourceDb) || !isValidDatabase(targetDb)) {
    return res.status(400).json({ 
      success: false, 
      error: 'Invalid source or target payrollclass' 
    });
  }

  if (sourceDb === targetDb) {
    return res.status(400).json({ 
      success: false, 
      error: 'Source and target payroll classes are the same' 
    });
  }

  const targetExists = await checkDatabaseExists(targetDb);
  if (!targetExists) {
    return res.status(400).json({
      success: false,
      error: `Target database "${targetDb}" does not exist.`
    });
  }

  let connection = null;
  let officersConnection = null;

  try {
    const startTime = Date.now();
    connection = await pool.getConnection();

    await connection.beginTransaction();

    // Standardize column names
    console.log(`Standardizing column names...`);
    const standardTables = ['py_payded', 'py_inputhistory'];
    
    await connection.query(`USE \`${sourceDb}\``);
    await standardizeEmployeeIdColumns(connection, sourceDb, standardTables);
    
    await connection.query(`USE \`${targetDb}\``);
    await standardizeEmployeeIdColumns(connection, targetDb, standardTables);
    
    console.log(`✓ Column standardization complete`);

    // Discover migration tables dynamically
    console.log(`🔍 Discovering migration tables...`);
    await connection.query(`USE \`${sourceDb}\``);
    const sourceMigrationTables =  await discoverOrGetDefaultMigrationTables(connection, sourceDb);

    await connection.query(`USE \`${targetDb}\``);
    const targetMigrationTables =  await discoverOrGetDefaultMigrationTables(connection, targetDb);

    const migrationTables = sourceMigrationTables.filter(sourceTable => 
      targetMigrationTables.some(targetTable => targetTable.table === sourceTable.table)
    );

    console.log(`  ✓ Found ${migrationTables.length} migration tables`);
    console.log(`  Tables: ${migrationTables.map(t => `${t.table}(${t.emplIdCol})`).join(', ')}`);

    await connection.query(`USE \`${sourceDb}\``);

    // Get list of employees in range - dynamically build UNION query
    const unionQueries = migrationTables.map(({ table, emplIdCol }) => 
      `SELECT DISTINCT \`${emplIdCol}\` as Empl_ID FROM \`${table}\` WHERE \`${emplIdCol}\` BETWEEN '${startId}' AND '${endId}'`
    ).join(' UNION ');

    if (!unionQueries) {
      throw new Error('No migration tables found in source database');
    }

    const [employees] = await connection.query(unionQueries);

    const totalEmployees = employees.length;

    if (totalEmployees === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({
        success: false,
        error: `No employees found in range ${startId} to ${endId} in source database`
      });
    }

    console.log(` Found ${totalEmployees} employees in range with records`);

    const emplIdList = employees.map(row => row.Empl_ID);

    // Delete existing records in target
    await connection.query(`USE \`${targetDb}\``);
    console.log(`Clearing existing records in target database...`);
    
    if (emplIdList.length > 0) {
      const batchSize = 1000;
      for (let i = 0; i < emplIdList.length; i += batchSize) {
        const batch = emplIdList.slice(i, i + batchSize);
        const placeholders = batch.map(() => '?').join(',');
        
        for (const { table, emplIdCol } of migrationTables) {
          try {
            const [tableExists] = await connection.query(
              `SELECT COUNT(*) as count FROM information_schema.tables 
               WHERE table_schema = ? AND table_name = ?`,
              [targetDb, table]
            );
            
            if (tableExists[0].count > 0) {
              const [columns] = await connection.query(
                `SELECT COLUMN_NAME FROM information_schema.columns 
                 WHERE table_schema = ? AND table_name = ? 
                 AND LOWER(COLUMN_NAME) = LOWER(?)`,
                [targetDb, table, emplIdCol]
              );
              
              const actualColName = columns.length > 0 ? columns[0].COLUMN_NAME : emplIdCol;
              
              await connection.query(
                `DELETE FROM ${table} WHERE \`${actualColName}\` IN (${placeholders})`,
                batch
              );
            }
          } catch (err) {
            console.log(`  ⚠️ Could not delete from ${table}: ${err.message}`);
          }
        }
      }
    }

    // Bulk copy records
    console.log(` Migrating records from source to target...`);
    let totalRelatedRecords = 0;

    for (const { table, emplIdCol } of migrationTables) {
      try {
        const [sourceTableExists] = await connection.query(
          `SELECT COUNT(*) as count FROM information_schema.tables 
           WHERE table_schema = ? AND table_name = ?`,
          [sourceDb, table]
        );
        
        const [targetTableExists] = await connection.query(
          `SELECT COUNT(*) as count FROM information_schema.tables 
           WHERE table_schema = ? AND table_name = ?`,
          [targetDb, table]
        );

        if (sourceTableExists[0].count > 0 && targetTableExists[0].count > 0) {
          const [sourceColumns] = await connection.query(
            `SELECT COLUMN_NAME FROM information_schema.columns 
             WHERE table_schema = ? AND table_name = ? 
             AND LOWER(COLUMN_NAME) = LOWER(?)`,
            [sourceDb, table, emplIdCol]
          );
          
          const sourceColName = sourceColumns.length > 0 ? sourceColumns[0].COLUMN_NAME : emplIdCol;
          
          const batchSize = 1000;
          let processedCount = 0;
          
          for (let i = 0; i < emplIdList.length; i += batchSize) {
            const batch = emplIdList.slice(i, i + batchSize);
            const placeholders = batch.map(() => '?').join(',');
            
            const [countRes] = await connection.query(
              `SELECT COUNT(*) as count FROM \`${sourceDb}\`.${table} 
               WHERE \`${sourceColName}\` IN (${placeholders})`,
              batch
            );
            const recordCount = countRes[0].count;

            if (recordCount > 0) {
              const [records] = await connection.query(
                `SELECT * FROM \`${sourceDb}\`.${table} 
                 WHERE \`${sourceColName}\` IN (${placeholders})`,
                batch
              );
              
              for (const record of records) {
                const cols = Object.keys(record);
                const vals = Object.values(record);
                const colPlaceholders = cols.map(() => '?').join(', ');

                await connection.query(
                  `INSERT INTO \`${targetDb}\`.${table} (\`${cols.join('`, `')}\`) VALUES (${colPlaceholders})`,
                  vals
                );
              }
              
              processedCount += recordCount;
            }
          }
          
          totalRelatedRecords += processedCount;
          console.log(`  ✓ Migrated ${processedCount} records from ${table}`);
        }
      } catch (err) {
        console.log(`  ⚠️ Could not migrate ${table}: ${err.message}`);
      }
    }

    // Bulk delete from source
    await connection.query(`USE \`${sourceDb}\``);
    console.log(`Removing migrated records from source database...`);
    
    for (const { table, emplIdCol } of migrationTables) {
      try {
        const [sourceColumns] = await connection.query(
          `SELECT COLUMN_NAME FROM information_schema.columns 
           WHERE table_schema = ? AND table_name = ? 
           AND LOWER(COLUMN_NAME) = LOWER(?)`,
          [sourceDb, table, emplIdCol]
        );
        
        const sourceColName = sourceColumns.length > 0 ? sourceColumns[0].COLUMN_NAME : emplIdCol;
        
        const batchSize = 1000;
        let totalDeleted = 0;
        
        for (let i = 0; i < emplIdList.length; i += batchSize) {
          const batch = emplIdList.slice(i, i + batchSize);
          const placeholders = batch.map(() => '?').join(',');
          
          const [result] = await connection.query(
            `DELETE FROM ${table} WHERE \`${sourceColName}\` IN (${placeholders})`,
            batch
          );
          totalDeleted += result.affectedRows;
        }
        
        if (totalDeleted > 0) {
          console.log(`  ✓ Deleted ${totalDeleted} records from ${table}`);
        }
      } catch (err) {
        console.log(`  ⚠️ Could not delete from ${table}: ${err.message}`);
      }
    }

    // Update payrollclass in hr_employees (always in officers DB)
    console.log(`Updating payrollclass in ${officersDb}.hr_employees...`);
    officersConnection = await pool.getConnection();
    await officersConnection.query(`USE \`${officersDb}\``);
    
    const batchSize = 1000;
    let totalUpdated = 0;
    
    for (let i = 0; i < emplIdList.length; i += batchSize) {
      const batch = emplIdList.slice(i, i + batchSize);
      const placeholders = batch.map(() => '?').join(',');
      
      const [result] = await officersConnection.query(
        `UPDATE hr_employees SET payrollclass = ? WHERE Empl_ID IN (${placeholders})`,
        [payrollClassInput, ...batch]
      );
      totalUpdated += result.affectedRows;
    }
    
    console.log(`  ✓ Updated payrollclass for ${totalUpdated} employees`);
    officersConnection.release();
    officersConnection = null;

    await connection.commit();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Range migration completed in ${duration} seconds`);

    res.status(200).json({
      success: true,
      message: `Range migration completed successfully`,
      data: {
        Range: `${startId} to ${endId}`,
        TotalEmployees: totalEmployees,
        EmployeesUpdated: totalUpdated,
        TotalRelatedRecords: totalRelatedRecords,
        TotalRecordsMigrated: totalRelatedRecords,
        SourceDatabase: sourceDb,
        TargetDatabase: targetDb,
        SourceDatabaseName: getFriendlyDbName(sourceDb),
        TargetDatabaseName: getFriendlyDbName(targetDb),
        DurationSeconds: duration,
        Timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Range migration failed:', error);
    
    if (connection) {
      try {
        await connection.rollback();
        console.log('⚠️ Transaction rolled back');
      } catch (rollbackError) {
        console.error('❌ Rollback error:', rollbackError);
      }
    }

    res.status(500).json({
      success: false,
      error: 'Range migration failed',
      message: error.message
    });
  } finally {
    if (connection) connection.release();
    if (officersConnection) officersConnection.release();
  }
});

// ==================== HELPER ENDPOINT: Get migration preview ====================
router.get('/payroll-class/preview/:Empl_ID', verifyToken, async (req, res) => {
  const { Empl_ID } = req.params;
  const { PayrollClass } = req.query;

  if (!PayrollClass) {
    return res.status(400).json({ error: 'PayrollClass query parameter required' });
  }

  try {
    const employeeId = Empl_ID.trim();
    const sourceDb = req.current_class;
    const targetDb = getDbNameFromPayrollClass(PayrollClass);

    if (!isValidDatabase(sourceDb) || !isValidDatabase(targetDb)) {
      return res.status(400).json({ error: 'Invalid database selection' });
    }

    const connection = await pool.getConnection();
    await connection.query(`USE \`${sourceDb}\``);

    const [employeeRows] = await connection.query(
      `SELECT Empl_ID, Surname, OtherName, payrollclass FROM hr_employees WHERE Empl_ID = ?`,
      [employeeId]
    );

    if (employeeRows.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'Employee not found' });
    }

    const employee = employeeRows[0];
    const relatedTables = ['py_payded', 'py_inputhistory', 'py_masterpayded'];
    const recordCounts = {};
    let totalRecords = 1;

    for (const table of relatedTables) {
      try {
        const [result] = await connection.query(
          `SELECT COUNT(*) as count FROM ${table} WHERE Empl_ID = ?`,
          [employeeId]
        );
        const count = result[0].count;
        if (count > 0) {
          recordCounts[table] = count;
          totalRecords += count;
        }
      } catch (err) {
        // Table might not exist
      }
    }

    connection.release();

    res.json({
      employee: {
        id: employee.Empl_ID,
        name: `${employee.Surname} ${employee.OtherName || ''}`.trim(),
        currentClass: employee.payrollclass,
        currentClassName: getFriendlyDbName(sourceDb)
      },
      migration: {
        targetClass: PayrollClass,
        targetClassName: getFriendlyDbName(targetDb),
        sourceDatabase: sourceDb,
        sourceDatabaseName: getFriendlyDbName(sourceDb),
        targetDatabase: targetDb,
        targetDatabaseName: getFriendlyDbName(targetDb),
        totalRecords: totalRecords,
        relatedRecords: recordCounts
      },
      warning: 'This operation will move all employee data to the new database and delete from current database. This cannot be undone.'
    });

  } catch (error) {
    console.error('❌ Preview error:', error);
    res.status(500).json({ error: 'Failed to generate preview', details: error.message });
  }
});

module.exports = router;