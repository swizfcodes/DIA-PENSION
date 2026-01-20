const express = require('express');
const router = express.Router();
const verifyToken = require('../../middware/authentication');
router.use(verifyToken);

// Load Salary Variance Controller
const salaryVarianceController = require('../../controllers/audit-trail/varianceAnalysisController');

// Route to get Salary Variance Audit Trail
router.get(
  '/',
  salaryVarianceController.generateSalaryVarianceReport.bind(salaryVarianceController)
);

//Filter options
router.get(
  '/filter-options',
  salaryVarianceController.getFilterOptions.bind(salaryVarianceController)
);

module.exports = router;


