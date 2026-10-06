// MemberService.gs

function registerMember(token, data) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.MANAGER, CONFIG.ROLES.KASIR]);
    
    // Check username availability
    if (typeof isDevUsername === 'function' && isDevUsername(data.username)) {
      throw new Error('Username ini dicadangkan untuk testing dev');
    }
    const users = getSheetData(CONFIG.SHEETS.USERS);
    if (users.find(u => u.username === data.username)) {
      throw new Error('Username sudah digunakan');
    }

    const memberId = generateMemberId();
    const qrData = memberId; 
    const userId = memberId; // 1 ID untuk 1 Siswa
    const hash = hashPassword(data.password);
    
    // Status awal siswa baru selalu MENUNGGU
    const initialStatus = CONFIG.MEMBER_STATUS.MENUNGGU;
    const now = new Date();

    ensureUserStudentColumns();
    const placeholderPhoto = `https://ui-avatars.com/api/?name=${encodeURIComponent(data.nama)}&background=10b981&color=fff&bold=true&format=png`;

    // 1. Simpan ke Single Master Table USERS
    appendRow(CONFIG.SHEETS.USERS, [
      userId, 
      data.username, 
      hash, 
      CONFIG.ROLES.SISWA, 
      data.nama, 
      initialStatus, 
      now, 
      placeholderPhoto,
      data.nis || '',
      data.kelas || '',
      qrData,
      now
    ]);

    // 2. Transisi: Jika sheet Members fisik masih ada di spreadsheet, sync baris untuk backup
    try {
      const ss = getSpreadsheet();
      const mSheet = ss.getSheetByName(CONFIG.SHEETS.MEMBERS);
      if (mSheet) {
        mSheet.appendRow([memberId, userId, data.nama, data.nis || '', data.kelas || '', now, initialStatus, qrData]);
        delete cachedSheetData[CONFIG.SHEETS.MEMBERS];
      }
    } catch (e) {}

    auditLog(session.userId, session.role, 'REGISTER_MEMBER', memberId, `Register member: ${data.nama}`);
    return { success: true, message: 'Pendaftaran berhasil, akun berstatus MENUNGGU persetujuan Manager.', memberId: memberId };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function updateMember(token, memberId, dataUpdate) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.MANAGER]);
    ensureUserStudentColumns();

    const userSheet = getSheet(CONFIG.SHEETS.USERS);
    const userData = userSheet.getDataRange().getValues();
    const headers = userData[0];
    
    const uIdIdx = headers.indexOf('user_id');
    const uNameIdx = headers.indexOf('username');
    const namaIdx = headers.indexOf('nama');
    const nisIdx = headers.indexOf('nis');
    const kelasIdx = headers.indexOf('kelas');
    const pwdIdx = headers.indexOf('password_hash');
    const statusIdx = headers.indexOf('status');

    // Find student in Users
    let userRow = -1;
    for (let i = 1; i < userData.length; i++) {
      if (userData[i][uIdIdx] === memberId) {
        userRow = i;
        break;
      }
    }
    if (userRow === -1) throw new Error('Member tidak ditemukan');

    // Check unique username if updated
    if (dataUpdate.username) {
      const existing = userData.find((row, idx) => idx > 0 && idx !== userRow && row[uNameIdx] === dataUpdate.username);
      if (existing) throw new Error('Username sudah digunakan');
      if (uNameIdx !== -1) userSheet.getRange(userRow + 1, uNameIdx + 1).setValue(dataUpdate.username);
    }

    if (dataUpdate.nama && namaIdx !== -1) userSheet.getRange(userRow + 1, namaIdx + 1).setValue(dataUpdate.nama);
    if (dataUpdate.nis && nisIdx !== -1) userSheet.getRange(userRow + 1, nisIdx + 1).setValue(dataUpdate.nis);
    if (dataUpdate.kelas && kelasIdx !== -1) userSheet.getRange(userRow + 1, kelasIdx + 1).setValue(dataUpdate.kelas);
    if (dataUpdate.password && pwdIdx !== -1) userSheet.getRange(userRow + 1, pwdIdx + 1).setValue(hashPassword(dataUpdate.password));
    if (dataUpdate.status && statusIdx !== -1) userSheet.getRange(userRow + 1, statusIdx + 1).setValue(dataUpdate.status);

    delete cachedSheetData[CONFIG.SHEETS.USERS];

    // Transisi: Update sheet Members jika masih ada
    try {
      const ss = getSpreadsheet();
      const mSheet = ss.getSheetByName(CONFIG.SHEETS.MEMBERS);
      if (mSheet) {
        const mData = mSheet.getDataRange().getValues();
        const mH = mData[0];
        const mIdIdx = mH.indexOf('member_id');
        for (let m = 1; m < mData.length; m++) {
          if (mData[m][mIdIdx] === memberId) {
            if (dataUpdate.nama && mH.indexOf('nama') !== -1) mSheet.getRange(m + 1, mH.indexOf('nama') + 1).setValue(dataUpdate.nama);
            if (dataUpdate.nis && mH.indexOf('nis') !== -1) mSheet.getRange(m + 1, mH.indexOf('nis') + 1).setValue(dataUpdate.nis);
            if (dataUpdate.kelas && mH.indexOf('kelas') !== -1) mSheet.getRange(m + 1, mH.indexOf('kelas') + 1).setValue(dataUpdate.kelas);
            if (dataUpdate.status && mH.indexOf('status') !== -1) mSheet.getRange(m + 1, mH.indexOf('status') + 1).setValue(dataUpdate.status);
            break;
          }
        }
        delete cachedSheetData[CONFIG.SHEETS.MEMBERS];
      }
    } catch (e) {}

    auditLog(session.userId, session.role, 'UPDATE_MEMBER', memberId, `Update data member ${memberId}`);
    return { success: true, message: `Data member berhasil diupdate` };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function updateMemberStatus(token, memberId, status) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.MANAGER]);
    const userSheet = getSheet(CONFIG.SHEETS.USERS);
    const userData = userSheet.getDataRange().getValues();
    const uHeaders = userData[0];
    const uIdIdx = uHeaders.indexOf('user_id');
    const uStatusIdx = uHeaders.indexOf('status');

    let foundAny = false;
    for (let j = 1; j < userData.length; j++) {
      const rowUid = userData[j][uIdIdx];
      if (rowUid === memberId) {
        userSheet.getRange(j + 1, uStatusIdx + 1).setValue(status);
        foundAny = true;
      }
    }

    // Transisi: Update sheet Members jika masih ada
    try {
      const ss = getSpreadsheet();
      const mSheet = ss.getSheetByName(CONFIG.SHEETS.MEMBERS);
      if (mSheet) {
        const mData = mSheet.getDataRange().getValues();
        const mIdIdx = mData[0].indexOf('member_id');
        const mStatusIdx = mData[0].indexOf('status');
        for (let i = 1; i < mData.length; i++) {
          if (mData[i][mIdIdx] === memberId) {
            mSheet.getRange(i + 1, mStatusIdx + 1).setValue(status);
            foundAny = true;
          }
        }
        delete cachedSheetData[CONFIG.SHEETS.MEMBERS];
      }
    } catch (e) {}

    if (foundAny) {
      delete cachedSheetData[CONFIG.SHEETS.USERS];
      auditLog(session.userId, session.role, 'UPDATE_MEMBER_STATUS', memberId, `Set status member ${memberId} ke ${status}`);
      return { success: true, message: `Status member berhasil diubah menjadi ${status}` };
    }
    throw new Error('Member tidak ditemukan');
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function approveMember(token, memberId) {
  return updateMemberStatus(token, memberId, CONFIG.MEMBER_STATUS.AKTIF);
}

function deactivateMember(token, memberId) {
  return updateMemberStatus(token, memberId, CONFIG.MEMBER_STATUS.NONAKTIF);
}

function activateMember(token, memberId) {
  return updateMemberStatus(token, memberId, CONFIG.MEMBER_STATUS.AKTIF);
}

function deleteMember(token, memberId) {
  return withScriptLock(function() {
    try {
      const session = requireRole(token, [CONFIG.ROLES.MANAGER]);
      if (!memberId) throw new Error('Member ID harus diisi');

      // 1. Validasi saldo aktif
      const dual = calculateDualBalance(memberId);
      if ((dual.tabungan || 0) > 0 || (dual.hijau || 0) > 0) {
        return {
          success: false,
          error_code: 'ACTIVE_BALANCE_NOT_EMPTY',
          message: `Tidak dapat menghapus siswa ${memberId} karena masih memiliki saldo aktif (Tabungan: Rp${(dual.tabungan||0).toLocaleString('id-ID')}, Hijau: Rp${(dual.hijau||0).toLocaleString('id-ID')}). Silakan lakukan penarikan saldo terlebih dahulu.`
        };
      }

      // 2. Hapus dari Users sheet (Single Master Table)
      const uSheet = getSheet(CONFIG.SHEETS.USERS);
      const uData = uSheet.getDataRange().getValues();
      const uHeaders = uData[0];
      const uIdCol = uHeaders.indexOf('user_id');
      const uRoleCol = uHeaders.indexOf('role');
      const uNamaCol = uHeaders.indexOf('nama');

      let memberName = '';
      for (let j = uData.length - 1; j >= 1; j--) {
        const rowUid = String(uData[j][uIdCol] || '').trim();
        const rowRole = String(uData[j][uRoleCol] || '').trim();
        if (rowUid === memberId && rowRole === CONFIG.ROLES.SISWA) {
          memberName = uData[j][uNamaCol] || memberName;
          uSheet.deleteRow(j + 1);
        }
      }

      // Transisi: Hapus dari Members sheet jika masih ada
      try {
        const ss = getSpreadsheet();
        const mSheet = ss.getSheetByName(CONFIG.SHEETS.MEMBERS);
        if (mSheet) {
          const mData = mSheet.getDataRange().getValues();
          const mIdCol = mData[0].indexOf('member_id');
          for (let i = mData.length - 1; i >= 1; i--) {
            if (String(mData[i][mIdCol] || '').trim() === memberId) {
              mSheet.deleteRow(i + 1);
            }
          }
          delete cachedSheetData[CONFIG.SHEETS.MEMBERS];
        }
      } catch (e) {}

      // 3. Hapus target terkait jika ada
      try {
        const tSheet = getSheet(CONFIG.SHEETS.TARGETS);
        const tData = tSheet.getDataRange().getValues();
        const tMidCol = tData[0].indexOf('member_id');
        if (tMidCol !== -1) {
          for (let k = tData.length - 1; k >= 1; k--) {
            if (String(tData[k][tMidCol] || '').trim() === memberId) {
              tSheet.deleteRow(k + 1);
            }
          }
        }
      } catch (e) {}

      delete cachedSheetData[CONFIG.SHEETS.USERS];
      delete cachedSheetData[CONFIG.SHEETS.TARGETS];

      auditLog(session.userId, session.role, 'DELETE_MEMBER', memberId, `Hapus member ${memberId} (${memberName || 'Siswa'})`);

      return {
        success: true,
        message: `Member ${memberName ? memberName + ' (' + memberId + ')' : memberId} berhasil dihapus secara aman.`
      };
    } catch (error) {
      if (error.message.includes("Unauthorized")) throw error;
      return { success: false, message: error.message };
    }
  });
}

function formatPhotoUrlHelper(url, name) {
  if (!url || typeof url !== 'string' || !url.trim()) {
    return 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name || 'Siswa') + '&background=10b981&color=fff&bold=true&format=png';
  }
  let cleanUrl = url.trim();
  if (cleanUrl.includes('drive.google.com')) {
    const match = cleanUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || cleanUrl.match(/id=([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      return 'https://drive.google.com/thumbnail?id=' + match[1] + '&sz=w500';
    }
  }
  return cleanUrl;
}

function getMemberProp(obj, key) {
  if (!obj) return '';
  if (obj[key] !== undefined && obj[key] !== '') return obj[key];
  const target = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const k in obj) {
    if (k.toLowerCase().replace(/[^a-z0-9]/g, '') === target && obj[k] !== undefined && obj[k] !== '') {
      return obj[k];
    }
  }
  return '';
}

/**
 * Mencari data member yang berkorespondensi dengan objek user (siswa)
 * Mencocokkan via user_id, member_id, username, atau nama
 */
function findMemberForUser(user, members) {
  if (!user) return null;
  members = members || getSheetData(CONFIG.SHEETS.MEMBERS);
  const uId = String(user.user_id || user.userId || '').trim();
  const uName = String(user.nama || '').trim().toLowerCase();
  const uUname = String(user.username || '').trim().toLowerCase();

  return members.find(m => {
    const mUserId = String(m.user_id || '').trim();
    const mMemberId = String(m.member_id || '').trim();
    
    if (uId && mUserId && mUserId.toLowerCase() === uId.toLowerCase()) return true;
    if (uId && mMemberId && mMemberId.toLowerCase() === uId.toLowerCase()) return true;
    if (uUname && mUserId && mUserId.toLowerCase() === uUname) return true;
    return false;
  }) || null;
}

/**
 * Memastikan setiap user dengan role SISWA memiliki baris di sheet Members
 * Jika belum ada (misal setelah reset DB atau tambah user via manajemen user),
 * otomatis dibuatkan baris Member baru (self-healing)
 */
function ensureMemberForStudentUser(user) {
  if (!user) return null;
  const role = user.role;
  if (role && role !== CONFIG.ROLES.SISWA) return null;
  
  let members = getSheetData(CONFIG.SHEETS.MEMBERS);
  let existing = findMemberForUser(user, members);
  if (existing) return existing;

  const uId = String(user.user_id || user.userId || '').trim();
  const memberId = (uId && uId.startsWith('KH-')) ? uId : generateMemberId();
  const memberStatus = user.status || CONFIG.MEMBER_STATUS.MENUNGGU;

  const newMemberRow = [
    memberId,
    uId || memberId,
    user.nama || user.username || 'Siswa',
    user.nis || '-',
    user.kelas || '-',
    user.created_at || new Date(),
    memberStatus,
    memberId
  ];

  appendRow(CONFIG.SHEETS.MEMBERS, newMemberRow);
  delete cachedSheetData[CONFIG.SHEETS.MEMBERS];

  return {
    member_id: memberId,
    user_id: uId || memberId,
    nama: user.nama || user.username || 'Siswa',
    nis: user.nis || '-',
    kelas: user.kelas || '-',
    tanggal_daftar: user.created_at || new Date(),
    status: memberStatus,
    qr_data: memberId
  };
}

/**
 * Sinkronisasi otomatis seluruh user ber-role SISWA agar tercatat di sheet Members
 */
function syncStudentMembers() {
  const users = getSheetData(CONFIG.SHEETS.USERS);
  const studentUsers = users.filter(u => u.role === CONFIG.ROLES.SISWA && (typeof isDevAccount !== 'function' || !isDevAccount(u)));

  // Bersihkan baris akun dev jika pernah tersimpan di sheet Members produksi
  try {
    const sheet = getSheet(CONFIG.SHEETS.MEMBERS);
    const data = sheet.getDataRange().getValues();
    if (data && data.length > 1) {
      const headers = data[0];
      const uIdIdx = headers.indexOf('user_id');
      const mIdIdx = headers.indexOf('member_id');
      const namaIdx = headers.indexOf('nama');
      const nisIdx = headers.indexOf('nis');
      const kelasIdx = headers.indexOf('kelas');
      let cleaned = false;
      for (let i = data.length - 1; i >= 1; i--) {
        const rowObj = {
          user_id: data[i][uIdIdx],
          member_id: data[i][mIdIdx],
          nama: data[i][namaIdx],
          nis: nisIdx !== -1 ? data[i][nisIdx] : '',
          kelas: kelasIdx !== -1 ? data[i][kelasIdx] : ''
        };
        if (typeof isDevAccount === 'function' && isDevAccount(rowObj)) {
          sheet.deleteRow(i + 1);
          cleaned = true;
        }
      }
      if (cleaned) {
        delete cachedSheetData[CONFIG.SHEETS.MEMBERS];
      }
    }
  } catch (e) {
    console.warn('Gagal membersihkan baris dev member: ' + e.message);
  }

  if (studentUsers.length === 0) return;

  let members = getSheetData(CONFIG.SHEETS.MEMBERS);
  let hasChanges = false;

  studentUsers.forEach(u => {
    const found = findMemberForUser(u, members);
    if (!found) {
      ensureMemberForStudentUser(u);
      hasChanges = true;
    }
  });

  if (hasChanges) {
    delete cachedSheetData[CONFIG.SHEETS.MEMBERS];
  }
}

function getMemberList(token) {
  try {
    requireRole(token, [CONFIG.ROLES.MANAGER, CONFIG.ROLES.KASIR]);
    ensureUserStudentColumns();

    const users = getSheetData(CONFIG.SHEETS.USERS);
    
    // Filter akun dev dan ambil hanya role SISWA
    const prodStudents = users.filter(u => {
      if (!u) return false;
      if (String(u.role).toUpperCase() !== CONFIG.ROLES.SISWA) return false;
      if (typeof isDevAccount === 'function' && isDevAccount(u)) return false;
      return true;
    });

    // Ambil data target tabungan aktif untuk setiap siswa
    const allTargets = getSheetData(CONFIG.SHEETS.TARGETS);
    const activeTargetsMap = {};
    if (Array.isArray(allTargets)) {
      allTargets.forEach(t => {
        if (t && t.member_id && String(t.status || '').toUpperCase() === 'AKTIF') {
          activeTargetsMap[String(t.member_id).trim()] = {
            targetId: t.target_id,
            targetName: t.target_name || '',
            targetAmount: Number(t.target_amount) || 0
          };
        }
      });
    }

    // Attach dual balances, profile photos & target tabungan
    const membersWithBalance = prodStudents.map(u => {
      const memberId = String(u.user_id || '').trim();
      const dual = calculateDualBalance(memberId);
      const tgt = activeTargetsMap[memberId];
      const photo = formatPhotoUrlHelper(u.photo_url, u.nama);

      return {
        member_id: memberId,
        user_id: memberId,
        nama: u.nama,
        username: u.username || '',
        nis: u.nis || '',
        kelas: u.kelas || '',
        tanggal_daftar: u.tanggal_daftar || u.created_at || '',
        status: u.status || 'AKTIF',
        qr_data: u.qr_data || memberId,
        balance: dual.tabungan,
        saldoTabungan: dual.tabungan,
        saldoHijau: dual.hijau,
        dualBalance: dual,
        targetTabungan: tgt ? tgt.targetAmount : 0,
        targetName: tgt ? tgt.targetName : '',
        target: tgt || null,
        photoUrl: photo,
        photo_url: photo
      };
    });

    return { success: true, data: membersWithBalance };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function getMemberById(memberId) {
  if (typeof isDevAccount === 'function' && isDevAccount({ member_id: memberId, user_id: memberId })) {
    const dev = CONFIG.DEV_CONFIG && CONFIG.DEV_CONFIG.ACCOUNTS && CONFIG.DEV_CONFIG.ACCOUNTS['siswa-dev'];
    if (dev) {
      return {
        member_id: dev.memberId,
        user_id: dev.userId,
        nama: dev.nama,
        nis: dev.nis,
        kelas: dev.kelas,
        status: dev.status,
        isDev: true
      };
    }
  }
  const users = getSheetData(CONFIG.SHEETS.USERS);
  const cleanId = String(memberId || '').trim();
  const u = users.find(user => 
    (String(user.user_id).trim() === cleanId || String(user.username || '').trim() === cleanId) &&
    String(user.role).toUpperCase() === CONFIG.ROLES.SISWA
  );
  if (!u) return null;

  return {
    member_id: u.user_id,
    user_id: u.user_id,
    nama: u.nama,
    username: u.username || '',
    nis: u.nis || '',
    kelas: u.kelas || '',
    status: u.status,
    qr_data: u.qr_data || u.user_id,
    tanggal_daftar: u.tanggal_daftar || u.created_at,
    photo_url: u.photo_url || ''
  };
}

function findMember(token, query) {
  try {
    requireRole(token, [CONFIG.ROLES.MANAGER, CONFIG.ROLES.KASIR]);
    ensureUserStudentColumns();
    const users = getSheetData(CONFIG.SHEETS.USERS);
    const q = String(query || '').trim().toLowerCase();
    
    if (!q) return { success: false, message: 'Harap masukkan kata kunci pencarian' };

    const prodStudents = users.filter(u => 
      String(u.role).toUpperCase() === CONFIG.ROLES.SISWA &&
      (typeof isDevAccount !== 'function' || !isDevAccount(u))
    );

    const found = prodStudents.find(u => 
      String(u.user_id || '').toLowerCase() === q || 
      String(u.nis || '').toLowerCase() === q ||
      String(u.username || '').toLowerCase() === q ||
      String(u.nama || '').toLowerCase() === q ||
      String(u.nama || '').toLowerCase().includes(q)
    );

    if (!found) {
      return { success: false, message: 'Anggota tidak ditemukan' };
    }

    const memberId = found.user_id;
    const photo = formatPhotoUrlHelper(found.photo_url, found.nama);
    const dual = calculateDualBalance(memberId);

    const result = {
      member_id: memberId,
      user_id: memberId,
      nama: found.nama,
      username: found.username || '',
      nis: found.nis || '',
      kelas: found.kelas || '',
      status: found.status,
      qr_data: found.qr_data || memberId,
      photoUrl: photo,
      photo_url: photo,
      balance: dual.tabungan,
      saldoTabungan: dual.tabungan,
      saldoHijau: dual.hijau,
      dualBalance: dual
    };

    return { success: true, data: result };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function getMyProfile(token) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.SISWA]);
    ensureUserStudentColumns();

    if (session.isDev || (typeof isDevAccount === 'function' && isDevAccount(session))) {
      return {
        success: true,
        data: {
          member_id: 'DEV-SIS-001',
          user_id: 'DEV-SIS-001',
          nama: session.nama || 'Siswa Dev (Testing)',
          nis: 'DEV-001',
          kelas: 'DEV',
          status: 'AKTIF',
          photoUrl: session.photoUrl || '',
          photo_url: session.photoUrl || '',
          balance: 100000,
          saldoTabungan: 100000,
          saldoHijau: 50000,
          dualBalance: { tabungan: 100000, hijau: 50000, total: 150000 }
        }
      };
    }

    const users = getSheetData(CONFIG.SHEETS.USERS);
    const u = users.find(user => 
      (user.user_id === session.userId || user.username === session.username) &&
      String(user.role).toUpperCase() === CONFIG.ROLES.SISWA
    );
    if (!u) throw new Error('Data member tidak ditemukan');

    const memberId = u.user_id;
    const photo = formatPhotoUrlHelper(u.photo_url || session.photoUrl, u.nama);
    const dual = calculateDualBalance(memberId);

    const profileData = {
      member_id: memberId,
      user_id: memberId,
      nama: u.nama,
      username: u.username || '',
      nis: u.nis || '',
      kelas: u.kelas || '',
      status: u.status,
      qr_data: u.qr_data || memberId,
      photoUrl: photo,
      photo_url: photo,
      balance: dual.tabungan,
      saldoTabungan: dual.tabungan,
      saldoHijau: dual.hijau,
      dualBalance: dual
    };

    return { success: true, data: profileData };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function setTarget(token, name, amount) {
  try {
    const session = verifyToken(token);
    if(session.role !== CONFIG.ROLES.SISWA) throw new Error('Hanya siswa yang dapat mengubah target.');
    
    const memberId = session.userId;
    const sheet = getSheet(CONFIG.SHEETS.TARGETS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const memberIdx = headers.indexOf('member_id');
    const statusIdx = headers.indexOf('status');
    
    for (let i = 1; i < data.length; i++) {
      if(data[i][memberIdx] === memberId && data[i][statusIdx] === 'AKTIF') {
        sheet.getRange(i + 1, statusIdx + 1).setValue('NONAKTIF');
      }
    }
    
    const targetId = 'TGT-' + Date.now();
    appendRow(CONFIG.SHEETS.TARGETS, [
      targetId, memberId, name, amount, 'AKTIF', new Date()
    ]);
    
    auditLog(session.userId, session.role, 'SET_TARGET', targetId, `Set target: ${name} (Rp${amount})`);
    return { success: true, message: 'Target berhasil disimpan' };
  } catch(e) {
    return { success: false, message: e.message };
  }
}
