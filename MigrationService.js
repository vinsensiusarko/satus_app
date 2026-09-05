// MigrationService.gs
// Script untuk migrasi database existing ke PRD v2 (Dual Wallet System)

function runMigrationToV2() {
  try {
    Logger.log('=== MEMULAI MIGRASI KE PRD V2 ===');
    const ss = getSpreadsheet();

    // 1. Migrasi sheet Transactions
    const txSheet = getSheet(CONFIG.SHEETS.TRANSACTIONS);
    const txData = txSheet.getDataRange().getValues();
    let txHeaders = txData[0] || [];
    
    let walletIdx = txHeaders.indexOf('wallet_type');
    let typeIdx = txHeaders.indexOf('type');

    if (walletIdx === -1) {
      Logger.log('Menambahkan kolom wallet_type ke Transactions...');
      // Insert column at index 5 (after type)
      txSheet.insertColumnAfter(4);
      txSheet.getRange(1, 5).setValue('wallet_type').setFontWeight('bold').setBackground('#e0e0e0');
      
      // Reload data
      const refreshedData = txSheet.getDataRange().getValues();
      walletIdx = 4; // 0-indexed column 5
      typeIdx = refreshedData[0].indexOf('type');
      
      for (let i = 1; i < refreshedData.length; i++) {
        const txType = refreshedData[i][typeIdx];
        let wallet = CONFIG.WALLET_TYPES.TABUNGAN;
        if (txType === 'SETOR_PLASTIK' || txType === 'SETOR_JELANTAH' || txType === 'TUKAR_HIJAU_ATK' || txType === 'SETUJUI_BIBIT') {
          wallet = CONFIG.WALLET_TYPES.HIJAU;
        }
        txSheet.getRange(i + 1, walletIdx + 1).setValue(wallet);
        
        if (txType === 'BELANJA_KOPERASI') {
          txSheet.getRange(i + 1, typeIdx + 1).setValue(CONFIG.TRANSACTION_TYPES.BELANJA_TABUNGAN);
        }
      }
      Logger.log(`Berhasil migrasi ${refreshedData.length - 1} transaksi ke dual wallet.`);
    } else {
      // Pastikan semua row terisi wallet_type
      for (let i = 1; i < txData.length; i++) {
        const txType = txData[i][typeIdx];
        const currentWallet = txData[i][walletIdx];
        if (!currentWallet) {
          let wallet = CONFIG.WALLET_TYPES.TABUNGAN;
          if (txType === 'SETOR_PLASTIK' || txType === 'SETOR_JELANTAH' || txType === 'TUKAR_HIJAU_ATK' || txType === 'SETUJUI_BIBIT') {
            wallet = CONFIG.WALLET_TYPES.HIJAU;
          }
          txSheet.getRange(i + 1, walletIdx + 1).setValue(wallet);
        }
        if (txType === 'BELANJA_KOPERASI') {
          txSheet.getRange(i + 1, typeIdx + 1).setValue(CONFIG.TRANSACTION_TYPES.BELANJA_TABUNGAN);
        }
      }
    }

    // 2. Migrasi sheet Products (tambah green_price)
    const prdSheet = getSheet(CONFIG.SHEETS.PRODUCTS);
    const prdData = prdSheet.getDataRange().getValues();
    const prdHeaders = prdData[0] || [];
    let greenPriceIdx = prdHeaders.indexOf('green_price');
    
    if (greenPriceIdx === -1) {
      Logger.log('Menambahkan kolom green_price ke Products...');
      prdSheet.insertColumnAfter(4); // after price
      prdSheet.getRange(1, 5).setValue('green_price').setFontWeight('bold').setBackground('#e0e0e0');
      
      const refreshedPrd = prdSheet.getDataRange().getValues();
      const priceIdx = refreshedPrd[0].indexOf('price');
      for (let i = 1; i < refreshedPrd.length; i++) {
        const p = refreshedPrd[i][priceIdx];
        prdSheet.getRange(i + 1, 5).setValue(p); // set default green_price = price
      }
      Logger.log('Berhasil menambahkan green_price untuk produk.');
    }

    // 3. Pastikan sheet Seeds ada dan terisi
    let seedsSheet = ss.getSheetByName(CONFIG.SHEETS.SEEDS);
    if (!seedsSheet) {
      Logger.log('Membuat sheet Seeds...');
      seedsSheet = ss.insertSheet(CONFIG.SHEETS.SEEDS);
      const headers = ['seed_id','seed_name','seed_type','conversion_value','stock','status'];
      const range = seedsSheet.getRange(1, 1, 1, headers.length);
      range.setValues([headers]);
      range.setFontWeight('bold');
      range.setBackground('#e0e0e0');
      seedsSheet.setFrozenRows(1);
      
      seedsSheet.appendRow(['SEED-001', 'Bibit Pohon Mangga', 'Buah', 10000, 50, 'AKTIF']);
      seedsSheet.appendRow(['SEED-002', 'Bibit Pohon Jambu', 'Buah', 10000, 40, 'AKTIF']);
      seedsSheet.appendRow(['SEED-003', 'Bibit Pohon Trembesi', 'Peneduh', 8000, 30, 'AKTIF']);
      Logger.log('Sheet Seeds berhasil dibuat dan di-seed.');
    }

    // 4. Pastikan sheet Seed_Requests ada
    let seedReqSheet = ss.getSheetByName(CONFIG.SHEETS.SEED_REQUESTS);
    if (!seedReqSheet) {
      Logger.log('Membuat sheet Seed_Requests...');
      seedReqSheet = ss.insertSheet(CONFIG.SHEETS.SEED_REQUESTS);
      const headers = ['request_id','member_id','seed_id','quantity','total_value','status','requested_at','reviewed_by','reviewed_at','reject_reason'];
      const range = seedReqSheet.getRange(1, 1, 1, headers.length);
      range.setValues([headers]);
      range.setFontWeight('bold');
      range.setBackground('#e0e0e0');
      seedReqSheet.setFrozenRows(1);
      Logger.log('Sheet Seed_Requests berhasil dibuat.');
    }

    // Bersihkan semua cache
    if (typeof cachedSheetData !== 'undefined') {
      Object.keys(cachedSheetData).forEach(k => delete cachedSheetData[k]);
    }

    Logger.log('=== MIGRASI KE PRD V2 SELESAI DENGAN SUKSES! ===');
    return { success: true, message: 'Migrasi ke PRD v2 berhasil!' };
  } catch (err) {
    Logger.log('ERROR MIGRASI: ' + err.message);
    return { success: false, message: 'Gagal migrasi: ' + err.message };
  }
}
