const express = require('express');
const router = express.Router();
const veriftyToken = require('../../middware/authentication');
router.use(veriftyToken);
const payPeriodReportController = require('../../controllers/audit-trail/inputVariationController');

router.get(
  '/',
  payPeriodReportController.generatePayPeriodReport.bind(payPeriodReportController)
);


router.get(
  '/filter-options',
  payPeriodReportController.getPayPeriodFilterOptions.bind(payPeriodReportController)
);

module.exports = router;


