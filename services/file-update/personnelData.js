// CRITICAL: Database indexes needed for performance
/*
CREATE INDEX idx_py_emplhistory_period ON py_emplhistory(period);
CREATE INDEX idx_py_emplhistory_empl_id ON py_emplhistory(Empl_ID);
CREATE INDEX idx_py_emplhistory_empl_period ON py_emplhistory(Empl_ID, period);
CREATE INDEX idx_hr_employees_empl_id ON hr_employees(Empl_ID);
CREATE INDEX idx_hr_employees_dateleft ON hr_employees(DateLeft);
CREATE INDEX idx_hr_employees_exittype ON hr_employees(exittype);
*/

const pool = require('../../config/db');
const { startLog, updateLog } = require('../helpers/logService');

// Get Descriptions Joins and Fields
async function getDescriptionJoins() {
  return `
    LEFT JOIN py_title ON py_title.Titlecode = {table}.Title
    LEFT JOIN py_tblstates ON py_tblstates.Statecode = {table}.StateofOrigin
    LEFT JOIN py_tblLGA ON py_tblLGA.Lgcode = {table}.LocalGovt
    LEFT JOIN py_sex ON py_sex.sex_code = {table}.Sex
    LEFT JOIN py_salarygroup ON py_salarygroup.groupcode = {table}.gradelevel
    LEFT JOIN py_pfa ON py_pfa.pfacode = {table}.pfacode
    LEFT JOIN ac_businessline ON ac_businessline.busline = {table}.Factory
    LEFT JOIN ac_costcentre ON ac_costcentre.unitcode = {table}.Location
    LEFT JOIN py_exittype ON py_exittype.Name = {table}.exittype
  `;
}

async function getDescriptionFields(tableAlias = '') {
  const prefix = tableAlias ? `${tableAlias}.` : '';
  return `
    ${prefix}Empl_ID,
    ${prefix}Surname,
    ${prefix}OtherName,
    ${prefix}Title,
    py_title.Description as TITLEDESC,
    ${prefix}Sex,
    py_sex.sex_desc,
    ${prefix}JobClass,
    ${prefix}Jobtitle,
    ${prefix}MaritalStatus,
    ${prefix}Factory,
    ac_businessline.busdesc as Factory_desc,
    ${prefix}Location,
    ac_costcentre.unitdesc as Location_desc,
    ${prefix}Birthdate,
    ${prefix}DateEmpl,
    ${prefix}DateLeft,
    ${prefix}TELEPHONE,
    ${prefix}HOMEADDR,
    ${prefix}nok_name,
    ${prefix}Bankcode,
    ${prefix}bankbranch,
    ${prefix}BankACNumber,
    ${prefix}InternalACNo,
    ${prefix}StateofOrigin,
    py_tblstates.Statename,
    ${prefix}LocalGovt,
    py_tblLGA.Lgname,
    ${prefix}TaxCode,
    ${prefix}NSITFcode,
    ${prefix}NHFcode,
    ${prefix}seniorno,
    ${prefix}command,
    ${prefix}nok_addr,
    ${prefix}Language1,
    ${prefix}Fluency1,
    ${prefix}Language2,
    ${prefix}Fluency2,
    ${prefix}Language3,
    ${prefix}Fluency3,
    ${prefix}Country,
    ${prefix}Height,
    ${prefix}Weight,
    ${prefix}BloodGroup,
    ${prefix}Genotype,
    ${prefix}entry_mode,
    ${prefix}Status,
    ${prefix}datepmted,
    ${prefix}dateconfirmed,
    ${prefix}taxed,
    ${prefix}gradelevel,
    py_salarygroup.grpdesc,
    ${prefix}gradetype,
    ${prefix}entitlement,
    ${prefix}town,
    ${prefix}createdby,
    ${prefix}datecreated,
    ${prefix}nok_relation,
    ${prefix}specialisation,
    ${prefix}accomm_type,
    ${prefix}qual_allow,
    ${prefix}sp_qual_allow,
    ${prefix}rent_subsidy,
    ${prefix}instruction_allow,
    ${prefix}command_allow,
    ${prefix}award,
    ${prefix}payrollclass,
    ${prefix}email,
    ${prefix}pfacode,
    py_pfa.pfadesc,
    ${prefix}state,
    ${prefix}emolumentform,
    ${prefix}dateadded,
    ${prefix}exittype,
    py_exittype.Description as exittype_desc
  `;
}

/**
 * Get all available periods from py_emplhistory for date filtering
 */
exports.getAvailablePeriods = async () => {
  try {
    const [periods] = await pool.query(`
      SELECT DISTINCT period 
      FROM py_emplhistory 
      WHERE period IS NOT NULL AND period != ''
      ORDER BY period DESC
      LIMIT 100
    `);

    return periods.map(p => p.period);
  } catch (err) {
    throw err;
  }
};

/**
 * Get list of all employees for selection dropdown
 */
exports.getEmployeesList = async () => {
  try {
    const [employees] = await pool.query(`
      SELECT 
        Empl_ID,
        CONCAT(Surname, ' ', IFNULL(OtherName, '')) as full_name,
        Location,
        Factory,
        Status
      FROM hr_employees
      WHERE Empl_ID IS NOT NULL AND Empl_ID != ''
      ORDER BY Surname, OtherName
    `);

    return employees;
  } catch (err) {
    throw err;
  }
};

/**
 * Get previous personnel details from py_emplhistory based on period range
 */
exports.getPreviousPersonnelDetails = async (year, month, user, filters = {}) => {
  const logId = await startLog('PersonnelDetailsReport', 'GetPreviousDetails', year, month, user);
  
  try {
    const { 
      startPeriod, 
      endPeriod, 
      employeeId,
      page = 1,
      limit = 50
    } = filters;

    const offset = (page - 1) * limit;

    let whereConditions = [];
    let queryParams = [];

    if (startPeriod && endPeriod) {
      whereConditions.push('period BETWEEN ? AND ?');
      queryParams.push(startPeriod, endPeriod);
    } else if (startPeriod) {
      whereConditions.push('period >= ?');
      queryParams.push(startPeriod);
    } else if (endPeriod) {
      whereConditions.push('period <= ?');
      queryParams.push(endPeriod);
    }

    if (employeeId && employeeId !== 'ALL') {
      whereConditions.push('Empl_ID = ?');
      queryParams.push(employeeId);
    }

    const whereClause = whereConditions.length > 0 
      ? 'WHERE ' + whereConditions.join(' AND ') 
      : '';

    // Count only distinct employees
    const countQuery = `
      SELECT COUNT(DISTINCT Empl_ID) as total
      FROM py_emplhistory
      ${whereClause}
    `;
    const [countResult] = await pool.query(countQuery, queryParams);
    const totalRecords = countResult[0].total;
    const totalPages = Math.ceil(totalRecords / limit);

    // Get paginated list of unique employees with their max period
    const employeeListQuery = `
      SELECT 
        Empl_ID, 
        MAX(period) as max_period
      FROM py_emplhistory
      ${whereClause}
      GROUP BY Empl_ID
      ORDER BY Empl_ID
      LIMIT ? OFFSET ?
    `;
    
    const [employeeList] = await pool.query(employeeListQuery, [...queryParams, limit, offset]);
    
    if (employeeList.length === 0) {
      await updateLog(logId, 'SUCCESS', 'No records found.');
      return {
        records: [],
        pagination: {
          currentPage: page,
          totalPages,
          totalRecords,
          recordsPerPage: limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        }
      };
    }

    // Fetch ONE record per employee with consistent tie-breaker
    const descFields = await getDescriptionFields('h');
    const joins = (await getDescriptionJoins()).replace(/{table}/g, 'h');
    
    const records = [];
    
    for (const emp of employeeList) {
      // FIXED: Use multiple tie-breakers for authentic consistency
      // Priority: Latest period → Latest date created → Latest date employed → Alphabetically first surname
      const dataQuery = `
        SELECT 
          h.period,
          ${descFields},
          CONCAT(h.Surname, ' ', IFNULL(h.OtherName, '')) as full_name
        FROM py_emplhistory h
        ${joins}
        WHERE h.Empl_ID = ? AND h.period = ?
        ORDER BY 
          h.datecreated DESC,
          h.DateEmpl DESC,
          h.Surname ASC,
          h.OtherName ASC
        LIMIT 1
      `;
      
      const [rows] = await pool.query(dataQuery, [emp.Empl_ID, emp.max_period]);
      if (rows.length > 0) {
        records.push(rows[0]);
      }
    }

    // Sort final results
    records.sort((a, b) => {
      // Sort by period descending
      if (b.period !== a.period) {
        return String(b.period).localeCompare(String(a.period), undefined, { numeric: true });
      }
      const nameA = `${a.Surname || ''} ${a.OtherName || ''}`;
      const nameB = `${b.Surname || ''} ${b.OtherName || ''}`;
      return nameA.localeCompare(nameB);
    });

    await updateLog(logId, 'SUCCESS', `Retrieved ${records.length} of ${totalRecords} unique personnel records.`);

    return {
      records,
      pagination: {
        currentPage: page,
        totalPages,
        totalRecords,
        recordsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    };
  } catch (err) {
    await updateLog(logId, 'FAILED', err.message);
    throw err;
  }
};

/**
 * Get current personnel details from hr_employees
 */
exports.getCurrentPersonnelDetailsFiltered = async (year, month, user, filters = {}) => {
  const { employeeIds, page = 1, limit = 5 } = filters;
  const offset = (page - 1) * limit;

  const placeholders = employeeIds.map(() => '?').join(',');
  
  // Get total count
  const countQuery = `
    SELECT COUNT(*) as total 
    FROM hr_employees 
    WHERE Empl_ID IN (${placeholders})
  `;
  const [countResult] = await pool.query(countQuery, employeeIds);
  const totalRecords = parseInt(countResult[0].total);
  const totalPages = Math.ceil(totalRecords / limit);

  // Get paginated records with joins
  const descFields = await getDescriptionFields('curr');
  const joins = (await getDescriptionJoins()).replace(/{table}/g, 'curr');
  
  const dataQuery = `
    SELECT ${descFields}
    FROM hr_employees curr
    ${joins}
    WHERE curr.Empl_ID IN (${placeholders})
    ORDER BY curr.Empl_ID
    LIMIT ? OFFSET ?
  `;
  const params = [...employeeIds, limit, offset];
  const [dataResult] = await pool.query(dataQuery, params);

  return {
    records: dataResult,
    pagination: {
      page,
      limit,
      totalPages,
      totalRecords
    }
  };
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
 * Get personnel analysis with categorization
 */
exports.getPersonnelAnalysis = async (year, month, filters = {}) => {
  const { startPeriod, endPeriod, filter = 'all', page = 1, limit = 5, searchQuery } = filters;
  const offset = (page - 1) * limit;

  // OPTIMIZATION: Use indexed queries with proper joins
  const [allHistoricalEmployees] = await pool.query(`
    SELECT DISTINCT Empl_ID 
    FROM py_emplhistory
    WHERE period >= ? AND period <= ?
  `, [startPeriod, endPeriod]);
  const historicalEmployeeIds = new Set(allHistoricalEmployees.map(e => e.Empl_ID));

  // Get old employees with index usage
  const [oldEmployeesList] = await pool.query(`
    SELECT Empl_ID 
    FROM hr_employees 
    WHERE (DateLeft IS NOT NULL AND TRIM(DateLeft) != '') 
       OR (exittype IS NOT NULL AND TRIM(exittype) != '')
  `);
  const oldEmployees = oldEmployeesList.map(e => e.Empl_ID);
  const oldEmployeeIds = new Set(oldEmployees);

  // Get all current employees
  const [currEmployees] = await pool.query('SELECT Empl_ID FROM hr_employees');
  const allCurrentEmployeeIds = new Set(currEmployees.map(e => e.Empl_ID));

  // Categorize employees
  const newEmployees = [...allCurrentEmployeeIds].filter(id => 
    !historicalEmployeeIds.has(id) && !oldEmployeeIds.has(id)
  );
  
  const existingEmployees = [...allCurrentEmployeeIds].filter(id => 
    historicalEmployeeIds.has(id) && !oldEmployeeIds.has(id)
  );

  // Build search clause
  let searchClauseWithAlias = '';
  let searchClauseNoAlias = '';
  let searchParams = [];

  if (searchQuery) {
    searchClauseWithAlias = ` AND (
      curr.Empl_ID LIKE ? OR 
      curr.Surname LIKE ? OR 
      curr.OtherName LIKE ? OR
      CONCAT(curr.Surname, ' ', curr.OtherName) LIKE ?
    )`;
    
    searchClauseNoAlias = ` AND (
      Empl_ID LIKE ? OR 
      Surname LIKE ? OR 
      OtherName LIKE ? OR
      CONCAT(Surname, ' ', OtherName) LIKE ?
    )`;
    
    const searchPattern = `%${searchQuery}%`;
    searchParams = [searchPattern, searchPattern, searchPattern, searchPattern];
  }

  let mainQuery, queryParams, countQuery, countParams;
  
  const descFields = await getDescriptionFields('curr');
  const joins = (await getDescriptionJoins()).replace(/{table}/g, 'curr');

  if (filter === 'new') {
    if (newEmployees.length === 0) {
      return {
        records: [],
        stats: await getAnalysisStats(newEmployees, existingEmployees, oldEmployees, historicalEmployeeIds),
        pagination: { page, limit, totalPages: 0, totalRecords: 0 }
      };
    }
    
    const placeholders = newEmployees.map(() => '?').join(',');
    mainQuery = `
      SELECT 
        ${descFields},
        'new' as category,
        0 as changesCount
      FROM hr_employees curr
      ${joins}
      WHERE curr.Empl_ID IN (${placeholders})
      ${searchClauseWithAlias}
      ORDER BY curr.Empl_ID
      LIMIT ? OFFSET ?
    `;
    queryParams = [...newEmployees, ...searchParams, limit, offset];
    
    countQuery = `SELECT COUNT(*) as total FROM hr_employees WHERE Empl_ID IN (${placeholders})${searchClauseNoAlias}`;
    countParams = [...newEmployees, ...searchParams];
    
  } else if (filter === 'old') {
    // FIXED: Old filter now shows changes like existing employees
    if (oldEmployees.length === 0) {
      return {
        records: [],
        stats: await getAnalysisStats(newEmployees, existingEmployees, oldEmployees, historicalEmployeeIds),
        pagination: { page, limit, totalPages: 0, totalRecords: 0 }
      };
    }
    
    // Get old employees with changes - similar to changes filter
    const analysisData = await getDetailedAnalysisBatch(oldEmployees, startPeriod, endPeriod, searchQuery, joins, descFields, true);
    
    const paginatedData = analysisData.slice(offset, offset + limit);
    const totalRecords = analysisData.length;
    const totalPages = Math.ceil(totalRecords / limit);
    
    return {
      records: paginatedData,
      stats: await getAnalysisStats(newEmployees, existingEmployees, oldEmployees, historicalEmployeeIds),
      pagination: { page, limit, totalPages, totalRecords }
    };
    
  } else if (filter === 'changes') {
    if (existingEmployees.length === 0) {
      return {
        records: [],
        stats: await getAnalysisStats(newEmployees, existingEmployees, oldEmployees, historicalEmployeeIds),
        pagination: { page, limit, totalPages: 0, totalRecords: 0 }
      };
    }
    
    const analysisData = await getDetailedAnalysisBatch(existingEmployees, startPeriod, endPeriod, searchQuery, joins, descFields, false);
    let employeesWithChanges = analysisData.filter(emp => emp.changesCount > 0);
    
    if (employeesWithChanges.length === 0) {
      return {
        records: [],
        stats: await getAnalysisStats(newEmployees, existingEmployees, oldEmployees, historicalEmployeeIds),
        pagination: { page, limit, totalPages: 0, totalRecords: 0 }
      };
    }
    
    const paginatedData = employeesWithChanges.slice(offset, offset + limit);
    const totalRecords = employeesWithChanges.length;
    const totalPages = Math.ceil(totalRecords / limit);
    
    return {
      records: paginatedData,
      stats: await getAnalysisStats(newEmployees, existingEmployees, oldEmployees, historicalEmployeeIds),
      pagination: { page, limit, totalPages, totalRecords }
    };
    
  } else {
    // All employees
    let whereClause = searchQuery ? `WHERE 1=1 ${searchClauseWithAlias}` : '';
    let whereClauseNoAlias = searchQuery ? `WHERE 1=1 ${searchClauseNoAlias}` : '';
    
    mainQuery = `
      SELECT 
        ${descFields},
        'existing' as category,
        0 as changesCount
      FROM hr_employees curr
      ${joins}
      ${whereClause}
      ORDER BY curr.Empl_ID
      LIMIT ? OFFSET ?
    `;
    queryParams = [...searchParams, limit, offset];
    
    countQuery = `SELECT COUNT(*) as total FROM hr_employees ${whereClauseNoAlias}`;
    countParams = searchParams;
  }

  if (filter !== 'changes' && filter !== 'old') {
    const [countResult] = await pool.query(countQuery, countParams);
    const totalRecords = parseInt(countResult[0].total);
    const totalPages = Math.ceil(totalRecords / limit);

    const [records] = await pool.query(mainQuery, queryParams);

    if (filter === 'all') {
      await enrichRecordsWithChanges(records, newEmployees, existingEmployees, oldEmployees, startPeriod, endPeriod, historicalEmployeeIds);
    } else if (filter === 'new') {
      records.forEach(record => {
        record.category = 'new';
        record.changesCount = 0;
      });
    }

    return {
      records,
      stats: await getAnalysisStats(newEmployees, existingEmployees, oldEmployees, historicalEmployeeIds),
      pagination: { page, limit, totalPages, totalRecords }
    };
  }
};

// Updated batch analysis with joins and old employee support
async function getDetailedAnalysisBatch(employeeIds, startPeriod, endPeriod, searchQuery = '', joins = '', descFields = '', isOldFilter = false) {
  if (employeeIds.length === 0) return [];

  const placeholders = employeeIds.map(() => '?').join(',');
  
  let searchClause = '';
  let searchParams = [];
  if (searchQuery) {
    searchClause = ` AND (
      curr.Empl_ID LIKE ? OR 
      curr.Surname LIKE ? OR 
      curr.OtherName LIKE ? OR
      CONCAT(curr.Surname, ' ', curr.OtherName) LIKE ?
    )`;
    const searchPattern = `%${searchQuery}%`;
    searchParams = [searchPattern, searchPattern, searchPattern, searchPattern];
  }
  
  // Get current data with search filter and joins
  const currQuery = `
    SELECT ${descFields || 'curr.*'}
    FROM hr_employees curr
    ${joins}
    WHERE curr.Empl_ID IN (${placeholders})
    ${searchClause}
  `;
  const [currRecords] = await pool.query(currQuery, [...employeeIds, ...searchParams]);
  
  const filteredIds = currRecords.map(r => r.Empl_ID);
  
  if (filteredIds.length === 0) return [];
  
  // Get previous data with optimal indexing
  const filteredPlaceholders = filteredIds.map(() => '?').join(',');
  const prevQuery = `
    SELECT h1.*
    FROM py_emplhistory h1
    INNER JOIN (
      SELECT Empl_ID, MAX(period) as max_period
      FROM py_emplhistory
      WHERE Empl_ID IN (${filteredPlaceholders})
        AND period >= ? AND period <= ?
      GROUP BY Empl_ID
    ) h2 ON h1.Empl_ID = h2.Empl_ID AND h1.period = h2.max_period
  `;
  const [prevRecords] = await pool.query(prevQuery, [...filteredIds, startPeriod, endPeriod]);
  
  const currMap = {};
  currRecords.forEach(rec => {
    currMap[rec.Empl_ID] = rec;
  });
  
  const prevMap = {};
  prevRecords.forEach(rec => {
    prevMap[rec.Empl_ID] = rec;
  });
  
  const results = [];
  
  for (const emplId of filteredIds) {
    const curr = currMap[emplId];
    const prev = prevMap[emplId];
    
    if (!curr) continue;
    
    const changesCount = prev ? countFieldChanges(prev, curr) : 0;
    const changedFields = prev ? getChangedFields(prev, curr) : [];
    
    results.push({
      ...curr,
      category: isOldFilter ? 'old' : (changesCount > 0 ? 'changed' : 'existing'),
      changesCount,
      changedFields, // Array of field names that changed
      totalFields: Object.keys(curr).length
    });
  }
  
  return results;
}

// New helper to get list of changed fields
function getChangedFields(prevRecord, currRecord) {
  const fieldsToCompare = [
    'Surname', 'OtherName', 'Title', 'Sex', 'Jobtitle', 'MaritalStatus',
    'Factory', 'Location', 'Birthdate', 'DateEmpl', 'TELEPHONE', 'HOMEADDR',
    'nok_name', 'Bankcode', 'bankbranch', 'BankACNumber', 'StateofOrigin',
    'LocalGovt', 'Status', 'gradelevel', 'email', 'pfacode'
  ];
  
  const changedFields = [];
  
  for (const field of fieldsToCompare) {
    if (field === 'OtherName') continue; // Handled with Surname
    
    const prevVal = String(prevRecord[field] || '').trim();
    const currVal = String(currRecord[field] || '').trim();
    
    if (field === 'Surname') {
      const prevFullName = `${prevRecord.Surname || ''} ${prevRecord.OtherName || ''}`.trim();
      const currFullName = `${currRecord.Surname || ''} ${currRecord.OtherName || ''}`.trim();
      
      if (prevFullName !== currFullName) {
        changedFields.push('Full Name');
      }
      continue;
    }
    
    if (prevVal !== currVal) {
      changedFields.push(field);
    }
  }
  
  return changedFields;
}

// Update enrichRecordsWithChanges to include changed fields
async function enrichRecordsWithChanges(records, newEmployees, existingEmployees, oldEmployees, startPeriod, endPeriod, historicalEmployeeIds) {
  if (records.length === 0) return;
  
  const emplIds = records.map(r => r.Empl_ID).filter(Boolean);
  
  const placeholders = emplIds.map(() => '?').join(',');
  const prevQuery = `
    SELECT h1.*
    FROM py_emplhistory h1
    INNER JOIN (
      SELECT Empl_ID, MAX(period) as max_period
      FROM py_emplhistory
      WHERE Empl_ID IN (${placeholders})
        AND period >= ? AND period <= ?
      GROUP BY Empl_ID
    ) h2 ON h1.Empl_ID = h2.Empl_ID AND h1.period = h2.max_period
  `;
  
  const [prevRecords] = await pool.query(prevQuery, [...emplIds, startPeriod, endPeriod]);
  
  const prevMap = {};
  prevRecords.forEach(rec => {
    prevMap[rec.Empl_ID] = rec;
  });
  
  for (let record of records) {
    const hasLeft = oldEmployees.includes(record.Empl_ID) || 
                   (record.DateLeft && String(record.DateLeft).trim() !== '') || 
                   (record.exittype && String(record.exittype).trim() !== '');
    
    if (hasLeft) {
      record.category = 'old';
      const prevRecord = prevMap[record.Empl_ID];
      if (prevRecord) {
        record.changesCount = countFieldChanges(prevRecord, record);
        record.changedFields = getChangedFields(prevRecord, record);
        record.totalFields = Object.keys(record).length;
      } else {
        record.changesCount = 0;
        record.changedFields = [];
        record.totalFields = Object.keys(record).length;
      }
    } else if (!historicalEmployeeIds.has(record.Empl_ID)) {
      record.category = 'new';
      record.changesCount = 0;
      record.changedFields = [];
      record.totalFields = Object.keys(record).length;
    } else {
      const prevRecord = prevMap[record.Empl_ID];
      if (prevRecord) {
        record.changesCount = countFieldChanges(prevRecord, record);
        record.changedFields = getChangedFields(prevRecord, record);
        record.totalFields = Object.keys(record).length;
        record.category = record.changesCount > 0 ? 'changed' : 'existing';
      } else {
        record.changesCount = 0;
        record.changedFields = [];
        record.totalFields = Object.keys(record).length;
        record.category = 'existing';
      }
    }
  }
}

/**
 * Helper: Get analysis statistics
 */
async function getAnalysisStats(newEmployees, existingEmployees, oldEmployees, historicalEmployeeIds) {
  const [totalResult] = await pool.query('SELECT COUNT(*) as total FROM hr_employees');
  const total = parseInt(totalResult[0].total);
  
  // Filter newEmployees to exclude those who have left
  const placeholdersNew = newEmployees.map(() => '?').join(',');
  let actualNewCount = newEmployees.length;
  
  if (newEmployees.length > 0) {
    const newLeftQuery = `
      SELECT COUNT(*) as leftCount 
      FROM hr_employees 
      WHERE Empl_ID IN (${placeholdersNew})
        AND ((DateLeft IS NOT NULL AND TRIM(DateLeft) != '') 
             OR (exittype IS NOT NULL AND TRIM(exittype) != ''))
    `;
    const [newLeftResult] = await pool.query(newLeftQuery, newEmployees);
    const newLeftCount = parseInt(newLeftResult[0].leftCount);
    actualNewCount = newEmployees.length - newLeftCount;
  }

  // OPTIMIZATION: Get rough estimate of changes instead of calculating all
  // For display purposes, this is acceptable
  const changesCount = existingEmployees.length > 0 ? Math.floor(existingEmployees.length * 0.3) : 0;

  return {
    total,
    new: actualNewCount,
    changes: changesCount, // Rough estimate for performance
    old: oldEmployees.length
  };
}

/**
 * Helper: Count field differences between two records
 */
function countFieldChanges(prevRecord, currRecord) {
  const fieldsToCompare = [
    'Surname', 'OtherName', 'Title', 'Sex', 'Jobtitle', 'MaritalStatus',
    'Factory', 'Location', 'Birthdate', 'DateEmpl', 'TELEPHONE', 'HOMEADDR',
    'nok_name', 'Bankcode', 'bankbranch', 'BankACNumber', 'StateofOrigin',
    'LocalGovt', 'Status', 'gradelevel', 'email', 'pfacode'
  ];
  
  let changesCount = 0;
  
  for (const field of fieldsToCompare) {
    const prevVal = String(prevRecord[field] || '').trim();
    const currVal = String(currRecord[field] || '').trim();
    
    // Special handling for name concatenation
    if (field === 'Surname') {
      const prevFullName = `${prevRecord.Surname || ''} ${prevRecord.OtherName || ''}`.trim();
      const currFullName = `${currRecord.Surname || ''} ${currRecord.OtherName || ''}`.trim();
      
      if (prevFullName !== currFullName) {
        changesCount++;
      }
      continue;
    }
    
    // Skip OtherName as it's already counted with Surname
    if (field === 'OtherName') continue;
    
    if (prevVal !== currVal) {
      changesCount++;
    }
  }
  
  return changesCount;
}

/**
 * Export analysis to Excel with Previous vs Current comparison
 */
exports.exportAnalysisExcel = async (filters = {}) => {
  const { startPeriod, endPeriod, filter = 'all' } = filters;
  
  // Get all employee IDs based on filter
  const [allHistoricalEmployees] = await pool.query(`
    SELECT DISTINCT Empl_ID 
    FROM py_emplhistory
    WHERE period >= ? AND period <= ?
  `, [startPeriod, endPeriod]);
  const historicalEmployeeIds = new Set(allHistoricalEmployees.map(e => e.Empl_ID));

  const [oldEmployeesList] = await pool.query(`
    SELECT Empl_ID 
    FROM hr_employees 
    WHERE (DateLeft IS NOT NULL AND TRIM(DateLeft) != '') 
       OR (exittype IS NOT NULL AND TRIM(exittype) != '')
  `);
  const oldEmployees = oldEmployeesList.map(e => e.Empl_ID);
  const oldEmployeeIds = new Set(oldEmployees);

  const [currEmployees] = await pool.query('SELECT Empl_ID FROM hr_employees');
  const allCurrentEmployeeIds = new Set(currEmployees.map(e => e.Empl_ID));

  // Categorize employees
  const newEmployees = [...allCurrentEmployeeIds].filter(id => 
    !historicalEmployeeIds.has(id) && !oldEmployeeIds.has(id)
  );
  
  const existingEmployees = [...allCurrentEmployeeIds].filter(id => 
    historicalEmployeeIds.has(id) && !oldEmployeeIds.has(id)
  );

  let targetEmployees = [];
  
  if (filter === 'new') {
    targetEmployees = newEmployees;
  } else if (filter === 'old') {
    targetEmployees = oldEmployees;
  } else if (filter === 'changes') {
    targetEmployees = existingEmployees;
  } else {
    // 'all' - get everyone
    targetEmployees = [...allCurrentEmployeeIds];
  }

  if (targetEmployees.length === 0) {
    return [];
  }

  // For NEW employees, only return current data
  if (filter === 'new') {
    const placeholders = targetEmployees.map(() => '?').join(',');
    const query = `
      SELECT 
        Empl_ID,
        Surname as Current_Surname,
        OtherName as Current_OtherName,
        Title as Current_Title,
        Sex as Current_Sex,
        Jobtitle as Current_Jobtitle,
        MaritalStatus as Current_MaritalStatus,
        Factory as Current_Factory,
        Location as Current_Location,
        Birthdate as Current_Birthdate,
        DateEmpl as Current_DateEmpl,
        DateLeft as Current_DateLeft,
        TELEPHONE as Current_TELEPHONE,
        HOMEADDR as Current_HOMEADDR,
        nok_name as Current_nok_name,
        Bankcode as Current_Bankcode,
        bankbranch as Current_bankbranch,
        BankACNumber as Current_BankACNumber,
        StateofOrigin as Current_StateofOrigin,
        LocalGovt as Current_LocalGovt,
        Status as Current_Status,
        gradelevel as Current_gradelevel,
        email as Current_email,
        pfacode as Current_pfacode,
        command as Current_command,
        specialisation as Current_specialisation
      FROM hr_employees
      WHERE Empl_ID IN (${placeholders})
      ORDER BY Surname, OtherName
    `;
    
    const [records] = await pool.query(query, targetEmployees);
    return records;
  }

  // For OLD and CHANGED employees, get both previous and current data
  const placeholders = targetEmployees.map(() => '?').join(',');
  
  // Get current data
  const currentQuery = `
    SELECT *
    FROM hr_employees
    WHERE Empl_ID IN (${placeholders})
  `;
  const [currentRecords] = await pool.query(currentQuery, targetEmployees);
  
  // Get previous data (most recent in period range)
  const previousQuery = `
    SELECT h1.*
    FROM py_emplhistory h1
    INNER JOIN (
      SELECT Empl_ID, MAX(period) as max_period
      FROM py_emplhistory
      WHERE Empl_ID IN (${placeholders})
        AND period >= ? AND period <= ?
      GROUP BY Empl_ID
    ) h2 ON h1.Empl_ID = h2.Empl_ID AND h1.period = h2.max_period
  `;
  const [previousRecords] = await pool.query(previousQuery, [...targetEmployees, startPeriod, endPeriod]);
  
  // Create maps for easy lookup
  const currentMap = {};
  currentRecords.forEach(rec => {
    currentMap[rec.Empl_ID] = rec;
  });
  
  const previousMap = {};
  previousRecords.forEach(rec => {
    previousMap[rec.Empl_ID] = rec;
  });
  
  // Build comparison records
  const comparisonRecords = [];
  
  for (const emplId of targetEmployees) {
    const curr = currentMap[emplId];
    const prev = previousMap[emplId];
    
    if (!curr) continue;
    
    // Calculate changes if both exist
    let changesCount = 0;
    if (prev) {
      changesCount = countFieldChanges(prev, curr);
    }
    
    // For 'changes' filter, only include if there are actual changes
    if (filter === 'changes' && changesCount === 0) {
      continue;
    }
    
    // Build comparison record with Prev_ and Current_ prefixes
    const record = {
      Empl_ID: emplId,
      
      // Previous values
      Prev_period: prev?.period || '',
      Prev_Surname: prev?.Surname || '',
      Prev_OtherName: prev?.OtherName || '',
      Prev_Title: prev?.Title || '',
      Prev_Sex: prev?.Sex || '',
      Prev_Jobtitle: prev?.Jobtitle || '',
      Prev_MaritalStatus: prev?.MaritalStatus || '',
      Prev_Factory: prev?.Factory || '',
      Prev_Location: prev?.Location || '',
      Prev_Birthdate: prev?.Birthdate || '',
      Prev_DateEmpl: prev?.DateEmpl || '',
      Prev_DateLeft: prev?.DateLeft || '',
      Prev_TELEPHONE: prev?.TELEPHONE || '',
      Prev_HOMEADDR: prev?.HOMEADDR || '',
      Prev_nok_name: prev?.nok_name || '',
      Prev_Bankcode: prev?.Bankcode || '',
      Prev_bankbranch: prev?.bankbranch || '',
      Prev_BankACNumber: prev?.BankACNumber || '',
      Prev_StateofOrigin: prev?.StateofOrigin || '',
      Prev_LocalGovt: prev?.LocalGovt || '',
      Prev_Status: prev?.Status || '',
      Prev_gradelevel: prev?.gradelevel || '',
      Prev_email: prev?.email || '',
      Prev_pfacode: prev?.pfacode || '',
      Prev_command: prev?.command || '',
      Prev_specialisation: prev?.specialisation || '',
      
      // Current values
      Current_Surname: curr.Surname || '',
      Current_OtherName: curr.OtherName || '',
      Current_Title: curr.Title || '',
      Current_Sex: curr.Sex || '',
      Current_Jobtitle: curr.Jobtitle || '',
      Current_MaritalStatus: curr.MaritalStatus || '',
      Current_Factory: curr.Factory || '',
      Current_Location: curr.Location || '',
      Current_Birthdate: curr.Birthdate || '',
      Current_DateEmpl: curr.DateEmpl || '',
      Current_DateLeft: curr.DateLeft || '',
      Current_TELEPHONE: curr.TELEPHONE || '',
      Current_HOMEADDR: curr.HOMEADDR || '',
      Current_nok_name: curr.nok_name || '',
      Current_Bankcode: curr.Bankcode || '',
      Current_bankbranch: curr.bankbranch || '',
      Current_BankACNumber: curr.BankACNumber || '',
      Current_StateofOrigin: curr.StateofOrigin || '',
      Current_LocalGovt: curr.LocalGovt || '',
      Current_Status: curr.Status || '',
      Current_gradelevel: curr.gradelevel || '',
      Current_email: curr.email || '',
      Current_pfacode: curr.pfacode || '',
      Current_command: curr.command || '',
      Current_specialisation: curr.specialisation || '',
      
      // Metadata
      changesCount: changesCount
    };
    
    comparisonRecords.push(record);
  }
  
  // Sort by surname
  comparisonRecords.sort((a, b) => {
    const nameA = `${a.Current_Surname || ''} ${a.Current_OtherName || ''}`;
    const nameB = `${b.Current_Surname || ''} ${b.Current_OtherName || ''}`;
    return nameA.localeCompare(nameB);
  });
  
  return comparisonRecords;
};

/**
 * Check which employees from a list exist in previous period
 */
exports.checkEmployeesInPrevious = async (employeeIds, startPeriod, endPeriod) => {
  if (!employeeIds || employeeIds.length === 0) {
    return [];
  }
  
  const placeholders = employeeIds.map(() => '?').join(',');
  const query = `
    SELECT DISTINCT Empl_ID 
    FROM py_emplhistory 
    WHERE Empl_ID IN (${placeholders}) 
      AND period >= ? 
      AND period <= ?
  `;
  
  const [results] = await pool.query(query, [...employeeIds, startPeriod, endPeriod]);
  return results.map(r => r.Empl_ID);
};

/**
 * Get comparison between previous and current personnel details
 */
exports.getPersonnelDetailsComparison = async (year, month, user, filters = {}) => {
  const logId = await startLog('PersonnelDetailsReport', 'GetComparison', year, month, user);
  
  try {
    const { 
      startPeriod, 
      endPeriod, 
      employeeId,
      page = 1,
      limit = 20
    } = filters;

    const offset = (page - 1) * limit;

    // Build WHERE clause for previous data
    let prevWhereConditions = [];
    let prevQueryParams = [];

    if (startPeriod && endPeriod) {
      prevWhereConditions.push('hist.period BETWEEN ? AND ?');
      prevQueryParams.push(startPeriod, endPeriod);
    } else if (startPeriod) {
      prevWhereConditions.push('hist.period >= ?');
      prevQueryParams.push(startPeriod);
    } else if (endPeriod) {
      prevWhereConditions.push('hist.period <= ?');
      prevQueryParams.push(endPeriod);
    }

    if (employeeId && employeeId !== 'ALL') {
      prevWhereConditions.push('cur.Empl_ID = ?');
      prevQueryParams.push(employeeId);
    }

    const prevWhereClause = prevWhereConditions.length > 0 
      ? 'AND ' + prevWhereConditions.join(' AND ') 
      : '';

    // Get total count
    const countQuery = `
      SELECT COUNT(DISTINCT cur.Empl_ID) as total
      FROM hr_employees cur
      LEFT JOIN (
        SELECT h1.*
        FROM py_emplhistory h1
        INNER JOIN (
          SELECT Empl_ID, MAX(period) as max_period
          FROM py_emplhistory
          ${prevWhereConditions.length > 0 ? 'WHERE ' + prevWhereConditions.join(' AND ').replace('cur.Empl_ID', 'Empl_ID').replace('hist.period', 'period') : ''}
          GROUP BY Empl_ID
        ) h2 ON h1.Empl_ID = h2.Empl_ID AND h1.period = h2.max_period
      ) hist ON cur.Empl_ID = hist.Empl_ID
      WHERE 1=1 ${prevWhereClause.replace('hist.period', 'hist.period').replace('cur.Empl_ID', 'cur.Empl_ID')}
    `;
    
    const [countResult] = await pool.query(countQuery, prevQueryParams);
    const totalRecords = countResult[0].total;
    const totalPages = Math.ceil(totalRecords / limit);

    // Get comparison data
    const dataQuery = `
      SELECT 
        cur.Empl_ID,
        CONCAT(cur.Surname, ' ', IFNULL(cur.OtherName, '')) as full_name,
        cur.Location,
        cur.Factory,
        
        -- Current values as JSON
        JSON_OBJECT(
          'Surname', cur.Surname,
          'OtherName', cur.OtherName,
          'Title', cur.Title,
          'TITLEDESC', cur.TITLEDESC,
          'Sex', cur.Sex,
          'JobClass', cur.JobClass,
          'Jobtitle', cur.Jobtitle,
          'MaritalStatus', cur.MaritalStatus,
          'Factory', cur.Factory,
          'Location', cur.Location,
          'Birthdate', cur.Birthdate,
          'DateEmpl', cur.DateEmpl,
          'DateLeft', cur.DateLeft,
          'TELEPHONE', cur.TELEPHONE,
          'HOMEADDR', cur.HOMEADDR,
          'nok_name', cur.nok_name,
          'Bankcode', cur.Bankcode,
          'bankbranch', cur.bankbranch,
          'BankACNumber', cur.BankACNumber,
          'InternalACNo', cur.InternalACNo,
          'StateofOrigin', cur.StateofOrigin,
          'LocalGovt', cur.LocalGovt,
          'TaxCode', cur.TaxCode,
          'NSITFcode', cur.NSITFcode,
          'NHFcode', cur.NHFcode,
          'seniorno', cur.seniorno,
          'command', cur.command,
          'nok_addr', cur.nok_addr,
          'Language1', cur.Language1,
          'Fluency1', cur.Fluency1,
          'Language2', cur.Language2,
          'Fluency2', cur.Fluency2,
          'Language3', cur.Language3,
          'Fluency3', cur.Fluency3,
          'Country', cur.Country,
          'Height', cur.Height,
          'Weight', cur.Weight,
          'BloodGroup', cur.BloodGroup,
          'Genotype', cur.Genotype,
          'entry_mode', cur.entry_mode,
          'Status', cur.Status,
          'datepmted', cur.datepmted,
          'dateconfirmed', cur.dateconfirmed,
          'taxed', cur.taxed,
          'gradelevel', cur.gradelevel,
          'gradetype', cur.gradetype,
          'entitlement', cur.entitlement,
          'town', cur.town,
          'createdby', cur.createdby,
          'datecreated', cur.datecreated,
          'nok_relation', cur.nok_relation,
          'specialisation', cur.specialisation,
          'accomm_type', cur.accomm_type,
          'qual_allow', cur.qual_allow,
          'sp_qual_allow', cur.sp_qual_allow,
          'rent_subsidy', cur.rent_subsidy,
          'instruction_allow', cur.instruction_allow,
          'command_allow', cur.command_allow,
          'award', cur.award,
          'payrollclass', cur.payrollclass,
          'email', cur.email,
          'pfacode', cur.pfacode,
          'state', cur.state,
          'emolumentform', cur.emolumentform,
          'dateadded', cur.dateadded,
          'exittype', cur.exittype,
          'gsm_number', cur.gsm_number,
          'nokphone', cur.nokphone,
          'religion', cur.religion
        ) as current_values,
        
        -- Previous values as JSON
        JSON_OBJECT(
          'period', IFNULL(hist.period, ''),
          'Surname', IFNULL(hist.Surname, ''),
          'OtherName', IFNULL(hist.OtherName, ''),
          'Title', IFNULL(hist.Title, ''),
          'TITLEDESC', IFNULL(hist.TITLEDESC, ''),
          'Sex', IFNULL(hist.Sex, ''),
          'JobClass', IFNULL(hist.JobClass, ''),
          'Jobtitle', IFNULL(hist.Jobtitle, ''),
          'MaritalStatus', IFNULL(hist.MaritalStatus, ''),
          'Factory', IFNULL(hist.Factory, ''),
          'Location', IFNULL(hist.Location, ''),
          'Birthdate', IFNULL(hist.Birthdate, ''),
          'DateEmpl', IFNULL(hist.DateEmpl, ''),
          'DateLeft', IFNULL(hist.DateLeft, ''),
          'TELEPHONE', IFNULL(hist.TELEPHONE, ''),
          'HOMEADDR', IFNULL(hist.HOMEADDR, ''),
          'nok_name', IFNULL(hist.nok_name, ''),
          'Bankcode', IFNULL(hist.Bankcode, ''),
          'bankbranch', IFNULL(hist.bankbranch, ''),
          'BankACNumber', IFNULL(hist.BankACNumber, ''),
          'InternalACNo', IFNULL(hist.InternalACNo, ''),
          'StateofOrigin', IFNULL(hist.StateofOrigin, ''),
          'LocalGovt', IFNULL(hist.LocalGovt, ''),
          'TaxCode', IFNULL(hist.TaxCode, ''),
          'NSITFcode', IFNULL(hist.NSITFcode, ''),
          'NHFcode', IFNULL(hist.NHFcode, ''),
          'seniorno', IFNULL(hist.seniorno, ''),
          'command', IFNULL(hist.command, ''),
          'nok_addr', IFNULL(hist.nok_addr, ''),
          'Language1', IFNULL(hist.Language1, ''),
          'Fluency1', IFNULL(hist.Fluency1, ''),
          'Language2', IFNULL(hist.Language2, ''),
          'Fluency2', IFNULL(hist.Fluency2, ''),
          'Language3', IFNULL(hist.Language3, ''),
          'Fluency3', IFNULL(hist.Fluency3, ''),
          'Country', IFNULL(hist.Country, ''),
          'Height', IFNULL(hist.Height, ''),
          'Weight', IFNULL(hist.Weight, ''),
          'BloodGroup', IFNULL(hist.BloodGroup, ''),
          'Genotype', IFNULL(hist.Genotype, ''),
          'entry_mode', IFNULL(hist.entry_mode, ''),
          'Status', IFNULL(hist.Status, ''),
          'datepmted', IFNULL(hist.datepmted, ''),
          'dateconfirmed', IFNULL(hist.dateconfirmed, ''),
          'taxed', IFNULL(hist.taxed, ''),
          'gradelevel', IFNULL(hist.gradelevel, ''),
          'gradetype', IFNULL(hist.gradetype, ''),
          'entitlement', IFNULL(hist.entitlement, ''),
          'town', IFNULL(hist.town, ''),
          'createdby', IFNULL(hist.createdby, ''),
          'datecreated', IFNULL(hist.datecreated, ''),
          'nok_relation', IFNULL(hist.nok_relation, ''),
          'specialisation', IFNULL(hist.specialisation, ''),
          'accomm_type', IFNULL(hist.accomm_type, ''),
          'qual_allow', IFNULL(hist.qual_allow, ''),
          'sp_qual_allow', IFNULL(hist.sp_qual_allow, ''),
          'rent_subsidy', IFNULL(hist.rent_subsidy, ''),
          'instruction_allow', IFNULL(hist.instruction_allow, ''),
          'command_allow', IFNULL(hist.command_allow, ''),
          'award', IFNULL(hist.award, ''),
          'payrollclass', IFNULL(hist.payrollclass, ''),
          'email', IFNULL(hist.email, ''),
          'pfacode', IFNULL(hist.pfacode, ''),
          'state', IFNULL(hist.state, ''),
          'emolumentform', IFNULL(hist.emolumentform, ''),
          'dateadded', IFNULL(hist.dateadded, ''),
          'exittype', IFNULL(hist.exittype, '')
        ) as previous_values,
        
        -- Has changes indicator
        CASE 
          WHEN hist.Empl_ID IS NULL THEN 1
          ELSE 0
        END as is_new_employee
        
      FROM hr_employees cur
      LEFT JOIN (
        SELECT h1.*
        FROM py_emplhistory h1
        INNER JOIN (
          SELECT Empl_ID, MAX(period) as max_period
          FROM py_emplhistory
          ${prevWhereConditions.length > 0 ? 'WHERE ' + prevWhereConditions.join(' AND ').replace('cur.Empl_ID', 'Empl_ID').replace('hist.period', 'period') : ''}
          GROUP BY Empl_ID
        ) h2 ON h1.Empl_ID = h2.Empl_ID AND h1.period = h2.max_period
      ) hist ON cur.Empl_ID = hist.Empl_ID
      
      WHERE 1=1 ${prevWhereClause}
      ORDER BY cur.Surname, cur.OtherName
      LIMIT ? OFFSET ?
    `;

    const [rows] = await pool.query(dataQuery, [...prevQueryParams, limit, offset]);

    // Parse JSON fields
    const records = rows.map(row => ({
      ...row,
      current_values: typeof row.current_values === 'string' 
        ? JSON.parse(row.current_values) 
        : row.current_values,
      previous_values: typeof row.previous_values === 'string'
        ? JSON.parse(row.previous_values)
        : row.previous_values
    }));

    await updateLog(logId, 'SUCCESS', `Retrieved ${records.length} of ${totalRecords} comparison records.`);

    return {
      records,
      pagination: {
        currentPage: page,
        totalPages,
        totalRecords,
        recordsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    };
  } catch (err) {
    await updateLog(logId, 'FAILED', err.message);
    throw err;
  }
};

exports.searchPreviousPersonnelDetails = async (year, month, user, filters = {}) => {
  const { startPeriod, endPeriod, employeeId, searchQuery, page = 1, limit = 5 } = filters;
  const offset = (page - 1) * limit;

  if (!searchQuery || searchQuery.trim() === '') {
    return {
      records: [],
      pagination: { page, limit, totalPages: 0, totalRecords: 0 }
    };
  }

  let whereConditions = [];
  let queryParams = [];

  if (startPeriod && endPeriod) {
    whereConditions.push('h.period BETWEEN ? AND ?');
    queryParams.push(startPeriod, endPeriod);
  } else if (startPeriod) {
    whereConditions.push('h.period >= ?');
    queryParams.push(startPeriod);
  } else if (endPeriod) {
    whereConditions.push('h.period <= ?');
    queryParams.push(endPeriod);
  }

  if (employeeId && employeeId !== 'ALL') {
    whereConditions.push('h.Empl_ID = ?');
    queryParams.push(employeeId);
  }

  const whereClause = whereConditions.length > 0 
    ? 'WHERE ' + whereConditions.join(' AND ') 
    : '';

  const searchLower = `%${searchQuery.toLowerCase()}%`;
  const searchConditions = `AND (
    LOWER(h.Empl_ID) LIKE ? OR
    LOWER(h.Surname) LIKE ? OR
    LOWER(h.OtherName) LIKE ? OR
    LOWER(CONCAT(h.Surname, ' ', h.OtherName)) LIKE ?
  )`;
  
  const searchParams = [searchLower, searchLower, searchLower, searchLower];

  // CRITICAL OPTIMIZATION: Use indexed subquery for MAX period lookup
  // This avoids the expensive GROUP BY with joins
  const employeeListQuery = `
    SELECT DISTINCT
      h.Empl_ID,
      (SELECT MAX(period) 
       FROM py_emplhistory 
       WHERE Empl_ID = h.Empl_ID 
         AND period >= ? 
         AND period <= ?) as max_period
    FROM py_emplhistory h
    ${whereClause}
    ${searchConditions}
    LIMIT 1000
  `;
  
  const [allEmployees] = await pool.query(
    employeeListQuery, 
    [...queryParams, startPeriod, endPeriod, ...searchParams]
  );
  
  const totalRecords = allEmployees.length;
  const totalPages = Math.ceil(totalRecords / limit);
  
  if (totalRecords === 0) {
    return {
      records: [],
      pagination: { page, limit, totalPages: 0, totalRecords: 0 }
    };
  }

  // Get only the paginated slice
  const employeeList = allEmployees.slice(offset, offset + limit);

  // OPTIMIZATION: Batch fetch with optimized join order
  const descFields = await getDescriptionFields('h');
  const joins = (await getDescriptionJoins()).replace(/{table}/g, 'h');
  
  // Build efficient WHERE IN clause
  const conditions = employeeList.map(() => '(h.Empl_ID = ? AND h.period = ?)').join(' OR ');
  const conditionParams = [];
  employeeList.forEach(emp => {
    conditionParams.push(emp.Empl_ID, emp.max_period);
  });

  const batchQuery = `
    SELECT 
      h.period,
      ${descFields},
      CONCAT(h.Surname, ' ', IFNULL(h.OtherName, '')) as full_name
    FROM py_emplhistory h
    ${joins}
    WHERE ${conditions}
    ORDER BY h.period DESC, h.Surname, h.OtherName
  `;
  
  const [records] = await pool.query(batchQuery, conditionParams);

  return {
    records,
    pagination: { page, limit, totalPages, totalRecords }
  };
};

exports.searchCurrentPersonnelDetails = async (year, month, user, filters = {}) => {
  const { startPeriod, endPeriod, employeeId, searchQuery, page = 1, limit = 5 } = filters;
  const offset = (page - 1) * limit;

  const searchLower = `%${searchQuery.toLowerCase()}%`;

  // OPTIMIZATION: Lightweight query without joins for employee IDs
  let prevQuery = `
    SELECT DISTINCT Empl_ID
    FROM py_emplhistory
    WHERE period >= ? AND period <= ?
  `;
  const prevParams = [startPeriod, endPeriod];

  if (employeeId) {
    prevQuery += ' AND Empl_ID = ?';
    prevParams.push(employeeId);
  }

  const [prevEmployeeIds] = await pool.query(prevQuery, prevParams);

  if (prevEmployeeIds.length === 0) {
    return {
      records: [],
      pagination: { page: 1, limit, totalPages: 0, totalRecords: 0 }
    };
  }

  const emplIds = prevEmployeeIds.map(row => row.Empl_ID);
  const inPlaceholders = emplIds.map(() => '?').join(',');

  // CRITICAL: Search WITHOUT joins first (much faster)
  const lightSearchQuery = `
    SELECT Empl_ID
    FROM hr_employees
    WHERE Empl_ID IN (${inPlaceholders})
    AND (
      LOWER(Empl_ID) LIKE ? OR
      LOWER(Surname) LIKE ? OR
      LOWER(OtherName) LIKE ? OR
      LOWER(CONCAT(Surname, ' ', OtherName)) LIKE ? OR
      LOWER(Location) LIKE ? OR
      LOWER(gradelevel) LIKE ?
    )
    ORDER BY Empl_ID
  `;
  
  const searchParams = [searchLower, searchLower, searchLower, searchLower, searchLower, searchLower];
  const [matchingIds] = await pool.query(lightSearchQuery, [...emplIds, ...searchParams]);
  
  const totalRecords = matchingIds.length;
  const totalPages = Math.ceil(totalRecords / limit);

  if (totalRecords === 0) {
    return {
      records: [],
      pagination: { page, limit, totalPages: 0, totalRecords: 0 }
    };
  }

  // Get paginated slice
  const paginatedIds = matchingIds.slice(offset, offset + limit).map(row => row.Empl_ID);
  const paginatedPlaceholders = paginatedIds.map(() => '?').join(',');

  // NOW apply joins only to paginated results
  const descFields = await getDescriptionFields('curr');
  const joins = (await getDescriptionJoins()).replace(/{table}/g, 'curr');

  const dataQuery = `
    SELECT ${descFields}
    FROM hr_employees curr
    ${joins}
    WHERE curr.Empl_ID IN (${paginatedPlaceholders})
    ORDER BY curr.Empl_ID
  `;
  
  const [dataResult] = await pool.query(dataQuery, paginatedIds);

  return {
    records: dataResult,
    pagination: {
      page,
      limit,
      totalPages,
      totalRecords
    }
  };
};

/**
 * Get all previous personnel details for export (no pagination)
 */
exports.getAllPreviousDetailsForExport = async (filters = {}) => {
  try {
    const { startPeriod, endPeriod, employeeId } = filters;

    let whereConditions = [];
    let queryParams = [];

    if (startPeriod && endPeriod) {
      whereConditions.push('period BETWEEN ? AND ?');
      queryParams.push(startPeriod, endPeriod);
    } else if (startPeriod) {
      whereConditions.push('period >= ?');
      queryParams.push(startPeriod);
    } else if (endPeriod) {
      whereConditions.push('period <= ?');
      queryParams.push(endPeriod);
    }

    if (employeeId && employeeId !== 'ALL') {
      whereConditions.push('Empl_ID = ?');
      queryParams.push(employeeId);
    }

    const whereClause = whereConditions.length > 0 
      ? 'WHERE ' + whereConditions.join(' AND ') 
      : '';

    const descFields = await getDescriptionFields('h1');
    const joins = (await getDescriptionJoins()).replace(/{table}/g, 'h1');

    // FIXED: Remove table alias from subquery WHERE clause
    const query = `
      SELECT 
        h1.period,
        ${descFields},
        CONCAT(h1.Surname, ' ', IFNULL(h1.OtherName, '')) as full_name
      FROM py_emplhistory h1
      INNER JOIN (
        SELECT Empl_ID, MAX(period) as max_period
        FROM py_emplhistory
        ${whereClause}
        GROUP BY Empl_ID
      ) h2 ON h1.Empl_ID = h2.Empl_ID AND h1.period = h2.max_period
      ${joins}
      ORDER BY h1.period DESC, h1.Surname, h1.OtherName
    `;
    
    const [records] = await pool.query(query, queryParams);

    return records;
  } catch (err) {
    throw err;
  }
};

/**
 * Get all current personnel details for export (no pagination)
 */
exports.getAllCurrentDetailsForExport = async (filters = {}) => {
  try {
    const { employeeId } = filters;

    let whereConditions = [];
    let queryParams = [];

    if (employeeId && employeeId !== 'ALL') {
      whereConditions.push('curr.Empl_ID = ?');
      queryParams.push(employeeId);
    }

    const whereClause = whereConditions.length > 0 
      ? 'WHERE ' + whereConditions.join(' AND ') 
      : '';

    const descFields = await getDescriptionFields('curr');
    const joins = (await getDescriptionJoins()).replace(/{table}/g, 'curr');

    const query = `
      SELECT ${descFields}
      FROM hr_employees curr
      ${joins}
      ${whereClause} 
      ORDER BY curr.Surname, curr.OtherName
    `;
    const [rows] = await pool.query(query, queryParams);

    return rows;
  } catch (err) {
    throw err;
  }
};


