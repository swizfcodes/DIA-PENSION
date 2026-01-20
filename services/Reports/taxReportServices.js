const pool = require('../../config/db');

class TaxReportService {
  
  // ========================================================================
  // TAX REPORT - WITH STATE FILTERING
  // ========================================================================
  async getTaxReport(filters = {}) {
    const { year, month, taxState, summaryOnly } = filters;
    
    // Convert summaryOnly to boolean if it's a string
    const isSummary = summaryOnly === true || summaryOnly === '1' || summaryOnly === 'true';
    
    if (isSummary) {
      // Summary query - aggregated by tax state
      const query = `
        SELECT 
          sr.ord as year,
          sr.mth as month,
          COALESCE(st.Statename, '') as tax_state,
          we.taxstate as tax_state_code,
          COUNT(DISTINCT mc.his_empno) as employee_count,
          ROUND(SUM(mc.his_netmth), 2) as total_net_pay,
          ROUND(SUM(mc.his_taxfreepaytodate), 2) as total_tax_free_pay,
          ROUND(SUM(mc.his_taxabletodate), 2) as total_taxable_income,
          ROUND(SUM(mc.his_taxmth), 2) as total_tax_deducted,
          ROUND(SUM(mc.his_taxtodate), 2) as total_cumulative_tax,
          ROUND(AVG(mc.his_taxmth), 2) as avg_tax_deducted,
          ROUND(MIN(mc.his_taxmth), 2) as min_tax_deducted,
          ROUND(MAX(mc.his_taxmth), 2) as max_tax_deducted,
          COUNT(CASE WHEN mc.his_taxmth > 0 THEN 1 END) as employees_with_tax
        FROM py_wkemployees we
        CROSS JOIN (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
        INNER JOIN py_mastercum mc ON mc.his_empno = we.empl_id AND mc.his_type = sr.mth
        LEFT JOIN py_tblstates st ON st.Statecode = we.taxstate
        WHERE 1=1
          ${year ? 'AND sr.ord = ?' : ''}
          ${month ? 'AND sr.mth = ?' : ''}
          ${taxState ? 'AND we.taxstate = ?' : ''}
        GROUP BY sr.ord, sr.mth, we.taxstate, st.Statename
        ORDER BY total_tax_deducted DESC, st.Statename
      `;
      
      const params = [];
      if (year) params.push(year);
      if (month) params.push(month);
      if (taxState) params.push(taxState);
      
      const [rows] = await pool.query(query, params);
      return rows;
      
    } else {
      // Detailed query - process in batches for better performance
      const BATCH_SIZE = 1000;
      
      // First, get the total count
      const countQuery = `
        SELECT COUNT(DISTINCT mc.his_empno) as total
        FROM py_wkemployees we
        CROSS JOIN (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
        INNER JOIN py_mastercum mc ON mc.his_empno = we.empl_id AND mc.his_type = sr.mth
        WHERE 1=1
          ${year ? 'AND sr.ord = ?' : ''}
          ${month ? 'AND sr.mth = ?' : ''}
          ${taxState ? 'AND we.taxstate = ?' : ''}
      `;
      
      const countParams = [];
      if (year) countParams.push(year);
      if (month) countParams.push(month);
      if (taxState) countParams.push(taxState);
      
      const [[{ total }]] = await pool.query(countQuery, countParams);
      
      // If no records, return empty array
      if (total === 0) return [];
      
      // Fetch data in batches
      const allResults = [];
      const totalBatches = Math.ceil(total / BATCH_SIZE);
      
      for (let batch = 0; batch < totalBatches; batch++) {
        const offset = batch * BATCH_SIZE;
        
        const query = `
          SELECT 
            sr.ord as year,
            sr.mth as month,
            mc.his_empno as employee_id,
            CONCAT(TRIM(we.Surname), ' ', TRIM(IFNULL(we.OtherName, ''))) as full_name,
            tt.Description as title,
            we.Title as Title,
            we.gradelevel,
            we.taxstate as tax_state_code,
            COALESCE(st.Statename, '') as tax_state,
            we.Location as location_code,
            COALESCE(cc.unitdesc, '') as location_name,
            ROUND(mc.his_netmth, 2) as net_pay,
            ROUND(mc.his_taxfreepaytodate, 2) as tax_free_pay,
            ROUND(mc.his_taxabletodate, 2) as taxable_income,
            ROUND(mc.his_taxmth, 2) as tax_deducted,
            ROUND(mc.his_taxtodate, 2) as cumulative_tax,
            ROUND(mc.his_nettodate, 2) as YTD_net_pay,
            ROUND((mc.his_taxmth / NULLIF(mc.his_netmth, 0)) * 100, 2) as effective_tax_rate,
            we.Bankcode,
            we.BankACNumber,
            we.TaxCode
          FROM py_wkemployees we
          CROSS JOIN (SELECT ord, mth FROM py_stdrate WHERE type = 'BT05') sr
          INNER JOIN py_mastercum mc ON mc.his_empno = we.empl_id AND mc.his_type = sr.mth
          LEFT JOIN py_tblstates st ON st.Statecode = we.taxstate
          LEFT JOIN ac_costcentre cc ON cc.unitcode = we.Location
          LEFT JOIN py_Title tt ON tt.Titlecode = we.Title
          WHERE 1=1
            ${year ? 'AND sr.ord = ?' : ''}
            ${month ? 'AND sr.mth = ?' : ''}
            ${taxState ? 'AND we.taxstate = ?' : ''}
          ORDER BY 
            ${taxState ? 'mc.his_taxmth DESC' : 'st.Statename, mc.his_taxmth DESC'}
          LIMIT ? OFFSET ?
        `;
        
        const params = [];
        if (year) params.push(year);
        if (month) params.push(month);
        if (taxState) params.push(taxState);
        params.push(BATCH_SIZE, offset);
        
        const [batchRows] = await pool.query(query, params);
        allResults.push(...batchRows);
      }
      
      return allResults;
    }
  }

  // ========================================================================
  // GET AVAILABLE TAX STATES
  // ========================================================================
  async getAvailableTaxStates() {
    const query = `
      SELECT DISTINCT
          we.taxstate as state_code,
          COALESCE(st.Statename, '') as state_name
      FROM py_wkemployees we
      LEFT JOIN py_tblstates st ON st.Statecode = we.taxstate
      WHERE we.taxstate IS NOT NULL
      ORDER BY state_name
    `;
    
    const [rows] = await pool.query(query);
    return rows;
  }

  // ========================================================================
  // HELPER: Get Current Period
  // ========================================================================
  async getCurrentPeriod() {
    const query = `
      SELECT ord as year, mth as month, pmth as prev_month
      FROM py_stdrate 
      WHERE type = 'BT05'
      LIMIT 1
    `;
    const [rows] = await pool.query(query);
    return rows[0];
  }
}

module.exports = new TaxReportService();


