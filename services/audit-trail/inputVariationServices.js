const pool = require('../../config/db');

class PayPeriodReportService {
  
  // ========================================================================
  // PAY PERIOD REPORT - DETAILED LISTING
  // ========================================================================
  async getPayPeriodReport(filters = {}) {
    const { fromPeriod, toPeriod, emplId, createdBy, payType } = filters;
    
    console.log('Pay Period Report Filters:', filters); // DEBUG
    
    try {
      // Build the main query with all filters
      const query = `
        SELECT 
          pp.pay_period,
          SUBSTRING(pp.pay_period, 1, 4) as year,
          SUBSTRING(pp.pay_period, 5, 2) as month,
          pp.Empl_ID as employee_id,
          CONCAT(TRIM(h.Surname), ' ', TRIM(IFNULL(h.OtherName, ''))) as full_name,
          tt.Description as title,
          h.Title as title_code,
          pp.type as pay_element_type,
          COALESCE(et.elmDesc, pp.type) as pay_element_description,
          pp.mak1,
          ROUND(pp.amtp, 2) as amount_primary,
          pp.mak2,
          ROUND(pp.amt, 2) as amount_secondary,
          ROUND(pp.amtad, 2) as amount_additional,
          ROUND(pp.amttd, 2) as amount_to_date,
          pp.payind as payment_indicator,
          pp.nomth as number_of_months,
          pp.createdby as created_by,
          DATE_FORMAT(pp.datecreated, '%Y-%m-%d %H:%i:%s') as date_created
        FROM py_inputhistory pp
        INNER JOIN hr_employees h ON h.empl_id = pp.Empl_ID
        LEFT JOIN py_Title tt ON tt.Titlecode = h.Title
        LEFT JOIN py_elementType et ON et.PaymentType = pp.type
        WHERE 1=1
          ${fromPeriod ? 'AND pp.pay_period >= ?' : ''}
          ${toPeriod ? 'AND pp.pay_period <= ?' : ''}
          ${emplId ? 'AND pp.Empl_ID = ?' : ''}
          ${createdBy ? 'AND pp.createdby LIKE ?' : ''}
          ${payType ? 'AND pp.type = ?' : ''}
        ORDER BY pp.pay_period DESC, pp.Empl_ID, pp.type
      `;
      
      const params = [];
      if (fromPeriod) params.push(fromPeriod);
      if (toPeriod) params.push(toPeriod);
      if (emplId) params.push(emplId);
      if (createdBy) params.push(`%${createdBy}%`);
      if (payType) params.push(payType);
      
      const [rows] = await pool.query(query, params);
      
      console.log('Pay Period Report - Rows returned:', rows.length); // DEBUG
      
      return rows;
      
    } catch (error) {
      console.error('Error in getPayPeriodReport:', error);
      throw error;
    }
  }

  // ========================================================================
  // GET STATISTICS FOR PAY PERIOD REPORT
  // ========================================================================
  async getPayPeriodStatistics(filters = {}) {
    const { fromPeriod, toPeriod, emplId, createdBy, payType } = filters;
    
    try {
      const query = `
        SELECT 
          COUNT(*) as total_records,
          COUNT(DISTINCT pp.Empl_ID) as total_employees,
          COUNT(DISTINCT pp.pay_period) as total_periods,
          COUNT(DISTINCT pp.type) as total_pay_elements,
          COUNT(DISTINCT pp.createdby) as total_operators,
          ROUND(SUM(pp.amtp), 2) as total_amount_primary,
          ROUND(SUM(pp.amt), 2) as total_amount_secondary,
          ROUND(SUM(pp.amtad), 2) as total_amount_additional,
          ROUND(SUM(pp.amttd), 2) as total_amount_to_date,
          ROUND(AVG(pp.amtp), 2) as avg_amount_primary,
          MIN(pp.pay_period) as earliest_period,
          MAX(pp.pay_period) as latest_period
        FROM py_inputhistory pp
        WHERE 1=1
          ${fromPeriod ? 'AND pp.pay_period >= ?' : ''}
          ${toPeriod ? 'AND pp.pay_period <= ?' : ''}
          ${emplId ? 'AND pp.Empl_ID = ?' : ''}
          ${createdBy ? 'AND pp.createdby LIKE ?' : ''}
          ${payType ? 'AND pp.type = ?' : ''}
      `;
      
      const params = [];
      if (fromPeriod) params.push(fromPeriod);
      if (toPeriod) params.push(toPeriod);
      if (emplId) params.push(emplId);
      if (createdBy) params.push(`%${createdBy}%`);
      if (payType) params.push(payType);
      
      const [rows] = await pool.query(query, params);
      return rows[0];
      
    } catch (error) {
      console.error('Error in getPayPeriodStatistics:', error);
      throw error;
    }
  }

  // ========================================================================
  // GET FILTER OPTIONS - Pay Periods Available
  // ========================================================================
  async getAvailablePayPeriods() {
    try {
      const query = `
        SELECT DISTINCT 
          pay_period,
          SUBSTRING(pay_period, 1, 4) as year,
          SUBSTRING(pay_period, 5, 2) as month
        FROM py_inputhistory
        ORDER BY pay_period DESC
        LIMIT 50
      `;
      
      const [rows] = await pool.query(query);
      return rows;
      
    } catch (error) {
      console.error('Error in getAvailablePayPeriods:', error);
      throw error;
    }
  }

  // ========================================================================
  // GET FILTER OPTIONS - Pay Element Types
  // ========================================================================
  async getAvailablePayTypes() {
    try {
      const query = `
        SELECT DISTINCT 
          pp.type as code,
          COALESCE(et.elmDesc, pp.type) as description
        FROM py_inputhistory pp
        LEFT JOIN py_elementType et ON et.PaymentType = pp.type
        ORDER BY pp.type
      `;
      
      const [rows] = await pool.query(query);
      return rows;
      
    } catch (error) {
      console.error('Error in getAvailablePayTypes:', error);
      throw error;
    }
  }

  // ========================================================================
  // GET FILTER OPTIONS - Operators/Created By
  // ========================================================================
  async getAvailableOperators() {
    try {
      const query = `
        SELECT DISTINCT 
          createdby as operator_name
        FROM py_inputhistory
        WHERE createdby IS NOT NULL
        ORDER BY createdby
      `;
      
      const [rows] = await pool.query(query);
      return rows;
      
    } catch (error) {
      console.error('Error in getAvailableOperators:', error);
      throw error;
    }
  }

  // ========================================================================
  // GET FILTER OPTIONS - Employees
  // ========================================================================
  async getAvailableEmployees() {
    try {
      const query = `
        SELECT DISTINCT 
          pp.Empl_ID as employee_id,
          CONCAT(TRIM(h.Surname), ' ', TRIM(IFNULL(h.OtherName, ''))) as full_name
        FROM py_inputhistory pp
        INNER JOIN hr_employees h ON h.empl_id = pp.Empl_ID
        ORDER BY pp.Empl_ID
        LIMIT 1000
      `;
      
      const [rows] = await pool.query(query);
      return rows;
      
    } catch (error) {
      console.error('Error in getAvailableEmployees:', error);
      throw error;
    }
  }

  // ========================================================================
  // HELPER: Format Period to Readable String
  // ========================================================================
  formatPeriod(period) {
    if (!period || period.length !== 6) return period;
    
    const year = period.substring(0, 4);
    const month = period.substring(4, 6);
    
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    const monthName = months[parseInt(month) - 1] || month;
    
    return `${monthName} ${year}`;
  }

  // ========================================================================
  // HELPER: Get Current Period
  // ========================================================================
  async getCurrentPeriod() {
    try {
      const query = `
        SELECT MAX(pay_period) as current_period
        FROM py_inputhistory
      `;
      
      const [rows] = await pool.query(query);
      return rows[0]?.current_period || null;
      
    } catch (error) {
      console.error('Error in getCurrentPeriod:', error);
      throw error;
    }
  }
}

module.exports = new PayPeriodReportService();