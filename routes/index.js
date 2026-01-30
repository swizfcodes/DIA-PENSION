//Dashboard
const statsRoutes = require('./dashboard/stats');
const notificationRoutes = require('./dashboard/notification');
const preferencesRoutes = require('./dashboard/preferences');


//administration
const usersRoutes = require('./administration/users');
const rolesRoutes = require('./administration/roles');
const switchpayrollclassRoutes = require('./administration/switchpayrollclass');
const permissionsRoutes = require('./administration/permissions');
const payrollclassSetupRoutes = require('./administration/payrollclassSetup');
const payrollclassChangeRoutes = require('./administration/payrollclassChange');
const changeregNoRoutes = require('./administration/changeregNo');
const companyProfileRoutes = require('./administration/companyProfile');
const monthendProcessingRoutes = require('./administration/monthendProcessing');
//one-off/irregular payments
const oneoffrankRoutes = require('./administration/irregular-oneoff/oneoffrank');
const reportRequirementSetupRoutes = require('./administration/irregular-oneoff/reportRequirementSetup');
const individualPaymentRoutes = require('./administration/irregular-oneoff/individualPayment');
const oneOffCalculationRoutes = require('./administration/irregular-oneoff/oneoff-calculation');
const oneOffReportsRoutes = require('./administration/irregular-oneoff/oneoff-reports');



//Personnel Profile
const personnelRoutes = require('./personnel-profile/personnels');



//Data Entry
const paymentDeductionsRoutes = require('./data-entry/paymentDeductions');
const arrearsCalculationsRoutes = require('./data-entry/arrearsCalculations');
const cummulativePayrollRoutes = require('./data-entry/cummulativePayroll');
const inputDocumentationRoutes = require('./data-entry/inputDocumentation');



//File Update
const inputVariableRoutes = require('./file-update/inputVariable');
const masterFileUpdateRoutes = require('./file-update/masterFileUpdate');
const personnelDataRoutes = require('./file-update/personnelData');
const recallPaymentRoutes = require('./file-update/recallPayment');
const savePayrollRoutes = require('./file-update/savePayroll');



//Payroll Calculations
const payrollCalculationRoutes = require('./payroll-calculations/payrollCalculation');
const backupPayRoutes = require('./payroll-calculations/backup');
const restorePayRoutes = require('./payroll-calculations/restore');
const calculationReportsRoutes = require('./payroll-calculations/calculationReports');




//utilities
const backupRoutes = require('./utilities/backup-db');
const restoreRoutes = require('./utilities/restore-db');
const ippisRoutes = require('./utilities/ippis-payment');
const consolidatedPayslipRoutes = require('./utilities/consolidated-payslips');



//refrence tables
const statesRoutes = require('./refrence-tables/states');
const payelementsRoutes = require('./refrence-tables/payelements');
const overtimeRoutes = require('./refrence-tables/overtime');
const bankdetailsRoutes = require('./refrence-tables/bankdetails');
const localgovernmentRoutes = require('./refrence-tables/localgovernment');
const departmentRoutes = require('./refrence-tables/department');
const commandRoutes = require('./refrence-tables/command');
const taxRoutes = require('./refrence-tables/tax');
const payperrankRoutes = require('./refrence-tables/payperrank');
const mutuallyexclusiveRoutes = require('./refrence-tables/mutuallyexclusive');
const salaryscaleRoutes = require('./refrence-tables/salaryscale');
const pfaRoutes = require('./refrence-tables/pfa');
const dropdownhelperRoutes = require('./refrence-tables/dropdownhelper');



//Reports
const erndedAnalysisRoutes = require('./reports/erndedAnalysis');
const loanAnalysisRoutes = require('./reports/loanAnalysis');
const nathouseFundsRoutes = require('./reports/nathouseFunds');
const personnelReportRoutes = require('./reports/personnelReport');
//const normhrsdeptAnalysisRoutes = require('./reports/normhrsdeptAnalysis');
const nstifRoutes = require('./reports/nstif');
//const overtimeAnalysisRoutes = require('./reports/overtimeAnalysis');
const paydedBankAnalysisRoutes = require('./reports/paydedBankAnalysis');
const paymentsBankRoutes = require('./reports/paymentsBank');
const controlSheetRoutes = require('./reports/controlSheet');
const payrollRegisterRoutes = require('./reports/payrollRegister');
const payslipsRoutes = require('./reports/payslips');
const salaryReconcileRoutes = require('./reports/salaryReconcile');
const salarySummaryRoutes = require('./reports/salarySummary');
const staffpayListRoutes = require('./reports/staffpayList');
const taxstatePayRoutes = require('./reports/taxstatePay');



//Audit Trail
const duplicateAccnoRoutes = require('./audit-trail/duplicateAccno');
const overpaymentRoutes = require('./audit-trail/overpayment');
const personalDetailsRecordRoutes = require('./audit-trail/personalDetailsRecord');
const salaryVarianceRoutes = require('./audit-trail/salaryVariance');
const variationInputRoutes = require('./audit-trail/variationInput');
const rangePaymentRoutes = require('./audit-trail/rangePayments');




//file-upload-helper
const salaryscaleuploadRoutes = require('./file-upload-helper/salaryscaleupload');
const personnelUploadRoutes = require('./file-upload-helper/personnelUpload');
const paydedUploadRoutes = require('./file-upload-helper/paydedUpload');

//Helpers
const paydedReportRoutes = require('./helpers/puppeteer-gen-reports/paydedReport');
const logServiceRoutes = require('./helpers/logRoutes');



module.exports = (app) => {
    //dashboard
    app.use('/stats', statsRoutes);
    app.use('/notifications', notificationRoutes);
    app.use('/preferences', preferencesRoutes);

    //administration
    app.use('/api/users', usersRoutes);
    app.use('/', rolesRoutes);
    app.use('/', switchpayrollclassRoutes);
    app.use('/roles', permissionsRoutes);
    app.use('/payroll-setup', payrollclassSetupRoutes);
    app.use('/payroll-change', payrollclassChangeRoutes);
    app.use('/regno', changeregNoRoutes);
    app.use('/company', companyProfileRoutes);
    app.use('/monthend', monthendProcessingRoutes);
    //one-off/irregular payments
    app.use('/oneoffrank', oneoffrankRoutes);
    app.use('/off', reportRequirementSetupRoutes);
    app.use('/individual', individualPaymentRoutes);
    app.use('/oneoff', oneOffCalculationRoutes);
    app.use('/oneoffreports', oneOffReportsRoutes);



    //personnel profile
    app.use('/personnel', personnelRoutes);


    //data entry
    app.use('/payded', paymentDeductionsRoutes);
    app.use('/arrears', arrearsCalculationsRoutes);
    app.use('/cumulative', cummulativePayrollRoutes);
    app.use('/documentation', inputDocumentationRoutes);


    //file update
    app.use('/inputvariable', inputVariableRoutes);
    app.use('/masterfile', masterFileUpdateRoutes);
    app.use('/personneldata', personnelDataRoutes);
    app.use('/recallpayment', recallPaymentRoutes);
    app.use('/savepayroll', savePayrollRoutes);


    //payroll-calculations
    app.use('/payrollcalculation', payrollCalculationRoutes);
    app.use('/backup', backupPayRoutes);
    app.use('/restore', restorePayRoutes);
    app.use('/calcreports', calculationReportsRoutes);


    //utilities
    app.use('/api/backup-db', backupRoutes);
    app.use("/api/restore-db", restoreRoutes);
    app.use("/ippis", ippisRoutes);
    app.use("/consolidated", consolidatedPayslipRoutes);



    //refrence tables
    app.use("/", statesRoutes);
    app.use("/pay", payelementsRoutes);
    app.use("/", overtimeRoutes);
    app.use("/api/v1", salaryscaleRoutes);
    app.use("/api/tax", taxRoutes);
    app.use("/api", bankdetailsRoutes);
    app.use("/lg", localgovernmentRoutes);
    app.use("/dept", departmentRoutes);
    app.use("/cmd", commandRoutes);
    app.use("/rank", payperrankRoutes);
    app.use("/mutually", mutuallyexclusiveRoutes);
    app.use("/pfa", pfaRoutes);
    app.use("/reference", dropdownhelperRoutes);


    //reports
    app.use('/ernded', erndedAnalysisRoutes);
    app.use('/loan', loanAnalysisRoutes);
    app.use('/nhf', nathouseFundsRoutes);
    //app.use('/normhrsdept', normhrsdeptAnalysisRoutes);
    app.use('/nstif', nstifRoutes);
    //app.use('/overtime', overtimeAnalysisRoutes);
    app.use('/paydedbank', paydedBankAnalysisRoutes);
    app.use('/paymentsbank', paymentsBankRoutes);
    app.use('/controlsheet', controlSheetRoutes);
    app.use('/payrollregister', payrollRegisterRoutes);
    app.use('/payslips', payslipsRoutes);
    app.use('/salaryreconcile', salaryReconcileRoutes);
    app.use('/salarysummary', salarySummaryRoutes);
    app.use('/staffpaylist', staffpayListRoutes);
    app.use('/taxstatepay', taxstatePayRoutes);
    app.use('/personnel-report', personnelReportRoutes);


    //audit-trail
    app.use('/duplicate', duplicateAccnoRoutes);
    app.use('/overpayment', overpaymentRoutes);
    app.use('/personalrecord', personalDetailsRecordRoutes);
    app.use('/salaryvariance', salaryVarianceRoutes);
    app.use('/variationinput', variationInputRoutes);
    app.use('/rangepayments', rangePaymentRoutes);
    


    //file-upload-helper
    app.use("/api/v1", salaryscaleuploadRoutes);
    app.use('/batchpersonnel', personnelUploadRoutes);
    app.use('/batchpayded', paydedUploadRoutes);



    //helpers
    app.use("/puppeteer", paydedReportRoutes);
    app.use("/logs", logServiceRoutes);
};