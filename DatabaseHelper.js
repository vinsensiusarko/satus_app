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

function getSheet(sheetName) {
  if (cachedSheets[sheetName]) return cachedSheets[sheetName];
  
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    // Initialize headers if we know them
    const schemas = {
      'Targets': ['target_id','member_id','target_name','target_amount','status','created_at']
    };
    if (schemas[sheetName]) {
      const headers = schemas[sheetName];
      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setValues([headers]);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#e0e0e0');
      sheet.setFrozenRows(1);
    }
  }
  cachedSheets[sheetName] = sheet;
  return sheet;
}

const cachedSheetData = {};

function getSheetData(sheetName) {
  if (cachedSheetData[sheetName]) return cachedSheetData[sheetName];
  
  const sheet = getSheet(sheetName);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    cachedSheetData[sheetName] = [];
    return [];
  }
  
  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  const mappedData = data.map(row => {
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
