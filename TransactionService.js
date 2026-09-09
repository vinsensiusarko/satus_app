// TransactionService.gs

function ensureVoidRequestsSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEETS.VOID_REQUESTS);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEETS.VOID_REQUESTS);
    const headers = ['void_id','transaction_id','member_id','wallet_type','amount','reason','cashier_id','status','requested_at','reviewed_by','reviewed_at','reject_reason'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#e0e0e0');
    sheet.setFrozenRows(1);
    try { sheet.autoResizeColumns(1, headers.length); } catch(e) {}
  }
}

function createSetorTunai(token, memberId, amount) {
  return withScriptLock(function() {
    try {
      const session = requireRole(token, [CONFIG.ROLES.KASIR]);
      const member = getMemberById(memberId);
      
      if (!member || member.status !== CONFIG.MEMBER_STATUS.AKTIF) {
        throw new Error('Anggota tidak aktif atau tidak ditemukan');
      }
      if (amount <= 0) throw new Error('Nominal harus lebih dari 0');

      const txId = generateTransactionId();
      const now = new Date();

      appendRow(CONFIG.SHEETS.TRANSACTIONS, [
        txId, now, memberId, CONFIG.TRANSACTION_TYPES.SETOR_TUNAI, CONFIG.WALLET_TYPES.TABUNGAN,
        amount, 0, amount, session.userId,
        'Setor tunai', 'COMPLETED'
      ]);

      auditLog(session.userId, session.role, 'CREATE_TRANSACTION', txId, 'Setor tunai Rp' + amount + ' untuk ' + memberId + ' (Saldo Tabungan)');
      
      const dualBalance = calculateDualBalance(memberId);
      return { 
        success: true, 
        message: 'Setor tunai berhasil', 
        transactionId: txId, 
        newBalance: dualBalance.tabungan,
        dualBalance: dualBalance 
      };
    } catch (error) {
      if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
    }
  });
}

function createSetorSampah(token, memberId, wasteType, quantity) {
  return withScriptLock(function() {
    try {
      const session = requireRole(token, [CONFIG.ROLES.KASIR]);
      const member = getMemberById(memberId);
      
      if (!member || member.status !== CONFIG.MEMBER_STATUS.AKTIF) {
        throw new Error('Anggota tidak aktif atau tidak ditemukan');
      }
      if (quantity <= 0) throw new Error('Berat/volume harus lebih dari 0');
      
      const wTypeUpper = wasteType.toUpperCase();
      if (wTypeUpper !== 'PLASTIK' && wTypeUpper !== 'JELANTAH') {
        throw new Error('Jenis sampah tidak valid');
      }

      const priceObj = getCurrentWastePrice(wasteType);
      if (!priceObj) throw new Error('Harga sampah belum diatur untuk tipe ini');

      const totalValue = quantity * parseFloat(priceObj.price);
      const txId = generateTransactionId();
      const wasteId = 'WST-' + txId.split('-').slice(1).join('-');
      const now = new Date();

      const txType = wasteType.toUpperCase() === 'PLASTIK' 
        ? CONFIG.TRANSACTION_TYPES.SETOR_PLASTIK 
        : CONFIG.TRANSACTION_TYPES.SETOR_JELANTAH;

      // Transaksi Utama (Masuk ke SALDO HIJAU)
      appendRow(CONFIG.SHEETS.TRANSACTIONS, [
        txId, now, memberId, txType, CONFIG.WALLET_TYPES.HIJAU,
        totalValue, 0, totalValue, session.userId,
        'Setor ' + wasteType + ' ' + quantity + ' ' + priceObj.unit, 'COMPLETED'
      ]);

      // Detail Waste
      appendRow(CONFIG.SHEETS.WASTE_TRANSACTIONS, [
        wasteId, txId, memberId, wasteType, quantity, priceObj.unit, 
        priceObj.price, totalValue, session.userId, now
      ]);

      auditLog(session.userId, session.role, 'CREATE_TRANSACTION', txId, 'Setor ' + wasteType + ' ' + quantity + priceObj.unit + ' untuk ' + memberId + ' (Saldo Hijau)');
      
      const dualBalance = calculateDualBalance(memberId);
      return { 
        success: true, 
        message: 'Setor ' + wasteType + ' berhasil', 
        transactionId: txId, 
        newBalance: dualBalance.hijau,
        dualBalance: dualBalance 
      };
    } catch (error) {
      if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
    }
  });
}

function createTarikTunai(token, memberId, amount) {
  return withScriptLock(function() {
    try {
      const session = requireRole(token, [CONFIG.ROLES.KASIR]);
      const member = getMemberById(memberId);
      
      if (!member || member.status !== CONFIG.MEMBER_STATUS.AKTIF) throw new Error('Anggota tidak aktif');
      if (amount <= 0) throw new Error('Nominal harus lebih dari 0');

      // Tarik Tunai HANYA dari Saldo Tabungan
      const balanceCheck = validateTabungan(memberId, amount);
      if (!balanceCheck.valid) throw new Error(balanceCheck.message);

      const txId = generateTransactionId();
      const now = new Date();

      appendRow(CONFIG.SHEETS.TRANSACTIONS, [
        txId, now, memberId, CONFIG.TRANSACTION_TYPES.TARIK_TUNAI, CONFIG.WALLET_TYPES.TABUNGAN,
        0, amount, amount, session.userId,
        'Tarik tunai', 'COMPLETED'
      ]);

      auditLog(session.userId, session.role, 'CREATE_TRANSACTION', txId, 'Tarik tunai Rp' + amount + ' dari ' + memberId + ' (Saldo Tabungan)');
      
      const dualBalance = calculateDualBalance(memberId);
      return { 
        success: true, 
        message: 'Tarik tunai berhasil', 
        transactionId: txId, 
        newBalance: dualBalance.tabungan,
        dualBalance: dualBalance 
      };
    } catch (error) {
      if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
    }
  });
}

function getMemberTransactions(token, memberId) {
  try {
    const session = verifyToken(token);
    if (!session) throw new Error('Unauthorized');
    
    const transactions = getSheetData(CONFIG.SHEETS.TRANSACTIONS)
      .filter(t => t.member_id === memberId)
      .map(t => {
        if (!t.wallet_type) {
          t.wallet_type = isTabunganTx(t) ? CONFIG.WALLET_TYPES.TABUNGAN : CONFIG.WALLET_TYPES.HIJAU;
        }
        return t;
      })
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
    return { success: true, data: transactions };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function getMemberRecentTransactions(token, memberId, limit) {
  try {
    requireRole(token, [CONFIG.ROLES.MANAGER, CONFIG.ROLES.KASIR]);
    ensureVoidRequestsSheet();
    
    const transactions = getSheetData(CONFIG.SHEETS.TRANSACTIONS)
      .filter(t => t.member_id === memberId)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit || 5);
      
    const voidRequests = getSheetData(CONFIG.SHEETS.VOID_REQUESTS);
    
    const enhanced = transactions.map(t => {
      const vReq = voidRequests.find(v => v.transaction_id === t.transaction_id && v.status === CONFIG.VOID_STATUS.PENDING);
      t.has_pending_void = !!vReq;
      if (!t.wallet_type) {
        t.wallet_type = isTabunganTx(t) ? CONFIG.WALLET_TYPES.TABUNGAN : CONFIG.WALLET_TYPES.HIJAU;
      }
      return t;
    });
    
    return { success: true, data: enhanced };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function requestVoidTransaction(token, transactionId, reason) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.KASIR, CONFIG.ROLES.MANAGER]);
    ensureVoidRequestsSheet();
    
    if (!reason || reason.trim().length < 3) {
      throw new Error('Alasan pembatalan harus diisi minimal 3 karakter');
    }

    const transactions = getSheetData(CONFIG.SHEETS.TRANSACTIONS);
    const tx = transactions.find(t => t.transaction_id === transactionId);
    if (!tx) throw new Error('Transaksi tidak ditemukan');
    if (tx.status !== 'COMPLETED') throw new Error('Hanya transaksi COMPLETED yang dapat diajukan pembatalan');

    const voidRequests = getSheetData(CONFIG.SHEETS.VOID_REQUESTS);
    const existing = voidRequests.find(v => v.transaction_id === transactionId && v.status === CONFIG.VOID_STATUS.PENDING);
    if (existing) throw new Error('Transaksi ini sudah diajukan pembatalan dan menunggu persetujuan Manager');

    const voidId = 'VOID-' + Date.now().toString().slice(-6);
    const now = new Date();

    appendRow(CONFIG.SHEETS.VOID_REQUESTS, [
      voidId, transactionId, tx.member_id, tx.wallet_type || 'TABUNGAN', tx.amount || 0,
      reason, session.userId, CONFIG.VOID_STATUS.PENDING, now, '', '', ''
    ]);

    auditLog(session.userId, session.role, 'REQUEST_VOID', voidId, 'Pengajuan pembatalan transaksi ' + transactionId + ': ' + reason);
    return { success: true, message: 'Pengajuan pembatalan transaksi berhasil dikirim ke Manager' };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function getVoidRequests(token) {
  try {
    requireRole(token, [CONFIG.ROLES.MANAGER, CONFIG.ROLES.KASIR]);
    ensureVoidRequestsSheet();
    
    const voidRequests = getSheetData(CONFIG.SHEETS.VOID_REQUESTS);
    const members = getSheetData(CONFIG.SHEETS.MEMBERS);
    const transactions = getSheetData(CONFIG.SHEETS.TRANSACTIONS);

    const enriched = voidRequests.map(v => {
      const m = members.find(x => x.member_id === v.member_id);
      const tx = transactions.find(t => t.transaction_id === v.transaction_id);
      return {
        ...v,
        member_name: m ? m.nama : v.member_id,
        member_kelas: m ? m.kelas : '-',
        tx_type: tx ? tx.type : '-',
        tx_desc: tx ? tx.description : '-'
      };
    }).sort((a, b) => new Date(b.requested_at) - new Date(a.requested_at));

    return { success: true, data: enriched };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function reviewVoidRequest(token, voidId, action, rejectReason) {
  return withScriptLock(function() {
    try {
      const session = requireRole(token, [CONFIG.ROLES.MANAGER]);
      ensureVoidRequestsSheet();
      
      const vSheet = getSheet(CONFIG.SHEETS.VOID_REQUESTS);
      const vData = vSheet.getDataRange().getValues();
      const vHeaders = vData[0];
      const vIdIdx = vHeaders.indexOf('void_id');
      const vStatusIdx = vHeaders.indexOf('status');
      const vReviewBy = vHeaders.indexOf('reviewed_by');
      const vReviewAt = vHeaders.indexOf('reviewed_at');
      const vRejectReason = vHeaders.indexOf('reject_reason');
      const vTxIdIdx = vHeaders.indexOf('transaction_id');
      const vMemberIdIdx = vHeaders.indexOf('member_id');

      let voidRow = -1;
      let targetTxId = '';
      let targetMemberId = '';

      for (let i = 1; i < vData.length; i++) {
        if (vData[i][vIdIdx] === voidId) {
          if (vData[i][vStatusIdx] !== CONFIG.VOID_STATUS.PENDING) {
            throw new Error('Pengajuan pembatalan ini sudah pernah diproses');
          }
          voidRow = i;
          targetTxId = vData[i][vTxIdIdx];
          targetMemberId = vData[i][vMemberIdIdx];
          break;
        }
      }

      if (voidRow === -1) throw new Error('Pengajuan pembatalan tidak ditemukan');

      const now = new Date();

      if (action === CONFIG.VOID_STATUS.APPROVED) {
        // 1. Update Void Status
        vSheet.getRange(voidRow + 1, vStatusIdx + 1).setValue(CONFIG.VOID_STATUS.APPROVED);
        vSheet.getRange(voidRow + 1, vReviewBy + 1).setValue(session.userId);
        vSheet.getRange(voidRow + 1, vReviewAt + 1).setValue(now);

        // 2. Update Transaction Status in Transactions Sheet to CANCELLED
        const txSheet = getSheet(CONFIG.SHEETS.TRANSACTIONS);
        const txData = txSheet.getDataRange().getValues();
        const txHeaders = txData[0];
        const txIdIdx = txHeaders.indexOf('transaction_id');
        const txStatusIdx = txHeaders.indexOf('status');
        const txTypeIdx = txHeaders.indexOf('type');
        const txDescIdx = txHeaders.indexOf('description');

        let txType = '';
        let txDesc = '';

        for (let j = 1; j < txData.length; j++) {
          if (txData[j][txIdIdx] === targetTxId) {
            txSheet.getRange(j + 1, txStatusIdx + 1).setValue('CANCELLED');
            txType = txData[j][txTypeIdx];
            txDesc = txData[j][txDescIdx];
            break;
          }
        }

        delete cachedSheetData[CONFIG.SHEETS.TRANSACTIONS];
        delete cachedSheetData[CONFIG.SHEETS.VOID_REQUESTS];

        // 3. Return Product Stock if it was Belanja/Tukar ATK
        if (txType === CONFIG.TRANSACTION_TYPES.BELANJA_TABUNGAN || txType === CONFIG.TRANSACTION_TYPES.TUKAR_HIJAU_ATK) {
          try {
            const prodSheet = getSheet(CONFIG.SHEETS.PRODUCTS);
            const pData = prodSheet.getDataRange().getValues();
            const pHeaders = pData[0];
            const pNameIdx = pHeaders.indexOf('product_name');
            const pStockIdx = pHeaders.indexOf('stock');

            // txDesc example: "Belanja Koperasi: Pensil 2B (2x), Buku Tulis (1x)"
            const itemsPart = txDesc.includes(':') ? txDesc.split(':')[1] : txDesc;
            const itemSplits = itemsPart.split(',');
            for (let itemStr of itemSplits) {
              const match = itemStr.match(/(.+)\((\d+)x\)/);
              if (match) {
                const pName = match[1].trim();
                const qty = parseInt(match[2], 10);
                for (let k = 1; k < pData.length; k++) {
                  if (pData[k][pNameIdx] === pName) {
                    const currStock = parseInt(pData[k][pStockIdx], 10) || 0;
                    prodSheet.getRange(k + 1, pStockIdx + 1).setValue(currStock + qty);
                    break;
                  }
                }
              }
            }
            delete cachedSheetData[CONFIG.SHEETS.PRODUCTS];
          } catch(err) {
            Logger.log('Error returning product stock on void: ' + err.message);
          }
        }

        auditLog(session.userId, session.role, 'APPROVE_VOID', voidId, 'Manager menyetujui pembatalan transaksi ' + targetTxId + ' (Member: ' + targetMemberId + ')');
        
        const dualBalance = calculateDualBalance(targetMemberId);
        return { 
          success: true, 
          message: 'Pembatalan transaksi berhasil disetujui! Saldo anggota telah disesuaikan kembali.',
          dualBalance: dualBalance
        };

      } else if (action === CONFIG.VOID_STATUS.REJECTED) {
        vSheet.getRange(voidRow + 1, vStatusIdx + 1).setValue(CONFIG.VOID_STATUS.REJECTED);
        vSheet.getRange(voidRow + 1, vReviewBy + 1).setValue(session.userId);
        vSheet.getRange(voidRow + 1, vReviewAt + 1).setValue(now);
        vSheet.getRange(voidRow + 1, vRejectReason + 1).setValue(rejectReason || 'Ditolak oleh Manager');

        delete cachedSheetData[CONFIG.SHEETS.VOID_REQUESTS];

        auditLog(session.userId, session.role, 'REJECT_VOID', voidId, 'Manager menolak pembatalan transaksi ' + targetTxId + ': ' + (rejectReason || '-'));
        return { success: true, message: 'Pengajuan pembatalan transaksi telah ditolak' };
      } else {
        throw new Error('Aksi tidak valid');
      }
    } catch (error) {
      if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
    }
  });
}

function getTransactionDetail(token, txId) {
  try {
    requireRole(token, [CONFIG.ROLES.MANAGER, CONFIG.ROLES.KASIR, CONFIG.ROLES.SISWA]);
    const transactions = getSheetData(CONFIG.SHEETS.TRANSACTIONS);
    const tx = transactions.find(t => t.transaction_id === txId);
    if (!tx) return { success: false, message: 'Transaksi tidak ditemukan' };

    const members = getSheetData(CONFIG.SHEETS.MEMBERS);
    const member = members.find(m => m.member_id === tx.member_id);
    if (member) {
      tx.member_name = member.nama;
    }
    if (!tx.wallet_type) {
      tx.wallet_type = isTabunganTx(tx) ? CONFIG.WALLET_TYPES.TABUNGAN : CONFIG.WALLET_TYPES.HIJAU;
    }
    return { success: true, data: tx };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error;
    return { success: false, message: error.message };
  }
}
