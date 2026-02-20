const pool = require('../../config/db');

class EmployeeChangeHistoryService {
  
  // ========================================================================
  // HELPER: Get Payroll Class from Current Database
  // ========================================================================
  /**
   * Maps database name to payroll class code from py_payrollclass
   * @param {string} dbName - Current database name
   * @returns {string} Payroll class code
   */
  async getPayrollClassFromDb(dbName) {
    const masterDb = pool.getMasterDb();
    const connection = await pool.getConnection();
    
    try {
      await connection.query(`USE \`${masterDb}\``);
      const [rows] = await connection.query(
        'SELECT classcode FROM py_payrollclass WHERE db_name = ?',
        [dbName]
      );
      
      const result = rows.length > 0 ? rows[0].classcode : null;
      console.log('🔍 Database:', dbName, '→ Payroll Class:', result);
      return result;
    } finally {
      connection.release();
    }
  }

  // ========================================================================
  // HELPER: Convert YYYYMM to period range
  // ========================================================================
  convertToPeriodRange(year, month) {
    const yearStr = year.toString().padStart(4, '0');
    const monthStr = month.toString().padStart(2, '0');
    
    const startPeriod = `${yearStr}${monthStr}010000`;
    const lastDay = new Date(year, month, 0).getDate();
    const endPeriod = `${yearStr}${monthStr}${lastDay.toString().padStart(2, '0')}2359`;
    
    return { startPeriod, endPeriod };
  }

  // ========================================================================
  // HELPER: Get all comparable fields (exclude meta fields)
  // ========================================================================
  getComparableFields() {
    return [
      'Surname', 'OtherName', 'Title', 'TITLEDESC', 'Sex', 'JobClass', 'Jobtitle',
      'MaritalStatus', 'Factory', 'Location', 'Birthdate', 'DateEmpl', 'DateLeft',
      'TELEPHONE', 'HOMEADDR', 'nok_name', 'Bankcode', 'bankbranch', 'BankACNumber',
      'InternalACNo', 'StateofOrigin', 'LocalGovt', 'TaxCode', 'NSITFcode', 'NHFcode',
      'seniorno', 'command', 'nok_addr', 'Language1', 'Fluency1', 'Language2', 'Fluency2',
      'Language3', 'Fluency3', 'Country', 'Height', 'Weight', 'BloodGroup', 'Genotype',
      'entry_mode', 'Status', 'datepmted', 'dateconfirmed', 'taxed', 'gradelevel',
      'gradetype', 'entitlement', 'town', 'nok_relation', 'specialisation', 'accomm_type',
      'qual_allow', 'sp_qual_allow', 'rent_subsidy', 'instruction_allow', 'command_allow',
      'award', 'payrollclass', 'email', 'pfacode', 'state', 'emolumentform', 'exittype'
    ];
  }

  // ========================================================================
  // HELPER: Format date from YYYY-MM-DD to readable format
  // ========================================================================
  formatDate(dateStr) {
    if (!dateStr) return '';
    
    // Convert to string and trim
    const dateString = dateStr.toString().trim();
    if (!dateString || dateString === '0000-00-00') return '';
    
    try {
      // Handle MySQL DATE format (YYYY-MM-DD)
      let year, month, day;
      
      if (dateString.includes('-')) {
        // Format: YYYY-MM-DD
        const parts = dateString.split('-');
        year = parts[0];
        month = parts[1];
        day = parts[2].substring(0, 2); // Handle datetime format
      } else if (dateString.length === 8) {
        // Format: YYYYMMDD
        year = dateString.substring(0, 4);
        month = dateString.substring(4, 6);
        day = dateString.substring(6, 8);
      } else {
        return dateString;
      }
      
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      
      const monthIndex = parseInt(month) - 1;
      const monthName = months[monthIndex] || month;
      
      return `${day}-${monthName}-${year}`;
    } catch (error) {
      console.error('Date formatting error for:', dateStr, error);
      return dateString;
    }
  }

  // ========================================================================
  // HELPER: Get date fields that need formatting
  // ========================================================================
  getDateFields() {
    return ['Birthdate', 'DateEmpl', 'DateLeft', 'datepmted', 'dateconfirmed'];
  }

  // ========================================================================
  // HELPER: Get lookup data for joins
  // ========================================================================
  async getLookupData() {
    try {
      // Get bank branches
      const [bankBranches] = await pool.query(`
        SELECT bankcode, branchcode, branchname as branch_display
        FROM py_bank
      `);

      // Get states
      const [states] = await pool.query(`
        SELECT Statecode, Statename
        FROM py_tblstates
      `);

      // Create lookup maps
      const bankBranchMap = new Map();
      bankBranches.forEach(row => {
        const key = `${row.bankcode}-${row.branchcode}`;
        bankBranchMap.set(key, row.branch_display);
      });

      const stateMap = new Map(states.map(s => [s.Statecode, s.Statename]));

      return { bankBranchMap, stateMap };
    } catch (error) {
      console.error('❌ ERROR fetching lookup data:', error);
      return { bankBranchMap: new Map(), stateMap: new Map() };
    }
  }

  // ========================================================================
  // HELPER: Resolve field value with lookups and formatting
  // ========================================================================
  resolveFieldValue(fieldName, value, bankcode, lookupData) {
    if (!value || value === '(empty)') return value;

    const dateFields = this.getDateFields();
    
    // Format date fields
    if (dateFields.includes(fieldName)) {
      return this.formatDate(value);
    }

    // Resolve bank branch
    if (fieldName === 'bankbranch' && bankcode) {
      const key = `${bankcode}-${value}`;
      const branchDisplay = lookupData.bankBranchMap.get(key);
      return branchDisplay || value;
    }

    // Resolve state
    if (fieldName === 'StateofOrigin') {
      const stateName = lookupData.stateMap.get(value);
      return stateName || value;
    }

    return value;
  }

  // ========================================================================
  // HELPER: Compare two records and get changed fields
  // ========================================================================
  compareRecords(historyRecord, currentRecord, lookupData) {
    const fields = this.getComparableFields();
    const changes = [];

    fields.forEach(field => {
      const oldValue = (historyRecord[field] || '').toString().trim();
      const newValue = (currentRecord[field] || '').toString().trim();

      if (oldValue !== newValue) {
        // Get bankcode for bank branch resolution
        const oldBankcode = historyRecord.Bankcode || '';
        const newBankcode = currentRecord.Bankcode || '';

        const oldResolved = this.resolveFieldValue(field, oldValue || '(empty)', oldBankcode, lookupData);
        const newResolved = this.resolveFieldValue(field, newValue || '(empty)', newBankcode, lookupData);

        changes.push({
          field_name: field,
          old_value: oldResolved,
          new_value: newResolved
        });
      }
    });

    return changes;
  }

  // ========================================================================
  // GET EMPLOYEE CHANGE HISTORY REPORT
  // ========================================================================
  async getEmployeeChangeHistory(filters = {}, currentDb) {
    const { fromYear, fromMonth, toYear, toMonth, emplId } = filters;
    
    const payrollClass = await this.getPayrollClassFromDb(currentDb);
    
    console.log('📊 Employee Change History Request:');
    console.log('   └─ Database:', currentDb);
    console.log('   └─ Payroll Class:', payrollClass);
    console.log('   └─ Filters:', JSON.stringify(filters, null, 2));

    if (!fromYear || !fromMonth || !toYear || !toMonth) {
      throw new Error('Period range (from and to) is required');
    }

    const fromPeriod = this.convertToPeriodRange(fromYear, fromMonth);
    const toPeriod = this.convertToPeriodRange(toYear, toMonth);

    console.log('   └─ Period Range:', fromPeriod.startPeriod, 'to', toPeriod.endPeriod);

    try {
      // Get lookup data once for all employees
      console.log('🔍 Loading lookup data (banks, states)...');
      const lookupData = await this.getLookupData();
      console.log('✅ Lookup data loaded');

      // Step 1: Get list of employees to process
      const employeeQuery = `
        SELECT DISTINCT Empl_ID
        FROM py_emplhistory
        WHERE payrollclass = ?
          AND period >= ? 
          AND period <= ?
          ${emplId ? 'AND Empl_ID = ?' : ''}
        ORDER BY Empl_ID
      `;

      const employeeParams = [payrollClass, fromPeriod.startPeriod, toPeriod.endPeriod];
      if (emplId) employeeParams.push(emplId);

      console.log('🔍 Fetching employees with history records...');
      const [employees] = await pool.query(employeeQuery, employeeParams);

      if (employees.length === 0) {
        console.log('⚠️  NO EMPLOYEES FOUND with history records in the specified period');
        return [];
      }

      console.log('✅ Found', employees.length, 'employees with history records');
      console.log('📦 Processing in batches of 500...');

      // Step 2: Process employees in batches of 500
      const batchSize = 500;
      const allResults = [];

      for (let i = 0; i < employees.length; i += batchSize) {
        const batch = employees.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(employees.length / batchSize);

        console.log(`   └─ Processing batch ${batchNumber}/${totalBatches} (${batch.length} employees)...`);

        const batchResults = await this.processBatch(
          batch,
          payrollClass,
          fromPeriod.startPeriod,
          toPeriod.endPeriod,
          lookupData
        );

        allResults.push(...batchResults);
      }

      // Filter out employees with no changes
      const employeesWithChanges = allResults.filter(emp => emp.changes.length > 0);

      console.log('✅ Change History Complete:');
      console.log('   └─ Total Employees Processed:', employees.length);
      console.log('   └─ Employees with Changes:', employeesWithChanges.length);
      console.log('   └─ Employees with No Changes:', employees.length - employeesWithChanges.length);

      return employeesWithChanges;

    } catch (error) {
      console.error('❌ ERROR in getEmployeeChangeHistory:');
      console.error('   └─ Error Type:', error.constructor.name);
      console.error('   └─ Error Code:', error.code);
      console.error('   └─ Error Message:', error.message);
      console.error('   └─ SQL State:', error.sqlState);
      console.error('   └─ Full Error:', error);
      throw error;
    }
  }

  // ========================================================================
  // HELPER: Process a batch of employees
  // ========================================================================
  async processBatch(employees, payrollClass, startPeriod, endPeriod, lookupData) {
    const employeeIds = employees.map(e => e.Empl_ID);
    const results = [];

    // Get latest history record for each employee in this batch
    const historyQuery = `
      SELECT h1.*
      FROM py_emplhistory h1
      INNER JOIN (
        SELECT Empl_ID, MAX(period) as max_period
        FROM py_emplhistory
        WHERE Empl_ID IN (${employeeIds.map(() => '?').join(',')})
          AND payrollclass = ?
          AND period >= ?
          AND period <= ?
        GROUP BY Empl_ID
      ) h2 ON h1.Empl_ID = h2.Empl_ID AND h1.period = h2.max_period
    `;

    const historyParams = [...employeeIds, payrollClass, startPeriod, endPeriod];
    const [historyRecords] = await pool.query(historyQuery, historyParams);

    // Get current hr_employees records for this batch
    const currentQuery = `
      SELECT *
      FROM hr_employees
      WHERE Empl_ID IN (${employeeIds.map(() => '?').join(',')})
        AND payrollclass = ?
    `;

    const currentParams = [...employeeIds, payrollClass];
    const [currentRecords] = await pool.query(currentQuery, currentParams);

    // Create maps for quick lookup
    const historyMap = new Map(historyRecords.map(r => [r.Empl_ID, r]));
    const currentMap = new Map(currentRecords.map(r => [r.Empl_ID, r]));

    // Compare records
    for (const emplId of employeeIds) {
      const historyRecord = historyMap.get(emplId);
      const currentRecord = currentMap.get(emplId);

      if (!historyRecord || !currentRecord) {
        continue;
      }

      const changes = this.compareRecords(historyRecord, currentRecord, lookupData);

      if (changes.length > 0) {
        results.push({
          employee_id: emplId,
          full_name: `${(currentRecord.Surname || '').trim()} ${(currentRecord.OtherName || '').trim()}`.trim(),
          title: currentRecord.Title,
          location: currentRecord.Location,
          history_period: historyRecord.period,
          history_date_formatted: this.formatPeriod(historyRecord.period),
          total_changes: changes.length,
          changes: changes
        });
      }
    }

    return results;
  }

  // ========================================================================
  // HELPER: Format period YYYYMMDDHHMM to readable string
  // ========================================================================
  formatPeriod(period) {
    if (!period || period.length < 12) return period;

    const year = period.substring(0, 4);
    const month = period.substring(4, 6);
    const day = period.substring(6, 8);
    const hour = period.substring(8, 10);
    const minute = period.substring(10, 12);

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthName = months[parseInt(month) - 1] || month;

    return `${day}-${monthName}-${year} ${hour}:${minute}`;
  }

  // ========================================================================
  // GET STATISTICS
  // ========================================================================
  async getChangeStatistics(changeData) {
    const stats = {
      total_employees_processed: changeData.length,
      total_changes: 0,
      employees_by_change_count: {},
      most_changed_fields: {},
      changes_by_employee: []
    };

    changeData.forEach(emp => {
      stats.total_changes += emp.total_changes;

      const changeCount = emp.total_changes;
      if (!stats.employees_by_change_count[changeCount]) {
        stats.employees_by_change_count[changeCount] = 0;
      }
      stats.employees_by_change_count[changeCount]++;

      emp.changes.forEach(change => {
        if (!stats.most_changed_fields[change.field_name]) {
          stats.most_changed_fields[change.field_name] = 0;
        }
        stats.most_changed_fields[change.field_name]++;
      });

      stats.changes_by_employee.push({
        employee_id: emp.employee_id,
        full_name: emp.full_name,
        total_changes: emp.total_changes
      });
    });

    stats.most_changed_fields = Object.entries(stats.most_changed_fields)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .reduce((obj, [key, val]) => {
        obj[key] = val;
        return obj;
      }, {});

    return stats;
  }

  // ========================================================================
  // GET AVAILABLE EMPLOYEES (for filter dropdown)
  // ========================================================================
  async getAvailableEmployees(currentDb) {
    try {
      const payrollClass = await this.getPayrollClassFromDb(currentDb);

      const query = `
        SELECT DISTINCT 
          h.Empl_ID as employee_id,
          CONCAT(TRIM(e.Surname), ' ', TRIM(IFNULL(e.OtherName, ''))) as full_name
        FROM py_emplhistory h
        INNER JOIN hr_employees e ON e.Empl_ID = h.Empl_ID
        WHERE h.payrollclass = ?
          AND e.payrollclass = ?
        ORDER BY h.Empl_ID
        LIMIT 1000
      `;

      const [rows] = await pool.query(query, [payrollClass, payrollClass]);
      return rows;

    } catch (error) {
      console.error('❌ ERROR in getAvailableEmployees:', error);
      throw error;
    }
  }
}

module.exports = new EmployeeChangeHistoryService();