const express = require('express');
const router = express.Router();
const veriftyToken = require('../../middware/authentication');
router.use(veriftyToken);
const personnelReportController = require('../../controllers/Reports/personnelReportController');

router.get(
  '/',
  personnelReportController.generatePersonnelReport.bind(personnelReportController)
);

router.get(
  '/filter-options',
  personnelReportController.getPersonnelFilterOptions.bind(personnelReportController)
);

module.exports = router;


