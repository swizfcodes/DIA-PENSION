const pool = require('../../config/db');

class StaffListingReportService {
  // ========================================================================
  // HELPER: Get Payroll Class from Current Database
  // ========================================================================
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
  // PERSONNEL REPORT - DETAILED LISTING
  // ========================================================================
  async getPersonnelReport(filters = {}, currentDb) {
    const { 
      title, 
      pfa, 
      location, 
      gradetype, 
      gradelevel, 
      bankBranch, 
      stateOfOrigin, 
      emolumentForm,
      rentSubsidy,
      taxed
    } = filters;
    
    const payrollClass = await this.getPayrollClassFromDb(currentDb);
    
    console.log('📊 Personnel Report Request:');
    console.log('   └─ Database:', currentDb);
    console.log('   └─ Payroll Class:', payrollClass);
    console.log('   └─ Filters:', JSON.stringify(filters, null, 2));
    
    try {
      const query = `
        SELECT 
          h.Empl_ID as employee_id,
          h.Title as title_code,
          CONCAT(TRIM(h.Surname), ' ', TRIM(IFNULL(h.OtherName, ''))) as full_name,
          h.Surname,
          h.OtherName,
          cc.unitdesc as location,
          h.Location as location_code,
          h.gradelevel,
          sg.grpdesc as gradetype,
          h.gradetype as gradetype_code,
          h.pfacode as pfa,
          h.NSITFcode as nsitf_code,
          h.emolumentform,
          h.Birthdate as birth_date,
          h.DateEmpl as date_employed,
          h.datepmted as date_promoted,
          h.StateofOrigin as state_of_origin,
          h.Bankcode as bank_code,
          h.bankbranch as bank_branch,
          h.rent_subsidy,
          h.taxed,
          h.Status as status,
          
          -- Calculate Age
          CASE 
            WHEN h.Birthdate IS NOT NULL AND h.Birthdate != '' AND LENGTH(h.Birthdate) = 8
            THEN TIMESTAMPDIFF(YEAR, 
              STR_TO_DATE(h.Birthdate, '%Y%m%d'), 
              CURDATE())
            ELSE NULL
          END as age,
          
          -- Calculate Years of Service (from employment to current date)
          CASE 
            WHEN h.DateEmpl IS NOT NULL AND h.DateEmpl != '' AND LENGTH(h.DateEmpl) = 8
            THEN TIMESTAMPDIFF(YEAR, 
              STR_TO_DATE(h.DateEmpl, '%Y%m%d'), 
              CURDATE())
            ELSE NULL
          END as years_of_service,
          
          -- Calculate detailed service breakdown for periods < 1 year
          CASE 
            WHEN h.DateEmpl IS NOT NULL AND h.DateEmpl != '' AND LENGTH(h.DateEmpl) = 8
            THEN TIMESTAMPDIFF(MONTH, 
              STR_TO_DATE(h.DateEmpl, '%Y%m%d'), 
              CURDATE())
            ELSE NULL
          END as total_months_of_service,
          
          CASE 
            WHEN h.DateEmpl IS NOT NULL AND h.DateEmpl != '' AND LENGTH(h.DateEmpl) = 8
            THEN TIMESTAMPDIFF(DAY, 
              STR_TO_DATE(h.DateEmpl, '%Y%m%d'), 
              CURDATE())
            ELSE NULL
          END as total_days_of_service,
          
          -- Calculate Years Since Promotion
          CASE 
            WHEN h.datepmted IS NOT NULL AND h.datepmted != '' AND LENGTH(h.datepmted) = 8
            THEN TIMESTAMPDIFF(YEAR, 
              STR_TO_DATE(h.datepmted, '%Y%m%d'), 
              CURDATE())
            ELSE NULL
          END as years_since_promotion,
          
          -- Format dates for display
          CASE 
            WHEN h.Birthdate IS NOT NULL AND h.Birthdate != '' AND LENGTH(h.Birthdate) = 8
            THEN DATE_FORMAT(STR_TO_DATE(h.Birthdate, '%Y%m%d'), '%d-%b-%Y')
            ELSE NULL
          END as birth_date_formatted,
          
          CASE 
            WHEN h.DateEmpl IS NOT NULL AND h.DateEmpl != '' AND LENGTH(h.DateEmpl) = 8
            THEN DATE_FORMAT(STR_TO_DATE(h.DateEmpl, '%Y%m%d'), '%d-%b-%Y')
            ELSE NULL
          END as date_employed_formatted,
          
          CASE 
            WHEN h.datepmted IS NOT NULL AND h.datepmted != '' AND LENGTH(h.datepmted) = 8
            THEN DATE_FORMAT(STR_TO_DATE(h.datepmted, '%Y%m%d'), '%d-%b-%Y')
            ELSE NULL
          END as date_promoted_formatted
          
        FROM py_wkemployees h
        LEFT JOIN ac_costcentre cc ON cc.unitcode = h.Location
        LEFT JOIN py_salarygroup sg ON sg.groupcode = h.gradetype
        WHERE h.payrollclass = ?
          AND (LENGTH(IFNULL(h.DateLeft, '')) = 0 
            OR (LENGTH(IFNULL(h.DateLeft, '')) = 8 AND STR_TO_DATE(h.DateLeft, '%Y%m%d') > CURDATE()))
          AND LENGTH(IFNULL(h.exittype, '')) = 0
          ${title ? 'AND h.Title = ?' : ''}
          ${pfa ? 'AND h.pfacode = ?' : ''}
          ${location ? 'AND h.Location = ?' : ''}
          ${gradetype ? 'AND h.gradetype = ?' : ''}
          ${gradelevel ? 'AND h.gradelevel = ?' : ''}
          ${bankBranch ? 'AND h.bankbranch = ?' : ''}
          ${stateOfOrigin ? 'AND h.StateofOrigin = ?' : ''}
          ${rentSubsidy ? 'AND h.rent_subsidy = ?' : ''}
          ${taxed ? 'AND h.taxed = ?' : ''}
          ${emolumentForm ? 'AND h.emolumentform = ?' : ''}
        ORDER BY h.Title, h.gradelevel DESC, h.Surname
      `;
      
      const params = [payrollClass];
      if (title) params.push(title);
      if (pfa) params.push(pfa);
      if (location) params.push(location);
      if (gradetype) params.push(gradetype);
      if (gradelevel) params.push(gradelevel);
      if (bankBranch) params.push(bankBranch);
      if (stateOfOrigin) params.push(stateOfOrigin);
      if (rentSubsidy) params.push(rentSubsidy);
      if (taxed) params.push(taxed);
      if (emolumentForm) params.push(emolumentForm);
      
      console.log('🔍 Executing query with params:', params);
      
      const [rows] = await pool.query(query, params);
      
      if (rows.length === 0) {
        console.log('⚠️  NO DATA FOUND for the selected filters');
        console.log('   └─ Applied Filters:', {
          payrollClass,
          title: title || 'All',
          pfa: pfa || 'All',
          location: location || 'All',
          gradetype: gradetype || 'All',
          gradelevel: gradelevel || 'All',
          bankBranch: bankBranch || 'All',
          stateOfOrigin: stateOfOrigin || 'All',
          rentSubsidy: rentSubsidy || 'All',
          taxed: taxed || 'All',
          emolumentForm: emolumentForm || 'All'
        });
      } else {
        console.log('✅ Personnel Report - Records found:', rows.length);
      }
      
      return rows;
      
    } catch (error) {
      console.error('❌ ERROR in getPersonnelReport:');
      console.error('   └─ Error Type:', error.constructor.name);
      console.error('   └─ Error Code:', error.code);
      console.error('   └─ Error Message:', error.message);
      console.error('   └─ SQL State:', error.sqlState);
      console.error('   └─ Full Error:', error);
      throw error;
    }
  }

  // ========================================================================
  // GET STATISTICS FOR PERSONNEL REPORT
  // ========================================================================
  async getPersonnelStatistics(filters = {}, currentDb) {
    const { 
      title, 
      pfa, 
      location, 
      gradetype, 
      gradelevel, 
      bankBranch, 
      stateOfOrigin, 
      emolumentForm,
      rentSubsidy,
      taxed
    } = filters;
    
    const payrollClass = await this.getPayrollClassFromDb(currentDb);
    
    console.log('📊 Generating statistics for personnel report...');
    
    try {
      const query = `
        SELECT 
          COUNT(*) as total_employees,
          COUNT(DISTINCT h.Title) as total_titles,
          COUNT(DISTINCT h.Location) as total_locations,
          COUNT(DISTINCT h.gradetype) as total_gradetypes,
          COUNT(DISTINCT h.gradelevel) as total_gradelevels,
          COUNT(DISTINCT h.pfacode) as total_pfas,
          COUNT(DISTINCT h.StateofOrigin) as total_states,
          
          -- Average calculations
          ROUND(AVG(
            CASE 
              WHEN h.Birthdate IS NOT NULL AND h.Birthdate != '' AND LENGTH(h.Birthdate) = 8
              THEN TIMESTAMPDIFF(YEAR, STR_TO_DATE(h.Birthdate, '%Y%m%d'), CURDATE())
              ELSE NULL
            END
          ), 1) as avg_age,
          
          ROUND(AVG(
            CASE 
              WHEN h.DateEmpl IS NOT NULL AND h.DateEmpl != '' AND LENGTH(h.DateEmpl) = 8
              THEN TIMESTAMPDIFF(YEAR, 
                STR_TO_DATE(h.DateEmpl, '%Y%m%d'), 
                CURDATE())
              ELSE NULL
            END
          ), 1) as avg_years_of_service,
          
          -- Count by rent subsidy
          SUM(CASE WHEN h.rent_subsidy = 'YES' THEN 1 ELSE 0 END) as with_rent_subsidy_yes,
          SUM(CASE WHEN h.rent_subsidy = 'NO' THEN 1 ELSE 0 END) as with_rent_subsidy_no,
          
          -- Count by tax status
          SUM(CASE WHEN h.taxed = 'YES' THEN 1 ELSE 0 END) as taxed_yes,
          SUM(CASE WHEN h.taxed = 'NO' THEN 1 ELSE 0 END) as taxed_no,
          
          -- Count by emolument form
          SUM(CASE WHEN h.emolumentform = 'YES' THEN 1 ELSE 0 END) as emolumentform_yes,
          SUM(CASE WHEN h.emolumentform = 'NO' THEN 1 ELSE 0 END) as emolumentform_no
          
        FROM py_wkemployees h
        WHERE h.payrollclass = ?
          AND (LENGTH(IFNULL(h.DateLeft, '')) = 0 
            OR (LENGTH(IFNULL(h.DateLeft, '')) = 8 AND STR_TO_DATE(h.DateLeft, '%Y%m%d') > CURDATE()))
          AND LENGTH(IFNULL(h.exittype, '')) = 0
          ${title ? 'AND h.Title = ?' : ''}
          ${pfa ? 'AND h.pfacode = ?' : ''}
          ${location ? 'AND h.Location = ?' : ''}
          ${gradetype ? 'AND h.gradetype = ?' : ''}
          ${gradelevel ? 'AND h.gradelevel = ?' : ''}
          ${bankBranch ? 'AND h.bankbranch = ?' : ''}
          ${stateOfOrigin ? 'AND h.StateofOrigin = ?' : ''}
          ${rentSubsidy ? 'AND h.rent_subsidy = ?' : ''}
          ${taxed ? 'AND h.taxed = ?' : ''}
          ${emolumentForm ? 'AND h.emolumentform = ?' : ''}
      `;
      
      const params = [payrollClass];
      if (title) params.push(title);
      if (pfa) params.push(pfa);
      if (location) params.push(location);
      if (gradetype) params.push(gradetype);
      if (gradelevel) params.push(gradelevel);
      if (bankBranch) params.push(bankBranch);
      if (stateOfOrigin) params.push(stateOfOrigin);
      if (rentSubsidy) params.push(rentSubsidy);
      if (taxed) params.push(taxed);
      if (emolumentForm) params.push(emolumentForm);
      
      const [rows] = await pool.query(query, params);
      
      console.log('✅ Statistics generated:', {
        total_employees: rows[0].total_employees,
        avg_age: rows[0].avg_age,
        avg_years_of_service: rows[0].avg_years_of_service
      });
      
      return rows[0];
      
    } catch (error) {
      console.error('❌ ERROR in getPersonnelStatistics:');
      console.error('   └─ Error Type:', error.constructor.name);
      console.error('   └─ Error Code:', error.code);
      console.error('   └─ Error Message:', error.message);
      console.error('   └─ SQL State:', error.sqlState);
      console.error('   └─ Full Error:', error);
      throw error;
    }
  }

  // ========================================================================
  // GET FILTER OPTIONS - Titles/Ranks
  // ========================================================================
  async getAvailableTitles(currentDb) {
    try {
      const payrollClass = await this.getPayrollClassFromDb(currentDb);
      
      const query = `
        SELECT DISTINCT 
          h.Title as code,
          COALESCE(t.Description, h.Title) as description
        FROM py_wkemployees h
        LEFT JOIN py_Title t ON t.Titlecode = h.Title
        WHERE h.Title IS NOT NULL AND h.Title != ''
          AND h.payrollclass = ?
          AND (LENGTH(IFNULL(h.DateLeft, '')) = 0 
            OR (LENGTH(IFNULL(h.DateLeft, '')) = 8 AND STR_TO_DATE(h.DateLeft, '%Y%m%d') > CURDATE()))
          AND LENGTH(IFNULL(h.exittype, '')) = 0
        ORDER BY h.Title
      `;
      
      const [rows] = await pool.query(query, [payrollClass]);
      return rows;
      
    } catch (error) {
      console.error('Error in getAvailableTitles:', error);
      throw error;
    }
  }

  // ========================================================================
  // GET FILTER OPTIONS - PFAs
  // ========================================================================
  async getAvailablePFAs(currentDb) {
    try {
      const payrollClass = await this.getPayrollClassFromDb(currentDb);
      
      const query = `
        SELECT DISTINCT 
          pfacode as code,
          pfacode as description
        FROM py_wkemployees
        WHERE pfacode IS NOT NULL AND pfacode != ''
          AND payrollclass = ?
          AND (LENGTH(IFNULL(DateLeft, '')) = 0 
            OR (LENGTH(IFNULL(DateLeft, '')) = 8 AND STR_TO_DATE(DateLeft, '%Y%m%d') > CURDATE()))
          AND LENGTH(IFNULL(exittype, '')) = 0
        ORDER BY pfacode
      `;
      
      const [rows] = await pool.query(query, [payrollClass]);
      return rows;
      
    } catch (error) {
      console.error('Error in getAvailablePFAs:', error);
      throw error;
    }
  }

  // ========================================================================
  // GET FILTER OPTIONS - Locations
  // ========================================================================
  async getAvailableLocations(currentDb) {
    try {
      const payrollClass = await this.getPayrollClassFromDb(currentDb);
      
      const query = `
        SELECT DISTINCT 
          h.Location as code,
          COALESCE(cc.unitdesc, h.Location) as description
        FROM py_wkemployees h
        LEFT JOIN ac_costcentre cc ON cc.unitcode = h.Location
        WHERE h.Location IS NOT NULL AND h.Location != ''
          AND h.payrollclass = ?
          AND (LENGTH(IFNULL(h.DateLeft, '')) = 0 
            OR (LENGTH(IFNULL(h.DateLeft, '')) = 8 AND STR_TO_DATE(h.DateLeft, '%Y%m%d') > CURDATE()))
          AND LENGTH(IFNULL(h.exittype, '')) = 0
        ORDER BY h.Location
      `;
      
      const [rows] = await pool.query(query, [payrollClass]);
      return rows;
      
    } catch (error) {
      console.error('Error in getAvailableLocations:', error);
      throw error;
    }
  }

  // ========================================================================
  // GET FILTER OPTIONS - Grade Types
  // ========================================================================
  async getAvailableGradeTypes(currentDb) {
    try {
      const payrollClass = await this.getPayrollClassFromDb(currentDb);
      
      const query = `
        SELECT DISTINCT 
          h.gradetype as code,
          COALESCE(sg.grpdesc, h.gradetype) as description
        FROM py_wkemployees h
        LEFT JOIN py_salarygroup sg ON sg.groupcode = h.gradetype
        WHERE h.gradetype IS NOT NULL AND h.gradetype != ''
          AND h.payrollclass = ?
          AND (LENGTH(IFNULL(h.DateLeft, '')) = 0 
            OR (LENGTH(IFNULL(h.DateLeft, '')) = 8 AND STR_TO_DATE(h.DateLeft, '%Y%m%d') > CURDATE()))
          AND LENGTH(IFNULL(h.exittype, '')) = 0
        ORDER BY h.gradetype
      `;
      
      const [rows] = await pool.query(query, [payrollClass]);
      return rows;
      
    } catch (error) {
      console.error('Error in getAvailableGradeTypes:', error);
      throw error;
    }
  }

  // ========================================================================
  // GET FILTER OPTIONS - Grade Levels
  // ========================================================================
  async getAvailableGradeLevels(currentDb) {
    try {
      const payrollClass = await this.getPayrollClassFromDb(currentDb);
      
      const query = `
        SELECT DISTINCT 
          gradelevel as code,
          gradelevel as description
        FROM py_wkemployees
        WHERE gradelevel IS NOT NULL AND gradelevel != ''
          AND payrollclass = ?
          AND (LENGTH(IFNULL(DateLeft, '')) = 0 
            OR (LENGTH(IFNULL(DateLeft, '')) = 8 AND STR_TO_DATE(DateLeft, '%Y%m%d') > CURDATE()))
          AND LENGTH(IFNULL(exittype, '')) = 0
        ORDER BY gradelevel DESC
      `;
      
      const [rows] = await pool.query(query, [payrollClass]);
      return rows;
      
    } catch (error) {
      console.error('Error in getAvailableGradeLevels:', error);
      throw error;
    }
  }

  // ========================================================================
  // GET FILTER OPTIONS - Bank Branches
  // ========================================================================
  async getAvailableBankBranches(currentDb) {
    try {
      const payrollClass = await this.getPayrollClassFromDb(currentDb);
      
      const query = `
        SELECT DISTINCT 
          bankbranch as code,
          bk.branchname as description
        FROM py_wkemployees
        LEFT JOIN py_bank bk ON bk.branchcode = LPAD(bankbranch, 3, '0')
        WHERE bankbranch IS NOT NULL AND bankbranch != ''
          AND payrollclass = ?
          AND (LENGTH(IFNULL(DateLeft, '')) = 0 
            OR (LENGTH(IFNULL(DateLeft, '')) = 8 AND STR_TO_DATE(DateLeft, '%Y%m%d') > CURDATE()))
          AND LENGTH(IFNULL(exittype, '')) = 0
        ORDER BY bankbranch
      `;
      
      const [rows] = await pool.query(query, [payrollClass]);
      return rows;
      
    } catch (error) {
      console.error('Error in getAvailableBankBranches:', error);
      throw error;
    }
  }

  // ========================================================================
  // GET FILTER OPTIONS - States of Origin
  // ========================================================================
  async getAvailableStates(currentDb) {
    try {
      const payrollClass = await this.getPayrollClassFromDb(currentDb);
      
      const query = `
        SELECT DISTINCT 
          StateofOrigin as code,
          s.Statename as description
        FROM py_wkemployees
        LEFT JOIN py_tblstates s ON Statecode = StateofOrigin
        WHERE StateofOrigin IS NOT NULL AND StateofOrigin != ''
          AND payrollclass = ?
          AND (LENGTH(IFNULL(DateLeft, '')) = 0 
            OR (LENGTH(IFNULL(DateLeft, '')) = 8 AND STR_TO_DATE(DateLeft, '%Y%m%d') > CURDATE()))
          AND LENGTH(IFNULL(exittype, '')) = 0
        ORDER BY StateofOrigin
      `;
      
      const [rows] = await pool.query(query, [payrollClass]);
      return rows;
      
    } catch (error) {
      console.error('Error in getAvailableStates:', error);
      throw error;
    }
  }

  // ========================================================================
  // GET FILTER OPTIONS - Rent Subsidy
  // ========================================================================
  async getAvailableRentSubsidy(currentDb) {
    try {
      const payrollClass = await this.getPayrollClassFromDb(currentDb);
      
      const query = `
        SELECT DISTINCT 
          rent_subsidy as code,
          CASE 
            WHEN rent_subsidy = 'YES' THEN 'Yes - With Rent Subsidy'
            WHEN rent_subsidy = 'NO' THEN 'No - Without Rent Subsidy'
            ELSE rent_subsidy
          END as description
        FROM py_wkemployees
        WHERE rent_subsidy IS NOT NULL AND rent_subsidy != ''
          AND payrollclass = ?
          AND (LENGTH(IFNULL(DateLeft, '')) = 0 
            OR (LENGTH(IFNULL(DateLeft, '')) = 8 AND STR_TO_DATE(DateLeft, '%Y%m%d') > CURDATE()))
          AND LENGTH(IFNULL(exittype, '')) = 0
        ORDER BY rent_subsidy DESC
      `;
      
      const [rows] = await pool.query(query, [payrollClass]);
      return rows;
      
    } catch (error) {
      console.error('Error in getAvailableRentSubsidy:', error);
      throw error;
    }
  }

  // ========================================================================
  // GET FILTER OPTIONS - Taxed Status
  // ========================================================================
  async getAvailableTaxedStatus(currentDb) {
    try {
      const payrollClass = await this.getPayrollClassFromDb(currentDb);
      
      const query = `
        SELECT DISTINCT 
          taxed as code,
          CASE 
            WHEN taxed = 'YES' THEN 'Yes - Taxed'
            WHEN taxed = 'NO' THEN 'No - Not Taxed'
            ELSE taxed
          END as description
        FROM py_wkemployees
        WHERE taxed IS NOT NULL AND taxed != ''
          AND payrollclass = ?
          AND (LENGTH(IFNULL(DateLeft, '')) = 0 
            OR (LENGTH(IFNULL(DateLeft, '')) = 8 AND STR_TO_DATE(DateLeft, '%Y%m%d') > CURDATE()))
          AND LENGTH(IFNULL(exittype, '')) = 0
        ORDER BY taxed DESC
      `;
      
      const [rows] = await pool.query(query, [payrollClass]);
      return rows;
      
    } catch (error) {
      console.error('Error in getAvailableTaxedStatus:', error);
      throw error;
    }
  }

  // ========================================================================
  // GET FILTER OPTIONS - Emolument Forms
  // ========================================================================
  async getAvailableEmolumentForms(currentDb) {
    try {
      const payrollClass = await this.getPayrollClassFromDb(currentDb);
      
      const query = `
        SELECT DISTINCT 
          emolumentform as code,
          CASE 
            WHEN emolumentform = 'YES' THEN 'Yes - With Emolument Form'
            WHEN emolumentform = 'NO' THEN 'No - Without Emolument Form'
            ELSE emolumentform
          END as description
        FROM py_wkemployees
        WHERE emolumentform IS NOT NULL AND emolumentform != ''
          AND payrollclass = ?
          AND (LENGTH(IFNULL(DateLeft, '')) = 0 
            OR (LENGTH(IFNULL(DateLeft, '')) = 8 AND STR_TO_DATE(DateLeft, '%Y%m%d') > CURDATE()))
          AND LENGTH(IFNULL(exittype, '')) = 0
        ORDER BY emolumentform DESC
      `;
      
      const [rows] = await pool.query(query, [payrollClass]);
      return rows;
      
    } catch (error) {
      console.error('Error in getAvailableEmolumentForms:', error);
      throw error;
    }
  }
}

module.exports = new StaffListingReportService();