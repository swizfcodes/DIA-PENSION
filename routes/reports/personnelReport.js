const express = require('express');
const router = express.Router();
const veriftyToken = require('../../middware/authentication');
router.use(veriftyToken);
const personnelReportController = require('../../controllers/Reports/personnelReportController');
const oldPersonnelReportController = require('../../controllers/Reports/oldPersonnelReportsController')

router.get(
  '/',
  personnelReportController.generatePersonnelReport.bind(personnelReportController)
);

router.get(
  '/old',
  oldPersonnelReportController.generateOldPersonnelReport.bind(oldPersonnelReportController)
);

router.get(
  '/filter-options',
  personnelReportController.getPersonnelFilterOptions.bind(personnelReportController)
);

router.get(
  '/filter-options-old',
  oldPersonnelReportController.getOldPersonnelFilterOptions.bind(oldPersonnelReportController)
);

module.exports = router;