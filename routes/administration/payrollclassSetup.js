const express = require('express');
const router = express.Router();
const verifyToken = require('../../middware/authentication');
const { attachPayrollClass } = require('../../middware/attachPayrollClass');
const pool  = require('../../config/db'); // mysql2 pool



// ==================== DATABASE MAPPING ====================
async function getDatabaseForClass(classcode) {
  const masterDb = pool.getMasterDb();
  const connection = await pool.getConnection();
  try {
    await connection.query(`USE \`${masterDb}\``);
    const [rows] = await connection.query(
      'SELECT db_name FROM py_payrollclass WHERE classcode = ?',
      [classcode]
    );
    return rows.length > 0 ? rows[0].db_name : null;
  } finally {
    connection.release();
  }
}

// ==================== CREATE ====================
router.post('/create', verifyToken, async (req, res) => {
  const { classcode, classname } = req.body;

  // Validation
  if (!classcode || classcode.trim() === '') {
    return res.status(400).json({ error: 'Class code is required' });
  }

  if (classcode.length > 5) {
    return res.status(400).json({ error: 'Class code must not exceed 5 characters' });
  }

  if (classname && classname.length > 30) {
    return res.status(400).json({ error: 'Class name must not exceed 30 characters' });
  }

  try {
    // Get the database for this specific class code
    const classDatabase = await getDatabaseForClass(classcode);
    
    if (!classDatabase) {
      return res.status(400).json({ 
        error: `No database mapping found for class code: ${classcode}` 
      });
    }

    // Get year and month from THIS class's py_stdrate table
    const [stdrate] = await pool.query(
      `SELECT ord AS year, mth AS month FROM ${classDatabase}.py_stdrate WHERE type = 'BT05' LIMIT 1`
    );

    if (stdrate.length === 0) {
      return res.status(404).json({ 
        error: `Payroll period not found in ${classDatabase}.py_stdrate` 
      });
    }

    const { year, month } = stdrate[0];

    // Store in py_payrollclass with the database name for future reference
    const query = `
      INSERT INTO py_payrollclass (classcode, classname, db_name, year, month)
      VALUES (?, ?, ?, ?, ?)
    `;

    await pool.query(query, [
      classcode.trim(),
      classname ? classname.trim() : null,
      classDatabase,
      year,
      month
    ]);

    res.status(201).json({
      message: 'New Payroll class created successfully',
      data: {
        classcode: classcode.trim(),
        classname: classname ? classname.trim() : null,
        db_name: classDatabase,
        year: year,
        month: month
      }
    });

  } catch (error) {
    console.error('Error creating payroll class:', error);

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        error: 'Payroll class with this code already exists for this period'
      });
    }

    res.status(500).json({ error: 'Failed to create payroll class' });
  }
});

// ==================== READ (with individual database lookup) ====================
router.get('/', verifyToken, async (req, res) => {
  try {
    // First, get all payroll classes
    const [classes] = await pool.query(`
      SELECT classcode, classname, db_name, 
             LOWER(COALESCE(status, 'inactive')) AS status
      FROM py_payrollclass
      ORDER BY classcode ASC
    `);

    // For each class, fetch year/month from its own database
    const classesWithPeriod = await Promise.all(
      classes.map(async (cls) => {
        try {
          // Get database for this class
          const dbName = cls.db_name || await getDatabaseForClass(cls.classcode);
          
          if (!dbName) {
            console.warn(`No database found for class ${cls.classcode}`);
            return {
              ...cls,
              year: null,
              month: null
            };
          }

          // Query THIS class's py_stdrate table
          const [stdrate] = await pool.query(
            `SELECT ord AS year, mth AS month FROM ${dbName}.py_stdrate WHERE type = 'BT05' LIMIT 1`
          );

          return {
            ...cls,
            year: stdrate[0]?.year || null,
            month: stdrate[0]?.month || null
          };
        } catch (error) {
          console.error(`Error fetching period for class ${cls.classcode}:`, error);
          return {
            ...cls,
            year: null,
            month: null
          };
        }
      })
    );

    res.status(200).json({
      message: 'Payroll classes retrieved successfully',
      data: classesWithPeriod,
      count: classesWithPeriod.length
    });

  } catch (error) {
    console.error('Error fetching payroll classes:', error);
    res.status(500).json({ error: 'Failed to fetch payroll classes' });
  }
});

// ==================== UPDATE ====================
router.put('/:classcode', verifyToken, async (req, res) => {
  const { classcode } = req.params;
  const { newClasscode, classname, status } = req.body;

  // Validation
  if (classname && classname.length > 30) {
    return res.status(400).json({ error: 'Class name must not exceed 30 characters' });
  }

  if (status && !['active', 'inactive'].includes(status.toLowerCase())) {
    return res.status(400).json({ error: 'Status must be either "active" or "inactive"' });
  }

  try {
    // Check if record exists
    const [existing] = await pool.query(
      `SELECT * FROM py_payrollclass WHERE classcode = ?`,
      [classcode]
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: 'Payroll class not found' });
    }

    // Check if new classcode already exists
    if (newClasscode && newClasscode !== classcode) {
      const [duplicate] = await pool.query(
        `SELECT classcode FROM py_payrollclass WHERE classcode = ?`,
        [newClasscode]
      );
      if (duplicate.length > 0) {
        return res.status(400).json({ error: 'New class code already exists' });
      }

      // If changing classcode, update the db_name mapping too
      const newDbName = await getDatabaseForClass(newClasscode);
      if (newDbName) {
        const [updateDb] = await pool.query(
          `UPDATE py_payrollclass SET db_name = ? WHERE classcode = ?`,
          [newDbName, classcode]
        );
      }
    }

    // Build dynamic query
    const fields = [];
    const values = [];

    if (newClasscode) {
      fields.push('classcode = ?');
      values.push(newClasscode.trim());
    }

    if (classname) {
      fields.push('classname = ?');
      values.push(classname.trim());
    }

    if (status) {
      fields.push('status = ?');
      values.push(status.toLowerCase());
    }

    fields.push('dateupdated = NOW()');

    if (fields.length === 1) {
      return res.status(400).json({ error: 'No fields provided for update' });
    }

    values.push(classcode);

    const updateQuery = `
      UPDATE py_payrollclass
      SET ${fields.join(', ')}
      WHERE classcode = ?
    `;

    await pool.query(updateQuery, values);

    res.status(200).json({
      message: 'Payroll class updated successfully',
      data: {
        classcode: newClasscode || classcode,
        classname,
        status,
        dateupdated: new Date().toISOString().slice(0, 19).replace('T', ' ')
      }
    });

  } catch (error) {
    console.error('Error updating payroll class:', error);
    res.status(500).json({ error: 'Failed to update payroll class' });
  }
});

// ==================== DELETE ====================
router.delete('/:classcode', verifyToken, async (req, res) => {
  const { classcode } = req.params;

  try {
    const [existing] = await pool.query(
      `SELECT classcode FROM py_payrollclass WHERE classcode = ?`,
      [classcode]
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: 'Payroll class not found' });
    }

    await pool.query(`DELETE FROM py_payrollclass WHERE classcode = ?`, [classcode]);

    res.status(200).json({
      message: 'Payroll class deleted successfully',
      data: { classcode }
    });

  } catch (error) {
    console.error('Error deleting payroll class:', error);

    if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.errno === 1451) {
      return res.status(409).json({
        error: 'Cannot delete payroll class. It is being referenced by other records.'
      });
    }

    res.status(500).json({ error: 'Failed to delete payroll class' });
  }
});

module.exports = router;