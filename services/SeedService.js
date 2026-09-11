// SeedService.gs
// Modul untuk Manajemen Bibit Tanaman, Pengajuan Konversi Bibit oleh Siswa, dan Approval Manager (PRD v2)

function getSeedList(token) {
  try {
    const session = verifyToken(token);
    if (!session) throw new Error('Unauthorized');
    
    const seeds = getSheetData(CONFIG.SHEETS.SEEDS).filter(s => s.status === 'AKTIF');
    return { success: true, data: seeds };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function addSeed(token, data) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.MANAGER]);
    const seedId = 'SEED-' + Date.now().toString().slice(-6);
    
    appendRow(CONFIG.SHEETS.SEEDS, [
      seedId, 
      data.name, 
      data.type || 'Buah/Pohon', 
      parseFloat(data.conversion_value) || 10000, 
      parseInt(data.stock, 10) || 0, 
      'AKTIF'
    ]);
    
    auditLog(session.userId, session.role, 'ADD_SEED', seedId, `Tambah bibit: ${data.name}`);
    return { success: true, message: 'Bibit tanaman berhasil ditambahkan', seedId: seedId };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function updateSeed(token, seedId, dataUpdate) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.MANAGER]);
    const sheet = getSheet(CONFIG.SHEETS.SEEDS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][headers.indexOf('seed_id')] === seedId) {
        if (dataUpdate.name !== undefined) sheet.getRange(i + 1, headers.indexOf('seed_name') + 1).setValue(dataUpdate.name);
        if (dataUpdate.type !== undefined) sheet.getRange(i + 1, headers.indexOf('seed_type') + 1).setValue(dataUpdate.type);
        if (dataUpdate.conversion_value !== undefined) sheet.getRange(i + 1, headers.indexOf('conversion_value') + 1).setValue(parseFloat(dataUpdate.conversion_value));
        if (dataUpdate.stock !== undefined) sheet.getRange(i + 1, headers.indexOf('stock') + 1).setValue(parseInt(dataUpdate.stock, 10));
        if (dataUpdate.status !== undefined) sheet.getRange(i + 1, headers.indexOf('status') + 1).setValue(dataUpdate.status);
        
        delete cachedSheetData[CONFIG.SHEETS.SEEDS];
        auditLog(session.userId, session.role, 'UPDATE_SEED', seedId, `Update bibit: ${dataUpdate.name || seedId}`);
        return { success: true, message: 'Data bibit berhasil diperbarui' };
      }
    }
    throw new Error('Bibit tidak ditemukan');
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function requestSeedConversion(token, seedId, quantity) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.SISWA]);
    const members = getSheetData(CONFIG.SHEETS.MEMBERS);
    const member = members.find(m => m.user_id === session.userId);
    
    if (!member || member.status !== CONFIG.MEMBER_STATUS.AKTIF) {
      throw new Error('Akun siswa belum aktif atau tidak ditemukan');
    }
    
    const qty = parseInt(quantity, 10);
    if (!qty || qty <= 0) throw new Error('Jumlah bibit harus lebih dari 0');
    
    const seeds = getSheetData(CONFIG.SHEETS.SEEDS);
    const seed = seeds.find(s => s.seed_id === seedId && s.status === 'AKTIF');
    if (!seed) throw new Error('Bibit tanaman tidak ditemukan atau tidak aktif');
    
    if (seed.stock !== undefined && seed.stock < qty) {
      throw new Error(`Stok bibit tidak mencukupi (sisa ${seed.stock})`);
    }

    const conversionValue = parseFloat(seed.conversion_value) || 10000;
    const totalValue = qty * conversionValue;
    
    // Validasi Saldo Hijau
    const balanceCheck = validateHijau(member.member_id, totalValue);
    if (!balanceCheck.valid) {
      throw new Error(balanceCheck.message);
    }

    const requestId = 'REQ-' + Date.now().toString().slice(-6);
    const now = new Date();
    
    // Simpan pengajuan (Status PENDING - Saldo Hijau BELUM berkurang sesuai PRD Poin 17)
    appendRow(CONFIG.SHEETS.SEED_REQUESTS, [
      requestId,
      member.member_id,
      seedId,
      qty,
      totalValue,
      CONFIG.SEED_REQUEST_STATUS.PENDING,
      now,
      '', // reviewed_by
      '', // reviewed_at
      ''  // reject_reason
    ]);

    auditLog(session.userId, session.role, 'AJUKAN_BIBIT', requestId, `Pengajuan ${qty} bibit ${seed.seed_name} senilai Rp${totalValue} (Saldo Hijau)`);
    
    return {
      success: true,
      message: `Pengajuan ${qty} bibit ${seed.seed_name} berhasil dikirim! Menunggu persetujuan Manager.`,
      requestId: requestId,
      totalValue: totalValue
    };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function getSeedRequests(token) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.MANAGER, CONFIG.ROLES.KASIR]);
    const requests = getSheetData(CONFIG.SHEETS.SEED_REQUESTS);
    const members = getSheetData(CONFIG.SHEETS.MEMBERS);
    const seeds = getSheetData(CONFIG.SHEETS.SEEDS);
    
    const populated = requests.map(req => {
      const m = members.find(mem => mem.member_id === req.member_id) || {};
      const s = seeds.find(sd => sd.seed_id === req.seed_id) || {};
      const currentHijau = calculateHijau(req.member_id);
      return {
        ...req,
        member_name: m.nama || req.member_id,
        member_kelas: m.kelas || '-',
        seed_name: s.seed_name || req.seed_id,
        seed_type: s.seed_type || 'Bibit Tanaman',
        current_saldo_hijau: currentHijau
      };
    }).sort((a, b) => {
      const tA = a.requested_at ? new Date(a.requested_at).getTime() : 0;
      const tB = b.requested_at ? new Date(b.requested_at).getTime() : 0;
      return (isNaN(tB) ? 0 : tB) - (isNaN(tA) ? 0 : tA);
    });

    return { success: true, data: populated };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function getSiswaSeedRequests(token) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.SISWA]);
    const members = getSheetData(CONFIG.SHEETS.MEMBERS);
    const member = members.find(m => m.user_id === session.userId);
    if (!member) throw new Error('Profil siswa tidak ditemukan');
    
    const requests = getSheetData(CONFIG.SHEETS.SEED_REQUESTS).filter(r => r.member_id === member.member_id);
    const seeds = getSheetData(CONFIG.SHEETS.SEEDS);
    
    const populated = requests.map(req => {
      const s = seeds.find(sd => sd.seed_id === req.seed_id) || {};
      return {
        ...req,
        seed_name: s.seed_name || req.seed_id,
        seed_type: s.seed_type || 'Bibit Tanaman'
      };
    }).sort((a, b) => {
      const tA = a.requested_at ? new Date(a.requested_at).getTime() : 0;
      const tB = b.requested_at ? new Date(b.requested_at).getTime() : 0;
      return (isNaN(tB) ? 0 : tB) - (isNaN(tA) ? 0 : tA);
    });

    return { success: true, data: populated };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function approveSeedRequest(token, requestId) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.MANAGER]);
    const sheet = getSheet(CONFIG.SHEETS.SEED_REQUESTS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const idIdx = headers.indexOf('request_id');
    const memberIdx = headers.indexOf('member_id');
    const seedIdx = headers.indexOf('seed_id');
    const qtyIdx = headers.indexOf('quantity');
    const totalValIdx = headers.indexOf('total_value');
    const statusIdx = headers.indexOf('status');
    const revByIdx = headers.indexOf('reviewed_by');
    const revAtIdx = headers.indexOf('reviewed_at');
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][idIdx] === requestId) {
        if (data[i][statusIdx] !== CONFIG.SEED_REQUEST_STATUS.PENDING) {
          throw new Error(`Pengajuan sudah berstatus ${data[i][statusIdx]}`);
        }
        
        const memberId = data[i][memberIdx];
        const seedId = data[i][seedIdx];
        const qty = data[i][qtyIdx];
        const totalValue = parseFloat(data[i][totalValIdx]);
        
        // Re-validasi Saldo Hijau
        const balanceCheck = validateHijau(memberId, totalValue);
        if (!balanceCheck.valid) {
          throw new Error(`Saldo Hijau siswa tidak cukup saat persetujuan! Tersedia: Rp${balanceCheck.balance.toLocaleString('id-ID')}`);
        }
        
        const seeds = getSheetData(CONFIG.SHEETS.SEEDS);
        const seed = seeds.find(s => s.seed_id === seedId);
        const seedName = seed ? seed.seed_name : seedId;
        
        // Potong Saldo Hijau siswa melalui transaksi SETUJUI_BIBIT (PRD Poin 18)
        const txId = generateTransactionId();
        const now = new Date();
        
        appendRow(CONFIG.SHEETS.TRANSACTIONS, [
          txId,
          now,
          memberId,
          CONFIG.TRANSACTION_TYPES.SETUJUI_BIBIT,
          CONFIG.WALLET_TYPES.HIJAU,
          0,          // credit
          totalValue, // debit
          totalValue, // amount
          session.userId,
          `Konversi Bibit: ${seedName} (${qty} bibit)`,
          'COMPLETED'
        ]);

        // Update status pengajuan jadi APPROVED
        sheet.getRange(i + 1, statusIdx + 1).setValue(CONFIG.SEED_REQUEST_STATUS.APPROVED);
        sheet.getRange(i + 1, revByIdx + 1).setValue(session.userId);
        sheet.getRange(i + 1, revAtIdx + 1).setValue(now);
        
        delete cachedSheetData[CONFIG.SHEETS.SEED_REQUESTS];
        
        auditLog(session.userId, session.role, 'APPROVE_BIBIT', requestId, `Persetujuan konversi ${qty} bibit senilai Rp${totalValue} untuk ${memberId}`);
        
        return { success: true, message: `Pengajuan bibit ${seedName} disetujui. Saldo Hijau siswa telah dipotong Rp${totalValue.toLocaleString('id-ID')}.` };
      }
    }
    throw new Error('Pengajuan tidak ditemukan');
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function rejectSeedRequest(token, requestId, reason) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.MANAGER]);
    const sheet = getSheet(CONFIG.SHEETS.SEED_REQUESTS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const idIdx = headers.indexOf('request_id');
    const memberIdx = headers.indexOf('member_id');
    const statusIdx = headers.indexOf('status');
    const revByIdx = headers.indexOf('reviewed_by');
    const revAtIdx = headers.indexOf('reviewed_at');
    const reasonIdx = headers.indexOf('reject_reason');
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][idIdx] === requestId) {
        if (data[i][statusIdx] !== CONFIG.SEED_REQUEST_STATUS.PENDING) {
          throw new Error(`Pengajuan sudah berstatus ${data[i][statusIdx]}`);
        }
        
        const memberId = data[i][memberIdx];
        const now = new Date();
        const rejectReason = reason || 'Pengajuan bibit ditolak oleh Manager';
        
        // Update status jadi REJECTED (Saldo Hijau TIDAK berubah sesuai PRD Poin 19)
        sheet.getRange(i + 1, statusIdx + 1).setValue(CONFIG.SEED_REQUEST_STATUS.REJECTED);
        sheet.getRange(i + 1, revByIdx + 1).setValue(session.userId);
        sheet.getRange(i + 1, revAtIdx + 1).setValue(now);
        sheet.getRange(i + 1, reasonIdx + 1).setValue(rejectReason);
        
        delete cachedSheetData[CONFIG.SHEETS.SEED_REQUESTS];
        
        auditLog(session.userId, session.role, 'REJECT_BIBIT', requestId, `Penolakan bibit untuk ${memberId}. Alasan: ${rejectReason}`);
        
        return { success: true, message: `Pengajuan bibit berhasil ditolak. Saldo Hijau siswa tetap utuh.` };
      }
    }
    throw new Error('Pengajuan tidak ditemukan');
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function fulfillSeedRequest(token, requestId) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.MANAGER, CONFIG.ROLES.KASIR]);
    const sheet = getSheet(CONFIG.SHEETS.SEED_REQUESTS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const idIdx = headers.indexOf('request_id');
    const seedIdx = headers.indexOf('seed_id');
    const qtyIdx = headers.indexOf('quantity');
    const statusIdx = headers.indexOf('status');
    const memberIdx = headers.indexOf('member_id');
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][idIdx] === requestId) {
        if (data[i][statusIdx] !== CONFIG.SEED_REQUEST_STATUS.APPROVED) {
          throw new Error('Hanya pengajuan dengan status APPROVED yang dapat direalisasikan (FULFILLED)');
        }
        
        const seedId = data[i][seedIdx];
        const qty = parseInt(data[i][qtyIdx], 10);
        const memberId = data[i][memberIdx];
        
        // Update request status to FULFILLED
        sheet.getRange(i + 1, statusIdx + 1).setValue(CONFIG.SEED_REQUEST_STATUS.FULFILLED);
        delete cachedSheetData[CONFIG.SHEETS.SEED_REQUESTS];
        
        // Kurangi stok bibit jika ada
        const seedSheet = getSheet(CONFIG.SHEETS.SEEDS);
        const seedData = seedSheet.getDataRange().getValues();
        const sHeaders = seedData[0];
        const sIdIdx = sHeaders.indexOf('seed_id');
        const sStockIdx = sHeaders.indexOf('stock');
        
        for (let j = 1; j < seedData.length; j++) {
          if (seedData[j][sIdIdx] === seedId) {
            const curStock = parseInt(seedData[j][sStockIdx], 10) || 0;
            const newStock = Math.max(0, curStock - qty);
            seedSheet.getRange(j + 1, sStockIdx + 1).setValue(newStock);
            break;
          }
        }
        delete cachedSheetData[CONFIG.SHEETS.SEEDS];
        
        auditLog(session.userId, session.role, 'FULFILL_BIBIT', requestId, `Realisasi bibit untuk ${memberId} (${qty} bibit)`);
        
        return { success: true, message: 'Bibit tanaman berhasil direalisasikan dan diserahkan ke siswa!' };
      }
    }
    throw new Error('Pengajuan tidak ditemukan');
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function getSeedTarget() {
  try {
    const props = PropertiesService.getScriptProperties();
    const val = props.getProperty('SCHOOL_SEED_TARGET');
    if (val && !isNaN(parseInt(val, 10)) && parseInt(val, 10) > 0) {
      return parseInt(val, 10);
    }
  } catch (e) {
    console.warn('PropertiesService error in getSeedTarget:', e);
  }
  return 500;
}

function updateSeedTarget(token, newTarget) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.MANAGER]);
    const target = parseInt(newTarget, 10);
    if (isNaN(target) || target <= 0) {
      throw new Error('Target harus berupa angka positif lebih dari 0.');
    }
    
    try {
      const props = PropertiesService.getScriptProperties();
      props.setProperty('SCHOOL_SEED_TARGET', String(target));
    } catch (e) {
      console.error('Failed to save target to PropertiesService:', e);
      throw new Error('Gagal menyimpan target ke sistem: ' + e.message);
    }

    auditLog(session.userId, session.role, 'UPDATE_SEED_TARGET', 'TARGET-SEKOLAH', `Mengubah target bibit sekolah menjadi ${target} bibit`);

    return {
      success: true,
      message: `Target penanaman sekolah berhasil diperbarui menjadi ${target} bibit.`,
      targetBibit: target
    };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error;
    return { success: false, message: error.message };
  }
}

function getSeedDashboard(token) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.MANAGER, CONFIG.ROLES.KASIR]);
    const requests = getSheetData(CONFIG.SHEETS.SEED_REQUESTS);
    
    const diajukan = requests.reduce((sum, r) => sum + (parseInt(r.quantity, 10) || 0), 0);
    const disetujui = requests.filter(r => r.status === CONFIG.SEED_REQUEST_STATUS.APPROVED || r.status === CONFIG.SEED_REQUEST_STATUS.FULFILLED)
      .reduce((sum, r) => sum + (parseInt(r.quantity, 10) || 0), 0);
    const realisasi = requests.filter(r => r.status === CONFIG.SEED_REQUEST_STATUS.FULFILLED)
      .reduce((sum, r) => sum + (parseInt(r.quantity, 10) || 0), 0);
    const belumRealisasi = requests.filter(r => r.status === CONFIG.SEED_REQUEST_STATUS.APPROVED)
      .reduce((sum, r) => sum + (parseInt(r.quantity, 10) || 0), 0);
    const pendingCount = requests.filter(r => r.status === CONFIG.SEED_REQUEST_STATUS.PENDING).length;

    return {
      success: true,
      data: {
        totalDiajukan: diajukan,
        totalDisetujui: disetujui,
        totalRealisasi: realisasi,
        belumRealisasi: belumRealisasi,
        pendingCount: pendingCount,
        targetBibit: getSeedTarget()
      }
    };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}
