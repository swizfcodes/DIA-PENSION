// ============================================
// CUSTOM DROPDOWN - FINAL FIX
// Fixes: Placeholder blocking values, missing select attributes, cascade issues
// ============================================

class CustomDropdown {
  constructor(element, options = {}) {
    if (!element) {
      throw new Error('CustomDropdown requires a valid element');
    }
    
    this.element = typeof element === 'string' ? document.querySelector(element) : element;
    
    if (!this.element) {
      throw new Error('Element not found');
    }
    
    this.originalElement = this.element;
    this.pendingValue = this.originalElement.value || null;
    
    // Extract placeholder from first option if it exists
    let extractedPlaceholder = options.placeholder || 'Select...';
    if (this.originalElement.options && this.originalElement.options.length > 0) {
      const firstOption = this.originalElement.options[0];
      if (!firstOption.value || firstOption.value === '') {
        extractedPlaceholder = firstOption.textContent.trim();
      }
    }
    
    // Preserve ALL original attributes
    this.originalAttributes = this.captureAttributes();
    
    this.config = {
      placeholder: extractedPlaceholder,
      searchEnabled: options.searchEnabled !== false,
      apiUrl: options.apiUrl || null,
      data: options.data || [],
      valueField: options.valueField || 'id',
      labelField: options.labelField || 'name',
      labelFormat: options.labelFormat || null,
      hiddenInputName: options.hiddenInputName || null,
      onSelect: options.onSelect || null,
      className: options.className || '',
      maxHeight: options.maxHeight || '240px',
      loadingText: options.loadingText || 'Loading...',
      errorText: options.errorText || 'Failed to load data',
      noResultsText: options.noResultsText || 'No results found',
      fetchHeaders: options.fetchHeaders || {},
      cacheData: options.cacheData !== false,
      ...options
    };
    
    // Internal data storage
    this._internalData = [];
    this._cachedData = null;
    this.selectedValue = null;
    this.selectedText = null;
    this.isOpen = false;
    this.isLoading = false;
    this.hasLoadedData = false;
    this.validationMessage = '';
    this.dataLoadedCallbacks = [];
    this.isInitialized = false;
    this._optionProcessTimeout = null;
    this._pendingOptionsBuffer = [];
    
    this.init();
  }
  
  get data() {
    return this._internalData;
  }
  
  set data(value) {
    if (!Array.isArray(value)) {
      console.warn('CustomDropdown: data must be an array, got:', typeof value);
      value = [];
    }
    this._internalData = value;
    this.hasLoadedData = value.length > 0;
  }
  
  captureAttributes() {
    const attrs = {};
    if (this.originalElement.attributes) {
      Array.from(this.originalElement.attributes).forEach(attr => {
        attrs[attr.name] = attr.value;
      });
    }
    
    attrs._disabled = this.originalElement.disabled;
    attrs._hidden = this.originalElement.hidden;
    attrs._required = this.originalElement.required;
    attrs._autofocus = this.originalElement.autofocus;
    attrs._tabindex = this.originalElement.tabIndex;
    
    return attrs;
  }
  
  init() {
    this.createDropdownHTML();
    this.searchInput = this.element.querySelector('.custom-dropdown-search');
    this.dropdownList = this.element.querySelector('.custom-dropdown-list');
    this.dropdownItems = this.element.querySelector('.custom-dropdown-items');
    this.hiddenInput = this.element.querySelector('.custom-dropdown-hidden');
    this.arrow = this.element.querySelector('.custom-dropdown-arrow');
    
    this.restoreAttributes();
    this.bindEvents();
    this.isInitialized = true;
    
    // Only set static data if provided
    if (this.config.data.length > 0) {
      this.setData(this.config.data);
    }
  }
  
  restoreAttributes() {
    const attrs = this.originalAttributes;
    
    if (attrs._disabled) {
      this.disabled = true;
    }
    
    if (attrs._hidden) {
      this.hidden = true;
    }
    
    if (attrs._required) {
      this.required = true;
    }
    
    if (attrs._autofocus && this.searchInput) {
      this.searchInput.autofocus = true;
    }
    
    if (attrs._tabindex !== undefined && this.searchInput) {
      this.searchInput.tabIndex = attrs._tabindex;
    }
    
    Object.keys(attrs).forEach(key => {
      if (key.startsWith('data-')) {
        this.element.setAttribute(key, attrs[key]);
      }
    });
    
    Object.keys(attrs).forEach(key => {
      if (key.startsWith('aria-')) {
        this.element.setAttribute(key, attrs[key]);
      }
    });
  }
  
  createDropdownHTML() {
    const wrapper = document.createElement('div');
    
    const originalId = this.originalElement.id;
    const originalName = this.originalElement.name;
    const originalClasses = this.originalElement.className;
    
    const structuralClasses = originalClasses.split(' ').filter(cls => {
      return cls.match(/^(col-|row-|grid|flex|w-(?!full)|h-(?!full)|m-|mt-|mb-|ml-|mr-|mx-|my-)/);
    }).join(' ');
    
    wrapper.className = `custom-dropdown-wrapper relative ${structuralClasses} ${this.config.className}`.trim();
    if (originalId) wrapper.id = originalId;
    
    // FIX: Don't show placeholder in input, only when empty
    wrapper.innerHTML = `
      <div class="relative w-full">
        <input 
          type="text" 
          class="custom-dropdown-search w-full border border-green-500 focus:border-yellow-500 bg-transparent rounded-md px-3 py-2 focus:outline-none pr-10"
          placeholder="${this.config.placeholder}"
          autocomplete="off"
          ${this.config.searchEnabled ? '' : 'readonly style="cursor: pointer;"'}>
        <span class="custom-dropdown-arrow absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none transition-transform duration-200">
          <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </div>

      <div class="custom-dropdown-list fixed z-[999999] mt-1 bg-yellow-50 border border-gray-300 rounded-md shadow-lg overflow-hidden" style="display: none; visibility: hidden;">
        <div class="py-1 custom-dropdown-items" style="max-height: ${this.config.maxHeight}; overflow-y: auto; overflow-x: hidden;"></div>
      </div>
      
      <input type="hidden" class="custom-dropdown-hidden" name="${originalName || this.config.hiddenInputName || ''}">
    `;
    
    const parent = this.element.parentNode;
    const nextSibling = this.element.nextSibling;
    
    while (this.element.firstChild) {
      this.element.removeChild(this.element.firstChild);
    }
    
    parent.removeChild(this.element);
    
    if (nextSibling) {
      parent.insertBefore(wrapper, nextSibling);
    } else {
      parent.appendChild(wrapper);
    }
    
    this.element = wrapper;
    
    this.setupDynamicOptionHandler();
    this.setupSelectCompatibility();
  }
  
  setupDynamicOptionHandler() {
    this.cleanupObserver = new MutationObserver((mutations) => {
      let optionsDetected = false;
      
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'OPTION') {
            optionsDetected = true;
            this._pendingOptionsBuffer.push(node);
          }
        });
      });
      
      if (optionsDetected) {
        if (this._optionProcessTimeout) {
          clearTimeout(this._optionProcessTimeout);
        }
        
        this._optionProcessTimeout = setTimeout(() => {
          this.processPendingOptions();
        }, 50);
      }
    });
    
    this.cleanupObserver.observe(this.element, {
      childList: true,
      subtree: true
    });
  }
  
  processPendingOptions() {
    if (this._pendingOptionsBuffer.length === 0) return;
    
    const allOptions = Array.from(this.element.querySelectorAll('option'));
    
    if (allOptions.length === 0) {
      this._pendingOptionsBuffer = [];
      return;
    }
    
    const newData = [];
    let newPlaceholder = null;
    
    allOptions.forEach(option => {
      const value = (option.value || '').trim();
      const text = (option.textContent || '').trim();
      
      if (!value || value === '') {
        if (text && !newPlaceholder) {
          newPlaceholder = text;
        }
      } else {
        newData.push({
          [this.config.valueField]: value,
          [this.config.labelField]: text
        });
      }
      
      option.remove();
    });
    
    if (newPlaceholder && this.searchInput) {
      this.searchInput.placeholder = newPlaceholder;
      this.config.placeholder = newPlaceholder;
    }
    
    if (newData.length > 0) {
      this.setData(newData);
    }
    
    this._pendingOptionsBuffer = [];
  }
  
  setupSelectCompatibility() {
    Object.defineProperty(this.element, 'value', {
      get: () => this.getValue(),
      set: (val) => {
        if (val === '' || val === null || val === undefined) {
          this.clear();
        } else {
          this.setValue(val);
        }
      },
      enumerable: true,
      configurable: true
    });
    
    Object.defineProperty(this.element, 'name', {
      get: () => this.hiddenInput ? this.hiddenInput.name : '',
      set: (val) => {
        if (this.hiddenInput) this.hiddenInput.name = val;
      },
      enumerable: true,
      configurable: true
    });
    
    Object.defineProperty(this.element, 'text', {
      get: () => this.getText(),
      enumerable: true,
      configurable: true
    });
    
    Object.defineProperty(this.element, 'disabled', {
      get: () => this.searchInput ? this.searchInput.disabled : false,
      set: (val) => {
        if (this.searchInput) {
          this.searchInput.disabled = !!val;
          if (this.hiddenInput) {
            this.hiddenInput.disabled = !!val;
          }
          if (val) {
            this.element.classList.add('opacity-50', 'cursor-not-allowed');
            this.searchInput.classList.add('cursor-not-allowed');
            this.close();
          } else {
            this.element.classList.remove('opacity-50', 'cursor-not-allowed');
            this.searchInput.classList.remove('cursor-not-allowed');
          }
        }
      },
      enumerable: true,
      configurable: true
    });
    
    Object.defineProperty(this.element, 'hidden', {
      get: () => this.element.style.display === 'none' || this.element.hasAttribute('hidden'),
      set: (val) => {
        if (val) {
          this.element.style.display = 'none';
          this.element.setAttribute('hidden', '');
        } else {
          this.element.style.display = '';
          this.element.removeAttribute('hidden');
        }
      },
      enumerable: true,
      configurable: true
    });
    
    Object.defineProperty(this.element, 'required', {
      get: () => this.hiddenInput ? this.hiddenInput.required : false,
      set: (val) => {
        if (this.hiddenInput) {
          this.hiddenInput.required = !!val;
        }
        if (this.searchInput) {
          this.searchInput.required = !!val;
        }
      },
      enumerable: true,
      configurable: true
    });
    
    Object.defineProperty(this.element, 'readOnly', {
      get: () => this.searchInput ? this.searchInput.readOnly : false,
      set: (val) => {
        if (this.searchInput) {
          this.searchInput.readOnly = !!val;
        }
      },
      enumerable: true,
      configurable: true
    });
    
    Object.defineProperty(this.element, 'tabIndex', {
      get: () => this.searchInput ? this.searchInput.tabIndex : -1,
      set: (val) => {
        if (this.searchInput) {
          this.searchInput.tabIndex = val;
        }
      },
      enumerable: true,
      configurable: true
    });
    
    // FIX: Proper options property that works with .selectedIndex
    Object.defineProperty(this.element, 'options', {
      get: () => {
        const options = this.data.map((item, index) => ({
          value: item[this.config.valueField],
          text: this.config.labelFormat 
            ? this.config.labelFormat(item) 
            : item[this.config.labelField],
          index: index,
          selected: item[this.config.valueField] == this.selectedValue
        }));
        
        options.selectedIndex = this.data.findIndex(
          item => item[this.config.valueField] == this.selectedValue
        );
        
        return options;
      },
      enumerable: true,
      configurable: true
    });
    
    Object.defineProperty(this.element, 'selectedIndex', {
      get: () => {
        return this.data.findIndex(
          item => item[this.config.valueField] == this.selectedValue
        );
      },
      set: (index) => {
        if (index >= 0 && index < this.data.length) {
          const item = this.data[index];
          const value = item[this.config.valueField];
          const text = this.config.labelFormat 
            ? this.config.labelFormat(item) 
            : item[this.config.labelField];
          this.selectItem(value, text, item);
        } else if (index === -1) {
          this.clear();
        }
      },
      enumerable: true,
      configurable: true
    });
    
    this.element.setCustomValidity = (message) => {
      this.validationMessage = message || '';
      if (this.searchInput) this.searchInput.setCustomValidity(message || '');
      if (this.hiddenInput) this.hiddenInput.setCustomValidity(message || '');
    };
    
    this.element.checkValidity = () => {
      return this.searchInput ? this.searchInput.checkValidity() : true;
    };
    
    this.element.reportValidity = () => {
      return this.searchInput ? this.searchInput.reportValidity() : true;
    };
    
    Object.defineProperty(this.element, 'validationMessage', {
      get: () => this.validationMessage,
      enumerable: true,
      configurable: true
    });
    
    Object.defineProperty(this.element, 'validity', {
      get: () => this.searchInput ? this.searchInput.validity : { valid: true },
      enumerable: true,
      configurable: true
    });
    
    Object.defineProperty(this.element, 'form', {
      get: () => this.hiddenInput ? this.hiddenInput.form : null,
      enumerable: true,
      configurable: true
    });
    
    this.element.focus = () => {
      if (this.searchInput) this.searchInput.focus();
    };
    
    this.element.blur = () => {
      if (this.searchInput) this.searchInput.blur();
    };
    
    Object.defineProperty(this.element, 'length', {
      get: () => this.data.length,
      enumerable: true,
      configurable: true
    });
    
    Object.defineProperty(this.element, 'type', {
      get: () => 'select-one',
      enumerable: true,
      configurable: true
    });
    
    Object.defineProperty(this.element, 'innerHTML', {
      set: (html) => {
        if (!html || !html.includes('<option')) {
          return;
        }
        
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        const options = tempDiv.querySelectorAll('option');
        
        const nonPlaceholderOptions = Array.from(options).filter(opt => opt.value && opt.value.trim() !== '');
        
        if (nonPlaceholderOptions.length === 0) {
          return;
        }
        
        const currentValue = this.selectedValue || this.pendingValue;
        
        this.data = [];
        this.selectedValue = null;
        this.selectedText = null;
        
        let detectedPlaceholder = null;
        
        options.forEach(option => {
          const value = (option.value || '').trim();
          const text = (option.textContent || '').trim();
          
          if (!value || value === '') {
            if (text && this.searchInput) {
              this.searchInput.placeholder = text;
              this.config.placeholder = text;
              detectedPlaceholder = text;
            }
          } else {
            const itemData = {
              [this.config.valueField]: value,
              [this.config.labelField]: text
            };
            this.data.push(itemData);
          }
        });
        
        // FIX: Clear input only if no value will be set
        if (!currentValue) {
          if (this.searchInput) this.searchInput.value = '';
        }
        if (this.hiddenInput) this.hiddenInput.value = '';
        
        if (this.dropdownItems) {
          this.dropdownItems.innerHTML = '';
        }
        
        if (currentValue && this.data.length > 0) {
          queueMicrotask(() => {
            const success = this._setValueInternal(currentValue, false);
            if (!success) {
              this.pendingValue = currentValue;
            }
          });
        } else if (currentValue) {
          this.pendingValue = currentValue;
        }
        
        this.triggerDataLoaded();
      },
      get: () => {
        return '';
      },
      enumerable: true,
      configurable: true
    });
    
    const originalGetAttribute = this.element.getAttribute.bind(this.element);
    this.element.getAttribute = (attr) => {
      if (attr === 'name') {
        return this.hiddenInput ? this.hiddenInput.name : originalGetAttribute(attr);
      }
      return originalGetAttribute(attr);
    };
    
    const originalSetAttribute = this.element.setAttribute.bind(this.element);
    this.element.setAttribute = (attr, value) => {
      if (attr === 'name' && this.hiddenInput) {
        this.hiddenInput.name = value;
      }
      return originalSetAttribute(attr, value);
    };
    
    this.element._customDropdown = this;
  }
  
  bindEvents() {
    if (!this.config.searchEnabled) {
      this.searchInput.addEventListener('mousedown', (e) => {
        if (!this.searchInput.disabled && !this.element.disabled) {
          e.preventDefault();
        }
      });
      
      this.searchInput.addEventListener('click', (e) => {
        if (!this.searchInput.disabled && !this.element.disabled) {
          e.preventDefault();
          this.toggle();
        }
      });
    }
    
    this.searchInput.addEventListener('focus', () => {
      if (!this.isOpen && !this.searchInput.disabled && !this.element.disabled) {
        this.open();
      }
    });
    
    if (this.config.searchEnabled) {
      this.searchInput.addEventListener('input', (e) => {
        this.filterItems(e.target.value);
        if (!this.isOpen) this.open();
      });
    }
    
    if (this.arrow) {
      this.arrow.style.pointerEvents = 'auto';
      this.arrow.style.cursor = 'pointer';
      this.arrow.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!this.searchInput.disabled && !this.element.disabled) {
          this.toggle();
          this.searchInput.focus();
        }
      });
    }
    
    document.addEventListener('click', (e) => {
      if (!this.element.contains(e.target) && !this.dropdownList.contains(e.target)) {
        this.close();
      }
    });
    
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.close();
        this.searchInput.blur();
      }
    });
    
    const reposition = () => {
      if (this.isOpen) this.positionDropdown();
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
  }
  
  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }
  
  async fetchData() {
    if (this.config.cacheData && this._cachedData && this._cachedData.length > 0) {
      this.setData(this._cachedData);
      return;
    }
    
    if (this.isLoading) return;
    
    this.isLoading = true;
    this.showLoading();
    
    try {
      const token = window.storageAvailable ? localStorage.getItem('token') : null;
      const headers = {
        'Authorization': token ? `Bearer ${token}` : '',
        'Content-Type': 'application/json',
        ...this.config.fetchHeaders
      };
      
      const response = await fetch(this.config.apiUrl, {
        method: 'GET',
        headers: headers
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      
      let dataArray = [];
      if (Array.isArray(result)) {
        dataArray = result;
      } else if (result.success && Array.isArray(result.data)) {
        dataArray = result.data;
      } else if (result.data && Array.isArray(result.data)) {
        dataArray = result.data;
      }
      
      if (this.config.cacheData) {
        this._cachedData = dataArray;
      }
      
      this.setData(dataArray);
    } catch (error) {
      console.error('CustomDropdown fetch error:', error);
      this.showError();
    } finally {
      this.isLoading = false;
    }
  }
  
  setData(data) {
    if (!Array.isArray(data)) {
      console.warn('CustomDropdown.setData: data must be an array');
      data = [];
    }
    
    this.data = data;
    
    // FIX: Don't clear input if value exists
    if (this.searchInput && !this.selectedValue && !this.pendingValue) {
      this.searchInput.value = '';
    }
    
    if (this.dropdownItems) {
      this.dropdownItems.innerHTML = '';
    }
    
    if (this.pendingValue && this.data.length > 0) {
      queueMicrotask(() => {
        const success = this._setValueInternal(this.pendingValue, false);
        if (success) {
          this.pendingValue = null;
        }
      });
    }
    
    this.triggerDataLoaded();
  }
  
  onDataLoaded(callback) {
    if (this.data.length > 0) {
      callback();
    } else {
      this.dataLoadedCallbacks.push(callback);
    }
  }
  
  triggerDataLoaded() {
    while (this.dataLoadedCallbacks.length > 0) {
      const callback = this.dataLoadedCallbacks.shift();
      try {
        callback();
      } catch (error) {
        console.error('Error in data loaded callback:', error);
      }
    }
  }
  
  renderItems(items) {
    if (items.length === 0) {
      this.dropdownItems.innerHTML = `
        <div class="px-3 py-4 text-center text-gray-500">
          ${this.config.noResultsText}
        </div>
      `;
      return;
    }
    
    let html = '';
    
    items.forEach(item => {
      const value = item[this.config.valueField];
      const label = this.config.labelFormat 
        ? this.config.labelFormat(item) 
        : item[this.config.labelField];
      
      const escapedLabel = String(label).replace(/[&<>"']/g, (char) => {
        const escapeMap = {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        };
        return escapeMap[char];
      });
      
      const isSelected = this.selectedValue == value ? ' bg-green-100' : '';
      html += `<div class="custom-dropdown-item px-3 py-2 hover:bg-green-50 cursor-pointer border-b border-gray-100 transition-colors${isSelected}" data-value="${value}">${escapedLabel}</div>`;
    });
    
    this.dropdownItems.innerHTML = html;
    
    this.dropdownItems.onclick = (e) => {
      const itemEl = e.target.closest('.custom-dropdown-item');
      if (!itemEl) return;
      
      const value = itemEl.getAttribute('data-value');
      const item = items.find(i => i[this.config.valueField] == value);
      
      if (item) {
        const label = this.config.labelFormat 
          ? this.config.labelFormat(item) 
          : item[this.config.labelField];
        this.selectItem(value, label, item);
      }
    };
  }
  
  selectItem(value, text, fullData) {
    this.selectedValue = value;
    this.selectedText = text;
    this.searchInput.value = text;
    
    if (this.hiddenInput) {
      this.hiddenInput.value = value;
    }
    
    this.close();
    
    if (this.config.onSelect) {
      this.config.onSelect(value, text, fullData);
    }
    
    const changeEvent = new Event('change', { bubbles: true, cancelable: true });
    this.element.dispatchEvent(changeEvent);
    
    const inputEvent = new Event('input', { bubbles: true, cancelable: true });
    this.element.dispatchEvent(inputEvent);
    
    const customEvent = new CustomEvent('dropdown:change', {
      detail: { value, text, data: fullData },
      bubbles: true,
      cancelable: true
    });
    this.element.dispatchEvent(customEvent);
  }
  
  filterItems(searchText) {
    const filtered = this.data.filter(item => {
      const label = this.config.labelFormat 
        ? this.config.labelFormat(item) 
        : item[this.config.labelField];
      
      return label.toLowerCase().includes(searchText.toLowerCase());
    });
    
    this.renderItems(filtered);
    
    if (!this.isOpen) {
      this.open();
    }
  }
  
  positionDropdown() {
    const inputRect = this.searchInput.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - inputRect.bottom;
    const spaceAbove = inputRect.top;
    const dropdownHeight = parseInt(this.config.maxHeight);
    
    this.dropdownList.style.width = inputRect.width + 'px';
    
    if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
      this.dropdownList.style.bottom = (viewportHeight - inputRect.top + 4) + 'px';
      this.dropdownList.style.top = 'auto';
      this.dropdownList.style.left = inputRect.left + 'px';
    } else {
      this.dropdownList.style.top = (inputRect.bottom + 4) + 'px';
      this.dropdownList.style.bottom = 'auto';
      this.dropdownList.style.left = inputRect.left + 'px';
    }
  }
  
  open() {
    if (this.element.disabled || this.searchInput.disabled) {
      return;
    }
    
    if (!this.hasLoadedData && this.config.apiUrl) {
      this.fetchData();
      return;
    }
    
    if (this.data.length === 0) {
      this.dropdownItems.innerHTML = `
        <div class="px-3 py-4 text-center text-gray-500">
          ${this.config.noResultsText}
        </div>
      `;
    } else {
      this.renderItems(this.data);
    }
    
    this.dropdownList.style.display = 'block';
    this.dropdownList.style.visibility = 'visible';
    this.positionDropdown();
    
    if (this.arrow) {
      this.arrow.style.transform = 'scaleY(-1)';
    }
    
    this.isOpen = true;
  }
  
  close() {
    if (this.dropdownList) {
      this.dropdownList.style.display = 'none';
      this.dropdownList.style.visibility = 'hidden';
    }
    
    if (this.arrow) {
      this.arrow.style.transform = 'scaleY(1)';
    }
    
    this.isOpen = false;
    
    if (this.dropdownItems && !this.isLoading) {
      this.dropdownItems.innerHTML = '';
    }
  }
  
  showLoading() {
    this.dropdownList.style.display = 'block';
    this.dropdownList.style.visibility = 'visible';
    this.positionDropdown();
    this.isOpen = true;
    
    this.dropdownItems.innerHTML = `
      <div class="px-3 py-4 text-center text-gray-500">
        <svg class="animate-spin h-5 w-5 mx-auto mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        ${this.config.loadingText}
      </div>
    `;
  }
  
  showError() {
    this.dropdownItems.innerHTML = `
      <div class="px-3 py-4 text-center text-red-500">
        ${this.config.errorText}
      </div>
    `;
  }
  
  getValue() {
    return this.selectedValue;
  }
  
  getText() {
    return this.selectedText;
  }
  
  _setValueInternal(value, fireEvents = true) {
    if (value === null || value === undefined || value === '') {
      return false;
    }
    
    if (this.data.length === 0) {
      this.pendingValue = value;
      return false;
    }
    
    let item = this.data.find(i => i[this.config.labelField] == value);
    if (!item) {
      item = this.data.find(i => i[this.config.valueField] == value);
    }
    
    if (item) {
      const actualValue = item[this.config.valueField];
      const text = this.config.labelFormat 
        ? this.config.labelFormat(item) 
        : item[this.config.labelField];
      
      this.selectedValue = actualValue;
      this.selectedText = text;
      // FIX: Always show the value text, not placeholder
      this.searchInput.value = text;
      
      if (this.hiddenInput) {
        this.hiddenInput.value = actualValue;
      }

      if (fireEvents) {
        if (this.config.onSelect) {
          this.config.onSelect(actualValue, text, item);
        }
        
        this.element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        this.element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        this.element.dispatchEvent(new CustomEvent('dropdown:change', {
          detail: { value: actualValue, text, data: item },
          bubbles: true,
          cancelable: true
        }));
      }
      
      return true;
    }
    
    return false;
  }
  
  setValue(value, fireEvents = true) {
    const success = this._setValueInternal(value, fireEvents);
    
    if (!success) {
      this.pendingValue = value;
    }
  }
  
  clear() {
    this.selectedValue = null;
    this.selectedText = null;
    if (this.searchInput) {
      this.searchInput.value = '';
    }
    if (this.hiddenInput) {
      this.hiddenInput.value = '';
    }
    
    if (this.dropdownItems) {
      this.dropdownItems.innerHTML = '';
    }
    
    this.element.dispatchEvent(new Event('change', { bubbles: true }));
    this.element.dispatchEvent(new Event('input', { bubbles: true }));
    this.element.dispatchEvent(new CustomEvent('dropdown:change', {
      detail: { value: null, text: '', data: null },
      bubbles: true
    }));
  }
  
  refresh() {
    this._cachedData = null;
    this.hasLoadedData = false;
    this.data = [];
    
    if (this.config.apiUrl) {
      this.fetchData();
    }
  }
  
  destroy() {
    this.close();
    if (this.cleanupObserver) {
      this.cleanupObserver.disconnect();
    }
    if (this._optionProcessTimeout) {
      clearTimeout(this._optionProcessTimeout);
    }
    this.element.remove();
  }
}

window.storageAvailable = (() => {
  try {
    const test = '__storage_test__';
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    return true;
  } catch (e) {
    return false;
  }
})();


// ============================================
// AUTO-INITIALIZATION SYSTEM
// ============================================

(function() {
  const convertedElements = new WeakMap();
  const elementIdMap = new Map();
  
  const style = document.createElement('style');
  style.textContent = `
    select:not([data-native]), iselect { 
      opacity: 0; 
      transition: opacity 0.1s; 
    }
    .custom-dropdown-wrapper { 
      opacity: 1 !important; 
    }
    .custom-dropdown-list {
      display: none !important;
      visibility: hidden !important;
    }
    .custom-dropdown-list[style*="visibility: visible"] {
      display: block !important;
      visibility: visible !important;
    }
    .custom-dropdown-items {
      min-height: 0;
      box-sizing: border-box;
    }
    .custom-dropdown-items::-webkit-scrollbar {
      width: 8px;
    }
    .custom-dropdown-items::-webkit-scrollbar-track {
      background: #f1f1f1;
      border-radius: 4px;
    }
    .custom-dropdown-items::-webkit-scrollbar-thumb {
      background: #888;
      border-radius: 4px;
    }
    .custom-dropdown-items::-webkit-scrollbar-thumb:hover {
      background: #555;
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .custom-dropdown-search:focus {
      border-color: #eab308 !important;
      outline: none;
    }
  `;
  document.head.appendChild(style);
  
  function getDropdownConfig() {
    if (window.dropdownConfig) {
      return {
        searchEnabled: true,
        configs: window.dropdownConfig,
        type: 'structured'
      };
    }
    
    return window.customDropdownConfig || {
      searchEnabled: true,
      searchable: [],
      type: 'simple'
    };
  }
  
  function getSearchableConfig(element, config) {
    if (element.hasAttribute('data-searchable')) {
      return element.getAttribute('data-searchable') !== 'false';
    }
    
    if (element.hasAttribute('searchable')) {
      return true;
    }
    
    if (config.type === 'structured' && config.configs && element.id) {
      for (const [fieldName, fieldConfig] of Object.entries(config.configs)) {
        const expectedId = `field-${fieldName.replace(/\s+/g, '-').toLowerCase()}`;
        if (element.id === expectedId) {
          return true;
        }
      }
      return true;
    }
    
    if (config.searchable && Array.isArray(config.searchable)) {
      if (element.id && config.searchable.includes(element.id)) {
        return true;
      } else if (element.id && config.searchable.length > 0) {
        return false;
      }
    }
    
    return config.searchEnabled !== false;
  }
  
  function getElementDropdownConfig(element, config) {
    if (config.type !== 'structured' || !config.configs || !element.id) {
      return null;
    }
    
    for (const [fieldName, fieldConfig] of Object.entries(config.configs)) {
      const expectedId = `field-${fieldName.replace(/\s+/g, '-').toLowerCase()}`;
      if (element.id === expectedId) {
        return {
          apiUrl: fieldConfig.endpoint ? `/reference/${fieldConfig.endpoint}` : null,
          valueField: fieldConfig.value || fieldConfig.valueField || 'id',
          labelField: fieldConfig.text || fieldConfig.labelField || 'name',
          placeholder: `Select ${fieldName}`
        };
      }
    }
    
    return null;
  }
  
  function convertElement(element) {
    if (convertedElements.has(element)) {
      return convertedElements.get(element);
    }
    
    if (element.hasAttribute('data-native')) {
      return element;
    }
    
    const tagName = element.tagName.toLowerCase();
    
    if (tagName === 'iselect') {
      const select = document.createElement('select');
      
      Array.from(element.attributes).forEach(attr => {
        select.setAttribute(attr.name, attr.value);
      });
      
      while (element.firstChild) {
        select.appendChild(element.firstChild);
      }
      
      element.parentNode.replaceChild(select, element);
      element = select;
    }
    
    if (element.tagName !== 'SELECT') {
      return element;
    }
    
    const existingOptions = Array.from(element.options).map(opt => ({
      value: (opt.value || '').trim(),
      name: (opt.textContent || '').trim()
    })).filter(opt => opt.value !== '');
    
    let placeholder = 'Select...';
    const firstOption = element.options[0];
    if (firstOption && (!firstOption.value || firstOption.value === '')) {
      placeholder = (firstOption.textContent || '').trim() || 'Select...';
    }
    
    const globalConfig = getDropdownConfig();
    const searchEnabled = getSearchableConfig(element, globalConfig);
    const elementConfig = getElementDropdownConfig(element, globalConfig);
    
    const isDisabled = element.disabled || element.hasAttribute('disabled');
    
    const dropdownOptions = {
      placeholder: placeholder,
      searchEnabled: searchEnabled,
      data: existingOptions,
      valueField: 'value',
      labelField: 'name'
    };
    
    if (elementConfig) {
      Object.assign(dropdownOptions, elementConfig);
    }
    
    const dropdown = new CustomDropdown(element, dropdownOptions);
    
    if (isDisabled) {
      dropdown.element.disabled = true;
    }
    
    convertedElements.set(element, dropdown.element);
    
    if (element.id) {
      elementIdMap.set(element.id, dropdown.element);
    }
    
    return dropdown.element;
  }
  
  function convertAllInBatches() {
    const selectors = 'select:not([data-dropdown-converted]):not([data-native]), iselect:not([data-dropdown-converted])';
    const elements = document.querySelectorAll(selectors);
    
    if (elements.length === 0) return;
    
    const BATCH_SIZE = 10;
    let index = 0;
    
    function processBatch() {
      const end = Math.min(index + BATCH_SIZE, elements.length);
      
      for (let i = index; i < end; i++) {
        elements[i].setAttribute('data-dropdown-converted', 'true');
        convertElement(elements[i]);
      }
      
      index = end;
      
      if (index < elements.length) {
        if (window.requestIdleCallback) {
          requestIdleCallback(processBatch, { timeout: 100 });
        } else {
          setTimeout(processBatch, 0);
        }
      }
    }
    
    processBatch();
  }
  
  const originalGetElementById = Document.prototype.getElementById;
  const originalQuerySelector = Document.prototype.querySelector;
  const originalQuerySelectorAll = Document.prototype.querySelectorAll;
  
  Document.prototype.getElementById = function(id) {
    if (elementIdMap.has(id)) {
      return elementIdMap.get(id);
    }
    
    const element = originalGetElementById.call(this, id);
    if (element && (element.tagName === 'SELECT' || element.tagName === 'ISELECT')) {
      const converted = convertElement(element);
      if (id) {
        elementIdMap.set(id, converted);
      }
      return converted;
    }
    return element;
  };
  
  Document.prototype.querySelector = function(selector) {
    const element = originalQuerySelector.call(this, selector);
    if (element && (element.tagName === 'SELECT' || element.tagName === 'ISELECT')) {
      return convertElement(element);
    }
    return element;
  };
  
  Document.prototype.querySelectorAll = function(selector) {
    const elements = originalQuerySelectorAll.call(this, selector);
    const selectorLower = selector.toLowerCase();
    
    if (selectorLower.includes('select') || selectorLower.includes('iselect')) {
      return Array.from(elements).map(el => {
        if (el.tagName === 'SELECT' || el.tagName === 'ISELECT') {
          return convertElement(el);
        }
        return el;
      });
    }
    return elements;
  };
  
  let mutationTimer;
  const observer = new MutationObserver(() => {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(convertAllInBatches, 50);
  });
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      convertAllInBatches();
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    });
  } else {
    convertAllInBatches();
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }
  
  window.convertSelectToDropdown = convertElement;
  window.convertAllSelects = convertAllInBatches;
})();


