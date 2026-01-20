const express = require('express');
const router = express.Router();
const verifyToken = require('../../middware/authentication');
router.use(verifyToken);
const duplicateAccountController = require('../../controllers/audit-trail/duplicateAccnoController');

router.get(
  '/',
  duplicateAccountController.generateDuplicateAccountReport.bind(duplicateAccountController)
);

router.get(
  '/filter-options',
  duplicateAccountController.getDuplicateAccountFilterOptions.bind(duplicateAccountController)
);

module.exports = router;


