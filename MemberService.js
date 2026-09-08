// MemberService.gs

function registerMember(token, data) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.MANAGER, CONFIG.ROLES.KASIR]);
    
    // Check username availability
    const users = getSheetData(CONFIG.SHEETS.USERS);
    if (users.find(u => u.username === data.username)) {
      throw new Error('Username sudah digunakan');
    }

    const memberId = generateMemberId();
    const qrData = memberId; 
    const userId = memberId; // Use same ID for User record so it shows as KH-
    const hash = hashPassword(data.password);
    
    // Status is MENUNGGU for both Member and User until approved by Manager
    appendRow(CONFIG.SHEETS.MEMBERS, [
      memberId, 
      userId, 
      data.nama, 
      data.nis, 
      data.kelas, 
      new Date(), 
      CONFIG.MEMBER_STATUS.MENUNGGU, 
      qrData
    ]);

    ensureUserPhotoColumn();
    const placeholderPhoto = `https://ui-avatars.com/api/?name=${encodeURIComponent(data.nama)}&background=10b981&color=fff&bold=true&format=png`;
    appendRow(CONFIG.SHEETS.USERS, [
      userId, data.username, hash, CONFIG.ROLES.SISWA, data.nama, CONFIG.MEMBER_STATUS.MENUNGGU, new Date(), placeholderPhoto
    ]);

    auditLog(session.userId, session.role, 'REGISTER_MEMBER', memberId, `Register member: ${data.nama}`);
    return { success: true, message: 'Pendaftaran berhasil, menunggu persetujuan Manager.', memberId: memberId };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function updateMember(token, memberId, dataUpdate) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.MANAGER]);
    const sheet = getSheet(CONFIG.SHEETS.MEMBERS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    // Find member
    let memberRow = -1;
    let userId = '';
    for (let i = 1; i < data.length; i++) {
      if (data[i][headers.indexOf('member_id')] === memberId) {
        memberRow = i;
        userId = data[i][headers.indexOf('user_id')];
        break;
      }
    }
    if (memberRow === -1) throw new Error('Member tidak ditemukan');
    
    // Update Member Data
    if (dataUpdate.nama) sheet.getRange(memberRow + 1, headers.indexOf('nama') + 1).setValue(dataUpdate.nama);
    if (dataUpdate.nis) sheet.getRange(memberRow + 1, headers.indexOf('nis') + 1).setValue(dataUpdate.nis);
    if (dataUpdate.kelas) sheet.getRange(memberRow + 1, headers.indexOf('kelas') + 1).setValue(dataUpdate.kelas);
    
    // Handle User Data
    if (dataUpdate.username || dataUpdate.password) {
      if (!dataUpdate.username) throw new Error('Username wajib diisi jika ingin mengupdate login');
      
      const userSheet = getSheet(CONFIG.SHEETS.USERS);
      const userData = userSheet.getDataRange().getValues();
      const uHeaders = userData[0];
      
      // Check if username used
      const existing = getSheetData(CONFIG.SHEETS.USERS).find(u => u.username === dataUpdate.username && u.user_id !== userId);
      if (existing) throw new Error('Username sudah digunakan');

      if (userId) {
        // Update existing user
        for(let j = 1; j < userData.length; j++) {
          if (userData[j][uHeaders.indexOf('user_id')] === userId) {
            if (dataUpdate.nama) userSheet.getRange(j + 1, uHeaders.indexOf('nama') + 1).setValue(dataUpdate.nama);
            if (dataUpdate.username) userSheet.getRange(j + 1, uHeaders.indexOf('username') + 1).setValue(dataUpdate.username);
            if (dataUpdate.password) {
              userSheet.getRange(j + 1, uHeaders.indexOf('password_hash') + 1).setValue(hashPassword(dataUpdate.password));
            }
            break;
          }
        }
      } else {
        // Create new user for legacy member
        if (!dataUpdate.password) throw new Error('Password wajib diisi untuk membuat login baru');
        const newUserId = memberId; // Use KH- ID
        const hash = hashPassword(dataUpdate.password);
        const status = data[memberRow][headers.indexOf('status')];
        
        appendRow(CONFIG.SHEETS.USERS, [
          newUserId, dataUpdate.username, hash, CONFIG.ROLES.SISWA, 
          dataUpdate.nama || data[memberRow][headers.indexOf('nama')], 
          status, new Date()
        ]);
        
        // Link new user to member
        sheet.getRange(memberRow + 1, headers.indexOf('user_id') + 1).setValue(newUserId);
      }
    }
    
    auditLog(session.userId, session.role, 'UPDATE_MEMBER', memberId, `Update data member ${memberId}`);
    return { success: true, message: `Data member berhasil diupdate` };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function updateMemberStatus(token, memberId, status) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.MANAGER]);
    const sheet = getSheet(CONFIG.SHEETS.MEMBERS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIdx = headers.indexOf('member_id');
    const statusIdx = headers.indexOf('status');
    const userIdIdx = headers.indexOf('user_id');
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][idIdx] === memberId) {
        sheet.getRange(i + 1, statusIdx + 1).setValue(status);
        
        // Update user status as well
        const userId = data[i][userIdIdx];
        if (userId) {
          const userSheet = getSheet(CONFIG.SHEETS.USERS);
          const userData = userSheet.getDataRange().getValues();
          const uHeaders = userData[0];
          const uIdIdx = uHeaders.indexOf('user_id');
          const uStatusIdx = uHeaders.indexOf('status');
          for(let j=1; j < userData.length; j++) {
            if(userData[j][uIdIdx] === userId) {
              userSheet.getRange(j + 1, uStatusIdx + 1).setValue(status);
              break;
            }
          }
        }
        
        delete cachedSheetData[CONFIG.SHEETS.MEMBERS];
        delete cachedSheetData[CONFIG.SHEETS.USERS];

        auditLog(session.userId, session.role, 'UPDATE_MEMBER_STATUS', memberId, `Set status member ${memberId} ke ${status}`);
        return { success: true, message: `Status member berhasil diubah menjadi ${status}` };
      }
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

function getMemberList(token) {
  try {
    requireRole(token, [CONFIG.ROLES.MANAGER, CONFIG.ROLES.KASIR]);
    ensureUserPhotoColumn();
    const members = getSheetData(CONFIG.SHEETS.MEMBERS);
    const users = getSheetData(CONFIG.SHEETS.USERS);
    
    // Attach dual balances & profile photos
    const membersWithBalance = members.map(m => {
      const dual = calculateDualBalance(m.member_id);
      m.balance = dual.tabungan; // legacy compat
      m.saldoTabungan = dual.tabungan;
      m.saldoHijau = dual.hijau;
      m.dualBalance = dual;

      let user = users.find(u => u.user_id && m.user_id && String(u.user_id).trim() === String(m.user_id).trim());
      if (!user && m.member_id) {
        user = users.find(u => u.user_id && String(u.user_id).trim().toLowerCase() === String(m.member_id).trim().toLowerCase());
      }
      if (!user && m.nama) {
        user = users.find(u => u.nama && String(u.nama).trim().toLowerCase() === String(m.nama).trim().toLowerCase());
      }

      const rawPhoto = getMemberProp(m, 'photo_url') || getMemberProp(user, 'photo_url');
      m.photoUrl = formatPhotoUrlHelper(rawPhoto, m.nama);
      m.photo_url = m.photoUrl;
      return m;
    });
    
    return { success: true, data: membersWithBalance };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function getMemberById(memberId) {
  const members = getSheetData(CONFIG.SHEETS.MEMBERS);
  return members.find(m => m.member_id === memberId) || null;
}

function findMember(token, query) {
  try {
    requireRole(token, [CONFIG.ROLES.MANAGER, CONFIG.ROLES.KASIR]);
    ensureUserPhotoColumn();
    const members = getSheetData(CONFIG.SHEETS.MEMBERS);
    const users = getSheetData(CONFIG.SHEETS.USERS);
    const q = String(query || '').trim().toLowerCase();
    
    if (!q) return { success: false, message: 'Harap masukkan kata kunci pencarian' };

    // 1. Search in members sheet: Member ID, NIS, or Nama (exact or partial)
    let found = members.find(m => 
      String(m.member_id || '').trim().toLowerCase() === q || 
      String(m.nis || '').trim().toLowerCase() === q
    );
    if (!found) {
      found = members.find(m => String(m.nama || '').trim().toLowerCase() === q);
    }
    if (!found) {
      found = members.find(m => String(m.nama || '').trim().toLowerCase().includes(q));
    }
    // Also fallback: search user record by username / name, then find member
    if (!found) {
      const uFound = users.find(u => 
        String(u.username || '').trim().toLowerCase() === q || 
        String(u.nama || '').trim().toLowerCase() === q ||
        String(u.nama || '').trim().toLowerCase().includes(q)
      );
      if (uFound) {
        found = members.find(m => 
          (m.user_id && String(m.user_id).trim() === String(uFound.user_id).trim()) ||
          (m.member_id && String(m.member_id).trim() === String(uFound.user_id).trim()) ||
          (m.nama && String(m.nama).trim().toLowerCase() === String(uFound.nama).trim().toLowerCase())
        );
      }
    }
    
    if (!found) return { success: false, message: 'Anggota tidak ditemukan' };
    
    // 2. Find matching user record to extract photo
    let user = users.find(u => u.user_id && found.user_id && String(u.user_id).trim() === String(found.user_id).trim());
    if (!user && found.member_id) {
      user = users.find(u => u.user_id && String(u.user_id).trim().toLowerCase() === String(found.member_id).trim().toLowerCase());
    }
    if (!user && found.nama) {
      user = users.find(u => u.nama && String(u.nama).trim().toLowerCase() === String(found.nama).trim().toLowerCase());
    }

    // 3. Resolve Photo URL
    const rawPhoto = getMemberProp(found, 'photo_url') || getMemberProp(user, 'photo_url');
    const photo = formatPhotoUrlHelper(rawPhoto, found.nama);
    found.photoUrl = photo;
    found.photo_url = photo;

    const dual = calculateDualBalance(found.member_id);
    found.balance = dual.tabungan; // legacy compat
    found.saldoTabungan = dual.tabungan;
    found.saldoHijau = dual.hijau;
    found.dualBalance = dual;
    return { success: true, data: found };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function getMyProfile(token) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.SISWA]);
    ensureUserPhotoColumn();
    const members = getSheetData(CONFIG.SHEETS.MEMBERS);
    
    // Find member by user_id
    const found = members.find(m => m.user_id === session.userId || m.member_id === session.userId);
    if (!found) throw new Error('Data member tidak ditemukan');

    const users = getSheetData(CONFIG.SHEETS.USERS);
    let user = users.find(u => u.user_id === session.userId || u.user_id === found.member_id || (u.nama && String(u.nama).toLowerCase() === String(found.nama).toLowerCase()));
    
    const rawPhoto = getMemberProp(found, 'photo_url') || getMemberProp(user, 'photo_url') || session.photoUrl || '';
    const photo = formatPhotoUrlHelper(rawPhoto, found.nama);
    found.photoUrl = photo;
    found.photo_url = photo;
    
    const dual = calculateDualBalance(found.member_id);
    found.balance = dual.tabungan; // legacy compat
    found.saldoTabungan = dual.tabungan;
    found.saldoHijau = dual.hijau;
    found.dualBalance = dual;
    return { success: true, data: found };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function setTarget(token, name, amount) {
  try {
    const session = verifyToken(token);
    if(session.role !== CONFIG.ROLES.SISWA) throw new Error('Hanya siswa yang dapat mengubah target.');
    
    const members = getSheetData(CONFIG.SHEETS.MEMBERS);
    const member = members.find(m => m.user_id === session.userId);
    if(!member) throw new Error('Data member tidak ditemukan.');
    
    const sheet = getSheet(CONFIG.SHEETS.TARGETS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const memberIdx = headers.indexOf('member_id');
    const statusIdx = headers.indexOf('status');
    
    for (let i = 1; i < data.length; i++) {
      if(data[i][memberIdx] === member.member_id && data[i][statusIdx] === 'AKTIF') {
        sheet.getRange(i + 1, statusIdx + 1).setValue('NONAKTIF');
      }
    }
    
    const targetId = 'TGT-' + Date.now();
    appendRow(CONFIG.SHEETS.TARGETS, [
      targetId, member.member_id, name, amount, 'AKTIF', new Date()
    ]);
    
    auditLog(session.userId, session.role, 'SET_TARGET', targetId, `Set target: ${name} (Rp${amount})`);
    return { success: true, message: 'Target berhasil disimpan' };
  } catch(e) {
    return { success: false, message: e.message };
  }
}
