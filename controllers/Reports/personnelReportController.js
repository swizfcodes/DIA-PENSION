const BaseReportController = require('../Reports/reportsFallbackController');
const personnelReportService = require('../../services/Reports/personnelReportServices');
const companySettings = require('../helpers/companySettings');
const { GenericExcelExporter } = require('../helpers/excel');
const fs = require('fs');
const path = require('path');
const pool = require('../../config/db');

class PersonnelReportController extends BaseReportController {

  constructor() {
    super(); // Initialize base class
  }

  // ==========================================================================
  // PERSONNEL REPORT - MAIN ENDPOINT (CURRENT EMPLOYEES)
  // ==========================================================================
  async generatePersonnelReport(req, res) {
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
        emolumentForm: filterParams.emolumentForm || filterParams.emolument_form,
        rentSubsidy: filterParams.rentSubsidy || filterParams.rent_subsidy,
        taxed: filterParams.taxed
      };
      
      console.log('Personnel Report Filters (Current Employees):', filters);
      
      const data = await personnelReportService.getPersonnelReport(filters, currentDb);
      const statistics = await personnelReportService.getPersonnelStatistics(filters, currentDb);
      
      console.log('Personnel Report Data rows:', data.length);
      console.log('Personnel Report Statistics:', statistics);

      if (format === 'excel') {
        return this.generatePersonnelReportExcel(data, req, res, filters, statistics);
      } else if (format === 'pdf') {
        return this.generatePersonnelReportPDF(data, req, res, filters, statistics);
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
  // EXCEL GENERATION (CURRENT EMPLOYEES)
  // ==========================================================================
  async generatePersonnelReportExcel(data, req, res, filters, statistics) {
    try {
      if (!data || data.length === 0) {
        throw new Error('No Personnel data available for the selected filters');
      }
      
      const exporter = new GenericExcelExporter();
      const className = this.getDatabaseNameFromRequest(req);

      // Columns for current employees
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
        { header: 'Emolument Form', key: 'emolumentform', width: 15 },
        { header: 'Age', key: 'age', width: 8, align: 'center' },
        { header: 'Years of Service', key: 'years_of_service', width: 15, align: 'center' },
        { header: 'Date Employed', key: 'date_employed_formatted', width: 15 },
        { header: 'Date Promoted', key: 'date_promoted_formatted', width: 15 },
        { header: 'Years Since Promotion', key: 'years_since_promotion', width: 18, align: 'center' },
        { header: 'State', key: 'state_of_origin', width: 15 }
      ];

      // Add S/N
      const dataWithSN = data.map((item, idx) => ({
        ...item,
        sn: idx + 1
      }));

      // Build filter description for subtitle
      const appliedFilters = [];
      if (filters.title) appliedFilters.push(`Rank: ${filters.title}`);
      if (filters.pfa) appliedFilters.push(`PFA: ${filters.pfa}`);
      if (filters.location) appliedFilters.push(`Location: ${filters.location}`);
      if (filters.gradetype) appliedFilters.push(`Grade Type: ${filters.gradetype}`);
      if (filters.gradelevel) appliedFilters.push(`Grade Level: ${filters.gradelevel}`);
      if (filters.bankBranch) appliedFilters.push(`Bank Branch: ${filters.bankBranch}`);
      if (filters.stateOfOrigin) appliedFilters.push(`State: ${filters.stateOfOrigin}`);
      if (filters.emolumentForm) appliedFilters.push(`Emolument Form: ${filters.emolumentForm}`);
      if (filters.rentSubsidy) appliedFilters.push(`Rent Subsidy: ${filters.rentSubsidy}`);
      if (filters.taxed) appliedFilters.push(`Taxed: ${filters.taxed}`);
      
      const filterDescription = appliedFilters.length > 0 ? appliedFilters.join(' | ') : 'All Current Personnel';

      // Include statistics in the subtitle
      const statsInfo = `Total: ${statistics.total_employees} | Avg Age: ${statistics.avg_age || 'N/A'} yrs | Avg Service: ${statistics.avg_years_of_service || 'N/A'} yrs`;
      const fullSubtitle = `${filterDescription}\n${statsInfo}`;

      const workbook = await exporter.createWorkbook({
        title: 'DIA PAYROLL - PERSONNEL REPORT',
        subtitle: fullSubtitle,
        className: className,
        columns: columns,
        data: dataWithSN,
        summary: {},
        sheetName: 'Current Personnel'
      });

      // Apply conditional formatting
      const worksheet = workbook.worksheets[0];
      const dataStartRow = 5; // After title, subtitle, blank row, and header

      dataWithSN.forEach((row, index) => {
        const rowNum = dataStartRow + index;
        
        // Highlight employees close to retirement (age > 55)
        if (row.age && parseInt(row.age) > 55) {
          const ageCell = worksheet.getCell(`K${rowNum}`);
          ageCell.font = { bold: true, color: { argb: 'FFFF0000' } };
        }

        // Highlight long service (> 30 years)
        if (row.years_of_service && parseInt(row.years_of_service) > 30) {
          const serviceCell = worksheet.getCell(`L${rowNum}`);
          serviceCell.font = { bold: true, color: { argb: 'FF006100' } };
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

      await exporter.exportToResponse(workbook, res, `current_personnel_report_${new Date().toISOString().split('T')[0]}.xlsx`);

    } catch (error) {
      console.error('Personnel Report Export error:', error);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: error.message });
      }
    }
  }

  // ==========================================================================
  // PDF GENERATION (CURRENT EMPLOYEES)
  // ==========================================================================
  async generatePersonnelReportPDF(data, req, res, filters, statistics) {
    try {
      if (!data || data.length === 0) {
        throw new Error('No Personnel data available for the selected filters');
      }

      console.log('📄 Generating PDF with', data.length, 'records');

      const templatePath = path.join(__dirname, '../../templates/personnel-report.html');
      
      if (!fs.existsSync(templatePath)) {
        throw new Error('PDF template file not found');
      }
      
      const templateContent = fs.readFileSync(templatePath, 'utf8');

      const appliedFilters = [];
      if (filters.title) appliedFilters.push(`Rank: ${filters.title}`);
      if (filters.pfa) appliedFilters.push(`PFA: ${filters.pfa}`);
      if (filters.location) appliedFilters.push(`Location: ${filters.location}`);
      if (filters.gradetype) appliedFilters.push(`Grade Type: ${filters.gradetype}`);
      if (filters.gradelevel) appliedFilters.push(`Grade Level: ${filters.gradelevel}`);
      if (filters.bankBranch) appliedFilters.push(`Bank Branch: ${filters.bankBranch}`);
      if (filters.stateOfOrigin) appliedFilters.push(`State: ${filters.stateOfOrigin}`);
      if (filters.emolumentForm) appliedFilters.push(`Emolument Form: ${filters.emolumentForm}`);
      if (filters.rentSubsidy) appliedFilters.push(`Rent Subsidy: ${filters.rentSubsidy}`);
      if (filters.taxed) appliedFilters.push(`Taxed: ${filters.taxed}`);
      
      const filterDescription = appliedFilters.length > 0 ? appliedFilters.join(' | ') : 'All Current Personnel';
  
      const image = await companySettings.getSettingsFromFile('./public/photos/logo.png');

      let className = this.getDatabaseNameFromRequest(req);
      if (className && className.includes(' ')) {
        className = className.replace(' ', '<br>');
      }

      const templateData = {
        data: data,
        statistics: statistics,
        reportDate: new Date(),
        filters: filterDescription,
        className: className,
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
        `attachment; filename=current_personnel_report_${new Date().toISOString().split('T')[0]}.pdf`
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


  // GET FILTER OPTIONS
  // ==========================================================================
  async getPersonnelFilterOptions(req, res) {
    try {
      // Get current database from pool using user_id
      const currentDb = pool.getCurrentDatabase(req.user_id.toString());
      console.log('🔍 Current database for filter options:', currentDb);
      
      const [titles, pfas, locations, gradeTypes, gradeLevels, bankBranches, states, rentSubsidy, taxedStatus, emolumentForms] = await Promise.all([
        personnelReportService.getAvailableTitles(currentDb),
        personnelReportService.getAvailablePFAs(currentDb),
        personnelReportService.getAvailableLocations(currentDb),
        personnelReportService.getAvailableGradeTypes(currentDb),
        personnelReportService.getAvailableGradeLevels(currentDb),
        personnelReportService.getAvailableBankBranches(currentDb),
        personnelReportService.getAvailableStates(currentDb),
        personnelReportService.getAvailableRentSubsidy(currentDb),
        personnelReportService.getAvailableTaxedStatus(currentDb),
        personnelReportService.getAvailableEmolumentForms(currentDb)
      ]);

      console.log('✅ Filter options loaded:', {
        titles: titles.length,
        pfas: pfas.length,
        locations: locations.length,
        gradeTypes: gradeTypes.length,
        gradeLevels: gradeLevels.length,
        bankBranches: bankBranches.length,
        states: states.length,
        rentSubsidy: rentSubsidy.length,
        taxedStatus: taxedStatus.length,
        emolumentForms: emolumentForms.length
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
      if (emolumentForms.length === 0) warnings.push('emolumentForms');

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
          emolumentForms,
          oldEmployeesOptions: [
            { code: 'yes', description: 'Separated/Left Employees' },
            { code: 'no', description: 'Active Employees Only' }
          ]
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
  
  getDatabaseNameFromRequest(req) {
    const dbToClassMap = {
      [process.env.DB_OFFICERS]: 'MILITARY STAFF',
      [process.env.DB_WOFFICERS]: 'CIVILIAN STAFF', 
      [process.env.DB_RATINGS]: 'PENSION STAFF',
      [process.env.DB_RATINGS_A]: 'NYSC ATTACHE',
      [process.env.DB_RATINGS_B]: 'RUNNING COST',
      // [process.env.DB_JUNIOR_TRAINEE]: 'TRAINEE'
    };

    const currentDb = req.current_class;
    return dbToClassMap[currentDb] || currentDb || 'MILITARY STAFF';
  }
}

module.exports = new PersonnelReportController();


