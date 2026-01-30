const jsreport = require('jsreport-core')();
const chromiumPdfGenerator = require('../../lib/chromiumPdfGenerator');
const Handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

class BaseReportController {
  constructor() {
    this.jsreportReady = false;
    this.fallbackReady = true;
    
    const forceFallback = process.env.USE_JSREPORT_FALLBACK === 'true';
    
    if (forceFallback) {
      console.log('⚠️  JSReport disabled via USE_JSREPORT_FALLBACK=true - using Chromium fallback');
      this.jsreportReady = false;
    } else {
      this.initJSReport();
    }
    
    this.registerHandlebarsHelpers();
  }

  async initJSReport() {
    try {
      jsreport.use(require('jsreport-handlebars')());
      jsreport.use(require('jsreport-chrome-pdf')());
      
      await jsreport.init();
      this.jsreportReady = true;
      console.log('✅ JSReport initialized');
    } catch (error) {
      console.error('⚠️  JSReport initialization failed, will use Chromium fallback:', error.message);
      this.jsreportReady = false;
    }
  }

  registerHandlebarsHelpers() {
    const helpersCode = this._getCommonHelpers();
    
    const helperFunctions = new Function(`
      ${helpersCode}
      return {
        formatCurrency,
        formatCurrencyWithSign,
        isNegative,
        abs,
        formatDate,
        formatTime,
        formatPeriod,
        formatMonth,
        add,
        subtract,
        eq,
        gt,
        gte,
        lt,
        lte,
        sum,
        groupBy,
        sumByType,
        getSeverity,
        getSeverityClass
      };
    `)();

    Object.keys(helperFunctions).forEach(name => {
      Handlebars.registerHelper(name, helperFunctions[name]);
    });

    console.log('✅ Handlebars helpers registered for fallback');
  }

  _getCommonHelpers() {
    return `
      function formatCurrency(value) {
        const num = parseFloat(value) || 0;
        return num.toLocaleString('en-NG', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });
      }

      function formatCurrencyWithSign(amount) {
        const num = parseFloat(amount || 0);
        const formatted = Math.abs(num).toLocaleString('en-NG', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });
        if (num < 0) {
          return '(' + formatted + ')';
        }
        return formatted;
      }

      function abs(value) {
        return Math.abs(parseFloat(value) || 0);
      }  
      
      function isNegative(amount) {
        return parseFloat(amount || 0) < 0;
      }
      
      function formatDate(date) {
        const d = new Date(date || new Date());
        return d.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        });
      }

      function formatTime(date) {
        return new Date(date).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
      }

      function formatPeriod(period) {
        if (!period || period.length !== 6) return period;
        const year = period.substring(0, 4);
        const month = period.substring(4, 6);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthName = months[parseInt(month) - 1] || month;
        return monthName + ' ' + year;
      }

      function formatMonth(monthNumber) {
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        return monthNames[monthNumber - 1] || 'Unknown';
      }

      function add(a, b) {
        return (parseFloat(a) || 0) + (parseFloat(b) || 0);
      }
      
      function subtract(a, b) {
        return (parseFloat(a) || 0) - (parseFloat(b) || 0);
      }
      
      function eq(a, b) {
        return a === b;
      }
      
      function gt(a, b) {
        return parseFloat(a) > parseFloat(b);
      }
      
      function gte(a, b) {
        return parseFloat(a) >= parseFloat(b);
      }
      
      function lt(a, b) {
        return parseFloat(a) < parseFloat(b);
      }
      
      function lte(a, b) {
        return parseFloat(a) <= parseFloat(b);
      }
      
      function sum(array, property) {
        if (!array || !Array.isArray(array)) return 0;
        return array.reduce((sum, item) => sum + (parseFloat(item[property]) || 0), 0);
      }
      
      function groupBy(array, property) {
        if (!array || !Array.isArray(array)) return [];
        
        const groups = {};
        array.forEach(item => {
          const key = item[property] || 'Unknown';
          if (!groups[key]) {
            groups[key] = [];
          }
          groups[key].push(item);
        });
        
        return Object.keys(groups).sort().map(key => ({
          key: key,
          values: groups[key]
        }));
      }
      
      function sumByType(earnings, type) {
        let total = 0;
        if (Array.isArray(earnings)) {
          earnings.forEach(item => {
            if (item.type === type) {
              total += parseFloat(item.amount) || 0;
            }
          });
        }
        return total;
      }

      function getSeverity(count) {
        if (count === 2) return 'Low';
        if (count <= 4) return 'Medium';
        return 'High';
      }

      function getSeverityClass(count) {
        if (count === 2) return 'severity-low';
        if (count <= 4) return 'severity-medium';
        return 'severity-high';
      }
    `;
  }

  // UNIFIED PDF GENERATION METHOD
  async generatePDFWithFallback(templatePath, templateData, pdfOptions = {}) {
    if (!fs.existsSync(templatePath)) {
      throw new Error(`PDF template file not found: ${templatePath}`);
    }
    
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    let pdfBuffer;

    if (this.jsreportReady) {
      try {
        console.log('🔄 Attempting PDF generation with JSReport...');
        const result = await jsreport.render({
          template: {
            content: templateContent,
            engine: 'handlebars',
            recipe: 'chrome-pdf',
            chrome: {
              displayHeaderFooter: pdfOptions.displayHeaderFooter || false,
              printBackground: pdfOptions.printBackground !== false,
              format: pdfOptions.format || 'A4',
              landscape: pdfOptions.landscape !== false,
              marginTop: pdfOptions.marginTop || '5mm',
              marginBottom: pdfOptions.marginBottom || '5mm',
              marginLeft: pdfOptions.marginLeft || '5mm',
              marginRight: pdfOptions.marginRight || '5mm',
              timeout: pdfOptions.timeout || 120000
            },
            helpers: pdfOptions.helpers || this._getCommonHelpers()
          },
          data: templateData,
          options: pdfOptions.options || {}
        });
        
        pdfBuffer = result.content;
        console.log('✅ PDF generated successfully with JSReport');
        return pdfBuffer;
      } catch (jsreportError) {
        console.error('⚠️  JSReport failed, switching to Chromium fallback:', jsreportError.message);
        this.jsreportReady = false;
      }
    }

    if (!this.jsreportReady && this.fallbackReady) {
      console.log('🔄 Using Chromium fallback for PDF generation...');
      
      const template = Handlebars.compile(templateContent);
      const html = template(templateData);
      
      pdfBuffer = await chromiumPdfGenerator.generateFromHTML(html, {
        format: pdfOptions.format || 'A4',
        landscape: pdfOptions.landscape !== false,
        margin: {
          top: pdfOptions.marginTop || '5mm',
          right: pdfOptions.marginRight || '5mm',
          bottom: pdfOptions.marginBottom || '5mm',
          left: pdfOptions.marginLeft || '5mm'
        }
      });
      
      console.log('✅ PDF generated successfully with Chromium fallback');
      return pdfBuffer;
    }

    throw new Error('No PDF generation method available');
  }

  // BATCH PDF GENERATION - For payslips/large datasets
  async generateBatchedPDF(templatePath, allData, batchSize, pdfOptions, extraTemplateData = {}) {
    console.log(`📦 Starting batched PDF generation: ${allData.length} items, batch size: ${batchSize}`);
    
    const batches = [];
    for (let i = 0; i < allData.length; i += batchSize) {
      batches.push(allData.slice(i, i + batchSize));
    }
    
    console.log(`📦 Created ${batches.length} batches`);
    
    const pdfBuffers = [];
    
    for (let i = 0; i < batches.length; i++) {
      console.log(`🔄 Processing batch ${i + 1}/${batches.length} (${batches[i].length} items)`);
      
      const templateData = {
        ...extraTemplateData,
        employees: batches[i]
      };
      
      const batchPdf = await this.generatePDFWithFallback(templatePath, templateData, pdfOptions);
      pdfBuffers.push(batchPdf);
      
      console.log(`✅ Batch ${i + 1}/${batches.length} complete`);
    }
    
    console.log('📄 Merging PDFs...');
    const mergedPdf = await this.mergePDFs(pdfBuffers);
    console.log('✅ PDF merge complete');
    
    return mergedPdf;
  }

  // MERGE MULTIPLE PDF BUFFERS
  async mergePDFs(pdfBuffers) {
    const PDFMerger = require('pdf-merger-js').default;
    const merger = new PDFMerger();

    for (const buffer of pdfBuffers) {
      await merger.add(buffer);
    }

    return merger.saveAsBuffer();
  }
}

module.exports = BaseReportController;