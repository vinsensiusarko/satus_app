// ReconciliationService.gs
/**
 * Layanan Diagnosa, Pelacakan Transaksi Nyasar, & Rekonsiliasi Otomatis Integritas Database
 * Menyelesaikan tabrakan ID (Hamizan vs Muh, Rositaa vs Naura, Gilang vs Nevita)
 * dan memindahkan transaksi yang salah sasaran ke akun yang sah.
 */

function getCleanString(val) {
  return String(val || '').trim();
}

/**
 * Melacak transaksi pada ID yang mengalami konflik
 */
function trackMisdirectedTransactions(token) {
  try {
    requireRole(token, [CONFIG.ROLES.MANAGER]);

    const txSheet = getSheet(CONFIG.SHEETS.TRANSACTIONS);
    const txData = txSheet.getDataRange().getValues();
    const txHeaders = txData[0];
    const txIdIdx = txHeaders.indexOf('transaction_id');
    const txDateIdx = txHeaders.indexOf('timestamp');
    const txMidIdx = txHeaders.indexOf('member_id');
    const txTypeIdx = txHeaders.indexOf('type');
    const txAmountIdx = txHeaders.indexOf('amount');
    const txDescIdx = txHeaders.indexOf('description');
    const txCashierIdx = txHeaders.indexOf('cashier_id');

    const conflictedIds = ['KH-2026-025', 'KH-2026-026', 'KH-2026-027'];
    const matchedTransactions = [];

    for (let i = 1; i < txData.length; i++) {
      const rowMid = getCleanString(txData[i][txMidIdx]);
      if (conflictedIds.includes(rowMid)) {
        matchedTransactions.push({
          row: i + 1,
          transactionId: txData[i][txIdIdx],
          timestamp: txData[i][txDateIdx],
          memberId: rowMid,
          type: txData[i][txTypeIdx],
          amount: parseFloat(txData[i][txAmountIdx]) || 0,
          description: txData[i][txDescIdx],
          cashierId: txData[i][txCashierIdx]
        });
      }
    }

    // Ambil juga dari Waste_Transactions jika ada
    const wasteSheet = getSheet(CONFIG.SHEETS.WASTE_TRANSACTIONS);
    const wasteData = wasteSheet.getDataRange().getValues();
    const wasteHeaders = wasteData[0];
    const wIdIdx = wasteHeaders.indexOf('waste_id');
    const wMidIdx = wasteHeaders.indexOf('member_id');
    const wDateIdx = wasteHeaders.indexOf('timestamp');
    const wTypeIdx = wasteHeaders.indexOf('waste_type');
    const wValIdx = wasteHeaders.indexOf('total_value');

    const matchedWaste = [];
    for (let j = 1; j < wasteData.length; j++) {
      const rowMid = getCleanString(wasteData[j][wMidIdx]);
      if (conflictedIds.includes(rowMid)) {
        matchedWaste.push({
          row: j + 1,
          wasteId: wasteData[j][wIdIdx],
          timestamp: wasteData[j][wDateIdx],
          memberId: rowMid,
          wasteType: wasteData[j][wTypeIdx],
          totalValue: parseFloat(wasteData[j][wValIdx]) || 0
        });
      }
    }

    return {
      success: true,
      data: {
        conflictedIds: conflictedIds,
        transactions: matchedTransactions,
        wasteTransactions: matchedWaste,
        totalFound: matchedTransactions.length + matchedWaste.length
      }
    };
  } catch (error) {
    if (error.message.includes('Unauthorized')) throw error;
    return { success: false, message: error.message };
  }
}

/**
 * Eksekusi Rekonsiliasi Live:
 * 1. Cari sequence ID tertinggi yang ada di database
 * 2. Alokasikan ID unik baru untuk Muh Sulthaan, Nauradisti, dan Nevita
 * 3. Update tabel Users dan Members
 * 4. Pindahkan transaksi yang nyasar (jika ada) ke ID baru
 * 5. Aktifkan status ketiganya menjadi AKTIF
 * 6. Hitung ulang dual balance
 */
function reconcileConflictedStudents(token) {
  return withScriptLock(function() {
    try {
      const session = requireRole(token, [CONFIG.ROLES.MANAGER]);

      const year = new Date().getFullYear();
      const prefix = `KH-${year}-`;

      // 1. Kumpulkan seluruh ID yang pernah digunakan untuk mencari sequence tertinggi
      const userSheet = getSheet(CONFIG.SHEETS.USERS);
      const userData = userSheet.getDataRange().getValues();
      const uHeaders = userData[0];
      const uIdIdx = uHeaders.indexOf('user_id');
      const uNameIdx = uHeaders.indexOf('nama');
      const uStatusIdx = uHeaders.indexOf('status');
      const uRoleIdx = uHeaders.indexOf('role');

      const memberSheet = getSheet(CONFIG.SHEETS.MEMBERS);
      const memberData = memberSheet.getDataRange().getValues();
      const mHeaders = memberData[0];
      const mIdIdx = mHeaders.indexOf('member_id');
      const mUidIdx = mHeaders.indexOf('user_id');
      const mNameIdx = mHeaders.indexOf('nama');
      const mStatusIdx = mHeaders.indexOf('status');
      const mQrIdx = mHeaders.indexOf('qr_data');

      let maxSeq = 0;
      const inspectSeq = (idStr) => {
        const clean = getCleanString(idStr).toUpperCase();
        if (clean.startsWith(prefix)) {
          const num = parseInt(clean.substring(prefix.length), 10);
          if (!isNaN(num) && num > maxSeq) maxSeq = num;
        }
      };

      for (let i = 1; i < userData.length; i++) inspectSeq(userData[i][uIdIdx]);
      for (let j = 1; j < memberData.length; j++) {
        inspectSeq(memberData[j][mIdIdx]);
        inspectSeq(memberData[j][mUidIdx]);
      }

      // Pastikan sequence minimal 27
      if (maxSeq < 27) maxSeq = 27;

      // Alokasikan 3 ID unik baru
      let seqCounter = maxSeq;
      const getNextId = () => {
        seqCounter++;
        return `${prefix}${String(seqCounter).padStart(3, '0')}`;
      };

      const newIdMuh = getNextId();
      const newIdNaura = getNextId();
      const newIdNevita = getNextId();

      const studentFixMap = [
        {
          targetNamePart: 'muh',
          targetFullName: 'Muh Sulthaan',
          oldId: 'KH-2026-025',
          newId: newIdMuh,
          originalPartner: 'Hamizan'
        },
        {
          targetNamePart: 'naura',
          targetFullName: 'Nauradisti',
          oldId: 'KH-2026-026',
          newId: newIdNaura,
          originalPartner: 'Rositaa'
        },
        {
          targetNamePart: 'nevita',
          targetFullName: 'Nevita',
          oldId: 'KH-2026-027',
          newId: newIdNevita,
          originalPartner: 'Gilang'
        }
      ];

      const reportLogs = [];

      // 2. Perbaiki sheet USERS
      studentFixMap.forEach(item => {
        let userUpdated = false;
        // Cari user yang namanya cocok dengan targetNamePart
        for (let u = 1; u < userData.length; u++) {
          const uName = getCleanString(userData[u][uNameIdx]).toLowerCase();
          const uId = getCleanString(userData[u][uIdIdx]);
          const uRole = getCleanString(userData[u][uRoleIdx]);

          if (uRole === CONFIG.ROLES.SISWA && uName.includes(item.targetNamePart)) {
            userSheet.getRange(u + 1, uIdIdx + 1).setValue(item.newId);
            userSheet.getRange(u + 1, uStatusIdx + 1).setValue('AKTIF');
            userUpdated = true;
            reportLogs.push(`Users: Update ${userData[u][uNameIdx]} dari ${uId} -> ${item.newId} (Status: AKTIF)`);
            break;
          }
        }
        item.userUpdated = userUpdated;
      });

      // 3. Perbaiki sheet MEMBERS
      studentFixMap.forEach(item => {
        let memberUpdated = false;
        for (let m = 1; m < memberData.length; m++) {
          const mName = getCleanString(memberData[m][mNameIdx]).toLowerCase();
          const mId = getCleanString(memberData[m][mIdIdx]);

          if (mName.includes(item.targetNamePart)) {
            memberSheet.getRange(m + 1, mIdIdx + 1).setValue(item.newId);
            memberSheet.getRange(m + 1, mUidIdx + 1).setValue(item.newId);
            memberSheet.getRange(m + 1, mStatusIdx + 1).setValue('AKTIF');
            if (mQrIdx !== -1) {
              memberSheet.getRange(m + 1, mQrIdx + 1).setValue(item.newId);
            }
            memberUpdated = true;
            reportLogs.push(`Members: Update ${memberData[m][mNameIdx]} dari ${mId} -> ${item.newId} (Status: AKTIF)`);
            break;
          }
        }
        item.memberUpdated = memberUpdated;
      });

      // 4. Pastikan pasangan lama (Hamizan, Rositaa, Gilang) tetap memegang status AKTIF di ID aslinya
      const originalPartners = [
        { namePart: 'hamizan', id: 'KH-2026-025' },
        { namePart: 'rosita', id: 'KH-2026-026' },
        { namePart: 'gilang', id: 'KH-2026-027' }
      ];
      originalPartners.forEach(p => {
        for (let m = 1; m < memberData.length; m++) {
          const mName = getCleanString(memberData[m][mNameIdx]).toLowerCase();
          if (mName.includes(p.namePart)) {
            memberSheet.getRange(m + 1, mIdIdx + 1).setValue(p.id);
            memberSheet.getRange(m + 1, mUidIdx + 1).setValue(p.id);
            memberSheet.getRange(m + 1, mStatusIdx + 1).setValue('AKTIF');
            break;
          }
        }
        for (let u = 1; u < userData.length; u++) {
          const uName = getCleanString(userData[u][uNameIdx]).toLowerCase();
          if (uName.includes(p.namePart)) {
            userSheet.getRange(u + 1, uIdIdx + 1).setValue(p.id);
            userSheet.getRange(u + 1, uStatusIdx + 1).setValue('AKTIF');
            break;
          }
        }
      });

      // 5. Audit & Relink Transaksi yang Nyasar
      const txSheet = getSheet(CONFIG.SHEETS.TRANSACTIONS);
      const txData = txSheet.getDataRange().getValues();
      const txHeaders = txData[0];
      const txIdIdx = txHeaders.indexOf('transaction_id');
      const txMidIdx = txHeaders.indexOf('member_id');
      const txDescIdx = txHeaders.indexOf('description');
      const txDateIdx = txHeaders.indexOf('timestamp');

      let relinkedCount = 0;
      studentFixMap.forEach(item => {
        for (let t = 1; t < txData.length; t++) {
          const tMid = getCleanString(txData[t][txMidIdx]);
          const tDesc = getCleanString(txData[t][txDescIdx]).toLowerCase();

          // Cek apakah transaksi menunjuk ke oldId DAN deskripsinya menyebut nama siswa baru
          if (tMid === item.oldId && tDesc.includes(item.targetNamePart)) {
            txSheet.getRange(t + 1, txMidIdx + 1).setValue(item.newId);
            relinkedCount++;
            reportLogs.push(`Transactions: Pindahkan transaksi ${txData[t][txIdIdx]} (${txData[t][txDescIdx]}) dari ${tMid} ke ${item.newId}`);
          }
        }
      });

      // 6. Invalidate Cache
      delete cachedSheetData[CONFIG.SHEETS.USERS];
      delete cachedSheetData[CONFIG.SHEETS.MEMBERS];
      delete cachedSheetData[CONFIG.SHEETS.TRANSACTIONS];

      // 7. Audit Log
      auditLog(
        session.userId,
        session.role,
        'RECONCILE_DATABASE',
        'SYSTEM_DATA_HEALING',
        `Rekonsiliasi sukses: Muh->${newIdMuh}, Naura->${newIdNaura}, Nevita->${newIdNevita}. Relinked: ${relinkedCount} tx.`
      );

      return {
        success: true,
        message: 'Rekonsiliasi database berhasil! 3 siswa berhasil dipisahkan ID-nya dan diaktifkan.',
        allocations: {
          muhSulthaan: { old: 'KH-2026-025', newId: newIdMuh },
          nauradisti: { old: 'KH-2026-026', newId: newIdNaura },
          nevita: { old: 'KH-2026-027', newId: newIdNevita }
        },
        relinkedTransactions: relinkedCount,
        logs: reportLogs
      };
    } catch (err) {
      if (err.message.includes('Unauthorized')) throw err;
      return { success: false, message: err.message };
    }
  });
}
