// Setup.gs
// Jalankan fungsi createSpreadsheetDatabase() satu kali dari editor Apps Script untuk membuat database.

function createSpreadsheetDatabase() {
  // Buat Spreadsheet baru
  const ss = SpreadsheetApp.create('Database SATUS - Kantong Hijau');
  const spreadsheetId = ss.getId();
  
  // Skema tabel
  const schemas = {
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
    'Void_Requests': ['void_id','transaction_id','member_id','wallet_type','amount','reason','cashier_id','status','requested_at','reviewed_by','reviewed_at','reject_reason']
  };

  // Buat setiap sheet dan header
  for (const [name, headers] of Object.entries(schemas)) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
    } else {
      sheet.clear();
    }
    
    // Set Header
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#e0e0e0');
    sheet.setFrozenRows(1);
    
    // Auto resize column
    try {
      sheet.autoResizeColumns(1, headers.length);
    } catch(e) {}
  }
  
  // Hapus Sheet1 default jika ada
  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }
  
  // Seed initial Manager and Kasir users with initial placeholder avatars
  const usersSheet = ss.getSheetByName('Users');
  if (usersSheet) {
    const rawPassManager = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'manager123');
    const hashManager = rawPassManager.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
    
    usersSheet.appendRow([
      'STF-001', 'admin', hashManager, 'MANAGER', 'Super Admin', 'AKTIF', new Date(), 'https://ui-avatars.com/api/?name=Admin&background=16a34a&color=fff&bold=true'
    ]);

    const rawPassKasir = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'kasir123');
    const hashKasir = rawPassKasir.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
    
    usersSheet.appendRow([
      'STF-002', 'kasir', hashKasir, 'KASIR', 'Petugas Kasir', 'AKTIF', new Date(), 'https://ui-avatars.com/api/?name=Kasir&background=059669&color=fff&bold=true'
    ]);
  }

  // Seed initial Seeds (Mangga, Jambu, Trembesi)
  const seedsSheet = ss.getSheetByName('Seeds');
  if (seedsSheet) {
    seedsSheet.appendRow(['SEED-001', 'Bibit Pohon Mangga', 'Buah', 10000, 50, 'AKTIF']);
    seedsSheet.appendRow(['SEED-002', 'Bibit Pohon Jambu', 'Buah', 10000, 40, 'AKTIF']);
    seedsSheet.appendRow(['SEED-003', 'Bibit Pohon Trembesi', 'Peneduh', 8000, 30, 'AKTIF']);
  }

  // Seed initial Waste Prices
  const wastePricesSheet = ss.getSheetByName('Waste_Prices');
  if (wastePricesSheet) {
    wastePricesSheet.appendRow(['PLASTIK', 'Kg', 2000, new Date(), 'AKTIF']);
    wastePricesSheet.appendRow(['JELANTAH', 'Liter', 3500, new Date(), 'AKTIF']);
  }

  // Seed initial Products (ATK) with price and green_price
  const productsSheet = ss.getSheetByName('Products');
  if (productsSheet) {
    productsSheet.appendRow(['PRD-001', 'Pensil 2B', 'ATK', 5000, 5000, 50, 'AKTIF']);
    productsSheet.appendRow(['PRD-002', 'Ballpoint Standard', 'ATK', 7000, 7000, 40, 'AKTIF']);
    productsSheet.appendRow(['PRD-003', 'Penghapus', 'ATK', 4000, 4000, 30, 'AKTIF']);
    productsSheet.appendRow(['PRD-004', 'Buku Tulis Sinar Dunia', 'Buku', 10000, 10000, 25, 'AKTIF']);
  }
  
  Logger.log('=========================================');
  Logger.log('✅ DATABASE BERHASIL DIBUAT!');
  Logger.log('📍 Buka Spreadsheet di sini: ' + ss.getUrl());
  Logger.log('🔑 SPREADSHEET ID: ' + spreadsheetId);
  Logger.log('⚠️ PENTING: Copy SPREADSHEET ID di atas dan paste ke Config.gs pada variabel CONFIG.SPREADSHEET_ID');
  Logger.log('=========================================');
}
