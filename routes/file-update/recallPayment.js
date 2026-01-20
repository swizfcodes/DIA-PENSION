const express = require('express');
const router = express.Router();
//const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');

const { recallPayrollFiles } = require('../../controllers/file-update/recallPayment');
router.post('/', verifyToken, recallPayrollFiles);

module.exports = router;


