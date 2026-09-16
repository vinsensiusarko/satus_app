// DatabaseHelper.gs

let cachedSpreadsheet = null;
const cachedSheets = {};

function getSpreadsheet() {
  if (cachedSpreadsheet) return cachedSpreadsheet;
  
  if (!CONFIG.SPREADSHEET_ID || CONFIG.SPREADSHEET_ID === 'YOUR_SPREADSHEET_ID_HERE') {
    throw new Error('Spreadsheet ID belum diatur di Config.gs. Silakan jalankan createSpreadsheetDatabase() di Setup.gs terlebih dahulu.');
  }
  cachedSpreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  return cachedSpreadsheet;
}

const DATABASE_SCHEMAS = {
  'Users': ['user_id','username','password_hash','role','nama','status','created_at','photo_url'],
  'Members': ['member_id','user_id','nama','nis','kelas','tanggal_daftar','status','qr_data'],
  'Transactions': ['transaction_id','timestamp','member_id','type','wallet_type','credit','debit','amount','cashier_id','description','status'],
  'Waste_Transactions': ['waste_id','transaction_id','member_id','waste_type','quantity','unit','unit_price','total_value','cashier_id','timestamp'],
  'Products': ['product_id','product_name','category','price','green_price','stock','status'],
  'Waste_Prices': ['waste_type','unit','price','effective_date','status'],
  'Targets': ['target_id','member_id','target_name','target_amount','status','created_at'],
  'Audit_Log': ['log_id','timestamp','user_id','role','action','reference_id','description'],
  'Seeds': ['seed_id','seed_name','seed_type','conversion_value','stock','status'],
  'Seed_Requests': ['request_id','member_id','seed_id','quantity','total_value','status','requested_at','reviewed_by','reviewed_at','reject_reason'],
  'Void_Requests': ['void_id','transaction_id','member_id','wallet_type','amount','reason','cashier_id','status','requested_at','reviewed_by','reviewed_at','reject_reason'],
  'App_Version': ['config_key','latest_version','latest_build_number','min_required_version','min_required_build_number','is_required','update_title','release_notes','play_store_url','is_active','updated_at'],
  'Scheduled_Notifications': ['schedule_id','title','body','target_role','trigger_time','frequency','is_active','last_sent_at','created_by','created_at']
};

function ensureSheetHeaders(sheet, sheetName) {
  if (!sheet) return;
  const expectedHeaders = DATABASE_SCHEMAS[sheetName];
  if (!expectedHeaders) return;

  // Cek cache agar tidak membuang 3 remote RPC ke Spreadsheet pada setiap request
  try {
    if (typeof CacheService !== 'undefined' && CacheService.getScriptCache) {
      const cache = CacheService.getScriptCache();
      if (cache && cache.get('sheet_hdr_ok_' + sheetName) === '1') {
        return;
      }
    }
  } catch (e) {}

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow === 0 || lastCol === 0) {
    const headerRange = sheet.getRange(1, 1, 1, expectedHeaders.length);
    headerRange.setValues([expectedHeaders]);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#e0e0e0');
    sheet.setFrozenRows(1);
    try { sheet.autoResizeColumns(1, expectedHeaders.length); } catch(e) {}
    try {
      const cache = CacheService.getScriptCache();
      if (cache) cache.put('sheet_hdr_ok_' + sheetName, '1', 21600); // 6 jam
    } catch(e) {}
    return;
  }

  // Check if row 1 is actually the header row
  const firstCell = String(sheet.getRange(1, 1).getValue()).trim();
  if (firstCell !== expectedHeaders[0]) {
    if (firstCell === '') {
      // Empty row 1, set headers
      const headerRange = sheet.getRange(1, 1, 1, expectedHeaders.length);
      headerRange.setValues([expectedHeaders]);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#e0e0e0');
      sheet.setFrozenRows(1);
    } else {
      // There is actual data in row 1! Insert a new row at row 1 for headers
      sheet.insertRowBefore(1);
      const headerRange = sheet.getRange(1, 1, 1, expectedHeaders.length);
      headerRange.setValues([expectedHeaders]);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#e0e0e0');
      sheet.setFrozenRows(1);
      try { sheet.autoResizeColumns(1, expectedHeaders.length); } catch(e) {}
    }
  }

  try {
    const cache = CacheService.getScriptCache();
    if (cache) cache.put('sheet_hdr_ok_' + sheetName, '1', 21600); // 6 jam
  } catch(e) {}
}

function getSheet(sheetName) {
  if (cachedSheets[sheetName]) return cachedSheets[sheetName];
  
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  ensureSheetHeaders(sheet, sheetName);
  cachedSheets[sheetName] = sheet;
  return sheet;
}

const cachedSheetData = {};

/**
 * Membersihkan cache in-memory data sheet
 * Dipanggil setiap kali thread baru memperoleh lock agar data yang dibaca 100% mutakhir
 */
function clearDatabaseCache() {
  for (const key in cachedSheetData) {
    delete cachedSheetData[key];
  }
}

/**
 * Melakukan commit paksa seluruh antrean penulisan SpreadsheetApp ke disk Google
 */
function flushDatabase() {
  try {
    if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.flush) {
      SpreadsheetApp.flush();
    }
  } catch (e) {
    console.warn('Gagal melakukan SpreadsheetApp.flush():', e);
  }
}

/**
 * Menjalankan operasi database penting dengan mutual exclusion lock (LockService)
 * Mencegah race condition, double-spending, tabrakan ID, dan lost update.
 * 
 * @param {Function} callback Fungsi callback yang akan dieksekusi di dalam lock
 * @param {Object} [options] Konfigurasi opsional (timeoutMs)
 * @returns {*} Hasil callback atau objek error jika lock gagal diperoleh
 */
function withScriptLock(callback, options) {
  const isEnabled = CONFIG.LOCK_CONFIG && CONFIG.LOCK_CONFIG.ENABLED !== false;
  if (!isEnabled) {
    return callback();
  }

  const timeoutMs = (options && options.timeoutMs) || (CONFIG.LOCK_CONFIG && CONFIG.LOCK_CONFIG.TIMEOUT_MS) || 30000;
  
  let lock = null;
  try {
    if (typeof LockService !== 'undefined' && LockService.getScriptLock) {
      lock = LockService.getScriptLock();
    }
  } catch (e) {
    console.warn('LockService tidak tersedia pada runtime ini:', e);
    return callback();
  }

  if (!lock) {
    return callback();
  }

  // Jika thread eksekusi saat ini sudah memegang lock (misal dari ApiRouter), langsung jalankan
  if (typeof lock.hasLock === 'function' && lock.hasLock()) {
    return callback();
  }

  let acquired = false;
  try {
    acquired = lock.tryLock(timeoutMs);
  } catch (err) {
    console.warn('Error saat mencoba acquire lock:', err);
  }

  if (!acquired) {
    console.error(`Gagal memperoleh script lock setelah ${timeoutMs}ms (antrean server penuh / timeout).`);
    return {
      success: false,
      error_code: 'SERVER_BUSY',
      message: 'Server sedang sibuk memproses antrean transaksi lain. Silakan coba beberapa saat lagi.'
    };
  }

  try {
    // 1. Bersihkan cache in-memory agar membaca data paling mutakhir dari Google Sheets
    clearDatabaseCache();

    // 2. Jalankan eksekusi mutasi / transaksi
    const result = callback();

    // 3. Commit paksa seluruh penulisan buffer spreadsheet sebelum lock dilepaskan
    flushDatabase();

    return result;
  } finally {
    try {
      if (lock && typeof lock.hasLock === 'function' && lock.hasLock()) {
        lock.releaseLock();
      }
    } catch (e) {
      console.warn('Error saat melepaskan lock:', e);
    }
  }
}

function getSheetData(sheetName) {
  if (cachedSheetData[sheetName]) return cachedSheetData[sheetName];
  
  const sheet = getSheet(sheetName);
  const allValues = sheet.getDataRange().getValues();
  if (!allValues || allValues.length <= 1) {
    cachedSheetData[sheetName] = [];
    return [];
  }
  
  const headers = allValues[0];
  const rows = allValues.slice(1);
  
  const mappedData = rows.map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      let val = row[i];
      if (val instanceof Date) {
        val = val.toISOString();
      }
      obj[h] = val;
    });
    return obj;
  });
  
  cachedSheetData[sheetName] = mappedData;
  return mappedData;
}

function appendRow(sheetName, rowData) {
  getSheet(sheetName).appendRow(rowData);
  delete cachedSheetData[sheetName];
}

function findRowByColumn(sheetName, columnName, value) {
  const sheet = getSheet(sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colIndex = headers.indexOf(columnName);
  if (colIndex === -1) return null;

  const data = sheet.getRange(2, colIndex + 1, lastRow - 1, 1).getValues();
  
  for (let i = 0; i < data.length; i++) {
    if (data[i][0] == value) {
      // Row is 1-indexed, +1 for header, +1 for loop index (0-based)
      const rowIndex = i + 2; 
      const fullData = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];
      const obj = {};
      headers.forEach((h, j) => obj[h] = fullData[j]);
      
      return { row: rowIndex, data: obj };
    }
  }
  return null;
}

function updateRow(sheetName, rowNumber, rowData) {
  const sheet = getSheet(sheetName);
  sheet.getRange(rowNumber, 1, 1, rowData.length).setValues([rowData]);
  delete cachedSheetData[sheetName];
}
