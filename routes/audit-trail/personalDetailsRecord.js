const express = require('express');
const router = express.Router();
const verifyToken = require('../../middware/authentication');
router.use(verifyToken);
const personalDetailsRecordController = require('../../controllers/audit-trail/changesPersonnelDetailsController');

router.get(
  '/',
  personalDetailsRecordController.generateChangeHistoryReport.bind(personalDetailsRecordController)
);

router.get(
  '/filter-options',
  personalDetailsRecordController.getChangeHistoryFilterOptions.bind(personalDetailsRecordController)
);

module.exports = router;