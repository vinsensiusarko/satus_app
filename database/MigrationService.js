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

/**
 * Migrasi Menyeluruh ke Single Master Table Users:
 * 1. Menjamin kolom kesiswaan ('nis', 'kelas', 'qr_data', 'tanggal_daftar', 'photo_url') di sheet Users
 * 2. Membuat cadangan fisik sheet Members menjadi 'Backup_Members_YYYYMMDD' sebagai safety net
 * 3. Menyalin/menyelaraskan semua NIS, Kelas, Tanggal Daftar dari Members ke Users
 * 4. Memastikan tidak ada siswa di Members yang tertinggal (membuat baris di Users jika belum ada)
 * 5. Menghapus sheet Members dari spreadsheet Google Sheets
 * 6. Membersihkan cache dan mencatat Audit Log
 */
function migrateToSingleMasterUsers(token) {
  return withScriptLock(function() {
    try {
      const session = requireRole(token, [CONFIG.ROLES.MANAGER]);
      const ss = getSpreadsheet();
      const mSheet = ss.getSheetByName(CONFIG.SHEETS.MEMBERS);

      if (!mSheet) {
        return {
          success: true,
          message: 'Sheet Members sudah tidak ada di spreadsheet (sudah bermigrasi ke Single Master Table Users).',
          alreadyMigrated: true
        };
      }

      // 1. Pastikan kolom kesiswaan ada di Users
      ensureUserStudentColumns();
      const uSheet = getSheet(CONFIG.SHEETS.USERS);
      const uData = uSheet.getDataRange().getValues();
      const uHeaders = uData[0];
      const uIdIdx = uHeaders.indexOf('user_id');
      const uNameIdx = uHeaders.indexOf('nama');
      const uNisIdx = uHeaders.indexOf('nis');
      const uKelasIdx = uHeaders.indexOf('kelas');
      const uQrIdx = uHeaders.indexOf('qr_data');
      const uTglIdx = uHeaders.indexOf('tanggal_daftar');
      const uStatusIdx = uHeaders.indexOf('status');

      // 2. Baca seluruh data dari Members
      const mData = mSheet.getDataRange().getValues();
      const mHeaders = mData[0];
      const mIdIdx = mHeaders.indexOf('member_id');
      const mUidIdx = mHeaders.indexOf('user_id');
      const mNamaIdx = mHeaders.indexOf('nama');
      const mNisIdx = mHeaders.indexOf('nis');
      const mKelasIdx = mHeaders.indexOf('kelas');
      const mTglIdx = mHeaders.indexOf('tanggal_daftar');
      const mStatusIdx = mHeaders.indexOf('status');
      const mQrIdx = mHeaders.indexOf('qr_data');

      // 3. Buat backup sheet aman: Backup_Members_YYYYMMDD
      const dateStr = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMdd');
      const backupSheetName = 'Backup_Members_' + dateStr;
      let backupSheet = ss.getSheetByName(backupSheetName);
      if (!backupSheet) {
        backupSheet = ss.insertSheet(backupSheetName);
        const sourceRange = mSheet.getDataRange();
        const targetRange = backupSheet.getRange(1, 1, mData.length, mHeaders.length);
        targetRange.setValues(sourceRange.getValues());
        backupSheet.setFrozenRows(1);
        try {
          backupSheet.getRange(1, 1, 1, mHeaders.length).setFontWeight('bold').setBackground('#d1fae5');
        } catch(e) {}
      }

      // 4. Backfill data dari Members ke Users
      let updatedCount = 0;
      let insertedCount = 0;
      const reportLogs = [];

      for (let m = 1; m < mData.length; m++) {
        const mId = String(mData[m][mIdIdx] || '').trim();
        const mUid = String(mData[m][mUidIdx] || '').trim();
        const mNama = String(mData[m][mNamaIdx] || '').trim();
        const mNis = mNisIdx !== -1 ? mData[m][mNisIdx] : '';
        const mKelas = mKelasIdx !== -1 ? mData[m][mKelasIdx] : '';
        const mTgl = mTglIdx !== -1 ? mData[m][mTglIdx] : new Date();
        const mStatus = mStatusIdx !== -1 ? mData[m][mStatusIdx] : 'AKTIF';
        const mQr = mQrIdx !== -1 ? mData[m][mQrIdx] : mId;

        if (!mId && !mNama) continue;

        // Cari di Users
        let matchedUserRow = -1;
        for (let u = 1; u < uData.length; u++) {
          const rowUid = String(uData[u][uIdIdx] || '').trim();
          const rowNama = String(uData[u][uNameIdx] || '').trim().toLowerCase();
          if ((mId && rowUid === mId) || (mUid && rowUid === mUid) || (mNama && rowNama === mNama.toLowerCase())) {
            matchedUserRow = u + 1; // 1-indexed row in sheet
            break;
          }
        }

        if (matchedUserRow !== -1) {
          // Update data di Users jika kosong
          if (uNisIdx !== -1 && mNis) uSheet.getRange(matchedUserRow, uNisIdx + 1).setValue(mNis);
          if (uKelasIdx !== -1 && mKelas) uSheet.getRange(matchedUserRow, uKelasIdx + 1).setValue(mKelas);
          if (uQrIdx !== -1 && mQr) uSheet.getRange(matchedUserRow, uQrIdx + 1).setValue(mQr);
          if (uTglIdx !== -1 && mTgl) uSheet.getRange(matchedUserRow, uTglIdx + 1).setValue(mTgl);
          if (mStatus === 'AKTIF' && uStatusIdx !== -1) {
            uSheet.getRange(matchedUserRow, uStatusIdx + 1).setValue('AKTIF');
          }
          updatedCount++;
          reportLogs.push(`Users: Synced data siswa ${mNama} (${mId})`);
        } else {
          // Buat record baru di Users jika siswa belum ada di Users
          const newUserId = mId || mUid || generateMemberId();
          const username = mId.toLowerCase().replace(/[^a-z0-9]/g, '');
          const placeholderPhoto = `https://ui-avatars.com/api/?name=${encodeURIComponent(mNama)}&background=10b981&color=fff&bold=true&format=png`;
          appendRow(CONFIG.SHEETS.USERS, [
            newUserId,
            username,
            hashPassword('siswa123'),
            CONFIG.ROLES.SISWA,
            mNama,
            mStatus || 'AKTIF',
            mTgl || new Date(),
            placeholderPhoto,
            mNis || '-',
            mKelas || '-',
            mQr || newUserId,
            mTgl || new Date()
          ]);
          insertedCount++;
          reportLogs.push(`Users: Inserted missing student ${mNama} (${newUserId})`);
        }
      }

      // 5. Hapus sheet fisik Members dari spreadsheet
      ss.deleteSheet(mSheet);
      delete cachedSheets[CONFIG.SHEETS.MEMBERS];
      delete cachedSheetData[CONFIG.SHEETS.MEMBERS];
      delete cachedSheetData[CONFIG.SHEETS.USERS];

      // 6. Catat Audit Log
      auditLog(
        session.userId,
        session.role,
        'MIGRATE_SINGLE_MASTER',
        'SYSTEM_CONSOLIDATION',
        `Migrasi Single Master selesai. Backup: ${backupSheetName}. Synced: ${updatedCount}, Inserted: ${insertedCount}. Sheet Members berhasil dihapus.`
      );

      return {
        success: true,
        message: `Migrasi ke Single Master Table Users sukses! Sheet Members telah di-backup ke ${backupSheetName} dan sheet Members asli telah dihapus.`,
        backupSheet: backupSheetName,
        syncedCount: updatedCount,
        insertedCount: insertedCount,
        logs: reportLogs
      };
    } catch (err) {
      if (err.message.includes("Unauthorized")) throw err;
      return { success: false, message: 'Gagal migrasi: ' + err.message };
    }
  });
}
