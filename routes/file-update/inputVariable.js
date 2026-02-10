const express = require('express');
const router = express.Router();
const veriftyToken = require('../../middware/authentication');
router.use(veriftyToken);
const inputVariableController = require('../../controllers/file-update/inputVariable');

router.get(
  '/',
  inputVariableController.generatePayPeriodReport.bind(inputVariableController)
);

module.exports = router;