const pool = require('../../config/db');

class SalarySummaryService {
  
  // ========================================================================
  // SALARY SUMMARY REPORT
  // ========================================================================
  async getSalarySummary(filters = {}) {
    const { location } = filters;
    
    const query = `
      SELECT 
        sr.ord as year,
        sr.mth as month,
        CASE sr.mth
          WHEN 1 THEN 'January' WHEN 2 THEN 'February' WHEN 3 THEN 'March'
          WHEN 4 THEN 'April' WHEN 5 THEN 'May' WHEN 6 THEN 'June'
          WHEN 7 THEN 'July' WHEN 8 THEN 'August' WHEN 9 THEN 'September'
          WHEN 10 THEN 'October' WHEN 11 THEN 'November' WHEN 12 THEN 'December'
        END as month_name,
        we.Location as location,
        COALESCE(cc.unitdesc, we.Location) as location_description,
        COUNT(DISTINCT mc.his_empno) as employee_count,
        
        -- Allowances (pre-aggregated from subquery)
        ROUND(SUM(COALESCE(mpd.total_allowances, 0)), 2) as total_allowances,
        
        -- Gross Pay (from mastercum)
        ROUND(SUM(mc.his_grossmth), 2) as total_gross,
        
        -- Deductions (pre-aggregated from subquery)
        ROUND(SUM(COALESCE(mpd.total_deductions, 0)), 2) as total_deductions,
        
        -- Tax (from mastercum)
        ROUND(SUM(mc.his_taxmth), 2) as total_tax,
        
        -- Net Pay (from mastercum)
        ROUND(SUM(mc.his_netmth), 2) as total_net
        
      FROM py_wkemployees we
      CROSS JOIN (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
      INNER JOIN py_mastercum mc ON mc.his_empno = we.empl_id AND mc.his_type = sr.mth
      LEFT JOIN ac_costcentre cc ON cc.unitcode = we.Location
      LEFT JOIN (
        SELECT 
          his_empno,
          SUM(CASE WHEN LEFT(his_type, 2) = 'PT' THEN amtthismth ELSE 0 END) as total_allowances,
          SUM(CASE WHEN LEFT(his_type, 2) IN ('PR', 'PL') THEN amtthismth ELSE 0 END) as total_deductions
        FROM py_masterpayded
        GROUP BY his_empno
      ) mpd ON mpd.his_empno = we.empl_id
      WHERE 1=1
        ${location ? 'AND we.Location = ?' : ''}
      GROUP BY sr.ord, sr.mth, we.Location, cc.unitdesc
      ORDER BY we.Location
    `;
    
    const params = [];
    if (location) params.push(location);
    
    const [rows] = await pool.query(query, params);
    
    // Calculate grand totals
    const grandTotals = {
      total_employees: rows.reduce((sum, row) => sum + parseInt(row.employee_count || 0), 0),
      total_allowances: rows.reduce((sum, row) => sum + parseFloat(row.total_allowances || 0), 0),
      total_gross: rows.reduce((sum, row) => sum + parseFloat(row.total_gross || 0), 0),
      total_deductions: rows.reduce((sum, row) => sum + parseFloat(row.total_deductions || 0), 0),
      total_tax: rows.reduce((sum, row) => sum + parseFloat(row.total_tax || 0), 0),
      total_net: rows.reduce((sum, row) => sum + parseFloat(row.total_net || 0), 0)
    };
    
    return {
      details: rows,
      grandTotals: grandTotals
    };
  }

  // ========================================================================
  // GET AVAILABLE LOCATIONS
  // ========================================================================
  async getAvailableLocations() {
    const query = `
      SELECT DISTINCT
        we.Location as location_code,
        COALESCE(cc.unitdesc, we.Location) as location_name
      FROM py_wkemployees we
      LEFT JOIN ac_costcentre cc ON cc.unitcode = we.Location
      WHERE we.Location IS NOT NULL AND we.Location != ''
      ORDER BY we.Location
    `;
    
    const [rows] = await pool.query(query);
    return rows;
  }

  // ========================================================================
  // HELPER: Get Current Period
  // ========================================================================
  async getCurrentPeriod() {
    const query = `
      SELECT 
        ord as year, 
        mth as month
      FROM py_stdrate 
      WHERE type = 'BT05' 
      LIMIT 1
    `;
    const [rows] = await pool.query(query);
    return rows[0];
  }
}

module.exports = new SalarySummaryService();


