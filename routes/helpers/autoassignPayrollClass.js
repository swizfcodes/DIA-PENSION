const express = require('express');
const pool = require('../../config/db'); // mysql2 pool
const router = express.Router();

// ==================== DATABASE CONFIGURATION ====================
const DATABASE_MAP = {
  [process.env.DB_OFFICERS || 'hicaddata']: { name: 'OFFICERS', code: '1' },
  [process.env.DB_WOFFICERS || 'hicaddata1']: { name: 'W/OFFICERS', code: '2' },
  [process.env.DB_RATINGS || 'hicaddata2']: { name: 'RATE A', code: '3' },
  [process.env.DB_RATINGS_A || 'hicaddata3']: { name: 'RATE B', code: '4' },
  [process.env.DB_RATINGS_B || 'hicaddata4']: { name: 'RATE C', code: '5' },
  [process.env.DB_JUNIOR_TRAINEE || 'hicaddata5']: { name: 'TRAINEE', code: '6' }
};

const PAYROLL_CLASS_TO_DB_MAP = {
  '1': process.env.DB_OFFICERS || 'hicaddata',
  '2': process.env.DB_WOFFICERS || 'hicaddata1',
  '3': process.env.DB_RATINGS || 'hicaddata2',
  '4': process.env.DB_RATINGS_A || 'hicaddata3',
  '5': process.env.DB_RATINGS_B || 'hicaddata4',
  '6': process.env.DB_JUNIOR_TRAINEE || 'hicaddata5',
  'OFFICERS': process.env.DB_OFFICERS || 'hicaddata',
  'W/OFFICERS': process.env.DB_WOFFICERS || 'hicaddata1',
  'W.OFFICERS': process.env.DB_WOFFICERS || 'hicaddata1',
  'RATE A': process.env.DB_RATINGS || 'hicaddata2',
  'RATEA': process.env.DB_RATINGS || 'hicaddata2',
  'RATE B': process.env.DB_RATINGS_A || 'hicaddata3',
  'RATEB': process.env.DB_RATINGS_A || 'hicaddata3',
  'RATE C': process.env.DB_RATINGS_B || 'hicaddata4',
  'RATEC': process.env.DB_RATINGS_B || 'hicaddata4',
  'JUNIOR/TRAINEE': process.env.DB_JUNIOR_TRAINEE || 'hicaddata5',
  'JUNIORTRAINEE': process.env.DB_JUNIOR_TRAINEE || 'hicaddata5',
  'hicaddata': process.env.DB_OFFICERS || 'hicaddata',
  'hicaddata1': process.env.DB_WOFFICERS || 'hicaddata1',
  'hicaddata2': process.env.DB_RATINGS || 'hicaddata2',
  'hicaddata3': process.env.DB_RATINGS_A || 'hicaddata3',
  'hicaddata4': process.env.DB_RATINGS_B || 'hicaddata4',
  'hicaddata5': process.env.DB_JUNIOR_TRAINEE || 'hicaddata5',
  [process.env.DB_OFFICERS || 'hicaddata']: process.env.DB_OFFICERS || 'hicaddata',
  [process.env.DB_WOFFICERS || 'hicaddata1']: process.env.DB_WOFFICERS || 'hicaddata1',
  [process.env.DB_RATINGS || 'hicaddata2']: process.env.DB_RATINGS || 'hicaddata2',
  [process.env.DB_RATINGS_A || 'hicaddata3']: process.env.DB_RATINGS_A || 'hicaddata3',
  [process.env.DB_RATINGS_B || 'hicaddata4']: process.env.DB_RATINGS_B || 'hicaddata4',
  [process.env.DB_JUNIOR_TRAINEE || 'hicaddata5']: process.env.DB_JUNIOR_TRAINEE || 'hicaddata5'
};

// ==================== HELPER FUNCTIONS ====================
function getPayrollClassFromDb(dbName) {
  const dbInfo = DATABASE_MAP[dbName];
  return dbInfo ? dbInfo.code : null;
}

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

// ==================== AUTO-ASSIGN PAYROLL CLASS ====================
async function autoAssignPayrollClass(dbName) {
  let connection = null;
  try {
    const payrollCode = getPayrollClassFromDb(dbName);
    
    if (!payrollCode) {
      console.log(`⚠️ No payroll class mapping found for database: ${dbName}`);
      return { updated: 0, error: 'No mapping found' };
    }

    console.log(`🔄 Checking for unassigned employees in database: ${dbName} (Class: ${payrollCode})`);

    connection = await pool.getConnection();
    await connection.query(`USE \`${dbName}\``);

    // Step 1: Check if payroll class exists in py_payrollclass
    const [payrollClassCheck] = await connection.query(
      `SELECT classcode, classname FROM py_payrollclass WHERE classcode = ?`,
      [payrollCode]
    );

    let payrollClassName = getFriendlyDbName(dbName);

    if (payrollClassCheck.length === 0) {
      // Payroll class doesn't exist, create it
      console.log(`⚠️ Payroll class ${payrollCode} not found in py_payrollclass, creating it...`);
      
      await connection.query(
        `INSERT INTO py_payrollclass (classcode, classname) VALUES (?, ?)`,
        [payrollCode, payrollClassName]
      );
      
      console.log(`✅ Created payroll class: ${payrollCode} - ${payrollClassName}`);
    } else {
      payrollClassName = payrollClassCheck[0].classname;
      console.log(`✓ Payroll class ${payrollCode} exists: ${payrollClassName}`);
    }

    // Step 2: Update employees with NULL or empty payrollclass
    const [result] = await connection.query(
      `UPDATE hr_employees 
       SET payrollclass = ?
       WHERE (payrollclass IS NULL OR payrollclass = '' OR payrollclass = '0')
       AND (DateLeft IS NULL OR DateLeft = '')
       AND (exittype IS NULL OR exittype = '')`,
      [payrollCode]
    );

    if (result.affectedRows > 0) {
      console.log(`✅ Auto-assigned ${result.affectedRows} employee(s) to payroll class "${payrollCode}" (${payrollClassName})`);
    }

    // Step 3: Check for mismatched payroll classes (employees with wrong class for this DB)
    const [mismatchedEmployees] = await connection.query(
      `SELECT COUNT(*) as count 
       FROM hr_employees 
       WHERE payrollclass != ? 
       AND payrollclass IS NOT NULL 
       AND payrollclass != ''
       AND (DateLeft IS NULL OR DateLeft = '')
       AND (exittype IS NULL OR exittype = '')`,
      [payrollCode]
    );

    let correctedMismatches = 0;
    if (mismatchedEmployees[0].count > 0) {
      console.log(`⚠️ Found ${mismatchedEmployees[0].count} employee(s) with incorrect payroll class in ${dbName}`);
      console.log(`   Correcting to match database: ${payrollCode} (${payrollClassName})`);
      
      const [correctResult] = await connection.query(
        `UPDATE hr_employees 
         SET payrollclass = ?
         WHERE payrollclass != ? 
         AND payrollclass IS NOT NULL 
         AND payrollclass != ''
         AND (DateLeft IS NULL OR DateLeft = '')
         AND (exittype IS NULL OR exittype = '')`,
        [payrollCode, payrollCode]
      );
      
      correctedMismatches = correctResult.affectedRows;
      console.log(`✅ Corrected ${correctedMismatches} mismatched employee(s)`);
    }

    connection.release();

    return { 
      updated: result.affectedRows,
      corrected: correctedMismatches,
      total: result.affectedRows + correctedMismatches,
      payrollClass: payrollCode,
      payrollClassName: payrollClassName,
      database: dbName,
      friendlyName: getFriendlyDbName(dbName)
    };

  } catch (error) {
    console.error(`❌ Error auto-assigning payroll class in ${dbName}:`, error.message);
    if (connection) connection.release();
    return { updated: 0, corrected: 0, total: 0, error: error.message };
  }
}

module.exports = { 
  autoAssignPayrollClass,
  getPayrollClassFromDb,
  getDbNameFromPayrollClass,
  getFriendlyDbName,
  isValidDatabase,
  checkDatabaseExists,
  DATABASE_MAP,
  PAYROLL_CLASS_TO_DB_MAP
};


