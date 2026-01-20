const express = require('express');
const router = express.Router();
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');


const { calculatePayroll } = require('../../controllers/payroll-calculations/payrollCalculation');
router.post('/', verifyToken, calculatePayroll);

const { getCalculationResults } = require('../../controllers/payroll-calculations/payrollCalculation');
router.get('/results', verifyToken, getCalculationResults);

module.exports = router;


