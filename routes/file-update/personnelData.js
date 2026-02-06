/*const express = require('express');
const router = express.Router();
const pool = require('../../config/db'); // mysql2 pool
const verifyToken = require('../../middware/authentication');

const { getAvailablePeriods } = require('../../controllers/file-update/personnelData');
router.get('/periods', verifyToken, getAvailablePeriods);

const { getEmployeesListPaginated } = require('../../controllers/file-update/personnelData');
router.get('/employees', verifyToken, getEmployeesListPaginated);

const {checkEmployeesInPrevious} = require('../../controllers/file-update/personnelData');
router.get('/check-previous', verifyToken, checkEmployeesInPrevious);

const { getPreviousPersonnelDetails } = require('../../controllers/file-update/personnelData');
router.get('/previous', verifyToken, getPreviousPersonnelDetails);

const {getCurrentPersonnelDetails  } = require('../../controllers/file-update/personnelData');
router.get('/current', verifyToken, getCurrentPersonnelDetails );

const {getPersonnelDetailsView  } = require('../../controllers/file-update/personnelData');
router.get('/view', verifyToken, getPersonnelDetailsView );

const { getPersonnelAnalysis } = require('../../controllers/file-update/personnelData');
router.get('/analysis', verifyToken, getPersonnelAnalysis);

const { getPersonnelDetailsComparison } = require('../../controllers/file-update/personnelData');
router.get('/compare', verifyToken, getPersonnelDetailsComparison);

const { searchPreviousPersonnelDetails } = require('../../controllers/file-update/personnelData');
router.get('/previous/search', verifyToken, searchPreviousPersonnelDetails);

const { searchCurrentPersonnelDetails } = require('../../controllers/file-update/personnelData');
router.get('/current/search', verifyToken, searchCurrentPersonnelDetails);

const { exportPreviousDetailsExcel  } = require('../../controllers/file-update/personnelData');
router.get('/export/excel-prev', verifyToken, exportPreviousDetailsExcel);

const { exportCurrentDetailsExcel } = require('../../controllers/file-update/personnelData');
router.get('/export/excel-cur', verifyToken, exportCurrentDetailsExcel);

const { exportAnalysisExcel } = require('../../controllers/file-update/personnelData');
router.get('/analysis/export/excel', verifyToken, exportAnalysisExcel);

const { exportPreviousDetailsPDF } = require('../../controllers/file-update/personnelData');
router.get('/export/pdf-prev', verifyToken, exportPreviousDetailsPDF);

const { exportCurrentDetailsPDF } = require('../../controllers/file-update/personnelData');
router.get('/export/pdf-cur', verifyToken, exportCurrentDetailsPDF);

// Update BT05 to 775
router.put('/update-stage', verifyToken, async (req, res) => {
  const user = req.user?.fullname || req.user_fullname || 'System Auto';

  await pool.query(
    "UPDATE py_stdrate SET sun = 775, createdby = ? WHERE type = 'BT05'", 
    [user]
  );
  res.json({ message: 'Personnel data changes printed.' });
});

module.exports = router;
*/