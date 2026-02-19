const express = require('express');
const router = express.Router();
const pool = require('../../../config/db.js');
const verifyToken = require('../../../middware/authentication.js');

//Get individual payment by empno
router.get('/:his_empno', verifyToken, async (req, res) => {
    const his_empno = req.params.his_empno.replace(/_SLASH_/g, '/');
    try {
        const [rows] = await pool.query('SELECT his_empno, his_type, amtthismth FROM py_calculation WHERE his_empno = ?', [his_empno]);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error fetching individual payments:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

//get all
router.get('/', verifyToken, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT his_empno, his_type, amtthismth FROM py_calculation');
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error fetching all individual payments:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
});

//Add new individual payment
router.post('/create', verifyToken, async (req, res) => {
    const { his_empno, his_type, amtthismth } = req.body;
    const createdby = req.user_fullname;

    try {
        const [result] = await pool.query(
            'INSERT INTO py_calculation (his_empno, his_type, amtthismth, createdby) VALUES (?, ?, ?, ?)',
            [his_empno, his_type, amtthismth, createdby]
        );
        res.json({ 
          success: true,
          message: 'Individual one-off payment added successfully',
          data: result 
          });
    } catch (error) {
        console.error('Error adding individual payment:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
});

//update individual payment (using composite key)
router.put('/:his_empno/:his_type', verifyToken, async (req, res) => {
  try {
    // Decode placeholders back into real slashes
    const his_empno = req.params.his_empno.replace(/_SLASH_/g, '/');
    const his_type = req.params.his_type.replace(/_SLASH_/g, '/');
    const { amtthismth } = req.body;

    const [result] = await pool.query(
      'UPDATE py_calculation SET amtthismth = ? WHERE his_empno = ? AND his_type = ?',
      [amtthismth, his_empno, his_type]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'No matching payment record found for update'
      });
    }

    res.json({ success: true, message: 'Individual one-off payment updated successfully', data: result });
  } catch (error) {
    console.error('Error updating individual payment:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});


//delete individual payment (using composite key)
router.delete('/:his_empno/:his_type', verifyToken, async (req, res) => {
    const his_empno  = req.params.his_empno.replace(/_SLASH_/g, '/');
    const his_type  = req.params.his_type.replace(/_SLASH_/g, '/');
    try {
        const [result] = await pool.query('DELETE FROM py_calculation WHERE his_empno = ? AND his_type = ?', [his_empno, his_type]);
        res.json({ success: true, message: 'Individual one-off payment deleted successfully', data: result });
    } catch (error) {
        console.error('Error deleting individual payment:', error);
        res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
});

module.exports = router;