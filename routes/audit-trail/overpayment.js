const express = require('express');
const router = express.Router();
const verifyToken = require('../../middware/authentication');
router.use(verifyToken);

// Load Overpayment Controller
const overpaymentController = require('../../controllers/audit-trail/varianceAnalysisController');

// Route to get Overpayment Audit Trail
router.get(
  '/get',
  overpaymentController.generateOverpaymentReport.bind(overpaymentController)
);

//Filter options
router.get(
  '/filter-options',
  overpaymentController.getFilterOptions.bind(overpaymentController)
);

module.exports = router;


