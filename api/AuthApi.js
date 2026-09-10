// api/AuthApi.gs

/**
 * ============================================================
 * SATUS - Kantong Hijau (SMP Muhammadiyah 1 Magetan)
 * Mobile Authentication API for Flutter (Satus Mobile)
 * ============================================================
 * Role-Based: MANAGER, KASIR, SISWA
 */

/**
 * Unified Login API with role enforcement.
 * Accepts username, user_id, member_id, or NIS (for SISWA).
 * 
 * @param {Object} params
 *   - username/identifier: string (username, user_id, member_id, or NIS)
 *   - password: string
 *   - role: string (optional: 'MANAGER' | 'KASIR' | 'SISWA')
 * @returns {Object} { success, message, data, token, error_code }
 */
function apiLogin(params) {
  try {
    params = params || {};
    const identifier = String(params.username || params.identifier || params.member_id || params.user_id || '').trim();
    const password = String(params.password || '').trim();
    const expectedRole = params.role ? String(params.role).trim().toUpperCase() : null;

    if (!identifier) {
      return {
        success: false,
        error_code: 'MISSING_IDENTIFIER',
        message: 'Username / ID Pengguna wajib diisi'
      };
    }

    if (!password) {
      return {
        success: false,
        error_code: 'MISSING_PASSWORD',
        message: 'Password wajib diisi'
      };
    }

    // 1. Cek login akun Dev/Testing (terisolasi dari database produksi)
    if (CONFIG.DEV_CONFIG && CONFIG.DEV_CONFIG.ENABLED && CONFIG.DEV_CONFIG.ACCOUNTS[identifier.toLowerCase()]) {
      const devAcc = CONFIG.DEV_CONFIG.ACCOUNTS[identifier.toLowerCase()];
      if (password !== devAcc.password) {
        return {
          success: false,
          error_code: 'INVALID_PASSWORD',
          message: 'Password akun dev salah'
        };
      }
      if (expectedRole && devAcc.role !== expectedRole) {
        return {
          success: false,
          error_code: 'ROLE_MISMATCH',
          message: `Akun ini terdaftar sebagai ${devAcc.role}, bukan ${expectedRole}. Silakan gunakan menu login yang sesuai.`
        };
      }

      const sessionData = {
        userId: devAcc.userId,
        username: devAcc.username,
        role: devAcc.role,
        nama: devAcc.nama,
        photoUrl: devAcc.photoUrl,
        isDev: true,
        status: devAcc.status || 'AKTIF'
      };

      const token = generateSignedToken(sessionData);
      sessionData.token = token;

      try {
        const cache = CacheService.getScriptCache();
        cache.put(token, JSON.stringify(sessionData), 21600);
      } catch (e) {}

      let responseData;
      if (devAcc.role === CONFIG.ROLES.SISWA) {
        const mockMember = {
          member_id: devAcc.memberId,
          user_id: devAcc.userId,
          nama: devAcc.nama,
          nis: devAcc.nis,
          kelas: devAcc.kelas,
          registered_at: new Date().toISOString(),
          status: 'AKTIF',
          photo_url: devAcc.photoUrl
        };
        const mockUser = {
          user_id: devAcc.userId,
          username: devAcc.username,
          nama: devAcc.nama,
          role: CONFIG.ROLES.SISWA,
          status: 'AKTIF',
          photo_url: devAcc.photoUrl
        };
        responseData = buildStudentProfileData(mockUser, mockMember);
      } else if (devAcc.role === CONFIG.ROLES.KASIR) {
        responseData = buildKasirProfileData({
          user_id: devAcc.userId,
          username: devAcc.username,
          nama: devAcc.nama,
          role: CONFIG.ROLES.KASIR,
          status: 'AKTIF',
          photo_url: devAcc.photoUrl
        });
      } else {
        responseData = buildManagerProfileData({
          user_id: devAcc.userId,
          username: devAcc.username,
          nama: devAcc.nama,
          role: CONFIG.ROLES.MANAGER,
          status: 'AKTIF',
          photo_url: devAcc.photoUrl
        });
      }

      responseData.token = token;
      responseData.isDev = true;

      return {
        success: true,
        message: `Login berhasil sebagai ${devAcc.role} (Akun Dev / Test). Selamat datang, ${devAcc.nama}!`,
        data: responseData,
        token: token
      };
    }

    ensureUserPhotoColumn();
    const users = getSheetData(CONFIG.SHEETS.USERS);
    const members = getSheetData(CONFIG.SHEETS.MEMBERS);

    let user = null;
    let member = null;

    // 1. Direct match on Users sheet (username or user_id)
    user = users.find(u => 
      u.username.toLowerCase() === identifier.toLowerCase() || 
      u.user_id.toLowerCase() === identifier.toLowerCase()
    );

    // 2. If not found in Users directly, search Members sheet (by member_id or NIS)
    if (!user) {
      member = members.find(m => 
        (m.member_id && m.member_id.toLowerCase() === identifier.toLowerCase()) ||
        (m.nis && String(m.nis).trim() === identifier)
      );
      if (member) {
        user = users.find(u => u.user_id === member.user_id || u.user_id === member.member_id);
      }
    } else if (user.role === CONFIG.ROLES.SISWA) {
      member = (typeof findMemberForUser === 'function')
        ? findMemberForUser(user, members)
        : members.find(m => m.user_id === user.user_id || m.member_id === user.user_id);
      if (!member && typeof ensureMemberForStudentUser === 'function') {
        member = ensureMemberForStudentUser(user);
      }
    }

    if (!user) {
      return {
        success: false,
        error_code: 'USER_NOT_FOUND',
        message: 'Akun tidak ditemukan. Periksa kembali username / ID Anda.'
      };
    }

    // 3. Verify Password
    if (hashPassword(password) !== user.password_hash) {
      return {
        success: false,
        error_code: 'INVALID_PASSWORD',
        message: 'Password yang Anda masukkan salah.'
      };
    }

    // 4. Role Enforcement (Proteksi Akses Berdasarkan Role)
    if (expectedRole && user.role !== expectedRole) {
      return {
        success: false,
        error_code: 'ROLE_MISMATCH',
        message: `Akun ini terdaftar sebagai ${user.role}, bukan ${expectedRole}. Silakan gunakan menu login yang sesuai.`
      };
    }

    // 5. Account Status Validation
    if (user.status === 'NONAKTIF') {
      return {
        success: false,
        error_code: 'ACCOUNT_INACTIVE',
        message: 'Akun Anda sedang dinonaktifkan. Silakan hubungi Administrator sekolah.'
      };
    }

    // 6. Build Role-Specific Profile Payload
    let responseData = null;
    if (user.role === CONFIG.ROLES.SISWA) {
      responseData = buildStudentProfileData(user, member);
    } else if (user.role === CONFIG.ROLES.KASIR) {
      responseData = buildKasirProfileData(user);
    } else if (user.role === CONFIG.ROLES.MANAGER) {
      responseData = buildManagerProfileData(user);
    } else {
      responseData = buildStaffProfileData(user);
    }

    // 7. Generate Signed HMAC Token (Valid 14 Days)
    const token = generateSignedToken({
      userId: user.user_id,
      username: user.username,
      role: user.role,
      nama: user.nama,
      photoUrl: responseData.photoUrl || ''
    });

    responseData.token = token;

    // 8. Cache session for rapid lookup
    try {
      const cache = CacheService.getScriptCache();
      cache.put(token, JSON.stringify({
        userId: user.user_id,
        username: user.username,
        role: user.role,
        nama: user.nama,
        photoUrl: responseData.photoUrl,
        token: token
      }), 21600);
    } catch(e) {}

    // 9. Audit Log
    auditLog(user.user_id, user.role, 'API_LOGIN', 'MOBILE_APP', `Login via Mobile App sebagai ${user.role}`);

    const isPending = (user.role === CONFIG.ROLES.SISWA && user.status === CONFIG.MEMBER_STATUS.MENUNGGU);
    const welcomeMsg = isPending 
      ? `Selamat datang ${user.nama}. Pendaftaran Anda masih berstatus MENUNGGU verifikasi Manager.`
      : `Login berhasil sebagai ${user.role}. Selamat datang, ${user.nama}!`;

    return {
      success: true,
      message: welcomeMsg,
      data: responseData
    };
  } catch (err) {
    console.error('apiLogin error:', err);
    return {
      success: false,
      error_code: 'SERVER_ERROR',
      message: err.message || 'Terjadi kesalahan pada server otentikasi'
    };
  }
}

/**
 * Dedicated login helper with forced role parameter
 */
function apiLoginRole(params, expectedRole) {
  params = params || {};
  params.role = expectedRole;
  return apiLogin(params);
}

/**
 * Specialized login for Manager
 */
function apiLoginManager(params) {
  return apiLoginRole(params, CONFIG.ROLES.MANAGER);
}

/**
 * Specialized login for Kasir
 */
function apiLoginKasir(params) {
  return apiLoginRole(params, CONFIG.ROLES.KASIR);
}

/**
 * Specialized login for Siswa
 */
function apiLoginSiswa(params) {
  return apiLoginRole(params, CONFIG.ROLES.SISWA);
}

/**
 * Verifies token validity, expiration, and database status.
 * Returns full profile payload if valid.
 */
function apiVerifyToken(params) {
  try {
    params = params || {};
    const token = String(params.token || '').trim();
    const expectedRole = params.role ? String(params.role).trim().toUpperCase() : null;

    if (!token) {
      return {
        success: false,
        error_code: 'MISSING_TOKEN',
        message: 'Token otentikasi wajib disertakan'
      };
    }

    const session = verifyToken(token);
    if (!session) {
      return {
        success: false,
        error_code: 'INVALID_TOKEN',
        message: 'Sesi login telah berakhir atau tidak valid. Silakan login kembali.'
      };
    }

    if (expectedRole && session.role !== expectedRole) {
      return {
        success: false,
        error_code: 'ROLE_MISMATCH',
        message: `Akses ditolak. Sesi ini adalah ${session.role}, bukan ${expectedRole}.`
      };
    }

    // Jika sesi akun dev, buat profil tanpa query sheet produksi
    if (session.isDev || (typeof isDevAccount === 'function' && isDevAccount(session))) {
      const devAcc = (CONFIG.DEV_CONFIG && CONFIG.DEV_CONFIG.ACCOUNTS[session.username.toLowerCase()]) || {
        username: session.username,
        role: session.role,
        nama: session.nama,
        userId: session.userId,
        photoUrl: session.photoUrl
      };
      let profile;
      if (devAcc.role === CONFIG.ROLES.SISWA) {
        profile = buildStudentProfileData(
          { user_id: devAcc.userId, username: devAcc.username, nama: devAcc.nama, role: 'SISWA', status: 'AKTIF', photo_url: devAcc.photoUrl },
          { member_id: devAcc.memberId || devAcc.userId, user_id: devAcc.userId, nama: devAcc.nama, nis: devAcc.nis || 'DEV-001', kelas: devAcc.kelas || 'DEV', status: 'AKTIF', photo_url: devAcc.photoUrl }
        );
      } else if (devAcc.role === CONFIG.ROLES.KASIR) {
        profile = buildKasirProfileData({ user_id: devAcc.userId, username: devAcc.username, nama: devAcc.nama, role: 'KASIR', status: 'AKTIF', photo_url: devAcc.photoUrl });
      } else {
        profile = buildManagerProfileData({ user_id: devAcc.userId, username: devAcc.username, nama: devAcc.nama, role: 'MANAGER', status: 'AKTIF', photo_url: devAcc.photoUrl });
      }
      profile.token = token;
      profile.isDev = true;
      return { success: true, message: 'Token valid (Akun Dev)', data: profile };
    }

    const users = getSheetData(CONFIG.SHEETS.USERS);
    const user = users.find(u => u.user_id === session.userId);
    if (!user) {
      return {
        success: false,
        error_code: 'USER_NOT_FOUND',
        message: 'Pengguna tidak ditemukan di sistem'
      };
    }

    let profile = null;
    if (user.role === CONFIG.ROLES.SISWA) {
      const members = getSheetData(CONFIG.SHEETS.MEMBERS);
      let member = (typeof findMemberForUser === 'function')
        ? findMemberForUser(user, members)
        : members.find(m => m.user_id === user.user_id || m.member_id === user.user_id);
      if (!member && typeof ensureMemberForStudentUser === 'function') {
        member = ensureMemberForStudentUser(user);
      }
      profile = buildStudentProfileData(user, member);
    } else if (user.role === CONFIG.ROLES.KASIR) {
      profile = buildKasirProfileData(user);
    } else if (user.role === CONFIG.ROLES.MANAGER) {
      profile = buildManagerProfileData(user);
    } else {
      profile = buildStaffProfileData(user);
    }

    profile.token = token;

    return {
      success: true,
      message: 'Token valid',
      data: profile
    };
  } catch (err) {
    return {
      success: false,
      error_code: 'SERVER_ERROR',
      message: err.message
    };
  }
}

/**
 * Fetch latest profile data for currently authenticated user
 */
function apiGetProfile(params) {
  return apiVerifyToken(params);
}

/**
 * Update Profile / Photo via Mobile API
 */
function apiUpdateProfile(params) {
  try {
    params = params || {};
    const token = String(params.token || '').trim();
    if (!token) return { success: false, error_code: 'MISSING_TOKEN', message: 'Token wajib disertakan' };

    const session = verifyToken(token);
    if (!session) return { success: false, error_code: 'INVALID_TOKEN', message: 'Sesi login tidak valid atau telah berakhir' };

    const updateData = {};
    if (params.photo_url !== undefined || params.photoUrl !== undefined) {
      updateData.photo_url = String(params.photo_url || params.photoUrl || '').trim();
    }
    if (params.nama !== undefined || params.name !== undefined) {
      updateData.nama = String(params.nama || params.name || '').trim();
    }

    if (Object.keys(updateData).length === 0) {
      return { success: false, error_code: 'NO_DATA', message: 'Tidak ada data profil yang dikirim untuk diperbarui' };
    }

    const res = updateMyProfile(token, updateData);
    if (res.success) {
      // Re-fetch updated profile according to role
      return apiVerifyToken({ token: token });
    } else {
      return { success: false, error_code: 'UPDATE_FAILED', message: res.message || 'Gagal memperbarui profil' };
    }
  } catch (err) {
    return { success: false, error_code: 'SERVER_ERROR', message: err.message };
  }
}

/**
 * Change password via Mobile API
 */
function apiChangePassword(params) {
  try {
    params = params || {};
    const token = String(params.token || '').trim();
    const oldPassword = String(params.old_password || params.oldPassword || '').trim();
    const newPassword = String(params.new_password || params.newPassword || '').trim();

    if (!token) return { success: false, error_code: 'MISSING_TOKEN', message: 'Token wajib disertakan' };
    if (!oldPassword) return { success: false, error_code: 'MISSING_OLD_PASS', message: 'Password lama wajib diisi' };
    if (!newPassword || newPassword.length < 4) return { success: false, error_code: 'INVALID_NEW_PASS', message: 'Password baru minimal 4 karakter' };

    const session = verifyToken(token);
    if (!session) return { success: false, error_code: 'INVALID_TOKEN', message: 'Sesi login tidak valid' };

    const res = changePassword(token, oldPassword, newPassword);
    if (res.success) {
      return { success: true, message: 'Password berhasil diubah!' };
    } else {
      return { success: false, error_code: 'CHANGE_PASS_FAILED', message: res.message };
    }
  } catch (err) {
    return { success: false, error_code: 'SERVER_ERROR', message: err.message };
  }
}

/**
 * Logout from Mobile API
 */
function apiLogout(params) {
  try {
    params = params || {};
    const token = String(params.token || '').trim();
    if (token) {
      const session = verifyToken(token);
      if (session) {
        auditLog(session.userId, session.role, 'API_LOGOUT', 'MOBILE_APP', 'Logout dari Mobile App');
      }
      try {
        CacheService.getScriptCache().remove(token);
      } catch (e) {}
    }
    return {
      success: true,
      message: 'Berhasil logout'
    };
  } catch (err) {
    return {
      success: true,
      message: 'Berhasil logout'
    };
  }
}

// ============================================================
// PROFILE BUILDER HELPERS FOR EACH ROLE
// ============================================================

/**
 * Role SISWA Profile Builder
 * Includes Student Identity, Dual Balances, Target, and Permissions
 */
function buildStudentProfileData(user, member) {
  const memberId = member ? member.member_id : user.user_id;
  const defaultAvatar = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.nama || user.username) + '&background=10b981&color=fff&bold=true&format=png';
  const photoUrl = (member && member.photo_url) ? member.photo_url : (user.photo_url || defaultAvatar);

  let dualBalance = { tabungan: 0, hijau: 0, total: 0 };
  try {
    dualBalance = calculateDualBalance(memberId);
  } catch (e) {
    console.warn('Could not calculate balance:', e);
  }

  let activeTarget = null;
  try {
    const targets = getSheetData(CONFIG.SHEETS.TARGETS);
    const found = targets.find(t => t.member_id === memberId && t.status === 'AKTIF');
    if (found) {
      const targetAmt = parseFloat(found.amount) || 0;
      const pct = targetAmt > 0 ? Math.min(100, Math.round((dualBalance.tabungan / targetAmt) * 100)) : 0;
      activeTarget = {
        targetId: found.target_id,
        name: found.name,
        amount: targetAmt,
        currentSaved: dualBalance.tabungan,
        progressPercent: pct,
        isReached: dualBalance.tabungan >= targetAmt
      };
    }
  } catch (e) {}

  return {
    userId: user.user_id,
    memberId: memberId,
    username: user.username,
    nama: user.nama || (member ? member.nama : ''),
    role: CONFIG.ROLES.SISWA,
    status: user.status || (member ? member.status : 'AKTIF'),
    photoUrl: photoUrl,
    member: {
      memberId: memberId,
      nis: member ? member.nis : '',
      kelas: member ? member.kelas : '',
      registeredAt: member ? member.registered_at : user.created_at,
      status: member ? member.status : user.status,
      qrData: memberId
    },
    balances: {
      saldoTabungan: dualBalance.tabungan,
      saldoHijau: dualBalance.hijau,
      totalSaldo: dualBalance.total,
      formatted: {
        saldoTabungan: 'Rp ' + dualBalance.tabungan.toLocaleString('id-ID'),
        saldoHijau: 'Rp ' + dualBalance.hijau.toLocaleString('id-ID'),
        totalSaldo: 'Rp ' + dualBalance.total.toLocaleString('id-ID')
      }
    },
    target: activeTarget,
    permissions: {
      canViewBalance: true,
      canViewHistory: true,
      canRequestSeed: true,
      canSetTarget: true,
      canUseQrCode: true
    }
  };
}

/**
 * Role KASIR Profile Builder
 * Includes Cashier Identity and Operator Permissions
 */
function buildKasirProfileData(user) {
  const defaultAvatar = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.nama || user.username) + '&background=0284c7&color=fff&bold=true&format=png';
  const photoUrl = user.photo_url || defaultAvatar;

  return {
    userId: user.user_id,
    username: user.username,
    nama: user.nama,
    role: CONFIG.ROLES.KASIR,
    status: user.status,
    photoUrl: photoUrl,
    permissions: {
      canScanMember: true,
      canProcessTransaction: true,
      canWeighWaste: true,
      canCashDepositWithdraw: true,
      canShoppingKoperasi: true,
      canExchangeAtk: true,
      canFulfillSeed: true,
      canRequestVoid: true,
      canViewCashierHistory: true
    }
  };
}

/**
 * Role MANAGER Profile Builder
 * Includes Administrator Identity and Leadership Permissions
 */
function buildManagerProfileData(user) {
  const defaultAvatar = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.nama || user.username) + '&background=4f46e5&color=fff&bold=true&format=png';
  const photoUrl = user.photo_url || defaultAvatar;

  return {
    userId: user.user_id,
    username: user.username,
    nama: user.nama,
    role: CONFIG.ROLES.MANAGER,
    status: user.status,
    photoUrl: photoUrl,
    permissions: {
      canManageMembers: true,
      canApproveMembers: true,
      canApproveVoid: true,
      canApproveSeed: true,
      canManageSeeds: true,
      canEditSeedTarget: true,
      canManageStaff: true,
      canManageWastePrices: true,
      canManageProducts: true,
      canViewFinancialReports: true,
      canViewImpactReport: true,
      canViewAuditLogs: true
    }
  };
}

/**
 * Fallback Profile Builder for generic staff
 */
function buildStaffProfileData(user) {
  const defaultAvatar = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.nama || user.username) + '&background=64748b&color=fff&bold=true&format=png';
  return {
    userId: user.user_id,
    username: user.username,
    nama: user.nama,
    role: user.role,
    status: user.status,
    photoUrl: user.photo_url || defaultAvatar
  };
}
