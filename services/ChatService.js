// ChatService.gs
// Layanan Pendukung Fitur Chat Realtime SATUS Mobile (Kontak Pengguna & Pengiriman FCM Notification)

/**
 * Mengambil daftar pengguna aktif yang dapat dihubungi melalui fitur chat
 * @param {string} token Sesi pengguna
 * @param {string} query Kata kunci pencarian (opsional)
 * @param {string} roleFilter Filter berdasarkan role (SISWA, KASIR, MANAGER) (opsional)
 * @returns {Object} ApiResponse
 */
function getUsersForChat(token, query, roleFilter) {
  try {
    const session = verifyToken(token);
    if (!session) {
      return { success: false, message: 'Sesi tidak valid atau telah kedaluwarsa' };
    }

    const currentUserId = String(session.userId || '').trim();
    const currentUsername = String(session.username || '').toLowerCase().trim();
    const isDevSession = session.isDev === true || (typeof isDevAccount === 'function' && isDevAccount(session));

    const users = getSheetData(CONFIG.SHEETS.USERS) || [];
    const members = getSheetData(CONFIG.SHEETS.MEMBERS) || [];

    // Map data member untuk lookup cepat berdasarkan user_id atau member_id
    const memberMap = {};
    if (Array.isArray(members)) {
      members.forEach(m => {
        const uid = String(m.user_id || m.member_id || '').trim();
        if (uid) {
          memberMap[uid] = m;
        }
        if (m.nama) {
          memberMap['name_' + String(m.nama).toLowerCase().trim()] = m;
        }
      });
    }

    const q = query ? String(query).toLowerCase().trim() : '';
    const rf = roleFilter ? String(roleFilter).toUpperCase().trim() : '';

    const results = [];
    const seenUserIds = {};

    // 1. Dukungan Akun Dev jika dalam sesi dev
    if (isDevSession && CONFIG.DEV_CONFIG && CONFIG.DEV_CONFIG.ACCOUNTS) {
      Object.keys(CONFIG.DEV_CONFIG.ACCOUNTS).forEach(key => {
        const acc = CONFIG.DEV_CONFIG.ACCOUNTS[key];
        const accUid = String(acc.userId || acc.memberId || '').trim();
        const accUsername = String(acc.username || '').toLowerCase().trim();
        const accRole = String(acc.role || '').toUpperCase().trim();
        const accNama = String(acc.nama || acc.username || 'Pengguna Dev');

        if (!accUid || accUid === currentUserId || (accUsername && accUsername === currentUsername)) {
          return;
        }

        if (rf && rf !== 'ALL' && accRole !== rf) {
          return;
        }

        if (q) {
          const matchNama = accNama.toLowerCase().includes(q);
          const matchUser = accUsername.includes(q);
          const matchNis = acc.nis ? String(acc.nis).toLowerCase().includes(q) : false;
          if (!matchNama && !matchUser && !matchNis) return;
        }

        seenUserIds[accUid] = true;
        if (accUsername) seenUserIds[accUsername] = true;

        results.push({
          userId: accUid,
          nama: accNama,
          username: accUsername,
          role: accRole,
          status: 'AKTIF',
          photoUrl: acc.photoUrl || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(accNama) + '&background=10b981&color=fff&bold=true&format=png'),
          nis: acc.nis ? String(acc.nis) : '',
          kelas: acc.kelas ? String(acc.kelas) : ''
        });
      });
    }

    // 2. Iterasi sheet Users
    if (Array.isArray(users)) {
      users.forEach(u => {
        const uid = String(u.user_id || '').trim();
        const uusername = String(u.username || '').toLowerCase().trim();
        const urole = String(u.role || '').toUpperCase().trim();
        const unama = String(u.nama || u.username || 'Pengguna');

        // Lewati akun sendiri atau akun yang sudah diproses
        if (!uid || uid === currentUserId || (uusername && uusername === currentUsername)) {
          return;
        }
        if (seenUserIds[uid] || (uusername && seenUserIds[uusername])) {
          return;
        }

        // Filter akun dev dari tabel prod jika bukan sesi dev
        if (!isDevSession && typeof isDevAccount === 'function' && isDevAccount(u)) {
          return;
        }

        // Normalisasi status: jika kosong default ke 'AKTIF'
        let rawStatus = String(u.status || '').trim().toUpperCase();
        if (!rawStatus) rawStatus = 'AKTIF';

        // Lewati akun yang statusnya dihapus
        if (rawStatus === 'DELETED' || rawStatus === 'HAPUS' || rawStatus === 'TERHAPUS') {
          return;
        }

        let ustatus = 'AKTIF';
        if (rawStatus === 'NONAKTIF' || rawStatus === 'INACTIVE' || rawStatus === 'BLOCKED') {
          ustatus = 'NONAKTIF';
        } else if (rawStatus === 'MENUNGGU' || rawStatus === 'PENDING' || rawStatus === 'UNVERIFIED') {
          ustatus = 'MENUNGGU';
        }

        // Filter role jika diminta
        if (rf && rf !== 'ALL' && urole !== rf) {
          return;
        }

        // Cari metadata kelas & nis untuk siswa dari memberMap
        const memberInfo = memberMap[uid] || memberMap['name_' + unama.toLowerCase().trim()] || {};
        const nis = memberInfo.nis ? String(memberInfo.nis) : (u.nis ? String(u.nis) : '');
        const kelas = memberInfo.kelas ? String(memberInfo.kelas) : (u.kelas ? String(u.kelas) : '');

        // Filter query pencarian (nama, nis, username)
        if (q) {
          const matchesNama = unama.toLowerCase().includes(q);
          const matchesNis = nis.toLowerCase().includes(q);
          const matchesUsername = uusername.includes(q);
          if (!matchesNama && !matchesNis && !matchesUsername) {
            return;
          }
        }

        const rawPhoto = u.photo_url || memberInfo.photo_url;
        const uphoto = String(rawPhoto || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(unama) + '&background=10b981&color=fff&bold=true&format=png'));

        seenUserIds[uid] = true;
        if (uusername) seenUserIds[uusername] = true;

        results.push({
          userId: uid,
          nama: unama,
          username: uusername,
          role: urole,
          status: ustatus,
          photoUrl: uphoto,
          nis: nis,
          kelas: kelas
        });
      });
    }

    // 3. Fallback: sertakan anggota dari sheet Members yang belum tercatat di Users
    if (Array.isArray(members) && (!rf || rf === 'ALL' || rf === 'SISWA')) {
      members.forEach(m => {
        const mUid = String(m.user_id || m.member_id || '').trim();
        const mnama = String(m.nama || 'Siswa').trim();

        if (!mUid || mUid === currentUserId || seenUserIds[mUid]) {
          return;
        }

        if (!isDevSession && typeof isDevAccount === 'function' && isDevAccount(m)) {
          return;
        }

        let rawStatus = String(m.status || '').trim().toUpperCase();
        if (!rawStatus) rawStatus = 'AKTIF';

        if (rawStatus === 'DELETED' || rawStatus === 'HAPUS' || rawStatus === 'TERHAPUS') {
          return;
        }

        let mstatus = 'AKTIF';
        if (rawStatus === 'NONAKTIF' || rawStatus === 'INACTIVE' || rawStatus === 'BLOCKED') {
          mstatus = 'NONAKTIF';
        } else if (rawStatus === 'MENUNGGU' || rawStatus === 'PENDING' || rawStatus === 'UNVERIFIED') {
          mstatus = 'MENUNGGU';
        }

        const nis = m.nis ? String(m.nis) : '';
        const kelas = m.kelas ? String(m.kelas) : '';

        if (q) {
          const matchesNama = mnama.toLowerCase().includes(q);
          const matchesNis = nis.toLowerCase().includes(q);
          if (!matchesNama && !matchesNis) {
            return;
          }
        }

        const mphoto = String(m.photo_url || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(mnama) + '&background=10b981&color=fff&bold=true&format=png'));

        seenUserIds[mUid] = true;

        results.push({
          userId: mUid,
          nama: mnama,
          username: '',
          role: 'SISWA',
          status: mstatus,
          photoUrl: mphoto,
          nis: nis,
          kelas: kelas
        });
      });
    }

    // Urutkan berdasarkan Nama alfabetis
    results.sort((a, b) => a.nama.localeCompare(b.nama));

    return {
      success: true,
      message: 'Berhasil memuat daftar pengguna obrolan',
      data: results
    };
  } catch (error) {
    console.error('Error in getUsersForChat:', error);
    return {
      success: false,
      message: 'Gagal memuat daftar obrolan: ' + error.message
    };
  }
}

/**
 * Mengirimkan Push Notification pesan obrolan baru ke penerima via FCM v1
 * @param {string} token Sesi pengirim
 * @param {string} recipientId User ID penerima pesan
 * @param {string} message Teks pesan yang dikirim
 * @param {string} roomId ID Room Firestore
 * @param {string} messageId ID Pesan Firestore
 * @returns {Object} ApiResponse
 */
function sendChatPushNotification(token, recipientId, message, roomId, messageId) {
  try {
    const session = verifyToken(token);
    if (!session) {
      return { success: false, message: 'Sesi pengirim tidak valid' };
    }

    if (!recipientId) {
      return { success: false, message: 'Recipient ID wajib disertakan' };
    }

    const topic = 'user_' + sanitizeFcmTopic(recipientId);
    const roleLabel = session.role ? ` (${session.role})` : '';
    const title = `💬 ${session.nama || 'Pesan Baru'}${roleLabel}`;
    
    // Potong isi pesan jika terlalu panjang untuk notifikasi
    const cleanMessage = String(message || '').trim();
    const body = cleanMessage.length > 120 
      ? cleanMessage.substring(0, 117) + '...' 
      : cleanMessage;

    const dataPayload = {
      type: 'CHAT_MESSAGE',
      roomId: String(roomId || ''),
      senderId: String(session.userId || ''),
      senderName: String(session.nama || ''),
      senderRole: String(session.role || ''),
      messageId: String(messageId || ''),
      channel_id: 'satus_chat_channel'
    };

    const channelId = (CONFIG.FIREBASE && CONFIG.FIREBASE.CHANNELS && CONFIG.FIREBASE.CHANNELS.CHAT)
      ? CONFIG.FIREBASE.CHANNELS.CHAT
      : 'satus_chat_channel';

    const result = sendFcmTopicMessage(topic, title, body, dataPayload, channelId);

    return {
      success: true,
      message: 'Notifikasi obrolan berhasil dipicu',
      data: result
    };
  } catch (error) {
    console.error('Error in sendChatPushNotification:', error);
    return {
      success: false,
      message: 'Gagal mengirim notifikasi obrolan: ' + error.message
    };
  }
}
