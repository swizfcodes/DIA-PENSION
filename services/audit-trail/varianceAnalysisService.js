const pool = require('../../config/db');

class VarianceAnalysisService {
  
  // ========================================================================
  // HELPER: Get Current Period from py_stdrate
  // ========================================================================
  async getCurrentPeriod() {
    try {
      const query = `
        SELECT sun, ord as year, mth as month, pmth as prev_month
        FROM py_stdrate 
        WHERE type = 'BT05'
        LIMIT 1
      `;
      const [rows] = await pool.query(query, []);
      return rows[0];
    } catch (error) {
      console.error('Error in getCurrentPeriod:', error);
      throw error;
    }
  }

  // ========================================================================
  // REPORT 1: SALARY VARIANCE ANALYSIS
  // ========================================================================
  async getSalaryVarianceAnalysis(filters = {}) {
    const { period, payTypes } = filters;
    
    console.log('Salary Variance Analysis Filters:', filters);
    
    try {
      const currentPeriodInfo = await this.getCurrentPeriod();
      const currentPeriod = `${currentPeriodInfo.year}${String(currentPeriodInfo.month).padStart(2, '0')}`;
      
      if (!period) {
        throw new Error('Period (YYYYMM) is required');
      }
      
      if (parseInt(period) > parseInt(currentPeriod)) {
        return {
          success: false,
          message: 'Selected period cannot be in the future',
          data: []
        };
      }
      
      const isCurrentPeriod = period === currentPeriod;
      const year = parseInt(period.substring(0, 4));
      const month = parseInt(period.substring(4, 6));

      // ── Calculation check (current period only) ───────────────────────────
      if (isCurrentPeriod && currentPeriodInfo.sun != 999) {
        const monthName = this.getMonthName(String(month));
        return {
          success: false,
          message: `Calculation not completed for ${monthName}, ${year}. Please complete payroll calculation before generating reports for ${monthName}, ${year}.`,
          data: []
        };
      }
      // ─────────────────────────────────────────────────────────────────────
      
      let payTypeArray = [];
      if (payTypes) {
        payTypeArray = Array.isArray(payTypes) ? payTypes : payTypes.split(',').map(t => t.trim());
      }
      
      let query, params;
      
      if (isCurrentPeriod) {
        // CURRENT PERIOD: Compare py_masterpayded (current) vs py_payhistory (previous month)
        const prevMonth = month - 1;
        const prevYear = prevMonth === 0 ? year - 1 : year;
        const prevMonthNum = prevMonth === 0 ? 12 : prevMonth;
        const prevColumn = `amtthismth${prevMonthNum}`;
        
        query = `
          SELECT 
            mpd.his_empno as employee_id,
            COALESCE(CONCAT(TRIM(h.Surname), ' ', TRIM(IFNULL(h.OtherName, ''))), mpd.his_empno) as full_name,
            COALESCE(tt.Description, '') as title,
            mpd.his_type as pay_type,
            COALESCE(et.elmDesc, mpd.his_type) as pay_type_description,
            ROUND(COALESCE(ph.${prevColumn}, 0), 2) as old_amount,
            ROUND(mpd.amtthismth, 2) as new_amount,
            ROUND(mpd.amtthismth - COALESCE(ph.${prevColumn}, 0), 2) as variance
          FROM py_masterpayded mpd
          LEFT JOIN hr_employees h ON h.empl_id = mpd.his_empno
          LEFT JOIN py_Title tt ON tt.Titlecode = h.Title
          LEFT JOIN py_elementType et ON et.PaymentType = mpd.his_type
          LEFT JOIN py_payhistory ph ON ph.his_empno = mpd.his_empno 
            AND ph.his_type = mpd.his_type 
            AND ph.his_year = ?
          WHERE mpd.amtthismth IS NOT NULL
            ${payTypeArray.length > 0 ? 'AND mpd.his_type IN (?)' : ''}
          HAVING variance != 0
          ORDER BY ABS(variance) DESC, mpd.his_empno, mpd.his_type
        `;
        
        params = [prevYear];
        if (payTypeArray.length > 0) params.push(payTypeArray);
        
        console.log(`📊 Current Period Mode: Comparing py_masterpayded.amtthismth vs py_payhistory.${prevColumn} (${prevYear})`);
        
      } else {
        // PREVIOUS PERIOD: Compare two months in py_payhistory (same year or cross year)
        const prevMonth = month - 1;
        const prevYear = prevMonth === 0 ? year - 1 : year;
        const prevMonthNum = prevMonth === 0 ? 12 : prevMonth;
        
        const currentColumn = `amtthismth${month}`;
        const prevColumn = `amtthismth${prevMonthNum}`;
        
        if (year === prevYear) {
          // SAME YEAR: Compare two columns in same row
          query = `
            SELECT 
              ph.his_empno as employee_id,
              COALESCE(CONCAT(TRIM(h.Surname), ' ', TRIM(IFNULL(h.OtherName, ''))), ph.his_empno) as full_name,
              h.Title as Title,
              COALESCE(tt.Description, '') as title,
              ph.his_type as pay_type,
              COALESCE(et.elmDesc, ph.his_type) as pay_type_description,
              ROUND(COALESCE(ph.${prevColumn}, 0), 2) as old_amount,
              ROUND(COALESCE(ph.${currentColumn}, 0), 2) as new_amount,
              ROUND(COALESCE(ph.${currentColumn}, 0) - COALESCE(ph.${prevColumn}, 0), 2) as variance
            FROM py_payhistory ph
            LEFT JOIN hr_employees h ON h.empl_id = ph.his_empno
            LEFT JOIN py_Title tt ON tt.Titlecode = h.Title
            LEFT JOIN py_elementType et ON et.PaymentType = ph.his_type
            WHERE ph.his_year = ?
              ${payTypeArray.length > 0 ? 'AND ph.his_type IN (?)' : ''}
            HAVING variance != 0
            ORDER BY ABS(variance) DESC, ph.his_empno, ph.his_type
          `;
          
          params = [year];
          if (payTypeArray.length > 0) params.push(payTypeArray);
          
          console.log(`📊 Same Year Mode: Comparing ${currentColumn} vs ${prevColumn} in year ${year}`);
          
        } else {
          // CROSS YEAR: Join two different year rows
          query = `
            SELECT 
              ph_current.his_empno as employee_id,
              COALESCE(CONCAT(TRIM(h.Surname), ' ', TRIM(IFNULL(h.OtherName, ''))), ph_current.his_empno) as full_name,
              COALESCE(tt.Description, '') as title,
              h.Title as Title,
              ph_current.his_type as pay_type,
              COALESCE(et.elmDesc, ph_current.his_type) as pay_type_description,
              ROUND(COALESCE(ph_prev.${prevColumn}, 0), 2) as old_amount,
              ROUND(COALESCE(ph_current.${currentColumn}, 0), 2) as new_amount,
              ROUND(COALESCE(ph_current.${currentColumn}, 0) - COALESCE(ph_prev.${prevColumn}, 0), 2) as variance
            FROM py_payhistory ph_current
            LEFT JOIN hr_employees h ON h.empl_id = ph_current.his_empno
            LEFT JOIN py_Title tt ON tt.Titlecode = h.Title
            LEFT JOIN py_elementType et ON et.PaymentType = ph_current.his_type
            LEFT JOIN py_payhistory ph_prev ON ph_prev.his_empno = ph_current.his_empno 
              AND ph_prev.his_type = ph_current.his_type 
              AND ph_prev.his_year = ?
            WHERE ph_current.his_year = ?
              ${payTypeArray.length > 0 ? 'AND ph_current.his_type IN (?)' : ''}
            HAVING variance != 0
            ORDER BY ABS(variance) DESC, ph_current.his_empno, ph_current.his_type
          `;
          
          params = [prevYear, year];
          if (payTypeArray.length > 0) params.push(payTypeArray);
          
          console.log(`📊 Cross Year Mode: Comparing ${year}.${currentColumn} vs ${prevYear}.${prevColumn}`);
        }
      }
      
      const [rows] = await pool.query(query, params);
      
      console.log('Salary Variance Analysis - Records with variance:', rows.length);
      
      const prevMonth = month - 1;
      const prevYear = prevMonth === 0 ? year - 1 : year;
      const prevMonthNum = prevMonth === 0 ? 12 : prevMonth;
      const prevPeriod = `${prevYear}${String(prevMonthNum).padStart(2, '0')}`;
      
      return {
        success: true,
        message: rows.length > 0 ? 'Variance analysis complete' : 'No variance found',
        period: period,
        previousPeriod: prevPeriod,
        isCurrentPeriod: isCurrentPeriod,
        comparisonInfo: isCurrentPeriod 
          ? `Comparing current period (${year}-${String(month).padStart(2, '0')}) with previous month (${prevYear}-${String(prevMonthNum).padStart(2, '0')})` 
          : `Comparing ${year}-${String(month).padStart(2, '0')} with ${prevYear}-${String(prevMonthNum).padStart(2, '0')}`,
        data: rows
      };
      
    } catch (error) {
      console.error('Error in getSalaryVarianceAnalysis:', error);
      throw error;
    }
  }

  // ========================================================================
  // REPORT 2: OVERPAYMENT ANALYSIS
  // ========================================================================
  async getOverpaymentAnalysis(filters = {}) {
    const { month } = filters;
    
    console.log('Overpayment Analysis Filters:', filters);
    
    try {
      // Get current period info
      const currentPeriodInfo = await this.getCurrentPeriod();
      const currentMonth = currentPeriodInfo.month;
      const currentYear = currentPeriodInfo.year;
      
      // Validate month input
      if (!month) {
        throw new Error('Month (1-12) is required');
      }
      
      const monthNum = parseInt(month);
      
      if (monthNum < 1 || monthNum > 12) {
        return {
          success: false,
          message: 'Month must be between 1 and 12',
          data: []
        };
      }
      
      // Check if month is not in the future
      if (monthNum > currentMonth) {
        return {
          success: false,
          message: 'Selected month cannot be in the future',
          data: []
        };
      }

      // ── Calculation check (current month only) ────────────────────────────
      if (monthNum === currentMonth && currentPeriodInfo.sun != 999) {
        const monthName = this.getMonthName(String(monthNum));
        return {
          success: false,
          message: `Calculation not completed for ${monthName}, ${currentYear}. Please complete payroll calculation before generating reports for ${monthName}, ${currentYear}.`,
          data: []
        };
      }
      // ─────────────────────────────────────────────────────────────────────
      
      // Calculate previous month
      const prevMonthNum = monthNum === 1 ? 12 : monthNum - 1;
      
      // Get threshold and pay element from BT04
      const [bt04Config] = await pool.query(`
        SELECT ord as threshold_percentage, basicpay as pay_element_code
        FROM py_stdrate 
        WHERE type = 'BT04'
        LIMIT 1
      `, []);
      
      if (!bt04Config || bt04Config.length === 0) {
        throw new Error('BT04 configuration not found in py_stdrate');
      }
      
      const threshold = parseFloat(bt04Config[0].threshold_percentage);
      const payElementCode = bt04Config[0].pay_element_code;
      
      console.log(`Overpayment threshold: ${threshold}%, Pay Element: ${payElementCode}`);
      
      // Query to find overpayments
      const query = `
        SELECT 
          curr.his_empno as employee_id,
          CONCAT(TRIM(h.Surname), ' ', TRIM(IFNULL(h.OtherName, ''))) as full_name,
          h.Title as Title,
          tt.Description as title,
          '${payElementCode}' as pay_element,
          COALESCE(et.elmDesc, '${payElementCode}') as pay_element_description,
          ROUND(COALESCE(prev.his_netmth, 0), 2) as previous_net,
          ROUND(curr.his_netmth, 2) as current_net,
          ROUND(curr.his_netmth - COALESCE(prev.his_netmth, 0), 2) as variance_amount,
          ROUND(
            ((curr.his_netmth - COALESCE(prev.his_netmth, 0)) / NULLIF(prev.his_netmth, 0)) * 100, 
            2
          ) as variance_percentage
        FROM py_mastercum curr
        INNER JOIN hr_employees h ON h.empl_id = curr.his_empno
        LEFT JOIN py_Title tt ON tt.Titlecode = h.Title
        LEFT JOIN py_elementType et ON et.PaymentType = '${payElementCode}'
        LEFT JOIN py_mastercum prev ON prev.his_empno = curr.his_empno 
          AND prev.his_type = ?
        WHERE curr.his_type = ?
          AND curr.his_netmth IS NOT NULL
          AND prev.his_netmth IS NOT NULL
          AND prev.his_netmth > 0
        HAVING variance_percentage > ?
        ORDER BY variance_percentage DESC, curr.his_empno
      `;
      
      const params = [prevMonthNum, monthNum, threshold];
      
      const [rows] = await pool.query(query, params);
      
      console.log('Overpayment Analysis - Records exceeding threshold:', rows.length);
      
      return {
        success: true,
        message: rows.length > 0 
          ? `Found ${rows.length} employees with overpayment exceeding ${threshold}% threshold` 
          : `No overpayments exceeding ${threshold}% threshold found`,
        month: monthNum,
        monthName: this.getMonthName(monthNum.toString()),
        threshold_percentage: threshold,
        pay_element: payElementCode,
        comparison_months: {
          current: monthNum,
          currentName: this.getMonthName(monthNum.toString()),
          previous: prevMonthNum,
          previousName: this.getMonthName(prevMonthNum.toString())
        },
        data: rows
      };
      
    } catch (error) {
      console.error('Error in getOverpaymentAnalysis:', error);
      throw error;
    }
  }

  // ========================================================================
  // GET AVAILABLE PAY TYPES FOR FILTERS
  // ========================================================================
  async getAvailablePayTypes() {
    try {
      const query = `
        SELECT DISTINCT 
          ph.his_type as code,
          COALESCE(et.elmDesc, ph.his_type) as description
        FROM py_payhistory ph
        LEFT JOIN py_elementType et ON et.PaymentType = ph.his_type
        ORDER BY ph.his_type
      `;
      
      const [rows] = await pool.query(query, []);
      return rows;
    } catch (error) {
      console.error('Error in getAvailablePayTypes:', error);
      throw error;
    }
  }

  // ========================================================================
  // GET AVAILABLE PERIODS
  // ========================================================================
  async getAvailablePeriods() {
    try {
      // Get current period info from py_stdrate
      const currentPeriodInfo = await this.getCurrentPeriod();
      const currentYear = currentPeriodInfo.year;
      const currentMonth = currentPeriodInfo.month;
      
      // Get distinct years from py_payhistory
      const query = `
        SELECT DISTINCT his_year as year
        FROM py_payhistory
        WHERE his_year IS NOT NULL
        ORDER BY his_year DESC
      `;
      
      const [rows] = await pool.query(query);
      
      // Generate YYYYMM options for each year
      const periods = [];
      
      for (const row of rows) {
        const year = row.year;
        
        // Determine max month for this year
        let maxMonth = 12;
        if (year === currentYear) {
          // Current year: only up to current month
          maxMonth = currentMonth;
        }
        
        // Generate months 1 to maxMonth
        for (let month = 1; month <= maxMonth; month++) {
          const period = `${year}${String(month).padStart(2, '0')}`;
          const label = `${year}-${String(month).padStart(2, '0')}`;
          periods.push({ value: period, label: label });
        }
      }
      
      // Sort by period descending (most recent first)
      periods.sort((a, b) => parseInt(b.value) - parseInt(a.value));
      
      return {
        success: true,
        data: periods
      };
      
    } catch (error) {
      console.error('Error in getAvailablePeriods:', error);
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
  // HELPER: Get Month Name
  // ========================================================================
  getMonthName(month) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                   'July', 'August', 'September', 'October', 'November', 'December'];
    return months[parseInt(month) - 1] || month;
  }
}

module.exports = new VarianceAnalysisService();