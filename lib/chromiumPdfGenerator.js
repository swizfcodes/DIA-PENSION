const fs = require('fs');
const path = require('path');

class ChromiumPDFGenerator {
  constructor() {
    this.chromium = null;
    this.puppeteer = null;
    this.launchOptions = null;
    this.initialized = false;
    this.initPromise = null;
    this.isProduction = process.env.NODE_ENV === 'production' || process.platform === 'linux';
    this.logFile = '/home/hicadng/backend/chromium-debug.log';
  }

  log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    console.log(message);
    try {
      fs.appendFileSync(this.logFile, logMessage);
    } catch (err) {
      console.error('Failed to write to log file:', err.message);
    }
  }

  async initialize() {
    if (this.initialized) return;

    this.log('=== CHROMIUM PDF GENERATOR INITIALIZATION ===');
    this.log(`Environment: ${this.isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
    this.log(`Platform: ${process.platform}`);

    if (this.isProduction) {
      await this._initializeProduction();
    } else {
      await this._initializeDevelopment();
    }

    this.initialized = true;
    this.log('✅ ChromiumPDFGenerator initialized successfully');
  }

  async _initializeProduction() {
    try {
      this.chromium = require('@sparticuz/chromium');
      this.puppeteer = require('puppeteer-core');
      this.log('✅ Loaded @sparticuz/chromium and puppeteer-core');

      const tempDir = '/home/hicadng/tmp/.chromium-temp';
      const chromiumExtractDir = path.join(tempDir, 'chromium-extract');
      
      this.log(`Temp directory: ${tempDir}`);
      this.log(`Chromium extract directory: ${chromiumExtractDir}`);
      
      // Create directories
      [tempDir, chromiumExtractDir].forEach(dir => {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
          this.log(`✅ Created directory: ${dir}`);
        }
      });
      
      // Set environment variables
      process.env.HOME = '/home/hicadng';
      process.env.TMPDIR = tempDir;
      process.env.TEMP = tempDir;
      process.env.TMP = tempDir;
      process.env.FONTCONFIG_PATH = tempDir;
      process.env.XDG_CACHE_HOME = tempDir;
      this.log('✅ Set environment variables to avoid /tmp');
      
      // Get executable path
      this.log('📥 Getting Chromium executable path...');
      let executablePath;
      
      try {
        executablePath = await this.chromium.executablePath({ cacheDir: chromiumExtractDir });
      } catch (pathError) {
        this.log(`⚠️ executablePath with cacheDir failed: ${pathError.message}`);
        executablePath = await this.chromium.executablePath();
      }
      
      this.log(`📍 Chromium executable path: ${executablePath}`);
      
      // If still in /tmp, relocate to our directory
      if (executablePath.startsWith('/tmp')) {
        this.log('⚠️ Executable still in /tmp, relocating...');
        const customChromiumPath = path.join(chromiumExtractDir, 'chromium');
        
        if (fs.existsSync(executablePath)) {
          this.log(`Copying from ${executablePath} to ${customChromiumPath}`);
          fs.copyFileSync(executablePath, customChromiumPath);
          fs.chmodSync(customChromiumPath, 0o755);
          executablePath = customChromiumPath;
          this.log(`✅ Copied Chromium to: ${executablePath}`);
        }
      }
      
      // Verify binary
      if (fs.existsSync(executablePath)) {
        this.log('✅ Chromium binary exists');
        
        const stats = fs.statSync(executablePath);
        this.log(`Permissions: ${stats.mode.toString(8)}`);
        
        try {
          fs.chmodSync(executablePath, 0o755);
          this.log('✅ Set execute permissions');
        } catch (chmodError) {
          this.log(`⚠️ chmod failed: ${chmodError.message}`);
        }
        
        try {
          fs.accessSync(executablePath, fs.constants.X_OK);
          this.log('✅ Binary is executable');
        } catch (accessError) {
          this.log(`❌ Binary NOT executable: ${accessError.message}`);
        }
      } else {
        this.log(`❌ Binary does not exist at: ${executablePath}`);
      }

    // Configure launch options
    this.launchOptions = {
      args: [
        ...this.chromium.args,
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--no-first-run',
        '--no-sandbox',
        '--no-zygote',
        '--single-process',
        `--user-data-dir=${tempDir}`,
        '--disable-software-rasterizer',
        '--disable-extensions',
        `--disk-cache-dir=${tempDir}`,
        '--disable-dev-tools',
        '--font-render-hinting=none',
        '--disable-font-subpixel-positioning',
        '--disable-web-security',
        // SHARPNESS IMPROVEMENTS
        '--force-device-scale-factor=2',
        '--enable-font-antialiasing'
      ],
      defaultViewport: this.chromium.defaultViewport,
      executablePath: executablePath,
      headless: true,
      ignoreHTTPSErrors: true,
      env: {
        ...process.env,
        FONTCONFIG_PATH: '/usr/share/fonts'
      }
    };
      this.log('✅ Launch options configured');
    } catch (initError) {
      this.log(`❌ INITIALIZATION ERROR: ${initError.message}`);
      this.log(`Stack: ${initError.stack}`);
      throw initError;
    }
  }

  async _initializeDevelopment() {
    this.puppeteer = require('puppeteer');
    this.launchOptions = {
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    };
    this.log('✅ Configured for local development');
  }

  async generateFromHTML(htmlContent, options = {}) {
    this.log('=== GENERATE PDF REQUEST ===');
    
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    await this.initPromise;

    let browser;
    try {
      // Inject font fixes for production only
      if (this.isProduction) {
        this.log('🔤 Injecting production font fallback...');
        
        const fontInjection = `
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Libre+Baskerville:wght@400;700&display=swap');
            
            body, table, th, td, div, span, p {
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif !important;
            }
            
            h1, h2, h3, h4, h5, h6,
            .header h1, .header h2 {
              font-family: 'Libre Baskerville', Georgia, serif !important;
            }
            
            * {
              -webkit-font-smoothing: antialiased !important;
              -moz-osx-font-smoothing: grayscale !important;
            }
          </style>
        `;
        
        if (htmlContent.includes('<head>')) {
          htmlContent = htmlContent.replace('<head>', '<head>' + fontInjection);
        } else if (htmlContent.includes('<html>')) {
          htmlContent = htmlContent.replace('<html>', '<html><head>' + fontInjection + '</head>');
        } else {
          htmlContent = fontInjection + htmlContent;
        }
        
        this.log('✅ Font fallback injected');
      } else {
        this.log('⏭️  Skipping font injection (local environment)');
      }
      
      this.log('🚀 Launching browser...');
      this.log(`   Executable: ${this.launchOptions.executablePath || 'default'}`);
      
      browser = await this.puppeteer.launch(this.launchOptions);
      this.log('✅ Browser launched successfully');
      
      const page = await browser.newPage();
      this.log('✅ New page created');
      
      // Set default timeouts for the page
      const timeout = options.timeout || 60000; // Default 60s, configurable
      page.setDefaultTimeout(timeout);
      page.setDefaultNavigationTimeout(timeout);
      this.log(`⏱️  Page timeout set to ${timeout}ms`);
      
      // SHARPNESS IMPROVEMENT: Set high-resolution viewport
      await page.setViewport({
        width: 1920,
        height: 1080,
        deviceScaleFactor: 2
      });
      this.log('✅ High-resolution viewport set');
      
      // Use 'domcontentloaded' instead of 'networkidle0' for faster rendering
      // This doesn't wait for all network resources, just the DOM to be ready
      this.log('📥 Loading HTML content...');
      await page.setContent(htmlContent, { 
        waitUntil: 'domcontentloaded', // Changed from 'networkidle0'
        timeout: timeout
      });
      this.log('✅ HTML content set');
      
      // Wait for fonts to load
      if (this.isProduction) {
        try {
          await page.evaluateHandle('document.fonts.ready');
          this.log('✅ Fonts loaded');
        } catch (fontError) {
          this.log(`⚠️  Font loading warning: ${fontError.message}`);
          // Continue anyway - fonts might be cached or local
        }
        
        // Brief delay for rendering
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      const pdfOptions = {
        format: options.format || 'A4',
        landscape: options.landscape !== undefined ? options.landscape : true,
        printBackground: true,
        preferCSSPageSize: true,
        scale: 1.0,
        margin: options.margin || {
          top: '5mm',
          right: '5mm',
          bottom: '5mm',
          left: '5mm'
        },
        tagged: true
      };
      
      this.log('📄 Generating PDF...');
      const pdfBuffer = await page.pdf(pdfOptions);
      this.log(`✅ PDF generated: ${pdfBuffer.length} bytes`);
      
      return pdfBuffer;
    } catch (error) {
      this.log(`❌ PDF Generation Error: ${error.message}`);
      this.log(`   Stack: ${error.stack}`);
      throw error;
    } finally {
      if (browser) {
        await browser.close();
        this.log('🔒 Browser closed');
      }
    }
  }
}

module.exports = new ChromiumPDFGenerator();