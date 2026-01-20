const express = require('express');
const router = express.Router();
const pool = require('../../config/db'); // Your MySQL connection
const verifyToken = require('../../middware/authentication');

// CREATE - Add new pay system
router.post('/paysystem', verifyToken, async (req, res) => {
  try {
    const {
      comp_code, comp_name, Address, Processyear, processmonth,
      createdby, salaryscale, retireage, hrlink, town, lg, state,
      email, box, tel, serveraddr, serverport, email_pword,
      mthly_tax, runtype, company_image, notes
    } = req.body;

    const query = `
      INSERT INTO py_paysystem (
        comp_code, comp_name, Address, Processyear, processmonth,
        createdby, salaryscale, retireage, hrlink, town, lg, state,
        email, box, tel, serveraddr, serverport, email_pword,
        mthly_tax, runtype, company_image, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await pool.query(query, [
      comp_code, comp_name, Address, Processyear, processmonth,
      createdby, salaryscale, retireage, hrlink, town, lg, state,
      email, box, tel, serveraddr, serverport, email_pword,
      mthly_tax, runtype, company_image, notes
    ]);

    res.status(201).json({
      success: true,
      message: 'Pay system created successfully',
      data: { id: result.insertId }
    });
  } catch (error) {
    console.error('Error creating pay system:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create pay system'
    });
  }
});

// READ - Get all pay systems
router.get('/paysystem', verifyToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        Id, comp_code, comp_name, Address, Processyear, processmonth,
        datecreated, createdby, salaryscale, retireage, hrlink, town,
        lg, state, email, box, tel, serveraddr, serverport, email_pword,
        mthly_tax, runtype, company_image, notes
      FROM py_paysystem
      ORDER BY datecreated DESC
    `;

    const [rows] = await pool.query(query);

    res.json({
      success: true,
      data: rows
    });
  } catch (error) {
    console.error('Error fetching pay systems:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch pay systems'
    });
  }
});

// READ - Get single pay system by ID
router.get('/paysystem/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      SELECT 
        Id, comp_code, comp_name, Address, Processyear, processmonth,
        datecreated, createdby, salaryscale, retireage, hrlink, town,
        lg, state, email, box, tel, serveraddr, serverport, email_pword,
        mthly_tax, runtype, company_image, notes
      FROM py_paysystem
      WHERE Id = ?
    `;

    const [rows] = await pool.query(query, [id]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Pay system not found'
      });
    }

    res.json({
      success: true,
      data: rows[0]
    });
  } catch (error) {
    console.error('Error fetching pay system:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch pay system'
    });
  }
});

// UPDATE - Update pay system
router.put('/paysystem/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate ID first
    if (!id || id === 'null' || id === 'undefined') {
      return res.status(400).json({
        success: false,
        error: 'Invalid pay system ID. Please ensure a record exists first.'
      });
    }

    const {
      comp_code, comp_name, Address, Processyear, processmonth,
      createdby, salaryscale, retireage, hrlink, town, lg, state,
      email, box, tel, serveraddr, serverport, email_pword,
      mthly_tax, runtype, company_image, notes
    } = req.body;

    const query = `
      UPDATE py_paysystem SET
        comp_code = ?, comp_name = ?, Address = ?, Processyear = ?,
        processmonth = ?, createdby = ?, salaryscale = ?, retireage = ?,
        hrlink = ?, town = ?, lg = ?, state = ?, email = ?, box = ?,
        tel = ?, serveraddr = ?, serverport = ?, email_pword = ?,
        mthly_tax = ?, runtype = ?, company_image = ?, notes = ?
      WHERE Id = ?
    `;

    // Convert all undefined values to null
    const params = [
      comp_code ?? null,
      comp_name ?? null,
      Address ?? null,
      Processyear ?? null,
      processmonth ?? null,
      createdby ?? null,
      salaryscale ?? null,
      retireage ?? null,
      hrlink ?? null,
      town ?? null,
      lg ?? null,
      state ?? null,
      email ?? null,
      box ?? null,
      tel ?? null,
      serveraddr ?? null,
      serverport ?? null,
      email_pword ?? null,
      mthly_tax ?? null,
      runtype ?? null,
      company_image ?? null,
      notes ?? null,
      id
    ];

    const [result] = await pool.query(query, params);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Pay system not found'
      });
    }

    res.json({
      success: true,
      message: 'Pay system updated successfully'
    });
  } catch (error) {
    console.error('Error updating pay system:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update pay system'
    });
  }
});

// DELETE - Delete pay system (soft delete recommended in production)
router.delete('/paysystem/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const query = 'DELETE FROM py_paysystem WHERE Id = ?';
    const [result] = await pool.query(query, [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'Pay system not found'
      });
    }

    res.json({
      success: true,
      message: 'Pay system deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting pay system:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete pay system'
    });
  }
});

module.exports = router;


