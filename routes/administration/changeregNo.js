const express = require('express');
const router = express.Router();
const verifyToken = require('../../middware/authentication');
const pool = require('../../config/db');


/**
 * Maps database name to payroll class code from py_payrollclass
 * @param {string} dbName - Current database name
 * @returns {string} Payroll class code
 */
async function getPayrollClassFromDb(dbName) {
  const masterDb = pool.getMasterDb();
  const connection = await pool.getConnection();
  
  try {
    await connection.query(`USE \`${masterDb}\``);
    const [rows] = await connection.query(
      'SELECT classcode FROM py_payrollclass WHERE db_name = ?',
      [dbName]
    );
    
    const result = rows.length > 0 ? rows[0].classcode : null;
    console.log('🔍 Database:', dbName, '→ Payroll Class:', result);
    return result;
  } finally {
    connection.release();
  }
}

/**
 * Hardcoded fallback list of py_* tables and their employee ID columns.
 * Used when dynamic discovery finds nothing in the current database.
 */
function getDefaultPayrollTables() {
  return [
    // INPUT TABLES
    { table: 'py_payded',          emplIdCol: 'Empl_ID'   },
    { table: 'py_cumulated',       emplIdCol: 'Empl_ID'   },
    { table: 'py_header',          emplIdCol: 'Empl_ID'   },
    { table: 'py_operative',       emplIdCol: 'Empl_ID'   },
    { table: 'py_overtime',        emplIdCol: 'Empl_ID'   },
    { table: 'py_documentation',   emplIdCol: 'doc_numb'  },
    // ARCHIVE TABLES
    { table: 'py_ipis_payhistory', emplIdCol: 'numb'      },
    { table: 'py_payhistory',      emplIdCol: 'his_empno' },
    { table: 'py_inputhistory',    emplIdCol: 'Empl_ID'   },
    // MASTER TABLES
    { table: 'py_masterpayded',    emplIdCol: 'his_Empno' },
    { table: 'py_mastercum',       emplIdCol: 'his_Empno' },
    { table: 'py_masterover',      emplIdCol: 'his_Empno' },
    { table: 'py_masterope',       emplIdCol: 'his_Empno' },
    { table: 'py_calculation',     emplIdCol: 'his_empno' },
    { table: 'py_oneoffhistory',   emplIdCol: 'his_empno' },
  ];
}

// HR child tables — Spouse, Children, NextOfKin are all in MASTER_TABLES
// so pool.query qualifies them to MASTER_DB automatically.
// NOTE: pass the bare table name (no backticks) in queries so qualifyMasterTables
// regex can match and rewrite it correctly.
const HR_CHILD_TABLES = ['Children', 'NextOfKin', 'Spouse'];

// ──────────────────────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Dynamically discover all py_* tables in the current DB that have an
 * employee-ID-like column. Returns [{table, emplIdCol}].
 */
async function discoverPayrollTables(database) {
  try {
    const [tables] = await pool.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = ?
         AND table_type = 'BASE TABLE'
         AND table_name LIKE 'py_%'
         AND table_name NOT IN ('py_payrollclass', 'py_setup')
       ORDER BY table_name`,
      [database]
    );

    const discovered = [];
    for (const { table_name } of tables) {
      const [cols] = await pool.query(
        `SELECT COLUMN_NAME
         FROM information_schema.columns
         WHERE table_schema = ? AND table_name = ?
           AND (
             COLUMN_NAME REGEXP '^[Ee]mpl_?[Ii][Dd]$'
             OR COLUMN_NAME REGEXP '^his_[Ee]mpno$'
             OR COLUMN_NAME = 'doc_numb'
             OR COLUMN_NAME = 'numb'
             OR LOWER(COLUMN_NAME) IN ('empl_id','emplid','empl_no','his_empno','doc_numb','numb')
           )
         ORDER BY
           CASE
             WHEN COLUMN_NAME = 'Empl_ID'          THEN 1
             WHEN LOWER(COLUMN_NAME) = 'empl_id'   THEN 2
             WHEN LOWER(COLUMN_NAME) = 'his_empno' THEN 3
             WHEN COLUMN_NAME = 'doc_numb'         THEN 4
             WHEN COLUMN_NAME = 'numb'             THEN 5
             ELSE 6
           END
         LIMIT 1`,
        [database, table_name]
      );
      if (cols.length > 0) {
        discovered.push({ table: table_name, emplIdCol: cols[0].COLUMN_NAME });
      }
    }
    return discovered;
  } catch {
    return [];
  }
}

/**
 * Resolve the case-correct column name via information_schema.
 * Falls back to the supplied name if not found.
 */
async function resolveColumnName(database, table, column) {
  try {
    const [rows] = await pool.query(
      `SELECT COLUMN_NAME
       FROM information_schema.columns
       WHERE table_schema = ? AND table_name = ? AND LOWER(COLUMN_NAME) = LOWER(?)`,
      [database, table, column]
    );
    return rows.length > 0 ? rows[0].COLUMN_NAME : column;
  } catch {
    return column;
  }
}

/**
 * Returns true if `column` is part of the PRIMARY KEY for the given table.
 */
async function isPrimaryKey(database, table, column) {
  try {
    const [rows] = await pool.query(
      `SELECT COLUMN_NAME
       FROM information_schema.columns
       WHERE table_schema = ? AND table_name = ? AND LOWER(COLUMN_NAME) = LOWER(?)
         AND COLUMN_KEY = 'PRI'`,
      [database, table, column]
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

// ==================== GET ALL EMPLOYEES ====================
router.get('/employees', verifyToken, async (req, res) => {
  try {
    const currentDb = pool.getCurrentDatabase(req.user_id.toString());
    const payrollClass = await getPayrollClassFromDb(currentDb);

    const [rows] = await pool.query(
      `SELECT Empl_ID, Title, Surname, OtherName
       FROM hr_employees
       WHERE (DateLeft IS NULL OR DateLeft = '')
         AND (exittype IS NULL OR exittype = '')
         AND payrollclass = ?`,
      [payrollClass]
    );

    res.status(200).json({
      message: 'Employees retrieved successfully',
      data: rows,
      count: rows.length
    });
  } catch (error) {
    console.error('Error fetching employees:', error);
    res.status(500).json({ error: 'Failed to fetch employees', details: error.message });
  }
});

// ==================== UPDATE EMPLOYEE REGISTRATION NUMBER ====================
/**
 * PUT /update-regno
 *
 * Updates Empl_ID across all tables in the pool's current database.
 *
 * - hr_employees, Children, NextOfKin, Spouse are in MASTER_TABLES so pool.query
 *   auto-qualifies them to MASTER_DB via qualifyMasterTables.
 *   IMPORTANT: pass bare table names (no backticks) in query strings so the
 *   regex in qualifyMasterTables can match and rewrite them correctly.
 *
 * - py_* payroll tables belong to the session DB and go through conn.query
 *   inside the transaction.
 *
 * - SET FOREIGN_KEY_CHECKS is session-level so it wraps outside the transaction,
 *   restored in a finally block.
 */
router.put('/update-regno', verifyToken, async (req, res) => {
  const { oldRegNo, newRegNo } = req.body;

  if (!oldRegNo || !newRegNo) {
    return res.status(400).json({ error: 'Both current and new registration numbers are required.' });
  }
  if (oldRegNo.trim() === newRegNo.trim()) {
    return res.status(400).json({ error: 'New registration number cannot be the same as the old one.' });
  }

  const oldId     = oldRegNo.trim();
  const newId     = newRegNo.trim();
  const currentDb = pool.getCurrentDatabase(req.user_id.toString());
  const masterDb  = pool.getMasterDb();

  console.log(`🔄 update-regno: "${oldId}" → "${newId}" | database: ${currentDb}`);

  try {
    // ── 1. Pre-flight checks ──────────────────────────────────────────────────
    // pool.query qualifies hr_employees → MASTER_DB automatically
    const [existingEmployee] = await pool.query(
      'SELECT Empl_ID FROM hr_employees WHERE Empl_ID = ?',
      [oldId]
    );
    if (existingEmployee.length === 0) {
      return res.status(404).json({ error: `No employee found with registration number "${oldId}".` });
    }

    const [taken] = await pool.query(
      'SELECT Empl_ID FROM hr_employees WHERE Empl_ID = ?',
      [newId]
    );
    if (taken.length > 0) {
      return res.status(400).json({ error: `The registration number "${newId}" already exists.` });
    }

    // ── 2. Discover py_* tables (before the transaction) ─────────────────────
    let payrollTables = await discoverPayrollTables(currentDb);

    if (payrollTables.length === 0) {
      console.log('  ⚠️ Dynamic discovery found no py_ tables — using fallback list');
      const defaults = getDefaultPayrollTables();
      for (const entry of defaults) {
        const [tc] = await pool.query(
          `SELECT COUNT(*) AS cnt
           FROM information_schema.tables
           WHERE table_schema = ? AND table_name = ?`,
          [currentDb, entry.table]
        );
        if (tc[0].cnt > 0) payrollTables.push(entry);
      }
    }
    console.log(`  ✓ ${payrollTables.length} py_* table(s) found`);

    // ── 3. FK checks off — session-level, outside the transaction ────────────
    await pool.rawQuery('SET FOREIGN_KEY_CHECKS = 0');

    let updateLog;
    try {
      updateLog = await pool.transaction(async (conn) => {
        const log = [];

        // ── hr_employees (PK) ─────────────────────────────────────────────────
        // Bare table name — qualifyMasterTables rewrites to MASTER_DB.Children etc.
        const [hrResult] = await pool.query(
          'UPDATE hr_employees SET Empl_ID = ? WHERE Empl_ID = ?',
          [newId, oldId]
        );
        log.push({ table: 'hr_employees', rows: hrResult.affectedRows, pk: true });
        console.log(`  ✓ hr_employees (PK) → ${hrResult.affectedRows} row(s)`);

        // ── HR child tables (FK) ──────────────────────────────────────────────
        // Children, NextOfKin, Spouse are all in MASTER_TABLES.
        // Use bare table name in the query string so qualifyMasterTables matches it.
        for (const childTable of HR_CHILD_TABLES) {
          try {
            const [tableCheck] = await pool.query(
              `SELECT COUNT(*) AS cnt
               FROM information_schema.tables
               WHERE table_schema = ? AND table_name = ?`,
              [masterDb, childTable]
            );
            if (tableCheck[0].cnt === 0) continue;

            const col = await resolveColumnName(masterDb, childTable, 'Empl_ID');

            const [result] = await pool.query(
              `UPDATE ${childTable} SET \`${col}\` = ? WHERE \`${col}\` = ?`,
              [newId, oldId]
            );
            log.push({ table: childTable, rows: result.affectedRows, fk: true });
            if (result.affectedRows > 0) {
              console.log(`  ✓ ${childTable} (FK) → ${result.affectedRows} row(s)`);
            }
          } catch (err) {
            console.warn(`  ⚠️ Could not update ${childTable}: ${err.message}`);
            log.push({ table: childTable, rows: 0, error: err.message });
          }
        }

        // ── py_* payroll tables ───────────────────────────────────────────────
        // These belong to the session DB — go through conn so they're part of
        // the transaction and roll back together on failure.
        for (const { table, emplIdCol } of payrollTables) {
          try {
            const col   = await resolveColumnName(currentDb, table, emplIdCol);
            const colPK = await isPrimaryKey(currentDb, table, col);

            const [result] = await conn.query(
              `UPDATE \`${table}\` SET \`${col}\` = ? WHERE \`${col}\` = ?`,
              [newId, oldId]
            );
            if (result.affectedRows > 0) {
              log.push({ table, rows: result.affectedRows, pk: colPK });
              console.log(`  ✓ ${table}.${col}${colPK ? ' (PK)' : ''} → ${result.affectedRows} row(s)`);
            }
          } catch (err) {
            console.warn(`  ⚠️ Could not update ${table}: ${err.message}`);
            log.push({ table, rows: 0, error: err.message });
          }
        }

        return log;
      });
    } finally {
      // Always restore — whether transaction succeeded or threw
      await pool.rawQuery('SET FOREIGN_KEY_CHECKS = 1');
    }

    const totalRows = updateLog.reduce((sum, e) => sum + (e.rows || 0), 0);
    const tablesHit = updateLog.filter(e => e.rows > 0).length;
    console.log(`✅ Done: "${oldId}" → "${newId}" | ${totalRows} row(s) across ${tablesHit} table(s)`);

    return res.status(200).json({
      message: 'Registration number updated successfully.',
      data: {
        oldRegNo:         oldId,
        newRegNo:         newId,
        database:         currentDb,
        totalRowsUpdated: totalRows,
        breakdown:        updateLog
      }
    });

  } catch (error) {
    console.error('❌ Error updating registration number:', error);
    return res.status(500).json({
      error:   'Failed to update registration number.',
      details: error.message
    });
  }
});

module.exports = router;