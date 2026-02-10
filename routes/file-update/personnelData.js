const express = require('express');
const router = express.Router();
const verifyToken = require('../../middware/authentication');
router.use(verifyToken);

const personnelDetailsController = require('../../controllers/file-update/personnelData');

// ========================================
// EMPLOYEE CHANGE HISTORY ROUTES
// ========================================

// Generate change history report (main endpoint)
router.get(
  '/',
  personnelDetailsController.generateChangeHistoryReport.bind(personnelDetailsController)
);

// Get change history filter options
router.get(
  '/filter-options',
  personnelDetailsController.getChangeHistoryFilterOptions.bind(personnelDetailsController)
);

module.exports = router;