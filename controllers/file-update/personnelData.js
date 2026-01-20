const pool = require('../../config/db');
const personnelDetailsService = require('../../services/file-update/personnelData');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

/**
 * GET: Get available periods for filtering
 */
exports.getAvailablePeriods = async (req, res) => {
  try {
    const periods = await personnelDetailsService.getAvailablePeriods();
    
    res.json({
      status: 'SUCCESS',
      periods
    });
  } catch (err) {
    console.error('Error getting available periods:', err);
    res.status(500).json({ 
      status: 'FAILED', 
      message: err.message 
    });
  }
};

/**
 * GET: Get list of all employees for selection
 */
exports.getEmployeesList = async (req, res) => {
  try {
    const employees = await personnelDetailsService.getEmployeesList();
    
    res.json({
      status: 'SUCCESS',
      totalEmployees: employees.length,
      employees
    });
  } catch (err) {
    console.error('Error getting employees list:', err);
    res.status(500).json({ 
      status: 'FAILED', 
      message: err.message 
    });
  }
};

/**
 * GET: Get employees list with pagination (MySQL version)
 */
exports.getEmployeesListPaginated = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    // Get total count
    const [countResult] = await pool.query(
      'SELECT COUNT(DISTINCT Empl_ID) AS total FROM hr_employees'
    );
    const totalRecords = parseInt(countResult.total);
    const totalPages = Math.ceil(totalRecords / limit);

    // Get paginated employees
    const [employees] = await pool.query(
      `SELECT DISTINCT Empl_ID,
        CONCAT(Surname, ' ', OtherName) AS full_name
       FROM hr_employees
       ORDER BY Empl_ID
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    res.json({
      status: 'SUCCESS',
      totalEmployees: totalRecords,
      currentPage: page,
      totalPages,
      hasMore: page < totalPages,
      employees
    });

  } catch (err) {
    console.error('Error getting employees list:', err);
    res.status(500).json({
      status: 'FAILED',
      message: err.message
    });
  }
};

/**
 * GET: Check which employees exist in previous report
 */
exports.checkEmployeesInPrevious = async (req, res) => {
  try {
    const { 
      startPeriod,
      endPeriod,
      employeeIds
    } = req.query;

    // Validate required parameters
    if (!startPeriod || !endPeriod) {
      return res.status(400).json({
        status: 'FAILED',
        error: 'Start and end periods are required'
      });
    }

    if (!employeeIds) {
      return res.status(400).json({
        status: 'FAILED',
        error: 'employeeIds parameter is required'
      });
    }

    // Parse comma-separated employee IDs
    const emplIdArray = employeeIds.split(',').map(id => id.trim()).filter(Boolean);

    if (emplIdArray.length === 0) {
      return res.json({
        status: 'SUCCESS',
        employeeIds: []
      });
    }

    // Build query with MySQL placeholders
    const placeholders = emplIdArray.map(() => '?').join(',');
    
    const query = `
      SELECT DISTINCT Empl_ID 
      FROM py_emplhistory 
      WHERE period >= ? 
        AND period <= ? 
        AND Empl_ID IN (${placeholders})
    `;

    const params = [startPeriod, endPeriod, ...emplIdArray];
    const [rows] = await pool.query(query, params);

    const existingEmployeeIds = rows.map(row => row.Empl_ID);

    res.json({
      status: 'SUCCESS',
      employeeIds: existingEmployeeIds,
      checkedCount: emplIdArray.length,
      foundCount: existingEmployeeIds.length
    });
  } catch (err) {
    console.error('Error checking employees in previous:', err);
    res.status(500).json({ 
      status: 'FAILED', 
      message: err.message 
    });
  }
};

/**
 * GET: Previous personnel details from py_emplhistory
 */
exports.getPreviousPersonnelDetails = async (req, res) => {
  try {
    const { 
      startPeriod, 
      endPeriod, 
      employeeId,
      page = 1,
      limit = 50
    } = req.query;

    // Validate required filters
    if (!startPeriod && !endPeriod) {
      return res.status(400).json({
        status: 'FAILED',
        error: 'At least one period (startPeriod or endPeriod) is required'
      });
    }

    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );

    if (!bt05Rows.length) {
      return res.status(404).json({ 
        status: 'FAILED',
        error: 'BT05 not found - processing period not set' 
      });
    }

    const { year, month } = bt05Rows[0];
    const user = req.user_fullname || 'System Auto';

    const result = await personnelDetailsService.getPreviousPersonnelDetails(
      year, 
      month, 
      user, 
      {
        startPeriod,
        endPeriod,
        employeeId,
        page: parseInt(page),
        limit: parseInt(limit)
      }
    );

    res.json({
      status: 'SUCCESS',
      reportType: 'PREVIOUS_DETAILS',
      filters: { startPeriod, endPeriod, employeeId },
      retrievedAt: new Date().toISOString(),
      records: result.records,
      pagination: result.pagination
    });
  } catch (err) {
    console.error('Error getting previous personnel details:', err);
    res.status(500).json({ 
      status: 'FAILED', 
      message: err.message 
    });
  }
};

/**
 * GET: Current personnel details - filtered by employees in previous report
 */
exports.getCurrentPersonnelDetails = async (req, res) => {
  try {
    const { 
      startPeriod,
      endPeriod,
      employeeId,
      page = 1,
      limit = 5
    } = req.query;

    // Validate required filters
    if (!startPeriod || !endPeriod) {
      return res.status(400).json({
        status: 'FAILED',
        error: 'Start and end periods are required to match with previous report'
      });
    }

    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );

    if (!bt05Rows.length) {
      return res.status(404).json({ 
        status: 'FAILED',
        error: 'BT05 not found - processing period not set' 
      });
    }

    const { year, month } = bt05Rows[0];
    const user = req.user_fullname || 'System Auto';

    // First, get the list of employee IDs from previous report
    // FIXED: Changed from PostgreSQL ($1, $2) to MySQL (?) placeholders
    let prevEmployeeIdsQuery = `
      SELECT DISTINCT Empl_ID 
      FROM py_emplhistory 
      WHERE period >= ? AND period <= ?
    `;
    const prevParams = [startPeriod, endPeriod];
    
    if (employeeId) {
      prevEmployeeIdsQuery += ` AND Empl_ID = ?`;
      prevParams.push(employeeId);
    }

    const [prevEmployeeIds] = await pool.query(prevEmployeeIdsQuery, prevParams);
    
    if (prevEmployeeIds.length === 0) {
      return res.json({
        status: 'SUCCESS',
        reportType: 'CURRENT_DETAILS',
        filters: { startPeriod, endPeriod, employeeId },
        retrievedAt: new Date().toISOString(),
        records: [],
        pagination: { page: 1, limit, totalPages: 0, totalRecords: 0 }
      });
    }

    const emplIds = prevEmployeeIds.map(row => row.Empl_ID);

    // Now get current data only for those employee IDs
    const result = await personnelDetailsService.getCurrentPersonnelDetailsFiltered(
      year, 
      month, 
      user, 
      {
        employeeIds: emplIds,
        page: parseInt(page),
        limit: parseInt(limit)
      }
    );

    res.json({
      status: 'SUCCESS',
      reportType: 'CURRENT_DETAILS',
      filters: { startPeriod, endPeriod, employeeId },
      retrievedAt: new Date().toISOString(),
      records: result.records,
      pagination: result.pagination
    });
  } catch (err) {
    console.error('Error getting current personnel details:', err);
    res.status(500).json({ 
      status: 'FAILED', 
      message: err.message 
    });
  }
};

/**
 * GET: Analysis - categorize personnel by new, changes, old
 */
exports.getPersonnelAnalysis = async (req, res) => {
  try {
    const { 
      startPeriod, 
      endPeriod, 
      filter = 'all',
      searchQuery,
      page = 1,
      limit = 5
    } = req.query;

    if (!startPeriod || !endPeriod) {
      return res.status(400).json({
        status: 'FAILED',
        error: 'Start and end periods are required'
      });
    }

    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );

    if (!bt05Rows.length) {
      return res.status(404).json({ 
        status: 'FAILED',
        error: 'BT05 not found' 
      });
    }

    const { year, month } = bt05Rows[0];
    
    const result = await personnelDetailsService.getPersonnelAnalysis(
      year, 
      month, 
      {
        startPeriod,
        endPeriod,
        filter,
        searchQuery,
        page: parseInt(page),
        limit: parseInt(limit)
      }
    );

    res.json({
      status: 'SUCCESS',
      reportType: 'ANALYSIS',
      filters: { startPeriod, endPeriod, filter, searchQuery },
      retrievedAt: new Date().toISOString(),
      records: result.records,
      stats: result.stats,
      pagination: result.pagination
    });
  } catch (err) {
    console.error('Error getting personnel analysis:', err);
    res.status(500).json({ 
      status: 'FAILED', 
      message: err.message 
    });
  }
};

/**
 * GET: Comparison between previous and current details
 */
exports.getPersonnelDetailsComparison = async (req, res) => {
  try {
    const { 
      startPeriod, 
      endPeriod, 
      employeeId,
      page = 1,
      limit = 20
    } = req.query;

    // Validate required filters
    if (!startPeriod && !endPeriod) {
      return res.status(400).json({
        status: 'FAILED',
        error: 'At least one period (startPeriod or endPeriod) is required'
      });
    }

    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );

    if (!bt05Rows.length) {
      return res.status(404).json({ 
        status: 'FAILED',
        error: 'BT05 not found - processing period not set' 
      });
    }

    const { year, month } = bt05Rows[0];
    const user = req.user_fullname || 'System Auto';

    const result = await personnelDetailsService.getPersonnelDetailsComparison(
      year, 
      month, 
      user, 
      {
        startPeriod,
        endPeriod,
        employeeId,
        page: parseInt(page),
        limit: parseInt(limit)
      }
    );

    res.json({
      status: 'SUCCESS',
      reportType: 'COMPARISON',
      filters: { startPeriod, endPeriod, employeeId },
      retrievedAt: new Date().toISOString(),
      records: result.records,
      pagination: result.pagination
    });
  } catch (err) {
    console.error('Error getting personnel details comparison:', err);
    res.status(500).json({ 
      status: 'FAILED', 
      message: err.message 
    });
  }
};

/**
 * GET: View last generated personnel reports (stage must be >= 775)
 */
exports.getPersonnelDetailsView = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 5,
      reportType = 'previous' // 'previous' or 'current'
    } = req.query;

    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month, sun FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );

    if (!bt05Rows.length) {
      return res.status(404).json({ 
        status: 'FAILED',
        error: 'BT05 not found - processing period not set' 
      });
    }

    const { year, month, sun } = bt05Rows[0];

    // Check if stage is ready (must be >= 775)
    if (sun < 775) {
      return res.status(400).json({ 
        status: 'FAILED',
        error: 'Personnel details reports are not ready for viewing.',
        currentStage: sun,
        requiredStage: 775
      });
    }

    const user = req.user?.fullname || req.user_fullname || 'System Auto';

    // Calculate period filter: Previous 2 YEARS from current BT05 period
    const currentPeriod = `${year}${String(month).padStart(2, '0')}`;
    const endPeriod = currentPeriod;
    
    // Calculate start period (2 years back)
    const startYear = parseInt(year) - 23;
    const startMonth = parseInt(month);
    const startPeriod = `${startYear}${String(startMonth).padStart(2, '0')}`;

    let result;
    let filters = { startPeriod, endPeriod };

    if (reportType === 'previous') {
      result = await personnelDetailsService.getPreviousPersonnelDetails(
        year, 
        month, 
        user, 
        {
          startPeriod,
          endPeriod,
          employeeId: null,
          page: parseInt(page),
          limit: parseInt(limit)
        }
      );
    } else {
      // For current: Get employee IDs from previous report first
      const prevEmployeeIdsQuery = `
        SELECT DISTINCT Empl_ID 
        FROM py_emplhistory 
        WHERE period >= ? AND period <= ?
      `;
      const [prevEmployeeIds] = await pool.query(prevEmployeeIdsQuery, [startPeriod, endPeriod]);
      
      if (prevEmployeeIds.length === 0) {
        result = {
          records: [],
          pagination: { page: 1, limit, totalPages: 0, totalRecords: 0 }
        };
      } else {
        const emplIds = prevEmployeeIds.map(row => row.Empl_ID);
        
        // Get current details filtered by those employee IDs
        result = await personnelDetailsService.getCurrentPersonnelDetailsFiltered(
          year, 
          month, 
          user, 
          {
            employeeIds: emplIds,
            page: parseInt(page),
            limit: parseInt(limit)
          }
        );
      }
    }

    res.json({
      status: 'SUCCESS',
      stage: sun,
      reportType: reportType.toUpperCase(),
      filters,
      retrievedAt: new Date().toISOString(),
      records: result.records,
      pagination: result.pagination
    });
  } catch (err) {
    console.error('Error fetching personnel details for view:', err);
    res.status(500).json({ 
      status: 'FAILED', 
      message: err.message 
    });
  }
};

/**
 * GET: Search previous personnel details (MySQL version)
 */
exports.searchPreviousPersonnelDetails = async (req, res) => {
  try {
    const { 
      startPeriod, 
      endPeriod, 
      employeeId,
      searchQuery,
      page = 1,
      limit = 5
    } = req.query;

    if (!startPeriod || !endPeriod) {
      return res.status(400).json({
        status: 'FAILED',
        error: 'Start and end periods are required'
      });
    }

    if (!searchQuery) {
      return res.status(400).json({
        status: 'FAILED',
        error: 'Search query is required'
      });
    }

    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type = 'BT05' LIMIT 1"
    );

    if (!bt05Rows.length) {
      return res.status(404).json({ 
        status: 'FAILED',
        error: 'BT05 not found' 
      });
    }

    const { year, month } = bt05Rows[0];
    const user = req.user_fullname || 'System Auto';

    const result = await personnelDetailsService.searchPreviousPersonnelDetails(
      year, 
      month, 
      user, 
      {
        startPeriod,
        endPeriod,
        employeeId,
        searchQuery,
        page: parseInt(page),
        limit: parseInt(limit)
      }
    );

    res.json({
      status: 'SUCCESS',
      reportType: 'PREVIOUS_DETAILS_SEARCH',
      filters: { startPeriod, endPeriod, employeeId, searchQuery },
      retrievedAt: new Date().toISOString(),
      records: result.records,
      pagination: result.pagination
    });

  } catch (err) {
    console.error('Error searching previous personnel details:', err);
    res.status(500).json({ 
      status: 'FAILED', 
      message: err.message 
    });
  }
};

/**
 * GET: Search current personnel details (MySQL version)
 */
exports.searchCurrentPersonnelDetails = async (req, res) => {
  try {
    const { 
      startPeriod,
      endPeriod,
      employeeId,
      searchQuery,
      page = 1,
      limit = 5
    } = req.query;

    if (!startPeriod || !endPeriod) {
      return res.status(400).json({
        status: 'FAILED',
        error: 'Start and end periods are required'
      });
    }

    if (!searchQuery) {
      return res.status(400).json({
        status: 'FAILED',
        error: 'Search query is required'
      });
    }

    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type = 'BT05' LIMIT 1"
    );

    if (!bt05Rows.length) {
      return res.status(404).json({ 
        status: 'FAILED',
        error: 'BT05 not found' 
      });
    }

    const { year, month } = bt05Rows[0];
    const user = req.user_fullname || 'System Auto';

    const result = await personnelDetailsService.searchCurrentPersonnelDetails(
      year, 
      month, 
      user, 
      {
        startPeriod,
        endPeriod,
        employeeId,
        searchQuery,
        page: parseInt(page),
        limit: parseInt(limit)
      }
    );

    res.json({
      status: 'SUCCESS',
      reportType: 'CURRENT_DETAILS_SEARCH',
      filters: { startPeriod, endPeriod, employeeId, searchQuery },
      retrievedAt: new Date().toISOString(),
      records: result.records,
      pagination: result.pagination
    });

  } catch (err) {
    console.error('Error searching current personnel details:', err);
    res.status(500).json({ 
      status: 'FAILED', 
      message: err.message 
    });
  }
};

/**
 * GET: Export previous personnel details to Excel
 */
exports.exportPreviousDetailsExcel = async (req, res) => {
  try {
    const { startPeriod, endPeriod, employeeId } = req.query;

    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );

    if (!bt05Rows.length) {
      return res.status(404).json({ error: 'BT05 not found' });
    }

    const { year, month } = bt05Rows[0];

    // Get all records for export
    const records = await personnelDetailsService.getAllPreviousDetailsForExport({
      startPeriod,
      endPeriod,
      employeeId
    });

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Previous Personnel Details');

    // Add header
    worksheet.addRow(['PREVIOUS PERSONNEL DETAILS REPORT']);
    worksheet.addRow([`Period: ${month}/${year}`]);
    worksheet.addRow([`Generated: ${new Date().toLocaleString()}`]);
    worksheet.addRow([`Filters: Period ${startPeriod || 'N/A'} to ${endPeriod || 'N/A'}${employeeId && employeeId !== 'ALL' ? `, Employee: ${employeeId}` : ', All Employees'}`]);
    worksheet.addRow([]);

    // Define all columns from py_emplhistory
    const columns = [
      { header: 'Period', key: 'period', width: 24 },
      { header: 'Employee ID', key: 'Empl_ID', width: 15 },
      { header: 'Surname', key: 'Surname', width: 20 },
      { header: 'Other Name', key: 'OtherName', width: 36 },
      { header: 'Title', key: 'Title', width: 10 },
      { header: 'Sex', key: 'Sex', width: 8 },
      { header: 'Job Title', key: 'Jobtitle', width: 20 },
      { header: 'Marital Status', key: 'MaritalStatus', width: 15 },
      { header: 'Factory', key: 'Factory', width: 12 },
      { header: 'Location', key: 'Location', width: 15 },
      { header: 'Birth Date', key: 'Birthdate', width: 21 },
      { header: 'Date Employed', key: 'DateEmpl', width: 21 },
      { header: 'Date Left', key: 'DateLeft', width: 21 },
      { header: 'Telephone', key: 'TELEPHONE', width: 21 },
      { header: 'NOK Name', key: 'nok_name', width: 35 },
      { header: 'Bank Code', key: 'Bankcode', width: 12 },
      { header: 'Bank Branch', key: 'bankbranch', width: 15 },
      { header: 'Bank Account', key: 'BankACNumber', width: 20 },
      { header: 'State of Origin', key: 'StateofOrigin', width: 15 },
      { header: 'Local Govt', key: 'LocalGovt', width: 15 },
      { header: 'Status', key: 'Status', width: 12 },
      { header: 'Grade Level', key: 'gradelevel', width: 12 },
      { header: 'Email', key: 'email', width: 35 },
      { header: 'PFA Code', key: 'pfacode', width: 15 },
      { header: 'Command', key: 'command', width: 15 },
      { header: 'Specialisation', key: 'specialisation', width: 20 },
      { header: 'Home Address', key: 'HOMEADDR', width: 56 }
    ];

    // Function to convert YYYYMMDD string to a Date object
    const parseYMD = (ymd) => {
      // Check if ymd is a non-empty string of the correct length
      if (!ymd || String(ymd).length < 8) return null;
      const s = String(ymd);
      const year = s.substring(0, 4);
      const month = s.substring(4, 6) - 1; // Month is 0-indexed
      const day = s.substring(6, 8);
      // Use Date.UTC to prevent timezone issues with simple YMD strings
      return new Date(Date.UTC(year, month, day)); 
    };

    // Function to convert YYYYMMDDHHMM string to a Date object
    const parseYMDHM = (ymdhm) => {
      // Check if ymdhm is a non-empty string of the correct length
      if (!ymdhm || String(ymdhm).length < 12) return null;
      const s = String(ymdhm);
      const year = s.substring(0, 4);
      const month = s.substring(4, 6) - 1;
      const day = s.substring(6, 8);
      const hour = s.substring(8, 10);
      const minute = s.substring(10, 12);
      // Use the full constructor
      return new Date(year, month, day, hour, minute);
    };

    worksheet.columns = columns;

    const headerTitles = columns.map(col => col.header);
    worksheet.addRow(headerTitles);

    const titleRow = worksheet.getRow(1);
    worksheet.mergeCells('A1:AC1'); 
    titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    titleRow.getCell(1).font = { bold: true, size: 16, color: { argb: 'FF0070C0' } }; // Corporate Blue

    for (let i = 2; i <= 4; i++) {
        worksheet.getRow(i).font = { size: 10, italic: true };
    }
    
    // --- Apply Standard Header Row Styling ---
    const headerRow = worksheet.getRow(6);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }; // White Text
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0070C0' } // Corporate Blue Fill
    };
    headerRow.height = 25;

    // Apply alignment, border, and ensure text wrapping
    headerRow.eachCell({ includeEmpty: false }, (cell) => {
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = { 
            top: { style: 'thin' }, 
            left: { style: 'thin' }, 
            bottom: { style: 'medium' },
            right: { style: 'thin' } 
        };
    });
    
    // --- Data rows with Banding and Formatting ---
    let rowNumber = 7;
      records.forEach(record => {
        const periodDate = parseYMDHM(record.period);
        const birthDate = parseYMD(record.Birthdate);
        const emplDate = parseYMD(record.DateEmpl);
        const leftDate = parseYMD(record.DateLeft);

        // Update record object for writing to Excel
        record.period = periodDate;
        record.Birthdate = birthDate;
        record.DateEmpl = emplDate;
        record.DateLeft = leftDate;
        
        const dataRow = worksheet.addRow(record);
        
        // Apply Alternating Row Color (Banding)
        if (rowNumber % 2 !== 0) { // Odd rows (7, 9, 11...)
            dataRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE6F0F8' } // Light Gray/Blue for banding
            };
        }
        
        // Apply standard data cell styling and formatting
        dataRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
            cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: false }; 
            cell.border = { 
                top: { style: 'thin', color: { argb: 'FFD3D3D3' } },
                left: { style: 'thin', color: { argb: 'FFD3D3D3' } }, 
                bottom: { style: 'thin', color: { argb: 'FFD3D3D3' } }, 
                right: { style: 'thin', color: { argb: 'FFD3D3D3' } } 
            };
        });
        
        dataRow.getCell('Empl_ID').alignment = { vertical: 'top', horizontal: 'center' };

        // 1. Period (YYYYMMDDHHMM)
        const periodCell = dataRow.getCell('period');
        if (periodDate instanceof Date) {
            periodCell.numFmt = 'd mmmm yyyy at hh:mm'; 
        } 
        periodCell.alignment = { vertical: 'top', horizontal: 'center' };
        
        // 2. Birthdate (YYYYMMDD)
        const birthCell = dataRow.getCell('Birthdate');
        if (birthDate instanceof Date) {
            birthCell.numFmt = 'd mmmm yyyy'; 
        }
        
        // 3. Date Employed (YYYYMMDD)
        const emplCell = dataRow.getCell('DateEmpl');
        if (emplDate instanceof Date) {
            emplCell.numFmt = 'd mmmm yyyy';
        }
        
        // 4. Date Left (YYYYMMDD)
        const leftCell = dataRow.getCell('DateLeft');
        if (leftDate instanceof Date) {
            leftCell.numFmt = 'd mmmm yyyy';
        }

        rowNumber++;
    });

    // --- Freeze Header Row for Easy Scrolling ---
    worksheet.views = [
        { state: 'frozen', ySplit: 6 }
    ];

    // Generate filename
    const filename = `previous_personnel_details_${year}_${month}${startPeriod ? '_' + startPeriod : ''}${endPeriod ? '_to_' + endPeriod : ''}${employeeId && employeeId !== 'ALL' ? '_' + employeeId : ''}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Excel export error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET: Export current personnel details to Excel
 */
exports.exportCurrentDetailsExcel = async (req, res) => {
  try {
    const ExcelJS = require('exceljs');

    const { employeeId } = req.query;

    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );

    if (!bt05Rows.length) {
      return res.status(404).json({ error: 'BT05 not found' });
    }

    const { year, month } = bt05Rows[0];

    // Get all records for export
    const records = await personnelDetailsService.getAllCurrentDetailsForExport({
      employeeId
    });

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Current Personnel Details');
    
    // The last column is the 28th column (AB)
    const lastColumnLetter = 'AB'; 

    // --- 1. Title Formatting (Row 1) ---
    worksheet.addRow(['CURRENT PERSONNEL DETAILS REPORT']);
    const titleRow = worksheet.getRow(1);
    worksheet.mergeCells(`A1:${lastColumnLetter}1`); 
    titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    titleRow.getCell(1).font = { bold: true, size: 16, color: { argb: 'FF0070C0' } };
    
    // Add metadata
    worksheet.addRow([`Period: ${month}/${year}`]);
    worksheet.addRow([`Generated: ${new Date().toLocaleString()}`]);
    worksheet.addRow([`Filters: ${employeeId && employeeId !== 'ALL' ? `Employee: ${employeeId}` : 'All Employees'}`]);
    worksheet.addRow([]); // Blank row 5
    
    // --- 2. Metadata Formatting (Rows 2-4) ---
    for (let i = 2; i <= 4; i++) {
      worksheet.getRow(i).font = { size: 10, italic: true };
    }

    // Define all columns from hr_employees (extended with additional fields)
    const columns = [
      { header: 'Employee ID', key: 'Empl_ID', width: 15 },
      { header: 'Surname', key: 'Surname', width: 20 },
      { header: 'Other Name', key: 'OtherName', width: 36 },
      { header: 'Title', key: 'Title', width: 10 },
      { header: 'Sex', key: 'Sex', width: 8 },
      { header: 'Job Title', key: 'Jobtitle', width: 20 },
      { header: 'Marital Status', key: 'MaritalStatus', width: 15 },
      { header: 'Factory', key: 'Factory', width: 12 },
      { header: 'Location', key: 'Location', width: 15 },
      { header: 'Birth Date', key: 'Birthdate', width: 21 }, // Date Format Target
      { header: 'Date Employed', key: 'DateEmpl', width: 21 }, // Date Format Target
      { header: 'Date Left', key: 'DateLeft', width: 21 }, // Date Format Target
      { header: 'Telephone', key: 'TELEPHONE', width: 15 },
      { header: 'NOK Name', key: 'nok_name', width: 35 },
      { header: 'Bank Code', key: 'Bankcode', width: 12 },
      { header: 'Bank Branch', key: 'bankbranch', width: 15 },
      { header: 'Bank Account', key: 'BankACNumber', width: 20 },
      { header: 'State of Origin', key: 'StateofOrigin', width: 15 },
      { header: 'Local Govt', key: 'LocalGovt', width: 15 },
      { header: 'Status', key: 'Status', width: 12 },
      { header: 'Grade Level', key: 'gradelevel', width: 12 },
      { header: 'Email', key: 'email', width: 35 },
      { header: 'GSM Number', key: 'gsm_number', width: 15 },
      { header: 'NOK Phone', key: 'nokphone', width: 15 },
      { header: 'Religion', key: 'religion', width: 15 },
      { header: 'PFA Code', key: 'pfacode', width: 15 },
      { header: 'Command', key: 'command', width: 15 },
      { header: 'Specialisation', key: 'specialisation', width: 20 },
      { header: 'Home Address', key: 'HOMEADDR', width: 56 }
    ];

    const parseYMD = (ymd) => {
      // Check if ymd is a non-empty string of the correct length (e.g., 8 digits)
      if (!ymd || String(ymd).length < 8) return null;
      const s = String(ymd);
      const year = s.substring(0, 4);
      const month = s.substring(4, 6) - 1; // Month is 0-indexed
      const day = s.substring(6, 8);
      // Use Date.UTC to prevent timezone issues with simple YMD strings
      return new Date(Date.UTC(year, month, day)); 
    };

    worksheet.columns = columns;

    // --- 3. Header Fix/Style (Row 6) ---
    // Explicitly write headers to ensure they show up
    const headerTitles = columns.map(col => col.header);
    worksheet.addRow(headerTitles); 
    
    const headerRow = worksheet.getRow(6);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }; // White Text
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0070C0' } // Corporate Blue Fill
    };
    headerRow.height = 25; 

    // Apply alignment, border, and wrapping
    headerRow.eachCell({ includeEmpty: false }, (cell) => {
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { 
        top: { style: 'thin' }, 
        left: { style: 'thin' }, 
        bottom: { style: 'medium' }, 
        right: { style: 'thin' } 
      };
    });

    // --- 4. Data Loop with Banding and Conditional Date Formatting ---
    let rowNumber = 7;
    
    records.forEach(record => {
        
      // Convert date strings (YYYYMMDD) to Date objects, required for numFmt
      const birthDate = parseYMD(record.Birthdate);
      const emplDate = parseYMD(record.DateEmpl);
      const leftDate = parseYMD(record.DateLeft);

      // Update record object for writing to Excel
      record.Birthdate = birthDate;
      record.DateEmpl = emplDate;
      record.DateLeft = leftDate;
      
      const dataRow = worksheet.addRow(record);
      
      // Apply Alternating Row Color (Banding)
      if (rowNumber % 2 !== 0) { // Odd rows
        dataRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE6F0F8' } // Light Gray/Blue for banding
        };
      }
      
      // Apply standard data cell styling and borders
      dataRow.eachCell({ includeEmpty: false }, (cell) => {
        cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: false }; 
        cell.border = { 
          top: { style: 'thin', color: { argb: 'FFD3D3D3' } },
          left: { style: 'thin', color: { argb: 'FFD3D3D3' } }, 
          bottom: { style: 'thin', color: { argb: 'FFD3D3D3' } }, 
          right: { style: 'thin', color: { argb: 'FFD3D3D3' } } 
        };
      });
      
      // --- CONDITIONAL DATE FORMATTING (d mmmm yyyy) ---
      const dateFormat = 'd mmmm yyyy';

      // Birthdate
      const birthCell = dataRow.getCell('Birthdate');
      if (birthDate instanceof Date) {
        birthCell.numFmt = dateFormat; 
      }
      
      // Date Employed
      const emplCell = dataRow.getCell('DateEmpl');
      if (emplDate instanceof Date) {
        emplCell.numFmt = dateFormat;
      }
      
      // Date Left
      const leftCell = dataRow.getCell('DateLeft');
      if (leftDate instanceof Date) {
        leftCell.numFmt = dateFormat;
      }

      // Center Employee ID
      dataRow.getCell('Empl_ID').alignment = { vertical: 'top', horizontal: 'center' };

      rowNumber++;
    });

    // --- 5. Freeze Header Row ---
    worksheet.views = [
      { state: 'frozen', ySplit: 6 } // Freezes rows 1-6 (Title, Metadata, Header)
    ];

    // Generate filename
    const filename = `current_personnel_details_${year}_${month}${employeeId && employeeId !== 'ALL' ? '_' + employeeId : ''}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Excel export error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET: Export analysis to Excel
 */
exports.exportAnalysisExcel = async (req, res) => {
  try {
    const { startPeriod, endPeriod, filter = 'all' } = req.query;
    
    const [bt05Rows] = await pool.query(
      "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
    );

    if (!bt05Rows.length) {
      return res.status(404).json({ error: 'BT05 not found' });
    }

    const { year, month } = bt05Rows[0];

    // Get all records for export
    const records = await personnelDetailsService.exportAnalysisExcel({
      startPeriod,
      endPeriod,
      filter
    });

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Personnel Analysis');

    // Add header
    worksheet.addRow(['PERSONNEL ANALYSIS REPORT']);
    worksheet.addRow([`Period: ${month}/${year}`]);
    worksheet.addRow([`Generated: ${new Date().toLocaleString()}`]);
    worksheet.addRow([`Filter: ${filter.toUpperCase()}`]);
    worksheet.addRow([]);

    // Helper function to parse dates
    const parseYMD = (ymd) => {
      if (!ymd || String(ymd).length < 8) return null;
      const s = String(ymd);
      const year = s.substring(0, 4);
      const month = s.substring(4, 6) - 1;
      const day = s.substring(6, 8);
      return new Date(Date.UTC(year, month, day));
    };

    // Helper function to compare values
    const valuesAreDifferent = (prevVal, currVal) => {
      const prev = String(prevVal || '').trim();
      const curr = String(currVal || '').trim();
      return prev !== curr && prev !== '' && curr !== '';
    };

    // Define columns based on filter type
    let columns;
    let lastColumnLetter;
    
    if (filter === 'new') {
      // For NEW employees - show only current details
      columns = [
        { header: 'Employee ID', key: 'Empl_ID', width: 15 },
        { header: 'Surname', key: 'Current_Surname', width: 20 },
        { header: 'Other Name', key: 'Current_OtherName', width: 25 },
        { header: 'Job Title', key: 'Current_Jobtitle', width: 20 },
        { header: 'Factory', key: 'Current_Factory', width: 12 },
        { header: 'Location', key: 'Current_Location', width: 15 },
        { header: 'Status', key: 'Current_Status', width: 12 },
        { header: 'Grade Level', key: 'Current_gradelevel', width: 12 },
        { header: 'Birth Date', key: 'Current_Birthdate', width: 21 },
        { header: 'Date Employed', key: 'Current_DateEmpl', width: 21 },
        { header: 'Date Left', key: 'Current_DateLeft', width: 21 },
        { header: 'Telephone', key: 'Current_TELEPHONE', width: 15 },
        { header: 'NOK Name', key: 'Current_nok_name', width: 35 },
        { header: 'Bank Code', key: 'Current_Bankcode', width: 12 },
        { header: 'Bank Branch', key: 'Current_bankbranch', width: 15 },
        { header: 'Bank Account', key: 'Current_BankACNumber', width: 20 },
        { header: 'State of Origin', key: 'Current_StateofOrigin', width: 15 },
        { header: 'Local Govt', key: 'Current_LocalGovt', width: 15 },
        { header: 'Email', key: 'Current_email', width: 35 },
        { header: 'GSM Number', key: 'Current_gsm_number', width: 15 },
        { header: 'NOK Phone', key: 'Current_nokphone', width: 15 },
        { header: 'Religion', key: 'Current_religion', width: 15 },
        { header: 'PFA Code', key: 'Current_pfacode', width: 15 },
        { header: 'Command', key: 'Current_command', width: 15 },
        { header: 'Specialisation', key: 'Current_specialisation', width: 20 },
        { header: 'Home Address', key: 'Current_HOMEADDR', width: 56 }
      ];
      lastColumnLetter = 'Z'; // 26 columns
    } else {
      // For OLD and CHANGED employees - show Previous vs Current side-by-side
      columns = [
        { header: 'Employee ID', key: 'Empl_ID', width: 15 },
        
        // Previous Details with paired current columns
        { header: 'Period', key: 'Prev_period', width: 20 },
        { header: 'Previous Surname', key: 'Prev_Surname', width: 20, field: 'Surname' },
        { header: 'Current Surname', key: 'Current_Surname', width: 20, field: 'Surname' },
        { header: 'Previous Other Name', key: 'Prev_OtherName', width: 25, field: 'OtherName' },
        { header: 'Current Other Name', key: 'Current_OtherName', width: 25, field: 'OtherName' },
        { header: 'Previous Job Title', key: 'Prev_Jobtitle', width: 20, field: 'Jobtitle' },
        { header: 'Current Job Title', key: 'Current_Jobtitle', width: 20, field: 'Jobtitle' },
        { header: 'Previous Factory', key: 'Prev_Factory', width: 12, field: 'Factory' },
        { header: 'Current Factory', key: 'Current_Factory', width: 12, field: 'Factory' },
        { header: 'Previous Location', key: 'Prev_Location', width: 15, field: 'Location' },
        { header: 'Current Location', key: 'Current_Location', width: 15, field: 'Location' },
        { header: 'Previous Status', key: 'Prev_Status', width: 12, field: 'Status' },
        { header: 'Current Status', key: 'Current_Status', width: 12, field: 'Status' },
        { header: 'Previous Grade Level', key: 'Prev_gradelevel', width: 12, field: 'gradelevel' },
        { header: 'Current Grade Level', key: 'Current_gradelevel', width: 12, field: 'gradelevel' },
        { header: 'Previous Birth Date', key: 'Prev_Birthdate', width: 21, field: 'Birthdate' },
        { header: 'Current Birth Date', key: 'Current_Birthdate', width: 21, field: 'Birthdate' },
        { header: 'Previous Date Employed', key: 'Prev_DateEmpl', width: 21, field: 'DateEmpl' },
        { header: 'Current Date Employed', key: 'Current_DateEmpl', width: 21, field: 'DateEmpl' },
        { header: 'Previous Date Left', key: 'Prev_DateLeft', width: 21, field: 'DateLeft' },
        { header: 'Current Date Left', key: 'Current_DateLeft', width: 21, field: 'DateLeft' },
        { header: 'Previous Telephone', key: 'Prev_TELEPHONE', width: 15, field: 'TELEPHONE' },
        { header: 'Current Telephone', key: 'Current_TELEPHONE', width: 15, field: 'TELEPHONE' },
        { header: 'Previous NOK Name', key: 'Prev_nok_name', width: 35, field: 'nok_name' },
        { header: 'Current NOK Name', key: 'Current_nok_name', width: 35, field: 'nok_name' },
        { header: 'Previous Bank Code', key: 'Prev_Bankcode', width: 12, field: 'Bankcode' },
        { header: 'Current Bank Code', key: 'Current_Bankcode', width: 12, field: 'Bankcode' },
        { header: 'Previous Bank Branch', key: 'Prev_bankbranch', width: 15, field: 'bankbranch' },
        { header: 'Current Bank Branch', key: 'Current_bankbranch', width: 15, field: 'bankbranch' },
        { header: 'Previous Bank Account', key: 'Prev_BankACNumber', width: 20, field: 'BankACNumber' },
        { header: 'Current Bank Account', key: 'Current_BankACNumber', width: 20, field: 'BankACNumber' },
        { header: 'Previous State of Origin', key: 'Prev_StateofOrigin', width: 15, field: 'StateofOrigin' },
        { header: 'Current State of Origin', key: 'Current_StateofOrigin', width: 15, field: 'StateofOrigin' },
        { header: 'Previous Local Govt', key: 'Prev_LocalGovt', width: 15, field: 'LocalGovt' },
        { header: 'Current Local Govt', key: 'Current_LocalGovt', width: 15, field: 'LocalGovt' },
        { header: 'Previous Email', key: 'Prev_email', width: 35, field: 'email' },
        { header: 'Current Email', key: 'Current_email', width: 35, field: 'email' },
        { header: 'Previous PFA Code', key: 'Prev_pfacode', width: 15, field: 'pfacode' },
        { header: 'Current PFA Code', key: 'Current_pfacode', width: 15, field: 'pfacode' },
        { header: 'Previous Command', key: 'Prev_command', width: 15, field: 'command' },
        { header: 'Current Command', key: 'Current_command', width: 15, field: 'command' },
        { header: 'Previous Specialisation', key: 'Prev_specialisation', width: 20, field: 'specialisation' },
        { header: 'Current Specialisation', key: 'Current_specialisation', width: 20, field: 'specialisation' },
        { header: 'Previous Home Address', key: 'Prev_HOMEADDR', width: 56, field: 'HOMEADDR' },
        { header: 'Current Home Address', key: 'Current_HOMEADDR', width: 56, field: 'HOMEADDR' },
        
        { header: 'Changes Count', key: 'changesCount', width: 15 }
      ];
      lastColumnLetter = 'AR'; // 44 columns
    }

    worksheet.columns = columns;

    // --- Title Formatting (Row 1) ---
    const titleRow = worksheet.getRow(1);
    worksheet.mergeCells(`A1:${lastColumnLetter}1`);
    titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    titleRow.getCell(1).font = { bold: true, size: 16, color: { argb: 'FF0070C0' } };
    
    // --- Metadata Formatting (Rows 2-4) ---
    for (let i = 2; i <= 4; i++) {
      worksheet.getRow(i).font = { size: 10, italic: true };
    }

    // --- Header Row Styling (Row 6) ---
    const headerTitles = columns.map(col => col.header);
    worksheet.addRow(headerTitles);
    
    const headerRow = worksheet.getRow(6);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0070C0' }
    };
    headerRow.height = 31;
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

    // Apply header borders
    headerRow.eachCell({ includeEmpty: false }, (cell) => {
      cell.border = { 
        top: { style: 'medium' }, 
        left: { style: 'medium' }, 
        bottom: { style: 'medium' },
        right: { style: 'medium' } 
      };
    });

    // --- Add Data Rows ---
    let rowNumber = 7;
    records.forEach(record => {
      // Parse and convert date fields to Date objects
      const rowData = { ...record };
      
      // Convert date fields
      if (filter !== 'new') {
        // Parse previous dates
        if (rowData.Prev_DateEmpl) {
          rowData.Prev_DateEmpl = parseYMD(rowData.Prev_DateEmpl);
        }
        if (rowData.Prev_Birthdate) {
          rowData.Prev_Birthdate = parseYMD(rowData.Prev_Birthdate);
        }
        if (rowData.Prev_DateLeft) {
          rowData.Prev_DateLeft = parseYMD(rowData.Prev_DateLeft);
        }
      }
      
      // Parse current dates
      if (rowData.Current_DateEmpl) {
        rowData.Current_DateEmpl = parseYMD(rowData.Current_DateEmpl);
      }
      if (rowData.Current_Birthdate) {
        rowData.Current_Birthdate = parseYMD(rowData.Current_Birthdate);
      }
      if (rowData.Current_DateLeft) {
        rowData.Current_DateLeft = parseYMD(rowData.Current_DateLeft);
      }
      
      const dataRow = worksheet.addRow(rowData);
      
      // Apply default banding
      if (rowNumber % 2 !== 0) {
        dataRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE6F0F8' } // Light Blue for banding
        };
      }
      
      // Style all cells with default formatting
      dataRow.eachCell({ includeEmpty: false }, (cell) => {
        cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: false };
        cell.border = {
          top: { style: 'medium', color: { argb: 'FFD3D3D3' } },
          left: { style: 'medium', color: { argb: 'FFD3D3D3' } },
          bottom: { style: 'medium', color: { argb: 'FFD3D3D3' } },
          right: { style: 'medium', color: { argb: 'FFD3D3D3' } }
        };
      });
      
      // Apply date formatting and highlight changes
      const dateFormat = 'd mmmm yyyy';
      
      columns.forEach((col, index) => {
        const colNumber = index + 1; // Excel columns are 1-indexed
        const cell = dataRow.getCell(colNumber);
        
        // Apply date formatting for date columns
        if ((col.key.includes('DateEmpl') || col.key.includes('Birthdate') || col.key.includes('DateLeft')) 
            && cell.value instanceof Date) {
          cell.numFmt = dateFormat;
        }
        
        // Highlight changed fields (only for old/changed filters)
        if (filter !== 'new' && col.field) {
          const prevKey = `Prev_${col.field}`;
          const currKey = `Current_${col.field}`;
          
          // Check if this column is part of a compared pair
          if (col.key === prevKey || col.key === currKey) {
            const prevValue = record[prevKey];
            const currValue = record[currKey];
            
            // Compare values (handle dates specially)
            let isDifferent = false;
            
            if (col.key.includes('Date')) {
              // For dates, compare the original string values before parsing
              isDifferent = valuesAreDifferent(prevValue, currValue);
            } else {
              isDifferent = valuesAreDifferent(prevValue, currValue);
            }
            
            // Apply yellow highlight if values differ
            if (isDifferent) {
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFFFFF00' } // Yellow highlight
              };
              cell.font = {
                bold: true,
                color: { argb: 'FF000000' } // Black text for visibility
              };
            }
          }
        }
      });
      
      rowNumber++;
    });

    // --- Freeze Header Row ---
    worksheet.views = [
      { state: 'frozen', ySplit: 6 }
    ];

    // Generate filename
    const filename = `personnel_analysis_${filter}_${year}_${month}.xlsx`;
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Excel export error:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Formats YYYYMMDD string to "DD Month YYYY" (e.g., 15 May 1985).
 * @param {string | number} ymdString - Date in YYYYMMDD format.
 * @returns {string} Formatted date string or 'N/A'.
 */
const formatDatePDF = (ymdString) => {
  if (!ymdString || String(ymdString).length < 8) return 'N/A';
  const s = String(ymdString);
  const year = s.substring(0, 4);
  const monthIndex = parseInt(s.substring(4, 6), 10) - 1; // Month is 0-indexed
  const day = s.substring(6, 8);
  
  const date = new Date(Date.UTC(year, monthIndex, day));
  
  if (isNaN(date.getTime())) return 'N/A';

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  
  return `${day} ${monthNames[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};

/**
 * Formats YYYYMMDDHHMM string to "DD Month YYYY HH:MM" (e.g., 01 Jan 2024 10:30).
 * @param {string | number} periodString - Period in YYYYMMDDHHMM format.
 * @returns {string} Formatted period string or 'N/A'.
 */
const formatPeriodPDF = (periodString) => {
  if (!periodString || String(periodString).length < 12) return 'N/A';
  const s = String(periodString);
  const year = s.substring(0, 4);
  const monthIndex = parseInt(s.substring(4, 6), 10) - 1;
  const day = s.substring(6, 8);
  const hour = s.substring(8, 10);
  const minute = s.substring(10, 12);
  
  // Create Date object assuming local time from the string components
  const date = new Date(year, monthIndex, day, hour, minute);

  if (isNaN(date.getTime())) return 'N/A';
  
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  
  // Pad day and minute/hour if needed
  const pDay = String(date.getDate()).padStart(2, '0');
  const pHour = String(date.getHours()).padStart(2, '0');
  const pMinute = String(date.getMinutes()).padStart(2, '0');

  return `${pDay} ${monthNames[date.getMonth()]} ${date.getFullYear()} ${pHour}:${pMinute}`;
};


// --- PDF Table Drawing Function ---

/**
 * Draws a professional, tabular report for personnel details, handling page breaks.
 * @param {PDFDocument} doc - The PDFKit document instance.
 * @param {Array<Object>} records - The data records to display.
 * @param {Array<Object>} columns - Array defining columns: [{ header, key, width, align }].
 * @param {number} startY - The Y position to start drawing the table.
 */
const drawPersonnelTable = (doc, records, columns, startY) => {
  const tableTop = startY;
  const itemHeight = 20; // Height of each data row
  const availableWidth = 510; // A4 width (595) - 2 * margin (50) = 495. Using 510 for better fit.
  const tableX = 50;
  let currentY = tableTop;

  // Calculate actual pixel width for each column
  const columnWidths = columns.map(col => ({
      ...col,
      pixelWidth: Math.floor(col.width * availableWidth / 100)
  }));

  // Function to draw header row
  const drawHeader = () => {
      doc.fillColor('#000000').font('Helvetica-Bold').fontSize(8);
      let x = tableX;
      let y = currentY;

      // Draw header background (Dark Blue)
      doc.rect(tableX, y, availableWidth, itemHeight).fill('#0070C0');
      
      // Draw header text (White) and borders
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8);
      columnWidths.forEach(col => {
          doc.text(col.header, x, y + 5, { 
              width: col.pixelWidth, 
              align: col.align || 'left',
              lineBreak: false,
              ellipsis: true
          });
          x += col.pixelWidth;
      });

      currentY += itemHeight;
      doc.moveDown(0.2);
  };

  // Draw initial header
  drawHeader();
  doc.fillColor('#000000').font('Helvetica').fontSize(8);

  // Draw data rows
  records.forEach((record, index) => {
      // Check for page break
      if (currentY + itemHeight > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          currentY = doc.page.margins.top;
          drawHeader(); // Redraw header on new page
          doc.fillColor('#000000').font('Helvetica').fontSize(8); // Reset data font
      }

      let x = tableX;
      const rowY = currentY;
      
      // Draw row background (Alternating color - Light Gray)
      if (index % 2 !== 0) {
          doc.rect(tableX, rowY, availableWidth, itemHeight).fill('#F0F0F0');
      } else {
          doc.rect(tableX, rowY, availableWidth, itemHeight).fill('#FFFFFF');
      }

      // Draw cell data
      doc.fillColor('#000000');
      columnWidths.forEach(col => {
          let data = record[col.key] || '';
          
          // Special handling for Name (combining Surname and OtherName)
          if (col.key === 'Surname') {
              data = `${record.Surname || ''} ${record.OtherName || ''}`.trim();
          } else if (col.key === 'DateEmpl' || col.key === 'DateLeft' || col.key === 'Birthdate') {
              data = formatDatePDF(data);
          } else if (col.key === 'period') {
              data = formatPeriodPDF(data);
          }

          doc.text(data, x + 2, rowY + 6, { 
              width: col.pixelWidth - 4, // 2px padding on each side
              align: col.align || 'left',
              lineBreak: false,
              ellipsis: true
          });
          x += col.pixelWidth;
      });

      // Draw thin bottom border
      doc.lineWidth(0.5).strokeColor('#D3D3D3').moveTo(tableX, rowY + itemHeight).lineTo(tableX + availableWidth, rowY + itemHeight).stroke();


      currentY += itemHeight;
  });
};


/**
 * GET: Export previous personnel details to PDF (Tabular Format)
 */
exports.exportPreviousDetailsPDF = async (req, res) => {
  try {
      const { startPeriod, endPeriod, employeeId } = req.query;

      const [bt05Rows] = await pool.query(
          "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
      );

      if (!bt05Rows.length) {
          return res.status(404).json({ error: 'BT05 not found' });
      }

      const { year, month } = bt05Rows[0];

      // Get all records for export
      const records = await personnelDetailsService.getAllPreviousDetailsForExport({
          startPeriod,
          endPeriod,
          employeeId
      });
      
      // --- Column Definition for Previous Details (with Period) ---
      const previousColumns = [
          { header: 'Period', key: 'period', width: 8, align: 'center' },
          { header: 'ID', key: 'Empl_ID', width: 7, align: 'center' },
          { header: 'Name', key: 'Surname', width: 14, align: 'left' }, // Combines Surname & OtherName
          { header: 'Job Title', key: 'Jobtitle', width: 17, align: 'left' },
          { header: 'Factory', key: 'Factory', width: 6, align: 'center' },
          { header: 'Location', key: 'Location', width: 9, align: 'left' },
          { header: 'Status', key: 'Status', width: 6, align: 'center' },
          { header: 'Grade', key: 'gradelevel', width: 6, align: 'center' },
          { header: 'Date Emp.', key: 'DateEmpl', width: 13, align: 'center' },
          { header: 'Date Left', key: 'DateLeft', width: 14, align: 'center' }
      ]; // Total width: 99%

      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      
      const filename = `previous_personnel_details_${year}_${month}${startPeriod ? '_' + startPeriod : ''}${endPeriod ? '_to_' + endPeriod : ''}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
      
      doc.pipe(res);

      // --- Report Header ---
      doc.fontSize(18).font('Helvetica-Bold').fillColor('#0070C0').text('PREVIOUS PERSONNEL DETAILS REPORT', { align: 'center' });
      doc.fillColor('#000000');
      doc.fontSize(10).font('Helvetica').text(`Period: ${month}/${year}`, { align: 'center' });
      doc.text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
      doc.text(`Period Range: ${startPeriod || 'N/A'} to ${endPeriod || 'N/A'}`, { align: 'center' });
      doc.moveDown(1.5);
      
      // --- Summary ---
      doc.fontSize(12).font('Helvetica-Bold').text(`Summary: Total Records: ${records.length}`);
      doc.moveDown(1);
      
      // --- Draw Table ---
      drawPersonnelTable(doc, records, previousColumns, doc.y);

      doc.end();
  } catch (err) {
      console.error('PDF export error:', err);
      res.status(500).json({ error: err.message });
  }
};

/**
 * GET: Export current personnel details to PDF (Tabular Format)
 */
exports.exportCurrentDetailsPDF = async (req, res) => {
  try {
      const { employeeId } = req.query;

      const [bt05Rows] = await pool.query(
          "SELECT ord AS year, mth AS month FROM py_stdrate WHERE type='BT05' LIMIT 1"
      );

      if (!bt05Rows.length) {
          return res.status(404).json({ error: 'BT05 not found' });
      }

      const { year, month } = bt05Rows[0];

      // Get all records for export
      const records = await personnelDetailsService.getAllCurrentDetailsForExport({
          employeeId
      });

      // --- Column Definition for Current Details (without Period) ---
      const currentColumns = [
      { header: 'ID', key: 'Empl_ID', width: 8, align: 'center' },
      { header: 'Name', key: 'Surname', width: 17, align: 'left' }, // Combines Surname & OtherName
      { header: 'Job Title', key: 'Jobtitle', width: 20, align: 'left' },
      { header: 'Factory', key: 'Factory', width: 7, align: 'center' },
      { header: 'Location', key: 'Location', width: 9, align: 'left' },
      { header: 'Status', key: 'Status', width: 7, align: 'center' },
      { header: 'Grade', key: 'gradelevel', width: 7, align: 'center' },
      { header: 'Date Emp.', key: 'DateEmpl', width: 11, align: 'center' },
      { header: 'Date Left', key: 'DateLeft', width: 11, align: 'center' },
      /*{ header: 'Birthdate', key: 'Birthdate', width: 11, align: 'center' },
      { header: 'Telephone', key: 'TELEPHONE', width: 15, align: 'left' },
      { header: 'NOK Name', key: 'nok_name', width: 20, align: 'left' },
      { header: 'Bank Code', key: 'Bankcode', width: 10, align: 'center' },
      { header: 'Bank Branch', key: 'bankbranch', width: 12, align: 'left' },
      { header: 'Bank Account', key: 'BankACNumber', width: 15, align: 'left' },
      { header: 'State of Origin', key: 'StateofOrigin', width: 12, align: 'left' },
      { header: 'Local Govt', key: 'LocalGovt', width: 12, align: 'left' },
      { header: 'Email', key: 'email', width: 25, align: 'left' },
      { header: 'PFA Code', key: 'pfacode', width: 12, align: 'center' },
      { header: 'NOK Phone', key: 'nokphone', width: 12, align: 'left' },
      { header: 'Religion', key: 'religion', width: 12, align: 'left' },
      { header: 'Command', key: 'command', width: 12, align: 'left' },
      { header: 'Specialisation', key: 'specialisation', width: 15, align: 'left' },

      { header: 'Home Address', key: 'HOMEADDR', width: 40, align: 'left' }*/
      ];

      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      
      const filename = `current_personnel_details_${year}_${month}${employeeId && employeeId !== 'ALL' ? '_' + employeeId : ''}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
      
      doc.pipe(res);

      // --- Report Header ---
      doc.fontSize(18).font('Helvetica-Bold').fillColor('#0070C0').text('CURRENT PERSONNEL DETAILS REPORT', { align: 'center' });
      doc.fillColor('#000000');
      doc.fontSize(10).font('Helvetica').text(`Period: ${month}/${year}`, { align: 'center' });
      doc.text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
      doc.text(`Filters: ${employeeId && employeeId !== 'ALL' ? `Employee: ${employeeId}` : 'All Employees'}`, { align: 'center' });
      doc.moveDown(1.5);

      // --- Summary ---
      doc.fontSize(12).font('Helvetica-Bold').text(`Summary: Total Records: ${records.length}`);
      doc.moveDown(1);
      
      // --- Draw Table ---
      drawPersonnelTable(doc, records, currentColumns, doc.y);

      doc.end();
  } catch (err) {
      console.error('PDF export error:', err);
      res.status(500).json({ error: err.message });
  }
};


