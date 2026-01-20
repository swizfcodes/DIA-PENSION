const express = require('express');
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');
const router = express.Router();


// GET ALL ACTIVE DEDUCTIONS (ALL EMPLOYEES)
router.get('/active/all', verifyToken, async (req, res) => {
  try {
    // Get pagination parameters from query string
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const searchQuery = req.query.search || '';

    // Build WHERE clause for search
    let whereClause = '';
    let queryParams = [];
    
    if (searchQuery) {
      whereClause = `WHERE (
        p.Empl_id LIKE ? OR 
        p.type LIKE ? OR 
        pi.inddesc LIKE ?
      )`;
      const searchPattern = `%${searchQuery}%`;
      queryParams = [searchPattern, searchPattern, searchPattern];
    }

    // Get total count with search filter
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM py_payded p
      LEFT JOIN py_payind pi ON p.payind = pi.ind
      ${whereClause}
    `;
    const [countResult] = await pool.query(countQuery, queryParams);
    const totalRecords = countResult[0].total;
    const totalPages = Math.ceil(totalRecords / limit);

    // Modified query with search and pagination
    const query = `
      SELECT 
        p.Empl_id,
        p.type,
        p.mak1 AS delete_maker_annual,
        p.amtp AS amount_payable,
        p.mak2 AS delete_maker_cumulative,
        p.amt,
        p.amtad AS amount_already_deducted,
        p.amttd AS amount_to_date,
        p.payind AS indicator,
        pi.inddesc AS indicator_description,
        p.nomth AS months_remaining,
        p.createdby,
        p.datecreated
      FROM py_payded p
      LEFT JOIN py_payind pi ON p.payind = pi.ind
      ${whereClause}
      ORDER BY p.Empl_id, p.type
      LIMIT ? OFFSET ?
    `;

    // Add limit and offset to query params
    const finalParams = [...queryParams, limit, offset];
    const [rows] = await pool.query(query, finalParams);

    res.json({
      success: true,
      data: rows,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalRecords: totalRecords,
        limit: limit,
        hasPreviousPage: page > 1,
        hasNextPage: page < totalPages
      }
    });
  } catch (error) {
    console.error('Error fetching active deductions:', error);
    res.status(500).json({
      success: false, 
      message: 'Error fetching active deductions',
      error: error.message
    });
  }
});

// NEW: GET ALL ACTIVE DEDUCTIONS FOR REPORT (NO LIMITS)
router.get('/report-all', verifyToken, async (req, res) => {
  try {
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM py_payded p`
    );
    const totalRecords = countResult[0].total;

    const query = `
      SELECT 
        p.Empl_id,
        p.type,
        p.mak1 AS delete_maker_annual,
        p.amtp AS amount_payable,
        p.mak2 AS delete_maker_cumulative,
        p.amt,
        p.amtad AS amount_already_deducted,
        p.amttd AS amount_to_date,
        p.payind AS indicator,
        pi.inddesc AS indicator_description,
        p.nomth AS months_remaining,
        p.createdby,
        p.datecreated
      FROM py_payded p
      LEFT JOIN py_payind pi ON p.payind = pi.ind
      ORDER BY p.Empl_id, p.type
    `;

    const [rows] = await pool.query(query);

    res.json({
        success: true,
        data: rows,
        pagination: {
          totalRecords: totalRecords,
        }
      });
    } catch (error) {
      console.error('Error fetching ALL report deductions:', error);
      res.status(500).json({
          success: false, 
          message: 'Error fetching all report deductions',
          error: error.message
      });
    }
});

//// GET ALL ACTIVE VARIATIONS (ALL EMPLOYEES)
router.get('/active/all-variations', verifyToken, async (req, res) => {
  try {
    // Get pagination parameters from query string
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const searchQuery = req.query.search || '';

    // Build WHERE clause for search
    let searchClause = '';
    let queryParams = [];

    if (searchQuery) {
      searchClause = `AND (
        p.Empl_id LIKE ? OR 
        p.type LIKE ?
      )`;
      const searchPattern = `%${searchQuery}%`;
      queryParams = [searchPattern, searchPattern];
    }

    // Base WHERE clause - filter only variation records (non-numeric amtad)
    const baseWhere = `
      WHERE p.amtad IS NOT NULL 
        AND TRIM(p.amtad) != ''
        AND TRIM(p.amtad) NOT IN ('N/A', 'n/a', 'null', '0', '0.0', '0.00')
        AND TRIM(p.amtad) REGEXP '[^0-9.,]'
    `;

    // Get total count with search filter
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM py_payded p
      ${baseWhere}
      ${searchClause}
    `;

    const [countResult] = await pool.query(countQuery, queryParams);
    const totalRecords = countResult[0].total;
    const totalPages = Math.ceil(totalRecords / limit);

    // Get actual paginated results
    const query = `
      SELECT 
        p.Empl_id,
        p.type,
        p.mak1 AS delete_maker_annual,
        p.amtp AS amount_payable,
        p.mak2 AS delete_maker_cumulative,
        p.amt,
        p.amtad AS amount_already_deducted,
        p.amttd AS amount_to_date,
        p.payind AS indicator,
        pi.inddesc AS indicator_description,
        p.nomth AS months_remaining,
        p.createdby,
        p.datecreated
      FROM py_payded p
      LEFT JOIN py_payind pi ON p.payind = pi.ind
      ${baseWhere}
      ${searchClause}
      ORDER BY p.Empl_id, p.type
      LIMIT ? OFFSET ?
    `;

    const finalParams = [...queryParams, limit, offset];
    const [rows] = await pool.query(query, finalParams);

    res.json({
      success: true,
      data: rows,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalRecords: totalRecords,
        limit: limit,
        hasPreviousPage: page > 1,
        hasNextPage: page < totalPages
      }
    });
  } catch (error) {
    console.error('Error fetching active variations:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching active variations',
      error: error.message
    });
  }
});

//// GET ALL ACTIVE VARIATIONS REPORTS
router.get('/report-all-variations', verifyToken, async (req, res) => {
  try {
    // Base WHERE clause - filter only variation records (non-numeric amtad)
    const baseWhere = `
      WHERE p.amtad IS NOT NULL 
        AND TRIM(p.amtad) != ''
        AND TRIM(p.amtad) NOT IN ('N/A', 'n/a', 'null', '0', '0.0', '0.00')
        AND TRIM(p.amtad) REGEXP '[^0-9.,]'
    `;

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM py_payded p
      ${baseWhere}
    `;

    const [countResult] = await pool.query(countQuery);
    const totalRecords = countResult[0].total;

    // Get all results for report
    const query = `
      SELECT 
        p.Empl_id,
        p.type,
        p.mak1 AS delete_maker_annual,
        p.amtp AS amount_payable,
        p.mak2 AS delete_maker_cumulative,
        p.amt,
        p.amtad AS amount_already_deducted,
        p.amttd AS amount_to_date,
        p.payind AS indicator,
        pi.inddesc AS indicator_description,
        p.nomth AS months_remaining,
        p.createdby,
        p.datecreated
      FROM py_payded p
      LEFT JOIN py_payind pi ON p.payind = pi.ind
      ${baseWhere}
      ORDER BY p.Empl_id, p.type
    `;

    const [rows] = await pool.query(query);

    res.json({
      success: true,
      data: rows,
      pagination: {
        totalRecords: totalRecords,
      }
    });
  } catch (error) {
    console.error('Error fetching active variations:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching active variations',
      error: error.message
    });
  }
});

// GET ALL DEDUCTIONS FOR AN EMPLOYEE
router.get('/:emplId', verifyToken, async (req, res) => {
  try {
    const { emplId } = req.params;
    const { active } = req.query; 

    // Get pagination parameters from query string
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    
    console.log('Pagination - Page:', page, 'Limit:', limit, 'Offset:', offset);

    let query = `
      SELECT 
        p.Empl_id,
        p.type,
        p.mak1 AS delete_maker_annual,
        p.amtp AS amount_payable,
        p.mak2 AS delete_maker_cumulative,
        p.amt,
        p.amtad AS amount_already_deducted,
        p.amttd AS amount_to_date,
        p.payind AS indicator,
        pi.inddesc AS indicator_description,
        p.nomth AS number_of_months,
        p.createdby,
        p.datecreated
      FROM py_payded p
      LEFT JOIN py_payind pi ON p.payind = pi.ind
      WHERE p.Empl_id = ?
    `;

    query += ` ORDER BY p.mak1 ASC, p.datecreated DESC`;

    const [countResult] = await pool.query(
      `SELECT COUNT(*) AS total FROM py_payded WHERE Empl_id = ?`,
      [emplId]
    );
    const totalRecords = countResult[0].total;
    const totalPages = Math.ceil(totalRecords / limit);

    const [rows] = await pool.query(query, [emplId]);

    res.json({
      success: true,
      count: rows.length,
      data: rows,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalRecords: totalRecords,
        limit: limit,
        hasPreviousPage: page > 1,
        hasNextPage: page < totalPages
      }
    });
  } catch (error) {
    console.error('Error fetching deductions:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching deductions',
      error: error.message
    });
  }
});

// GET SPECIFIC DEDUCTION
router.get('/:emplId/:type',  verifyToken, async (req, res) => {
  try {
    const { emplId, type } = req.params;
    const decodedType = decodeURIComponent(type);

    const query = `
      SELECT 
        p.Empl_id,
        p.type,
        p.mak1 AS delete_maker_annual,
        p.amtp AS amount_payable,
        p.mak2 AS delete_maker_cumulative,
        p.amt,
        p.amtad AS amount_already_deducted,
        p.amttd AS amount_to_date,
        p.payind AS indicator,
        pi.inddesc AS indicator_description,
        p.nomth AS number_of_months,
        p.createdby,
        p.datecreated
      FROM py_payded p
      LEFT JOIN py_payind pi ON p.payind = pi.ind
      WHERE p.Empl_id = ? AND p.type = ?
    `;

    const [rows] = await pool.query(query, [emplId, decodedType]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Deduction not found'
      });
    }

    res.json({
      success: true,
      data: rows[0]
    });
  } catch (error) {
    console.error('Error fetching deduction:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching deduction',
      error: error.message
    });
  }
});

// GET DEDUCTION SUMMARY BY EMPLOYEE
router.get('/summary/:emplId',  verifyToken, async (req, res) => {
  try {
    const { emplId } = req.params;

    const query = `
      SELECT 
        Empl_id,
        COUNT(*) AS total_deductions,
        SUM(CASE WHEN mak1 = 'No' THEN 1 ELSE 0 END) AS active_deductions,
        SUM(CASE WHEN mak1 = 'Yes' THEN 1 ELSE 0 END) AS inactive_deductions,
        SUM(CASE WHEN mak1 = 'No' THEN amtp ELSE 0 END) AS total_monthly_deduction,
        SUM(amttd) AS total_deducted_to_date
      FROM py_payded
      WHERE Empl_id = ?
      GROUP BY Empl_id
    `;

    const [rows] = await pool.query(query, [emplId]);

    if (rows.length === 0) {
      return res.json({
        success: true,
        data: {
          Empl_id: emplId,
          total_deductions: 0,
          active_deductions: 0,
          inactive_deductions: 0,
          total_monthly_deduction: 0,
          total_deducted_to_date: 0
        }
      });
    }

    res.json({
      success: true,
      data: rows[0]
    });
  } catch (error) {
    console.error('Error fetching summary:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching summary',
      error: error.message
    });
  }
});


//Create Payded
router.post('/', verifyToken, async (req, res) => {
  try {
    const {
      Empl_id,
      type,
      mak1,
      amtp,
      mak2,
      amttd,
      payind,
      nomth,
    } = req.body;

    const createdby = req.user_fullname;

    // Validation
    if (!Empl_id || !type || !amtp || !payind) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: Empl_id, type, amtp, payind'
      });
    }

    // Check if deduction already exists
    const checkQuery = `
      SELECT * FROM py_payded 
      WHERE Empl_id = ? AND type = ?
    `;
    const [existing] = await pool.query(checkQuery, [Empl_id, type]);

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Payment/Deduction already exists for this employee and type'
      });
    }

    const query = `
      INSERT INTO py_payded (
        Empl_id, type, mak1, amtp, mak2, amttd, 
        amtad, amt, payind, nomth, createdby, datecreated
      ) VALUES (?, ?, ?, ?, ?, ?, 0.00, 0.00, ?, ?, ?, NOW())
    `;

    const [result] = await pool.query(query, [
      Empl_id,
      type,
      mak1,
      amtp,
      mak2,
      amttd,
      payind,
      nomth || 0,
      createdby
    ]);

    // Fetch the created record
    const [newRecord] = await pool.query(
      'SELECT * FROM py_payded WHERE Empl_id = ? AND type = ?',
      [Empl_id, type]
    );

    res.status(201).json({
      success: true,
      message: 'New Payment/Deduction record created successfully',
      data: newRecord[0]
    });
  } catch (error) {
    console.error('Error creating payment/deduction:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating payment/deduction',
      error: error.message
    });
  }
});

//Create Variations 
router.post('/variation', verifyToken, async (req, res) => {
  try {
    const {
      Empl_id,
      type,
      amt,
      amtad,
    } = req.body;

    const createdby = req.user_fullname;

    // Validation
    if (!Empl_id || !type || !amt || !amtad) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: Service No, type, amount, action'
      });
    }

    // Check if variation already exists
    const checkQuery = `
      SELECT * FROM py_payded 
      WHERE Empl_id = ? AND type = ?
    `;
    const [existing] = await pool.query(checkQuery, [Empl_id, type]);

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Variation already exists for this employee and type'
      });
    }

    const query = `
      INSERT INTO py_payded (
        Empl_id, type, amt, 
        amtad, createdby, datecreated
      ) VALUES (?, ?, ?, ?, ?, NOW())
    `;

    const [result] = await pool.query(query, [
      Empl_id,
      type,
      amt,
      amtad,
      createdby
    ]);

    // Fetch the created record
    const [newRecord] = await pool.query(
      'SELECT * FROM py_payded WHERE Empl_id = ? AND type = ?',
      [Empl_id, type]
    );

    res.status(201).json({
      success: true,
      message: 'New Variation to Payment/Deduction record created successfully',
      data: newRecord[0]
    });
  } catch (error) {
    console.error('Error creating a new Variation to payment/deduction:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating a new Variation to payment/deduction',
      error: error.message
    });
  }
});


//Update Payded
router.put('/:emplId/:type',  verifyToken, async (req, res) => {
  try {
    const { emplId, type } = req.params;
    const decodedType = decodeURIComponent(type);
    const { amtp, amttd, mak1, payind, nomth, mak2 } = req.body;

    // Check if record exists
    const checkQuery = `
      SELECT * FROM py_payded 
      WHERE Empl_id = ? AND type = ?
    `;
    const [existing] = await pool.query(checkQuery, [emplId, decodedType]);

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Deduction not found'
      });
    }

    // Build dynamic update query
    const updates = [];
    const values = [];

    if (amtp !== undefined) {
      updates.push('amtp = ?');
      values.push(amtp);
    }
    if (amttd !== undefined) {
      updates.push('amttd = ?');
      values.push(amttd);
    }
    if (mak1 !== undefined) {
      updates.push('mak1 = ?');
      values.push(mak1);
      // If marking for deletion, set amtp to 0
      if (mak1 === 'Yes') {
        updates.push('amtp = 0.00');
      }
    }
    if (mak2 !== undefined) {
      updates.push('mak2 = ?');
      values.push(mak2);
      /*if (mak2 === 'Yes') {
        updates.push('amttd = 0.00');
      }*/
    }
    if (payind !== undefined) {
      updates.push('payind = ?');
      values.push(payind);
    }
    if (nomth !== undefined) {
      updates.push('nomth = ?');
      values.push(nomth);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    updates.push('datecreated = NOW()');
    values.push(emplId, decodedType);

    const query = `
      UPDATE py_payded 
      SET ${updates.join(', ')}
      WHERE Empl_id = ? AND type = ?
    `;

    await pool.query(query, values);

    // Fetch updated record
    const [updated] = await pool.query(
      'SELECT * FROM py_payded WHERE Empl_id = ? AND type = ?',
      [emplId, decodedType]
    );

    res.json({
      success: true,
      message: 'Successfully updated a payment/deduction record',
      data: updated[0]
    });
  } catch (error) {
    console.error('Error updating payment/deduction:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating payment/deduction',
      error: error.message
    });
  }
});

//Update Variations
router.put('/variation/:emplId/:type',  verifyToken, async (req, res) => {
  try {
    const { emplId, type } = req.params;
    const decodedType = decodeURIComponent(type);
    const { amt, amtad } = req.body;

    // Check if record exists
    const checkQuery = `
      SELECT * FROM py_payded 
      WHERE Empl_id = ? AND type = ?
    `;
    const [existing] = await pool.query(checkQuery, [emplId, decodedType]);

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Deduction not found'
      });
    }

    // Build dynamic update query
    const updates = [];
    const values = [];

    if (amtad !== undefined) {
      updates.push('amtad = ?');
      values.push(amtad);
    }
    if (amt !== undefined) {
      updates.push('amt = ?');
      values.push(amt);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    updates.push('datecreated = NOW()');
    values.push(emplId, decodedType);

    const query = `
      UPDATE py_payded 
      SET ${updates.join(', ')}
      WHERE Empl_id = ? AND type = ?
    `;

    await pool.query(query, values);

    // Fetch updated record
    const [updated] = await pool.query(
      'SELECT * FROM py_payded WHERE Empl_id = ? AND type = ?',
      [emplId, decodedType]
    );

    res.json({
      success: true,
      message: 'Successfully updated a Variation to Payment/Deduction record',
      data: updated[0]
    });
  } catch (error) {
    console.error('Error updating a Variation to payment/deduction record:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating a Variation to payment/deduction record',
      error: error.message
    });
  }
});


// DEACTIVATE DEDUCTION (SOFT DELETE)

router.patch('/:emplId/:type/deactivate', verifyToken, async (req, res) => {
  try {
    const { emplId, type } = req.params;
    const decodedType = decodeURIComponent(type);

    const query = `
      UPDATE py_payded
      SET mak1 = 'Yes', amtp = 0.00, datecreated = NOW()
      WHERE Empl_id = ? AND type = ?
    `;

    const [result] = await pool.query(query, [emplId, decodedType]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Deduction not found'
      });
    }

    res.json({
      success: true,
      message: 'Payment/Deduction deactivated successfully',
      affectedRows: result.affectedRows
    });
  } catch (error) {
    console.error('Error deactivating payment/deduction:', error);
    res.status(500).json({
      success: false,
      message: 'Error deactivating payment/deduction',
      error: error.message
    });
  }
});

// REACTIVATE DEDUCTION
router.patch('/:emplId/:type/reactivate', verifyToken, async (req, res) => {
  try {
    const { emplId, type } = req.params;
    const decodedType = decodeURIComponent(type);
    const { amtp } = req.body;

    if (!amtp || amtp <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount payable (amtp) is required'
      });
    }

    const query = `
      UPDATE py_payded
      SET mak1 = 'No', amtp = ?, amt = ?, datecreated = NOW()
      WHERE Empl_id = ? AND type = ?
    `;

    const [result] = await pool.query(query, [amtp, amtp, emplId, decodedType]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Payment/Deduction not found'
      });
    }

    res.json({
      success: true,
      message: 'Payment/Deduction reactivated successfully',
      affectedRows: result.affectedRows
    });
  } catch (error) {
    console.error('Error reactivating payment/deduction:', error);
    res.status(500).json({
      success: false,
      message: 'Error reactivating payment/deduction',
      error: error.message
    });
  }
});

// DELETE DEDUCTION (HARD DELETE)
router.delete('/:emplId/:type', verifyToken, async (req, res) => {
  try {
    const { emplId, type } = req.params;
    const decodedType = decodeURIComponent(type);

    const query = `
      DELETE FROM py_payded
      WHERE Empl_id = ? AND type = ?
    `;

    const [result] = await pool.query(query, [emplId, decodedType]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Deduction not found'
      });
    }

    res.json({
      success: true,
      message: 'Successfully deleted payment/deduction record',
      affectedRows: result.affectedRows
    });
  } catch (error) {
    console.error('Error deleting payment/deduction record:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting payment/deduction record',
      error: error.message
    });
  }
});

// PROCESS MONTHLY DEDUCTIONS FOR EMPLOYEE
router.post('/:emplId/process-monthly', verifyToken, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const { emplId } = req.params;

    await connection.beginTransaction();

    // Update all active deductions for the employee
    const updateQuery = `
      UPDATE py_payded
      SET 
        amttd = amttd + amtp,
        amtad = amtad + amtp,
        nomth = CASE WHEN nomth > 0 THEN nomth - 1 ELSE 0 END,
        mak1 = CASE WHEN nomth <= 1 THEN 'Yes' ELSE mak1 END
      WHERE Empl_id = ?
      AND mak1 = 'No'
      AND amtp > 0
    `;

    const [updateResult] = await connection.query(updateQuery, [emplId]);

    // Get processed deductions
    const selectQuery = `
      SELECT 
        Empl_id,
        type,
        amtp AS amount_deducted,
        amttd AS new_total,
        nomth AS months_remaining,
        mak1 AS status
      FROM py_payded
      WHERE Empl_id = ?
      ORDER BY type
    `;

    const [processed] = await connection.query(selectQuery, [emplId]);

    await connection.commit();

    res.json({
      success: true,
      message: 'Monthly deductions processed successfully',
      affectedRows: updateResult.affectedRows,
      data: processed
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error processing monthly deductions:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing monthly deductions',
      error: error.message
    });
  } finally {
    connection.release();
  }
});

// PROCESS MONTHLY DEDUCTIONS FOR ALL EMPLOYEES
router.post('/process-monthly/all', verifyToken, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    // Update all active deductions
    const updateQuery = `
      UPDATE py_payded
      SET 
        amttd = amttd + amtp,
        amtad = amtad + amtp,
        nomth = CASE WHEN nomth > 0 THEN nomth - 1 ELSE 0 END,
        mak1 = CASE WHEN nomth <= 1 THEN 'Yes' ELSE mak1 END
      WHERE mak1 = 'No'
      AND amtp > 0
    `;

    const [updateResult] = await connection.query(updateQuery);

    // Get summary of processed deductions
    const summaryQuery = `
      SELECT 
        Empl_id,
        COUNT(*) AS deductions_processed,
        SUM(amtp) AS total_amount_deducted
      FROM py_payded
      WHERE mak1 = 'No' OR (mak1 = 'Yes' AND nomth = 0)
      GROUP BY Empl_id
    `;

    const [summary] = await connection.query(summaryQuery);

    await connection.commit();

    res.json({
      success: true,
      message: 'All monthly deductions processed successfully',
      affectedRows: updateResult.affectedRows,
      summary: summary
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error processing all monthly deductions:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing all monthly deductions',
      error: error.message
    });
  } finally {
    connection.release();
  }
});

// GET COMPLETED DEDUCTIONS (nomth = 0)
router.get('/completed/all', verifyToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        Empl_id,
        type,
        amttd AS total_paid,
        nomth,
        mak1 AS status,
        datecreated AS completion_date
      FROM py_payded
      WHERE nomth = 0
      ORDER BY datecreated DESC
    `;

    const [rows] = await pool.query(query);

    res.json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    console.error('Error fetching completed deductions:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching completed deductions',
      error: error.message
    });
  }
});

// CHECK FOR DUPLICATE ACTIVE DEDUCTIONS
router.get('/validation/duplicates', verifyToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        Empl_id,
        type,
        COUNT(*) AS duplicate_count
      FROM py_payded
      WHERE mak1 = 'No'
      GROUP BY Empl_id, type
      HAVING COUNT(*) > 1
    `;

    const [rows] = await pool.query(query);

    res.json({
      success: true,
      hasDuplicates: rows.length > 0,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    console.error('Error checking duplicates:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking duplicates',
      error: error.message
    });
  }
});

// BULK CREATE DEDUCTIONS
router.post('/bulk', verifyToken, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    const deductions = req.body;

    if (!Array.isArray(deductions) || deductions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Request body must be a non-empty array of deductions'
      });
    }

    await connection.beginTransaction();

    const insertQuery = `
      INSERT INTO py_payded (
        Empl_id, type, mak1, amtp, mak2, amt, 
        amtad, amttd, payind, nomth, createdby, datecreated
      ) VALUES (?, ?, 'No', ?, 'No', ?, 0.00, 0.00, ?, ?, ?, NOW())
    `;

    const results = [];
    const errors = [];

    for (let i = 0; i < deductions.length; i++) {
      const { Empl_id, type, amtp, payind, nomth, createdby } = deductions[i];

      try {
        // Validation
        if (!Empl_id || !type || !amtp || !payind) {
          errors.push({
            index: i,
            record: deductions[i],
            error: 'Missing required fields'
          });
          continue;
        }

        // Check if already exists
        const [existing] = await connection.query(
          'SELECT * FROM py_payded WHERE Empl_id = ? AND type = ?',
          [Empl_id, type]
        );

        if (existing.length > 0) {
          errors.push({
            index: i,
            record: deductions[i],
            error: 'Deduction already exists'
          });
          continue;
        }

        await connection.query(insertQuery, [
          Empl_id,
          type,
          amtp,
          amtp,
          payind,
          nomth || 0,
          createdby || 'SYSTEM'
        ]);

        results.push({
          index: i,
          Empl_id,
          type,
          status: 'created'
        });
      } catch (err) {
        errors.push({
          index: i,
          record: deductions[i],
          error: err.message
        });
      }
    }

    if (errors.length === deductions.length) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: 'All records failed to insert',
        errors: errors
      });
    }

    await connection.commit();

    res.status(201).json({
      success: true,
      message: `${results.length} deductions created successfully`,
      created: results.length,
      failed: errors.length,
      results: results,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error bulk creating deductions:', error);
    res.status(500).json({
      success: false,
      message: 'Error bulk creating deductions',
      error: error.message
    });
  } finally {
    connection.release();
  }
});


module.exports = router;



