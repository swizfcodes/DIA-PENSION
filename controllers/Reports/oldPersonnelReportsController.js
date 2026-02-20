const BaseReportController = require('../Reports/reportsFallbackController');
const oldPersonnelReportService = require('../../services/Reports/oldPersonnelReportServices');
const companySettings = require('../helpers/companySettings');
const { GenericExcelExporter } = require('../helpers/excel');
const fs = require('fs');
const path = require('path');
const pool = require('../../config/db');

class OldPersonnelReportController extends BaseReportController {

  constructor() {
    super(); // Initialize base class
  }

  // ==========================================================================
  // PERSONNEL REPORT - MAIN ENDPOINT (OLD EMPLOYEES)
  // ==========================================================================
  async generateOldPersonnelReport(req, res) {
    try {
      const { format, ...filterParams } = req.query;
      
      // Get current database from pool using user_id
      const currentDb = pool.getCurrentDatabase(req.user_id.toString());
      console.log('🔍 Current database for personnel report:', currentDb);
      
      // Map frontend parameter names to backend expected names
      const filters = {
        title: filterParams.title || filterParams.Title,
        pfa: filterParams.pfa,
        location: filterParams.location,
        gradetype: filterParams.gradetype || filterParams.gradeType,
        gradelevel: filterParams.gradelevel || filterParams.gradeLevel,
        bankBranch: filterParams.bankBranch || filterParams.bank_branch,
        stateOfOrigin: filterParams.stateOfOrigin || filterParams.state_of_origin,
        exitType: filterParams.exitType || filterParams.exit_type,
        rentSubsidy: filterParams.rentSubsidy || filterParams.rent_subsidy,
        taxed: filterParams.taxed
      };
      
      console.log('Personnel Report Filters (Old Employees):', filters);
      
      const data = await oldPersonnelReportService.getPersonnelReport(filters, currentDb);
      const statistics = await oldPersonnelReportService.getPersonnelStatistics(filters, currentDb);
      
      console.log('Personnel Report Data rows:', data.length);
      console.log('Personnel Report Statistics:', statistics);

      if (format === 'excel') {
        return this.generateOldPersonnelReportExcel(data, req, res, filters, statistics);
      } else if (format === 'pdf') {
        return this.generateOldPersonnelReportPDF(data, req, res, filters, statistics);
      }

      // Return JSON with statistics
      res.json({ 
        success: true, 
        data,
        statistics,
        filters
      });
    } catch (error) {
      console.error('Error generating Personnel report:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // ==========================================================================
  // EXCEL GENERATION (OLD EMPLOYEES)
  // ==========================================================================
  async generateOldPersonnelReportExcel(data, req, res, filters, statistics) {
    try {
      if (!data || data.length === 0) {
        throw new Error('No Old Personnel data available for the selected filters');
      }

      const exporter = new GenericExcelExporter();
      const className = await this.getDatabaseNameFromRequest(req);

      // Columns for old employees
      const columns = [
        { header: 'S/N', key: 'sn', width: 8, align: 'center' },
        { header: 'Svc No.', key: 'employee_id', width: 15 },
        { header: 'Rank', key: 'title_code', width: 10 },
        { header: 'Full Name', key: 'full_name', width: 35 },
        { header: 'Location', key: 'location', width: 25 },
        { header: 'Grade Level', key: 'gradelevel', width: 12, align: 'center' },
        { header: 'Grade Type', key: 'gradetype', width: 20 },
        { header: 'PFA', key: 'pfa', width: 15 },
        { header: 'NSITF Code', key: 'nsitf_code', width: 15 },
        { header: 'Age', key: 'age', width: 8, align: 'center' },
        { header: 'Years Served', key: 'years_served_formatted', width: 18, align: 'center' },
        { header: 'Date Employed', key: 'date_employed_formatted', width: 15 },
        { header: 'Date Left', key: 'date_left_formatted', width: 15 },
        { header: 'Exit Reason', key: 'exittype', width: 18, align: 'center' },
        { header: 'Years Since Exit', key: 'years_since_exit', width: 15, align: 'center' },
        { header: 'State', key: 'state_of_origin', width: 15 }
      ];

      // Format years served for old employees
      const formatYearsServed = (totalMonths, totalDays) => {
        const years = Math.floor(totalMonths / 12);
        const months = totalMonths % 12;
        const days = totalDays % 30; // Approximate days in remaining month
        
        if (years >= 1) {
          return years.toString();
        } else if (months >= 1) {
          return `${months} month${months !== 1 ? 's' : ''}`;
        } else if (days >= 0) {
          return `${days} day${days !== 1 ? 's' : ''}`;
        }
        return 'N/A';
      };

      // Add S/N and format years served
      const dataWithSN = data.map((item, idx) => {
        const totalMonths = item.total_months_of_service || 0;
        const totalDays = item.total_days_of_service || 0;
        
        let yearsServedFormatted;
        if (totalMonths < 12) {
          // Less than a year - format as months or days
          yearsServedFormatted = formatYearsServed(totalMonths, totalDays);
        } else {
          // 1 year or more - show years
          yearsServedFormatted = item.years_of_service || 0;
        }

        return {
          ...item,
          sn: idx + 1,
          years_served_formatted: yearsServedFormatted
        };
      });

      // Build filter description for subtitle
      const appliedFilters = [];
      if (filters.title) appliedFilters.push(`Rank: ${filters.title}`);
      if (filters.pfa) appliedFilters.push(`PFA: ${filters.pfa}`);
      if (filters.location) appliedFilters.push(`Location: ${filters.location}`);
      if (filters.gradetype) appliedFilters.push(`Grade Type: ${filters.gradetype}`);
      if (filters.gradelevel) appliedFilters.push(`Grade Level: ${filters.gradelevel}`);
      if (filters.bankBranch) appliedFilters.push(`Bank Branch: ${filters.bankBranch}`);
      if (filters.stateOfOrigin) appliedFilters.push(`State: ${filters.stateOfOrigin}`);
      if (filters.exitType) appliedFilters.push(`Exit Type: ${filters.exitType}`);
      if (filters.rentSubsidy) appliedFilters.push(`Rent Subsidy: ${filters.rentSubsidy}`);
      if (filters.taxed) appliedFilters.push(`Taxed: ${filters.taxed}`);
      
      const filterDescription = appliedFilters.length > 0 ? appliedFilters.join(' | ') : 'All Separated Personnel';

      // Include statistics in the subtitle
      const statsInfo = `Total: ${statistics.total_employees} | Avg Age: ${statistics.avg_age || 'N/A'} yrs | Avg Service: ${statistics.avg_years_of_service || 'N/A'} yrs | Avg Years Since Exit: ${statistics.avg_years_since_exit || 'N/A'} yrs`;
      const fullSubtitle = `${filterDescription}\n${statsInfo}`;

      const workbook = await exporter.createWorkbook({
        title: 'DIA - PERSONNEL REPORT (EXITED MEMBERS)',
        subtitle: fullSubtitle,
        className: className,
        columns: columns,
        data: dataWithSN,
        summary: {},
        sheetName: 'Separated Personnel'
      });

      // Apply conditional formatting
      const worksheet = workbook.worksheets[0];
      const dataStartRow = 5; // After title, subtitle, blank row, and header

      dataWithSN.forEach((row, index) => {
        const rowNum = dataStartRow + index;
        
        // Highlight employees who left at older age (age > 55)
        if (row.age && parseInt(row.age) > 55) {
          const ageCell = worksheet.getCell(`J${rowNum}`);
          ageCell.font = { bold: true, color: { argb: 'FFFF0000' } };
        }

        // Highlight long service (> 30 years served)
        if (row.years_of_service && parseInt(row.years_of_service) >= 30) {
          const serviceCell = worksheet.getCell(`K${rowNum}`);
          serviceCell.font = { bold: true, color: { argb: 'FF006100' } };
        }
        
        // Highlight recent exits (< 2 years since exit)
        if (row.years_since_exit && parseInt(row.years_since_exit) < 2) {
          const exitCell = worksheet.getCell(`O${rowNum}`);
          exitCell.font = { bold: true, color: { argb: 'FFFF8C00' } };
        }
      });

      // Auto-shrink: Set print scaling to 65% for better fit
      worksheet.pageSetup = {
        ...worksheet.pageSetup,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        scale: 65,
        orientation: 'landscape',
        paperSize: 9 // A4
      };

      await exporter.exportToResponse(workbook, res, `separated_personnel_report_${new Date().toISOString().split('T')[0]}.xlsx`);

    } catch (error) {
      console.error('Personnel Report Export error:', error);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: error.message });
      }
    }
  }

  // ==========================================================================
  // PDF GENERATION (OLD EMPLOYEES)
  // ==========================================================================
  async generateOldPersonnelReportPDF(data, req, res, filters, statistics) {
    try {
      if (!data || data.length === 0) {
        throw new Error('No Old Personnel data available for the selected filters');
      }

      console.log('📄 Generating PDF with', data.length, 'records');

      const templatePath = path.join(__dirname, '../../templates/personnel-report-old.html');
      
      if (!fs.existsSync(templatePath)) {
        throw new Error('PDF template file not found');
      }
      
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      // Format years served for old employees
      const formatYearsServed = (totalMonths, totalDays) => {
        const years = Math.floor(totalMonths / 12);
        const months = totalMonths % 12;
        const days = totalDays % 30; // Approximate days in remaining month
        
        if (years >= 1) {
          return years.toString();
        } else if (months >= 1) {
          return `${months} month${months !== 1 ? 's' : ''}`;
        } else if (days >= 0) {
          return `${days} day${days !== 1 ? 's' : ''}`;
        }
        return 'N/A';
      };

      // Add years_served_formatted to data
      const formattedData = data.map(item => {
        const totalMonths = item.total_months_of_service || 0;
        const totalDays = item.total_days_of_service || 0;
        
        let yearsServedFormatted;
        if (totalMonths < 12) {
          // Less than a year - format as months or days
          yearsServedFormatted = formatYearsServed(totalMonths, totalDays);
        } else {
          // 1 year or more - show years
          yearsServedFormatted = item.years_of_service || 0;
        }

        return {
          ...item,
          years_served_formatted: yearsServedFormatted
        };
      });

      const appliedFilters = [];
      if (filters.title) appliedFilters.push(`Rank: ${filters.title}`);
      if (filters.pfa) appliedFilters.push(`PFA: ${filters.pfa}`);
      if (filters.location) appliedFilters.push(`Location: ${filters.location}`);
      if (filters.gradetype) appliedFilters.push(`Grade Type: ${filters.gradetype}`);
      if (filters.gradelevel) appliedFilters.push(`Grade Level: ${filters.gradelevel}`);
      if (filters.bankBranch) appliedFilters.push(`Bank Branch: ${filters.bankBranch}`);
      if (filters.stateOfOrigin) appliedFilters.push(`State: ${filters.stateOfOrigin}`);
      if (filters.exitType) appliedFilters.push(`Exit Type: ${filters.exitType}`);
      if (filters.rentSubsidy) appliedFilters.push(`Rent Subsidy: ${filters.rentSubsidy}`);
      if (filters.taxed) appliedFilters.push(`Taxed: ${filters.taxed}`);
      
      const filterDescription = appliedFilters.length > 0 ? appliedFilters.join(' | ') : 'All Separated Personnel';
  
      const image = await companySettings.getSettingsFromFile('./public/photos/logo.png');

      const templateData = {
        data: formattedData,
        statistics: statistics,
        reportDate: new Date(),
        filters: filterDescription,
        className: await this.getDatabaseNameFromRequest(req),
        ...image
      };

      const pdfBuffer = await this.generatePDFWithFallback(
        templatePath,
        templateData,
        {
          format: 'A4',
          landscape: true,
          marginTop: '5mm',
          marginBottom: '5mm',
          marginLeft: '5mm',
          marginRight: '5mm'
        }
      );

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 
        `attachment; filename=separated_personnel_report_${new Date().toISOString().split('T')[0]}.pdf`
      );
      res.send(pdfBuffer);

    } catch (error) {
      console.error('❌ ERROR generating Personnel Report PDF:');
      console.error('   └─ Error Type:', error.constructor.name);
      console.error('   └─ Error Message:', error.message);
      console.error('   └─ Stack:', error.stack);
      return res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to generate PDF report'
      });
    }
  }

  // ==========================================================================
  // GET FILTER OPTIONS (OLD EMPLOYEES)
  // ==========================================================================
  async getOldPersonnelFilterOptions(req, res) {
    try {
      // Get current database from pool using user_id
      const currentDb = pool.getCurrentDatabase(req.user_id.toString());
      console.log('🔍 Current database for filter options:', currentDb);
      
      const [titles, pfas, locations, gradeTypes, gradeLevels, bankBranches, states, rentSubsidy, taxedStatus, exitTypes] = await Promise.all([
        oldPersonnelReportService.getAvailableTitles(currentDb),
        oldPersonnelReportService.getAvailablePFAs(currentDb),
        oldPersonnelReportService.getAvailableLocations(currentDb),
        oldPersonnelReportService.getAvailableGradeTypes(currentDb),
        oldPersonnelReportService.getAvailableGradeLevels(currentDb),
        oldPersonnelReportService.getAvailableBankBranches(currentDb),
        oldPersonnelReportService.getAvailableStates(currentDb),
        oldPersonnelReportService.getAvailableRentSubsidy(currentDb),
        oldPersonnelReportService.getAvailableTaxedStatus(currentDb),
        oldPersonnelReportService.getAvailableExitTypes(currentDb)
      ]);

      console.log('✅ Filter options loaded (Old Employees):', {
        titles: titles.length,
        pfas: pfas.length,
        locations: locations.length,
        gradeTypes: gradeTypes.length,
        gradeLevels: gradeLevels.length,
        bankBranches: bankBranches.length,
        states: states.length,
        rentSubsidy: rentSubsidy.length,
        taxedStatus: taxedStatus.length,
        exitTypes: exitTypes.length
      });

      // Check for empty filter options
      const warnings = [];
      if (titles.length === 0) warnings.push('titles');
      if (pfas.length === 0) warnings.push('pfas');
      if (locations.length === 0) warnings.push('locations');
      if (gradeTypes.length === 0) warnings.push('gradeTypes');
      if (gradeLevels.length === 0) warnings.push('gradeLevels');
      if (bankBranches.length === 0) warnings.push('bankBranches');
      if (states.length === 0) warnings.push('states');
      if (rentSubsidy.length === 0) warnings.push('rentSubsidy');
      if (taxedStatus.length === 0) warnings.push('taxedStatus');
      if (exitTypes.length === 0) warnings.push('exitTypes');

      if (warnings.length > 0) {
        console.log('⚠️  Warning: No data found for filters:', warnings.join(', '));
      }

      res.json({
        success: true,
        data: {
          titles,
          pfas,
          locations,
          gradeTypes,
          gradeLevels,
          bankBranches,
          states,
          rentSubsidy,
          taxedStatus,
          exitTypes
        },
        warnings: warnings.length > 0 ? `No data available for: ${warnings.join(', ')}` : null
      });
    } catch (error) {
      console.error('❌ ERROR getting Personnel filter options:');
      console.error('   └─ Error Type:', error.constructor.name);
      console.error('   └─ Error Message:', error.message);
      console.error('   └─ Stack:', error.stack);
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to load filter options'
      });
    }
  }

  // ==========================================================================
  // HELPER FUNCTIONS
  // ==========================================================================
  
  async getDatabaseNameFromRequest(req) {
    const currentDb = req.current_class;
    if (!currentDb) return 'MILITARY';

    const [classInfo] = await pool.query(
      'SELECT classname FROM py_payrollclass WHERE db_name = ?',
      [currentDb]
    );

    return classInfo.length > 0 ? classInfo[0].classname : currentDb;
  }
}

module.exports = new OldPersonnelReportController();