// Auth.gs

function hashPassword(password) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password);
  return raw.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

function ensureUserPhotoColumn() {
  const sheet = getSheet(CONFIG.SHEETS.USERS);
  const data = sheet.getDataRange().getValues();
  if (data.length > 0) {
    const headers = data[0];
    if (!headers.includes('photo_url')) {
      const colIdx = headers.length + 1;
      sheet.getRange(1, colIdx).setValue('photo_url').setFontWeight('bold').setBackground('#e0e0e0');
      delete cachedSheetData[CONFIG.SHEETS.USERS];
    }
  }
}

function getAuthSecret() {
  try {
    const props = PropertiesService.getScriptProperties();
    let secret = props ? props.getProperty('SATUS_AUTH_SECRET') : null;
    if (!secret) {
      secret = Utilities.getUuid() + '-' + Utilities.getUuid() + '-satus-auth-secret-2026';
      if (props) {
        props.setProperty('SATUS_AUTH_SECRET', secret);
      }
    }
    return secret;
  } catch (e) {
    console.warn('PropertiesService access warning, using static salt:', e);
    return 'satus-auth-secret-fallback-key-2026';
  }
}

function generateSignedToken(sessionData) {
  const payload = {
    userId: sessionData.userId,
    username: sessionData.username,
    role: sessionData.role,
    nama: sessionData.nama,
    photoUrl: sessionData.photoUrl || '',
    iat: Date.now(),
    exp: Date.now() + (14 * 24 * 60 * 60 * 1000) // 14 days expiration
  };
  const payloadB64 = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  const signatureBytes = Utilities.computeHmacSha256Signature(payloadB64, getAuthSecret());
  const signatureB64 = Utilities.base64EncodeWebSafe(signatureBytes);
  return payloadB64 + '.' + signatureB64;
}

function getCurrentSession(token) {
  try {
    const session = verifyToken(token);
    if (!session) return { success: false, message: 'Session expired' };
    
    ensureUserPhotoColumn();
    const users = getSheetData(CONFIG.SHEETS.USERS);
    const user = users.find(u => u.user_id === session.userId);
    
    let photoUrl = (user && user.photo_url) ? user.photo_url : '';
    if (!photoUrl && session.role === CONFIG.ROLES.SISWA) {
      try {
        const members = getSheetData(CONFIG.SHEETS.MEMBERS);
        const member = members.find(m => m.user_id === session.userId || m.member_id === session.userId || (m.nama && session.nama && m.nama.toLowerCase().trim() === session.nama.toLowerCase().trim()));
        if (member && member.photo_url) photoUrl = member.photo_url;
      } catch(e) {}
    }
    
    const defaultAvatar = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(session.nama || session.username) + '&background=10b981&color=fff&bold=true&format=png';
    session.photoUrl = photoUrl || defaultAvatar;
    session.token = token; // Guarantee token is preserved
    
    try {
      const cache = CacheService.getScriptCache();
      cache.put(token, JSON.stringify(session), 21600);
    } catch(e) {}
    
    return { success: true, data: session };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function login(username, password) {
  try {
    ensureUserPhotoColumn();
    const users = getSheetData(CONFIG.SHEETS.USERS);
    const user = users.find(u => u.username === username && (u.status === 'AKTIF' || (u.role === 'SISWA' && u.status === 'MENUNGGU')));

    if (!user) {
      return { success: false, message: 'Username tidak ditemukan, tidak aktif, atau bukan siswa yang menunggu persetujuan' };
    }

    if (hashPassword(password) !== user.password_hash) {
      return { success: false, message: 'Password salah' };
    }

    let photoUrl = user.photo_url;
    if (!photoUrl && user.role === CONFIG.ROLES.SISWA) {
      try {
        const members = getSheetData(CONFIG.SHEETS.MEMBERS);
        const member = members.find(m => m.user_id === user.user_id || m.member_id === user.user_id || (m.nama && user.nama && m.nama.toLowerCase().trim() === user.nama.toLowerCase().trim()));
        if (member && member.photo_url) photoUrl = member.photo_url;
      } catch(e) {}
    }

    const defaultAvatar = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.nama || user.username) + '&background=10b981&color=fff&bold=true&format=png';
    const sessionData = {
      userId: user.user_id,
      username: user.username,
      role: user.role,
      nama: user.nama,
      photoUrl: photoUrl || defaultAvatar
    };

    const token = generateSignedToken(sessionData);
    sessionData.token = token;

    try {
      const cache = CacheService.getScriptCache();
      cache.put(token, JSON.stringify(sessionData), 21600); // 6 hours cache
    } catch (e) {}

    auditLog(user.user_id, user.role, 'LOGIN', '', 'User login');

    return { 
      success: true, 
      data: sessionData,
      token: token
    };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;

  // 1. Stateless Signed Token Format (payload.signature)
  if (token.indexOf('.') !== -1) {
    try {
      const parts = token.split('.');
      if (parts.length === 2) {
        const payloadB64 = parts[0];
        const signatureB64 = parts[1];
        const expectedSigBytes = Utilities.computeHmacSha256Signature(payloadB64, getAuthSecret());
        const expectedSigB64 = Utilities.base64EncodeWebSafe(expectedSigBytes);
        
        if (signatureB64 === expectedSigB64) {
          const payloadJson = Utilities.newBlob(Utilities.base64DecodeWebSafe(payloadB64)).getDataAsString();
          const session = JSON.parse(payloadJson);
          
          if (session.exp && Date.now() > session.exp) {
            return null; // Expired
          }
          
          // Verify user exists and is active in database
          const users = getSheetData(CONFIG.SHEETS.USERS);
          const dbUser = users.find(u => u.user_id === session.userId);
          if (!dbUser || (dbUser.status !== 'AKTIF' && !(dbUser.role === 'SISWA' && dbUser.status === 'MENUNGGU'))) {
            return null;
          }
          
          session.role = dbUser.role;
          session.nama = dbUser.nama || session.nama;
          if (dbUser.photo_url) {
            session.photoUrl = dbUser.photo_url;
          }
          session.token = token;
          return session;
        }
      }
    } catch (e) {
      console.warn('Signed token verification failed: ' + e.message);
    }
  }

  // 2. Legacy Cache Fallback (for existing UUID sessions)
  try {
    const cache = CacheService.getScriptCache();
    const sessionStr = cache.get(token);
    if (sessionStr) {
      const session = JSON.parse(sessionStr);
      const users = getSheetData(CONFIG.SHEETS.USERS);
      const dbUser = users.find(u => u.user_id === session.userId);
      if (!dbUser || (dbUser.status !== 'AKTIF' && !(dbUser.role === 'SISWA' && dbUser.status === 'MENUNGGU'))) {
        try { cache.remove(token); } catch(e) {}
        return null;
      }
      session.token = token;
      return session;
    }
  } catch (e) {
    console.warn('Cache fallback error: ' + e.message);
  }

  return null;
}

function requireRole(token, allowedRoles) {
  const session = verifyToken(token);
  if (!session) throw new Error('Unauthorized: Session expired or invalid');
  if (!allowedRoles.includes(session.role)) throw new Error('Forbidden: Insufficient role');
  return session;
}

function changePassword(token, oldPassword, newPassword) {
  try {
    const session = verifyToken(token);
    if (!session) throw new Error('Unauthorized: Session expired or invalid');
    
    if (!newPassword || newPassword.length < 4) {
      throw new Error('Password baru minimal 4 karakter');
    }
    
    const sheet = getSheet(CONFIG.SHEETS.USERS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const uIdIdx = headers.indexOf('user_id');
    const passIdx = headers.indexOf('password_hash');
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][uIdIdx] === session.userId) {
        const currentHash = data[i][passIdx];
        if (hashPassword(oldPassword) !== currentHash) {
          throw new Error('Password lama tidak sesuai');
        }
        
        const newHash = hashPassword(newPassword);
        sheet.getRange(i + 1, passIdx + 1).setValue(newHash);
        delete cachedSheetData[CONFIG.SHEETS.USERS];
        
        auditLog(session.userId, session.role, 'CHANGE_PASSWORD', session.userId, 'Ganti password akun');
        return { success: true, message: 'Password berhasil diubah!' };
      }
    }
    throw new Error('User tidak ditemukan');
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error;
    return { success: false, message: error.message };
  }
}

function updateMyProfile(token, dataUpdate) {
  try {
    const session = verifyToken(token);
    if (!session) throw new Error('Unauthorized: Session expired or invalid');
    
    ensureUserPhotoColumn();
    const sheet = getSheet(CONFIG.SHEETS.USERS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const uIdIdx = headers.indexOf('user_id');
    const photoIdx = headers.indexOf('photo_url');
    const namaIdx = headers.indexOf('nama');
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][uIdIdx] === session.userId) {
        if (dataUpdate.photo_url !== undefined && photoIdx !== -1) {
          sheet.getRange(i + 1, photoIdx + 1).setValue(dataUpdate.photo_url);
        }
        if (dataUpdate.nama && namaIdx !== -1) {
          sheet.getRange(i + 1, namaIdx + 1).setValue(dataUpdate.nama);
          session.nama = dataUpdate.nama;
        }
        
        delete cachedSheetData[CONFIG.SHEETS.USERS];
        
        // If user is Siswa, also update name & photo in Members sheet if changed
        if (session.role === CONFIG.ROLES.SISWA) {
          const mSheet = getSheet(CONFIG.SHEETS.MEMBERS);
          const mData = mSheet.getDataRange().getValues();
          const mHeaders = mData[0];
          const mUIdIdx = mHeaders.indexOf('user_id');
          const mNamaIdx = mHeaders.indexOf('nama');
          const mPhotoIdx = mHeaders.indexOf('photo_url');
          for (let j = 1; j < mData.length; j++) {
            if (mData[j][mUIdIdx] === session.userId) {
              if (dataUpdate.nama && mNamaIdx !== -1) {
                mSheet.getRange(j + 1, mNamaIdx + 1).setValue(dataUpdate.nama);
              }
              if (dataUpdate.photo_url !== undefined && mPhotoIdx !== -1) {
                mSheet.getRange(j + 1, mPhotoIdx + 1).setValue(dataUpdate.photo_url);
              }
              delete cachedSheetData[CONFIG.SHEETS.MEMBERS];
              break;
            }
          }
        }
        
        const photoUrl = dataUpdate.photo_url || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(session.nama) + '&background=10b981&color=fff&bold=true&format=png');
        session.photoUrl = photoUrl;
        session.token = token; // Guarantee token is preserved!
        
        // Update cache
        try {
          const cache = CacheService.getScriptCache();
          cache.put(token, JSON.stringify(session), 21600);
        } catch(e) {}
        
        auditLog(session.userId, session.role, 'UPDATE_PROFILE', session.userId, 'Perbarui foto/profil akun');
        return { 
          success: true, 
          message: 'Profil berhasil diperbarui!',
          data: session
        };
      }
    }
    throw new Error('User tidak ditemukan');
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error;
    return { success: false, message: error.message };
  }
}

function getUserList(token) {
  try {
    ensureUserPhotoColumn();
    requireRole(token, [CONFIG.ROLES.MANAGER]);
    const users = getSheetData(CONFIG.SHEETS.USERS);
    const safeUsers = users.map(u => {
      delete u.password_hash;
      if (!u.photo_url) {
        u.photo_url = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(u.nama || u.username) + '&background=10b981&color=fff&bold=true&format=png';
      }
      return u;
    });
    return { success: true, data: safeUsers };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function registerUser(token, data) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.MANAGER]);
    ensureUserPhotoColumn();
    
    // Check if username exists
    const users = getSheetData(CONFIG.SHEETS.USERS);
    if (users.find(u => u.username === data.username)) {
      throw new Error('Username sudah digunakan');
    }
    
    const isSiswa = (data.role === CONFIG.ROLES.SISWA);
    const userId = isSiswa ? generateMemberId() : ('STF-' + Date.now().toString().slice(-6));
    const hash = hashPassword(data.password);
    const placeholderPhoto = data.photo_url || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(data.nama) + '&background=10b981&color=fff&bold=true&format=png');
    
    appendRow(CONFIG.SHEETS.USERS, [
      userId, data.username, hash, data.role, data.nama, 'AKTIF', new Date(), placeholderPhoto
    ]);

    // Jika role SISWA, otomatis buat record di tabel Members agar muncul di data anggota
    if (isSiswa) {
      appendRow(CONFIG.SHEETS.MEMBERS, [
        userId,
        userId,
        data.nama,
        data.nis || '-',
        data.kelas || '-',
        new Date(),
        'AKTIF',
        userId
      ]);
      delete cachedSheetData[CONFIG.SHEETS.MEMBERS];
    }
    
    auditLog(session.userId, session.role, 'ADD_USER', userId, 'Tambah ' + data.role + ': ' + data.nama);
    return { success: true, message: data.role + ' berhasil ditambahkan!' };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function deactivateUser(token, userId) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.MANAGER]);
    const sheet = getSheet(CONFIG.SHEETS.USERS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIdx = headers.indexOf('user_id');
    const statusIdx = headers.indexOf('status');
    const roleIdx = headers.indexOf('role');
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][idIdx] === userId) {
        if (data[i][roleIdx] === CONFIG.ROLES.MANAGER) {
          throw new Error('Tidak bisa menonaktifkan akun Manager');
        }
        sheet.getRange(i + 1, statusIdx + 1).setValue('NONAKTIF');
        delete cachedSheetData[CONFIG.SHEETS.USERS];

        // Jika SISWA, nonaktifkan juga di sheet Members
        if (data[i][roleIdx] === CONFIG.ROLES.SISWA) {
          try {
            const mSheet = getSheet(CONFIG.SHEETS.MEMBERS);
            const mData = mSheet.getDataRange().getValues();
            const mHeaders = mData[0];
            const mUid = mHeaders.indexOf('user_id');
            const mMid = mHeaders.indexOf('member_id');
            const mSt = mHeaders.indexOf('status');
            for (let m = 1; m < mData.length; m++) {
              if (mData[m][mUid] === userId || mData[m][mMid] === userId) {
                mSheet.getRange(m + 1, mSt + 1).setValue('NONAKTIF');
                break;
              }
            }
            delete cachedSheetData[CONFIG.SHEETS.MEMBERS];
          } catch(e) {}
        }

        auditLog(session.userId, session.role, 'DEACTIVATE_USER', userId, 'Set status user ' + userId + ' ke NONAKTIF');
        return { success: true, message: 'Status user berhasil dinonaktifkan' };
      }
    }
    throw new Error('User tidak ditemukan');
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function activateUser(token, userId) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.MANAGER]);
    const sheet = getSheet(CONFIG.SHEETS.USERS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIdx = headers.indexOf('user_id');
    const statusIdx = headers.indexOf('status');
    const roleIdx = headers.indexOf('role');
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][idIdx] === userId) {
        sheet.getRange(i + 1, statusIdx + 1).setValue('AKTIF');
        delete cachedSheetData[CONFIG.SHEETS.USERS];

        // Jika SISWA, aktifkan juga di sheet Members
        if (data[i][roleIdx] === CONFIG.ROLES.SISWA) {
          try {
            const mSheet = getSheet(CONFIG.SHEETS.MEMBERS);
            const mData = mSheet.getDataRange().getValues();
            const mHeaders = mData[0];
            const mUid = mHeaders.indexOf('user_id');
            const mMid = mHeaders.indexOf('member_id');
            const mSt = mHeaders.indexOf('status');
            for (let m = 1; m < mData.length; m++) {
              if (mData[m][mUid] === userId || mData[m][mMid] === userId) {
                mSheet.getRange(m + 1, mSt + 1).setValue('AKTIF');
                break;
              }
            }
            delete cachedSheetData[CONFIG.SHEETS.MEMBERS];
          } catch(e) {}
        }

        auditLog(session.userId, session.role, 'ACTIVATE_USER', userId, 'Set status user ' + userId + ' ke AKTIF');
        return { success: true, message: 'Status user berhasil diaktifkan kembali' };
      }
    }
    throw new Error('User tidak ditemukan');
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function updateUser(token, userId, dataUpdate) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.MANAGER]);
    ensureUserPhotoColumn();
    const sheet = getSheet(CONFIG.SHEETS.USERS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    // Check if new username is already used by someone else
    if (dataUpdate.username) {
      const users = getSheetData(CONFIG.SHEETS.USERS);
      const existing = users.find(u => u.username === dataUpdate.username && u.user_id !== userId);
      if (existing) throw new Error('Username sudah digunakan pengguna lain');
    }

    for (let i = 1; i < data.length; i++) {
      if (data[i][headers.indexOf('user_id')] === userId) {
        const currentRole = data[i][headers.indexOf('role')];
        if (dataUpdate.nama) sheet.getRange(i + 1, headers.indexOf('nama') + 1).setValue(dataUpdate.nama);
        if (dataUpdate.role) sheet.getRange(i + 1, headers.indexOf('role') + 1).setValue(dataUpdate.role);
        if (dataUpdate.username) sheet.getRange(i + 1, headers.indexOf('username') + 1).setValue(dataUpdate.username);
        if (dataUpdate.password) {
          const hash = hashPassword(dataUpdate.password);
          sheet.getRange(i + 1, headers.indexOf('password_hash') + 1).setValue(hash);
        }
        if (dataUpdate.photo_url !== undefined && headers.indexOf('photo_url') !== -1) {
          sheet.getRange(i + 1, headers.indexOf('photo_url') + 1).setValue(dataUpdate.photo_url);
        }
        delete cachedSheetData[CONFIG.SHEETS.USERS];

        // Jika SISWA, sinkronisasi nama ke tabel Members jika nama diubah
        if (currentRole === CONFIG.ROLES.SISWA && dataUpdate.nama) {
          try {
            const mSheet = getSheet(CONFIG.SHEETS.MEMBERS);
            const mData = mSheet.getDataRange().getValues();
            const mHeaders = mData[0];
            const mUid = mHeaders.indexOf('user_id');
            const mMid = mHeaders.indexOf('member_id');
            const mNama = mHeaders.indexOf('nama');
            for (let m = 1; m < mData.length; m++) {
              if (mData[m][mUid] === userId || mData[m][mMid] === userId) {
                mSheet.getRange(m + 1, mNama + 1).setValue(dataUpdate.nama);
                break;
              }
            }
            delete cachedSheetData[CONFIG.SHEETS.MEMBERS];
          } catch(e) {}
        }

        auditLog(session.userId, session.role, 'UPDATE_USER', userId, 'Update data user ' + userId);
        return { success: true, message: 'Data user berhasil diupdate' };
      }
    }
    throw new Error('User tidak ditemukan');
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}
