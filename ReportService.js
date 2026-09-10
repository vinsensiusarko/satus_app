// ReportService.gs

function getDashboardData(token) {
  try {
    const session = verifyToken(token);
    if (!session) throw new Error('Unauthorized');
    
    if (session.role === CONFIG.ROLES.MANAGER) {
      return getManagerDashboard();
    } else if (session.role === CONFIG.ROLES.KASIR) {
      return getKasirDashboard();
    } else if (session.role === CONFIG.ROLES.SISWA) {
      if (session.isDev || (typeof isDevAccount === 'function' && isDevAccount(session))) {
        return getSiswaDashboard(session.userId || 'DEV-SIS-001', {
          member_id: 'DEV-SIS-001',
          user_id: 'DEV-SIS-001',
          nama: session.nama || 'Siswa Dev (Testing)',
          nis: 'DEV-001',
          kelas: 'DEV',
          status: 'AKTIF',
          qr_data: 'DEV-SIS-001',
          photoUrl: session.photoUrl || ''
        });
      }

      let members = getSheetData(CONFIG.SHEETS.MEMBERS);
      let member = (typeof findMemberForUser === 'function') 
        ? findMemberForUser(session, members) 
        : members.find(m => m.user_id === session.userId || m.member_id === session.userId);
      
      if (!member) {
        // Auto-heal: sinkronisasi jika user ada di sheet Users
        const users = getSheetData(CONFIG.SHEETS.USERS);
        const user = users.find(u => u.user_id === session.userId || u.username === session.username);
        if (user && typeof ensureMemberForStudentUser === 'function') {
          member = ensureMemberForStudentUser(user);
        }
      }

      // Jika tetap belum ditemukan, fallback agar dashboard siswa tidak blank/stuck
      if (!member) {
        member = {
          member_id: session.userId || 'KH-SISWA',
          user_id: session.userId,
          nama: session.nama || session.username || 'Siswa',
          nis: '-',
          kelas: '-',
          status: session.status || CONFIG.MEMBER_STATUS.MENUNGGU,
          qr_data: session.userId || 'KH-SISWA'
        };
      }
      return getSiswaDashboard(member.member_id, member);
    }
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

function getManagerDashboard() {
  const allMembers = getSheetData(CONFIG.SHEETS.MEMBERS);
  const allUsers = getSheetData(CONFIG.SHEETS.USERS);
  
  // Filter akun dev agar statistik dashboard produksi murni 100% data nyata
  const members = allMembers.filter(m => typeof isDevAccount !== 'function' || !isDevAccount(m));
  const users = allUsers.filter(u => typeof isDevAccount !== 'function' || !isDevAccount(u));

  const transactions = getSheetData(CONFIG.SHEETS.TRANSACTIONS)
    .filter(t => t.status === 'COMPLETED' && (typeof isDevAccount !== 'function' || !isDevAccount({ member_id: t.member_id })));
  const wastes = getSheetData(CONFIG.SHEETS.WASTE_TRANSACTIONS)
    .filter(w => typeof isDevAccount !== 'function' || !isDevAccount({ member_id: w.member_id }));
  const seedRequests = getSheetData(CONFIG.SHEETS.SEED_REQUESTS)
    .filter(r => typeof isDevAccount !== 'function' || !isDevAccount({ member_id: r.member_id }));
  // Total Pengguna Unik di sistem (Siswa + Kasir + Manager)
  const totalAnggota = users.length;
  
  const siswaAktif = members.filter(m => m.status === 'AKTIF').length;
  const siswaMenunggu = members.filter(m => m.status === 'MENUNGGU').length;
  const siswaNonaktif = members.filter(m => m.status === 'NONAKTIF').length;
  const totalSiswa = members.length;
  
  const kasirs = users.filter(u => u.role === 'KASIR');
  const totalKasir = kasirs.length;
  const kasirAktif = kasirs.filter(u => u.status === 'AKTIF').length;
  const kasirNonaktif = kasirs.filter(u => u.status === 'NONAKTIF').length;
  
  const admins = users.filter(u => u.role === 'MANAGER');
  const totalAdmin = admins.length;
  const adminAktif = admins.filter(u => u.status === 'AKTIF').length;
  const adminNonaktif = admins.filter(u => u.status === 'NONAKTIF').length;
  
  // Perhitungan Dual Saldo Global
  let totalSaldoTabungan = 0;
  let totalSaldoHijau = 0;
  
  members.forEach(m => {
    totalSaldoTabungan += calculateTabungan(m.member_id);
    totalSaldoHijau += calculateHijau(m.member_id);
  });
  
  const totalSaldo = totalSaldoTabungan + totalSaldoHijau;
  
  const today = new Date().toDateString();
  const txHariIni = transactions.filter(t => new Date(t.timestamp).toDateString() === today).length;
  
  const plastikTerkumpul = wastes
    .filter(w => w.waste_type === 'PLASTIK')
    .reduce((sum, w) => sum + (parseFloat(w.quantity) || 0), 0);
    
  const jelantahTerkumpul = wastes
    .filter(w => w.waste_type === 'JELANTAH')
    .reduce((sum, w) => sum + (parseFloat(w.quantity) || 0), 0);
    
  const totalTransaksi = transactions.length;
  
  const nilaiEkonomiSampah = wastes.reduce((sum, w) => sum + (parseFloat(w.total_value) || 0), 0);

  // PRD v2 Bibit & ATK metrics
  const bibitTerkonversi = seedRequests
    .filter(r => r.status === CONFIG.SEED_REQUEST_STATUS.APPROVED || r.status === CONFIG.SEED_REQUEST_STATUS.FULFILLED)
    .reduce((sum, r) => sum + (parseInt(r.quantity, 10) || 0), 0);
    
  const pengajuanMenunggu = seedRequests
    .filter(r => r.status === CONFIG.SEED_REQUEST_STATUS.PENDING).length;

  let pendingVoidCount = 0;
  try {
    ensureVoidRequestsSheet();
    const voidRequests = getSheetData(CONFIG.SHEETS.VOID_REQUESTS);
    pendingVoidCount = voidRequests.filter(v => v.status === CONFIG.VOID_STATUS.PENDING).length;
  } catch(e) {}

  const atkDitukar = transactions
    .filter(t => t.type === CONFIG.TRANSACTION_TYPES.TUKAR_HIJAU_ATK).length;

  const saldoHijauDigunakan = transactions
    .filter(t => isHijauTx(t))
    .reduce((sum, t) => sum + (parseFloat(t.debit) || 0), 0);

  return {
    success: true,
    data: {
      totalAnggota,
      totalSiswa,
      siswaAktif,
      siswaMenunggu,
      siswaNonaktif,
      totalKasir,
      kasirAktif,
      kasirNonaktif,
      totalAdmin,
      adminAktif,
      adminNonaktif,
      totalSaldoTabungan,
      totalSaldoHijau,
      totalSaldo,
      txHariIni,
      plastikTerkumpul,
      jelantahTerkumpul,
      totalTransaksi,
      nilaiEkonomiSampah,
      bibitTerkonversi,
      atkDitukar,
      pengajuanMenunggu,
      saldoHijauDigunakan,
      pendingVoidCount,
      targetBibit: (typeof getSeedTarget === 'function' ? getSeedTarget() : 500)
    }
  };
}

function getKasirDashboard() {
  ensureVoidRequestsSheet();
  const voidRequests = getSheetData(CONFIG.SHEETS.VOID_REQUESTS);
  const pendingVoidTxIds = {};
  voidRequests.forEach(v => {
    if (v.status === CONFIG.VOID_STATUS.PENDING) {
      pendingVoidTxIds[v.transaction_id] = true;
    }
  });

  const transactions = getSheetData(CONFIG.SHEETS.TRANSACTIONS);
  const today = new Date().toDateString();
  const txHariIni = transactions.filter(t => new Date(t.timestamp).toDateString() === today);
  
  return {
    success: true,
    data: {
      totalTxHariIni: txHariIni.filter(t => t.status === 'COMPLETED').length,
      allTx: transactions.map(t => {
        if (!t.wallet_type) t.wallet_type = isTabunganTx(t) ? CONFIG.WALLET_TYPES.TABUNGAN : CONFIG.WALLET_TYPES.HIJAU;
        t.has_pending_void = !!pendingVoidTxIds[t.transaction_id];
        return t;
      }).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp))
    }
  };
}

function getSiswaDashboard(memberId, fallbackMember) {
  // Jika akun dev, sediakan mock dashboard data langsung tanpa baca transaksi produksi
  if (typeof isDevUserId === 'function' && isDevUserId(memberId)) {
    const devProfile = fallbackMember || {
      member_id: 'DEV-SIS-001',
      user_id: 'DEV-SIS-001',
      nama: 'Siswa Dev (Testing)',
      nis: 'DEV-001',
      kelas: 'DEV',
      status: 'AKTIF',
      photoUrl: 'https://ui-avatars.com/api/?name=Siswa+Dev&background=10b981&color=fff&bold=true'
    };
    return {
      success: true,
      data: {
        profile: devProfile,
        balance: 100000,
        saldoTabungan: 100000,
        saldoHijau: 50000,
        dualBalance: { tabungan: 100000, hijau: 50000, total: 150000 },
        kontribusi: {
          plastik: 5,
          jelantah: 2,
          bibit: 1,
          nilaiHijau: 50000
        },
        target: {
          target_id: 'TGT-DEV',
          target_name: 'Beli Sepatu Sekolah (Demo Target)',
          target_amount: 250000,
          currentSaved: 100000,
          progressPercent: 40
        },
        recentTx: [
          { transaction_id: 'TRX-DEV-001', timestamp: new Date().toISOString(), type: 'SETOR_TUNAI', wallet_type: 'TABUNGAN', amount: 50000, description: 'Setoran Awal (Testing)' },
          { transaction_id: 'TRX-DEV-002', timestamp: new Date(Date.now() - 86400000).toISOString(), type: 'SETOR_PLASTIK', wallet_type: 'HIJAU', amount: 25000, description: 'Setor Sampah Plastik 2.5 Kg (Testing)' }
        ]
      }
    };
  }

  const members = getSheetData(CONFIG.SHEETS.MEMBERS);
  let member = members.find(m => m.member_id === memberId || m.user_id === memberId);
  if (!member && fallbackMember) member = fallbackMember;

  const users = getSheetData(CONFIG.SHEETS.USERS);
  const user = member 
    ? users.find(u => (u.user_id && member.user_id && u.user_id === member.user_id) || (u.user_id && member.member_id && u.user_id === member.member_id) || (u.nama && member.nama && u.nama.toLowerCase().trim() === member.nama.toLowerCase().trim()))
    : null;
  const photoUrl = user ? (user.photo_url || '') : ((member && member.photo_url) ? member.photo_url : '');
  
  const memberProfile = member ? {
    ...member,
    photoUrl: photoUrl
  } : {
    member_id: memberId,
    user_id: memberId,
    nama: 'Siswa',
    nis: '-',
    kelas: '-',
    status: (user && user.status) || CONFIG.MEMBER_STATUS.MENUNGGU,
    photoUrl: photoUrl
  };

  const dualBalance = calculateDualBalance(memberId);
  
  const transactions = getSheetData(CONFIG.SHEETS.TRANSACTIONS)
    .filter(t => t.member_id === memberId && t.status === 'COMPLETED')
    .map(t => {
      if (!t.wallet_type) t.wallet_type = isTabunganTx(t) ? CONFIG.WALLET_TYPES.TABUNGAN : CONFIG.WALLET_TYPES.HIJAU;
      return t;
    })
    .sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
    
  const wastes = getSheetData(CONFIG.SHEETS.WASTE_TRANSACTIONS).filter(w => w.member_id === memberId);
  const seedRequests = getSheetData(CONFIG.SHEETS.SEED_REQUESTS).filter(r => r.member_id === memberId);

  const plastik = wastes.filter(w => w.waste_type === 'PLASTIK').reduce((sum, w) => sum + (parseFloat(w.quantity) || 0), 0);
  const jelantah = wastes.filter(w => w.waste_type === 'JELANTAH').reduce((sum, w) => sum + (parseFloat(w.quantity) || 0), 0);
  const nilaiHijau = wastes.reduce((sum, w) => sum + (parseFloat(w.total_value) || 0), 0);
  
  const bibit = seedRequests
    .filter(r => r.status === CONFIG.SEED_REQUEST_STATUS.APPROVED || r.status === CONFIG.SEED_REQUEST_STATUS.FULFILLED)
    .reduce((sum, r) => sum + (parseInt(r.quantity, 10) || 0), 0);

  const targets = getSheetData(CONFIG.SHEETS.TARGETS).filter(t => t.member_id === memberId && t.status === 'AKTIF');
  const activeTarget = targets.length > 0 ? targets[0] : null;
  
  return {
    success: true,
    data: {
      profile: memberProfile,
      balance: dualBalance.tabungan, // legacy compat
      saldoTabungan: dualBalance.tabungan,
      saldoHijau: dualBalance.hijau,
      dualBalance: dualBalance,
      kontribusi: {
        plastik: plastik,
        jelantah: jelantah,
        bibit: bibit,
        nilaiHijau: nilaiHijau
      },
      target: activeTarget,
      recentTx: transactions.slice(0, 10)
    }
  };
}

function getLaporanManager(token, period) {
  try {
    const session = requireRole(token, [CONFIG.ROLES.MANAGER]);
    
    let startDate = new Date(0); // Default to all time
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();
    
    if (period === 'harian') {
      startDate = new Date(y, m, d);
    } else if (period === 'mingguan') {
      startDate = new Date(y, m, d - now.getDay());
    } else if (period === 'bulanan') {
      startDate = new Date(y, m, 1);
    }

    const allMembers = getSheetData(CONFIG.SHEETS.MEMBERS);
    const members = allMembers.filter(m => typeof isDevAccount !== 'function' || !isDevAccount(m));
    const transactions = getSheetData(CONFIG.SHEETS.TRANSACTIONS)
      .filter(t => t.status === 'COMPLETED' && (typeof isDevAccount !== 'function' || !isDevAccount({ member_id: t.member_id })));
    const wastes = getSheetData(CONFIG.SHEETS.WASTE_TRANSACTIONS)
      .filter(w => typeof isDevAccount !== 'function' || !isDevAccount({ member_id: w.member_id }));
    const seedRequests = getSheetData(CONFIG.SHEETS.SEED_REQUESTS)
      .filter(r => typeof isDevAccount !== 'function' || !isDevAccount({ member_id: r.member_id }));
    
    const txInPeriod = transactions.filter(t => {
      const txDate = new Date(t.timestamp);
      return !isNaN(txDate.getTime()) && txDate >= startDate;
    });
    
    const wastesInPeriod = wastes.filter(w => {
      const wDate = new Date(w.timestamp);
      return !isNaN(wDate.getTime()) && wDate >= startDate;
    });
    
    const membersInPeriod = members.filter(m => {
      const mDate = new Date(m.tanggal_daftar || m.created_at || 0);
      return !isNaN(mDate.getTime()) && mDate >= startDate;
    });

    const seedsInPeriod = seedRequests.filter(s => {
      const sDate = new Date(s.requested_at || 0);
      return !isNaN(sDate.getTime()) && sDate >= startDate;
    });

    // Keuangan Tabungan
    const setorTunai = txInPeriod.filter(t => t.type === CONFIG.TRANSACTION_TYPES.SETOR_TUNAI).reduce((s,t) => s + (parseFloat(t.amount)||0), 0);
    const tarikTunai = txInPeriod.filter(t => t.type === CONFIG.TRANSACTION_TYPES.TARIK_TUNAI).reduce((s,t) => s + (parseFloat(t.amount)||0), 0);
    const belanjaTabungan = txInPeriod.filter(t => t.type === CONFIG.TRANSACTION_TYPES.BELANJA_TABUNGAN || t.type === 'BELANJA_KOPERASI').reduce((s,t) => s + (parseFloat(t.amount)||0), 0);

    // Keuangan Hijau
    const nilaiPlastik = txInPeriod.filter(t => t.type === CONFIG.TRANSACTION_TYPES.SETOR_PLASTIK).reduce((s,t) => s + (parseFloat(t.amount)||0), 0);
    const nilaiJelantah = txInPeriod.filter(t => t.type === CONFIG.TRANSACTION_TYPES.SETOR_JELANTAH).reduce((s,t) => s + (parseFloat(t.amount)||0), 0);
    const nilaiTukarAtk = txInPeriod.filter(t => t.type === CONFIG.TRANSACTION_TYPES.TUKAR_HIJAU_ATK).reduce((s,t) => s + (parseFloat(t.amount)||0), 0);
    const nilaiKonversiBibit = txInPeriod.filter(t => t.type === CONFIG.TRANSACTION_TYPES.SETUJUI_BIBIT).reduce((s,t) => s + (parseFloat(t.amount)||0), 0);

    // Saldo Global
    let totalSaldoTabungan = 0;
    let totalSaldoHijau = 0;
    members.forEach(m => {
      totalSaldoTabungan += calculateTabungan(m.member_id);
      totalSaldoHijau += calculateHijau(m.member_id);
    });

    // Lingkungan
    const kgPlastik = wastesInPeriod.filter(w => w.waste_type === 'PLASTIK').reduce((s,w) => s + (parseFloat(w.quantity)||0), 0);
    const literJelantah = wastesInPeriod.filter(w => w.waste_type === 'JELANTAH').reduce((s,w) => s + (parseFloat(w.quantity)||0), 0);
    const jumlahSetoranSampah = wastesInPeriod.length;
    const bibitTerkonversi = seedsInPeriod.filter(s => s.status === CONFIG.SEED_REQUEST_STATUS.APPROVED || s.status === CONFIG.SEED_REQUEST_STATUS.FULFILLED)
      .reduce((s,r) => s + (parseInt(r.quantity, 10)||0), 0);

    // Keanggotaan
    const anggotaAktif = members.filter(m => m.status === 'AKTIF').length;
    const anggotaBaru = membersInPeriod.length;
    const anggotaNonaktif = members.filter(m => m.status === 'NONAKTIF').length;

    // Aktivitas
    const jumlahTransaksi = txInPeriod.length;
    
    const kasirMap = {};
    const siswaMap = {};
    txInPeriod.forEach(t => {
      kasirMap[t.cashier_id] = (kasirMap[t.cashier_id] || 0) + 1;
      siswaMap[t.member_id] = (siswaMap[t.member_id] || 0) + 1;
    });

    let topKasir = Object.keys(kasirMap).map(k => ({id: k, count: kasirMap[k]})).sort((a,b) => b.count - a.count).slice(0,3);
    let topSiswa = Object.keys(siswaMap).map(s => ({id: s, count: siswaMap[s]})).sort((a,b) => b.count - a.count).slice(0,3);

    return {
      success: true,
      data: {
        keuangan: { 
          setorTunai, 
          tarikTunai, 
          belanjaTabungan, 
          nilaiPlastik, 
          nilaiJelantah, 
          nilaiTukarAtk, 
          nilaiKonversiBibit, 
          totalSaldoTabungan, 
          totalSaldoHijau, 
          totalSaldo: totalSaldoTabungan + totalSaldoHijau 
        },
        lingkungan: { kgPlastik, literJelantah, jumlahSetoranSampah, bibitTerkonversi },
        keanggotaan: { anggotaAktif, anggotaBaru, anggotaNonaktif },
        aktivitas: { jumlahTransaksi, topKasir, topSiswa }
      }
    };
  } catch (err) {
    if (err.message.includes("Unauthorized")) throw err; return { success: false, message: err.message };
  }
}
