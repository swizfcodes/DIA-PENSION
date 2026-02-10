const pool = require('../../config/db');

class PayPeriodReportService {
  
  // ========================================================================
  // PAY PERIOD REPORT - DETAILED LISTING
  // ========================================================================
  async getPayPeriodReport() {
    
    try {
      const query = `
        SELECT
          s.ord AS year,
          s.mth AS month,
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
        FROM py_payded pp
        INNER JOIN hr_employees h ON h.empl_id = pp.Empl_ID
        LEFT JOIN py_Title tt ON tt.Titlecode = h.Title
        LEFT JOIN py_elementType et ON et.PaymentType = pp.type
        LEFT JOIN py_stdrate s ON s.type = 'BT05'
        ORDER BY pp.Empl_ID, pp.type
      `;
      
      const [rows] = await pool.query(query);
      
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
  async getPayPeriodStatistics() {
    
    try {
      const query = `
        SELECT 
          COUNT(*) as total_records,
          COUNT(DISTINCT pp.Empl_ID) as total_employees,
          COUNT(DISTINCT pp.type) as total_pay_elements,
          COUNT(DISTINCT pp.createdby) as total_operators,
          ROUND(SUM(pp.amtp), 2) as total_amount_primary,
          ROUND(SUM(pp.amt), 2) as total_amount_secondary,
          ROUND(SUM(pp.amtad), 2) as total_amount_additional,
          ROUND(SUM(pp.amttd), 2) as total_amount_to_date,
          ROUND(AVG(pp.amtp), 2) as avg_amount_primary
        FROM py_payded pp
      `;
      
      const [rows] = await pool.query(query);
      return rows[0];
      
    } catch (error) {
      console.error('Error in getPayPeriodStatistics:', error);
      throw error;
    }
  }
}

module.exports = new PayPeriodReportService();