const express = require('express');
const router = express.Router();
//const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');

const { savePayrollFiles } = require('../../controllers/file-update/savePayroll');
router.post('/', verifyToken, savePayrollFiles);

module.exports = router;


