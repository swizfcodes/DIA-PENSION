const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const verifyToken = require('../../middware/authentication');
const pool  = require('../../config/db'); // mysql2 pool

const SECRET = process.env.JWT_SECRET;

const getDISPLAY_MAPPING = async () => {
  const masterDb = pool.getMasterDb();
  const connection = await pool.getConnection();
  
  try {
    await connection.query(`USE \`${masterDb}\``);
    const [rows] = await connection.query(
      'SELECT db_name, classname FROM py_payrollclass'
    );

    const DISPLAY_MAPPING = {};
    rows.forEach(({ db_name, classname }) => {
      DISPLAY_MAPPING[db_name] = classname;
    });

    return DISPLAY_MAPPING;
  } finally {
    connection.release();
  }
};

//const DISPLAY_MAPPING = await getDISPLAY_MAPPING();

// Get all available database classes (for populating the table)
router.get('/dbclasses', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT classcode, classname, db_name, status
      FROM py_payrollclass
      WHERE status = 'active'
    `);

    // mark which is primary & current
    const classes = rows.map(row => ({
      id: row.db_name, // unique db identifier
      display: row.classname,
      dbName: row.db_name,
      isPrimary: row.classname === req.primary_class,
      isActive: row.db_name === req.current_class,
      hasAccess: true
    }));

    res.json({
      classes,
      currentClass: req.current_class,
      primaryClass: req.primary_class,
      userId: req.user_id
    });

  } catch (err) {
    console.error('❌ Error loading db_classes:', err);
    res.status(500).json({ error: 'Failed to load classes' });
  }
});

// Switch payroll class (temporary for session)
router.post('/switch-class', verifyToken, async (req, res) => {
  try {
    const { targetClass } = req.body; // could be classname OR db_name
    const userId = req.user_id;

    console.log(`\n🔄 User ${userId} attempting to switch to: ${targetClass}`);

    // First, resolve targetClass to db_name
    let targetDbName = targetClass;
    
    // Try lookup by classname first
    let [classRows] = await pool.query(`
      SELECT classcode, classname, db_name, status
      FROM py_payrollclass
      WHERE classname = ? AND status = 'active'
    `,
    [targetClass]
    );

    // If not found, try lookup by db_name
    if (classRows.length === 0) {
      [classRows] = await pool.query(`
        SELECT classcode, classname, db_name, status
        FROM py_payrollclass
        WHERE db_name = ? AND status = 'active'
      `,
      [targetClass]
      );
    }

    if (classRows.length === 0) {
      return res.status(400).json({ error: 'Invalid class selected' });
    }

    const selectedClass = classRows[0];
    targetDbName = selectedClass.db_name;

    console.log(`✅ Resolved target class: ${selectedClass.classname} (${targetDbName})`);

    // Simply switch to the target database
    // User can work in ANY database, not restricted to their primary_class
    pool.useDatabase(targetDbName);

    // Generate new token with updated current_class
    // Keep primary_class and other user info from current token
    const newPayload = {
      user_id: req.user_id,
      full_name: req.user_fullname,
      role: req.user_role,
      primary_class: req.primary_class, // Keep their home database
      current_class: targetDbName, // Update to new working database
      created_in: req.created_in || req.primary_class // Track where user record exists
    };

    const newToken = jwt.sign(newPayload, SECRET, { expiresIn: '6h' });

    console.log(`\n✅ Successfully switched user ${userId} to ${targetDbName}`);
    console.log(`   Primary class (home): ${req.primary_class}`);
    console.log(`   Current class (working): ${targetDbName} (${selectedClass.classname})`); // ✅ Added class name

    res.json({
      success: true,
      message: `Switched to ${selectedClass.classname} successfully.`,
      token: newToken,
      newClass: {
        id: selectedClass.db_name,
        display: selectedClass.classname
      },
      isPrimary: selectedClass.db_name === req.primary_class,
      switchedAt: new Date().toISOString()
    });

  } catch (err) {
    console.error('❌ Switch class error:', err);
    res.status(500).json({ error: 'Failed to switch class' });
  }
});

// Get current session info
router.get('/session-info', verifyToken, async (req, res) => {
  try {
    const DISPLAY_MAPPING = await getDISPLAY_MAPPING();
    
    res.json({
      userId: req.user_id,
      fullName: req.user_fullname,
      role: req.user_role,
      primaryClass: {
        id: req.primary_class,
        display: DISPLAY_MAPPING[req.primary_class] || req.primary_class.toUpperCase()
      },
      currentClass: {
        id: req.current_class,
        display: DISPLAY_MAPPING[req.current_class] || req.current_class.toUpperCase()
      },
      isWorkingOnPrimary: req.primary_class === req.current_class
    });
  } catch (error) {
    console.error('❌ Session info error:', error);
    res.status(500).json({ error: 'Failed to get session info' });
  }
});

// Reset to primary class
router.post('/reset-to-primary', verifyToken, async (req, res) => {
  try {
    const DISPLAY_MAPPING = await getDISPLAY_MAPPING();
    
    // Create new JWT with current_class reset to primary_class
    const newPayload = {
      user_id: req.user_id,
      full_name: req.user_fullname,
      role: req.user_role,
      primary_class: req.primary_class,
      current_class: req.primary_class // Reset to primary (e.g., back to 'hicaddata')
    };
    
    const newToken = jwt.sign(newPayload, SECRET, { expiresIn: '24h' });
    
    console.log(`🔄 User ${req.user_fullname} reset to primary class: ${req.primary_class}`);
    
    res.json({
      success: true,
      message: `Reset to primary class: ${DISPLAY_MAPPING[req.primary_class] || req.primary_class}`,
      token: newToken,
      resetAt: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Reset to primary error:', error);
    res.status(500).json({ 
      error: 'Failed to reset to primary class',
      message: error.message 
    });
  }
});

module.exports = router;