const express = require('express');
const router = express.Router();
//const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');

const { inputVariables } = require('../../controllers/file-update/inputVariable');
router.post('/', verifyToken, inputVariables);

const { getInputVariablesView} = require('../../controllers/file-update/inputVariable');
router.get('/view', verifyToken, getInputVariablesView);

const { getLoanRecords } = require('../../controllers/file-update/inputVariable');
router.get('/loans', getLoanRecords);

const { exportInputVariablesPdf } = require('../../controllers/file-update/inputVariable');
router.get('/export/pdf', verifyToken, exportInputVariablesPdf);

const { exportInputVariablesExcel } = require('../../controllers/file-update/inputVariable');
router.get('/export/excel', verifyToken, exportInputVariablesExcel);

module.exports = router;



