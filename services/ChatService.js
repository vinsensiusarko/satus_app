// ChatService.gs
// Layanan Pendukung Fitur Chat Realtime SATUS Mobile (Kontak Pengguna & Pengiriman FCM Notification)

/**
 * Mengambil daftar pengguna aktif yang dapat dihubungi melalui fitur chat
 * @param {string} token Sesi pengguna
 * @param {string} query Kata kunci pencarian (opsional)
 * @param {string} roleFilter Filter berdasarkan role (SISWA, KASIR, MANAGER) (opsional)
 * @returns {Object} ApiResponse
 */
/**
 * Helper internal untuk mengambil dan mem-cache daftar seluruh pengguna yang dapat dichat
 * Menggunakan CacheService (TTL 5 menit) untuk memangkas latensi dari ~1.5s menjadi ~80ms.
 * @param {boolean} isDevSession
 * @returns {Array<Object>}
 */
function _getMasterChatUsersList(isDevSession) {
  const cache = CacheService.getScriptCache();
  const cacheKey = isDevSession ? 'CHAT_MASTER_USERS_DEV' : 'CHAT_MASTER_USERS_PROD';
  
  try {
    const cached = cache.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (_) {}

  const users = getSheetData(CONFIG.SHEETS.USERS) || [];
  const members = getSheetData(CONFIG.SHEETS.MEMBERS) || [];

  // Map data member untuk lookup cepat berdasarkan user_id atau member_id
  const memberMap = {};
  if (Array.isArray(members)) {
    members.forEach(m => {
      const uid = String(m.user_id || m.userId || m.member_id || m.memberId || m.id || m.ID || '').trim();
      if (uid) {
        memberMap[uid] = m;
        memberMap[uid.toLowerCase()] = m;
      }
      const mn = String(m.nama || m.Nama || m.name || '').toLowerCase().trim();
      if (mn) {
        memberMap['name_' + mn] = m;
      }
    });
  }

  const list = [];
  const seenUserIds = {};

  // 1. Dukungan Akun Dev jika dalam sesi dev
  if (isDevSession && CONFIG.DEV_CONFIG && CONFIG.DEV_CONFIG.ACCOUNTS) {
    Object.keys(CONFIG.DEV_CONFIG.ACCOUNTS).forEach(key => {
      const acc = CONFIG.DEV_CONFIG.ACCOUNTS[key];
      const accUid = String(acc.userId || acc.memberId || '').trim();
      const accUsername = String(acc.username || '').toLowerCase().trim();
      const accRole = String(acc.role || '').toUpperCase().trim();
      const accNama = String(acc.nama || acc.username || 'Pengguna Dev');

      if (!accUid) return;

      seenUserIds[accUid] = true;
      seenUserIds[accUid.toLowerCase()] = true;
      if (accUsername) seenUserIds[accUsername] = true;

      list.push({
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
      const uid = String(u.user_id || u.userId || u.ID || u.id || u.member_id || u.memberId || '').trim();
      const uusername = String(u.username || u.Username || '').toLowerCase().trim();
      const urole = String(u.role || u.Role || 'SISWA').toUpperCase().trim();
      const unama = String(u.nama || u.Nama || u.name || u.displayName || u.username || 'Pengguna').trim();

      if (!uid || seenUserIds[uid] || seenUserIds[uid.toLowerCase()] || (uusername && seenUserIds[uusername])) {
        return;
      }

      if (!isDevSession && typeof isDevAccount === 'function' && isDevAccount(u)) {
        return;
      }

      let rawStatus = String(u.status || u.Status || '').trim().toUpperCase();
      if (!rawStatus) rawStatus = 'AKTIF';

      if (rawStatus === 'DELETED' || rawStatus === 'HAPUS' || rawStatus === 'TERHAPUS') {
        return;
      }

      let ustatus = 'AKTIF';
      if (rawStatus === 'NONAKTIF' || rawStatus === 'INACTIVE' || rawStatus === 'BLOCKED') {
        ustatus = 'NONAKTIF';
      } else if (rawStatus === 'MENUNGGU' || rawStatus === 'PENDING' || rawStatus === 'UNVERIFIED') {
        ustatus = 'MENUNGGU';
      }

      const memberInfo = memberMap[uid] || memberMap[uid.toLowerCase()] || memberMap['name_' + unama.toLowerCase().trim()] || {};
      const nis = memberInfo.nis ? String(memberInfo.nis) : (u.nis ? String(u.nis) : '');
      const kelas = memberInfo.kelas ? String(memberInfo.kelas) : (u.kelas ? String(u.kelas) : '');

      const rawPhoto = u.photo_url || u.photoUrl || u.foto || memberInfo.photo_url || memberInfo.photoUrl;
      const uphoto = String(rawPhoto || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(unama) + '&background=10b981&color=fff&bold=true&format=png'));

      seenUserIds[uid] = true;
      seenUserIds[uid.toLowerCase()] = true;
      if (uusername) seenUserIds[uusername] = true;

      list.push({
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
  if (Array.isArray(members)) {
    members.forEach(m => {
      const mUid = String(m.user_id || m.userId || m.member_id || m.memberId || m.id || m.ID || '').trim();
      const mnama = String(m.nama || m.Nama || m.name || 'Siswa').trim();

      if (!mUid || seenUserIds[mUid] || seenUserIds[mUid.toLowerCase()]) {
        return;
      }

      if (!isDevSession && typeof isDevAccount === 'function' && isDevAccount(m)) {
        return;
      }

      let rawStatus = String(m.status || m.Status || '').trim().toUpperCase();
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
      const mphoto = String(m.photo_url || m.photoUrl || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(mnama) + '&background=10b981&color=fff&bold=true&format=png'));

      seenUserIds[mUid] = true;
      seenUserIds[mUid.toLowerCase()] = true;

      list.push({
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

  try {
    const serialized = JSON.stringify(list);
    if (serialized.length < 95000) {
      cache.put(cacheKey, serialized, 300); // Simpan cache selama 5 menit
    }
  } catch (err) {
    console.warn('Gagal menyimpan cache CHAT_MASTER_USERS: ' + err.message);
  }

  return list;
}

/**
 * Mengambil daftar pengguna aktif yang dapat dihubungi melalui fitur chat
 * @param {string} token Sesi pengguna
 * @param {string} query Kata kunci pencarian (opsional)
 * @param {string} roleFilter Filter berdasarkan role (SISWA, KASIR, MANAGER) (opsional)
 * @returns {Object} ApiResponse
 */
function getUsersForChat(token, query, roleFilter) {
  try {
    if (!token) {
      return { success: false, message: 'Token otentikasi tidak disertakan atau sesi telah kedaluwarsa' };
    }

    const session = verifyToken(token);
    if (!session) {
      return { success: false, message: 'Sesi tidak valid atau telah kedaluwarsa' };
    }

    const currentUserId = String(session.userId || session.user_id || '').trim().toLowerCase();
    const currentUsername = String(session.username || '').toLowerCase().trim();
    const isDevSession = session.isDev === true || (typeof isDevAccount === 'function' && isDevAccount(session));

    const masterList = _getMasterChatUsersList(isDevSession);

    const q = query ? String(query).toLowerCase().trim() : '';
    const rf = roleFilter ? String(roleFilter).toUpperCase().trim() : '';

    const results = [];

    masterList.forEach(u => {
      const uid = String(u.userId || '').toLowerCase();
      const uusername = String(u.username || '').toLowerCase();

      // Lewati akun sendiri
      if (uid === currentUserId || (uusername && uusername === currentUsername)) {
        return;
      }

      // Filter role jika diminta
      if (rf && rf !== 'ALL' && u.role !== rf) {
        return;
      }

      // Filter query pencarian (nama, nis, username)
      if (q) {
        const matchesNama = u.nama.toLowerCase().includes(q);
        const matchesNis = u.nis ? u.nis.toLowerCase().includes(q) : false;
        const matchesUsername = uusername.includes(q);
        if (!matchesNama && !matchesNis && !matchesUsername) {
          return;
        }
      }

      results.push(u);
    });

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

    const cleanRoomId = String(roomId || '').trim();
    const cleanRecipientId = String(recipientId).trim();
    const currentUserId = String(session.userId || '').trim();

    // Anti-Spam / Rate Limiting: batasi notifikasi maksimal 1x per 2 detik per room
    const cache = CacheService.getScriptCache();
    const rateLimitKey = 'CHAT_PUSH_RATE_' + currentUserId + '_' + (cleanRoomId || cleanRecipientId);
    if (cache.get(rateLimitKey)) {
      return {
        success: true,
        message: 'Notifikasi obrolan di-throttle (rate limit) untuk menghindari spam status bar',
        data: { rateLimited: true }
      };
    }
    try {
      cache.put(rateLimitKey, '1', 2);
    } catch (_) {}

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
      roomId: cleanRoomId,
      senderId: currentUserId,
      senderName: String(session.nama || ''),
      senderRole: String(session.role || ''),
      messageId: String(messageId || ''),
      channel_id: 'satus_chat_channel',
      tag: 'chat_' + cleanRoomId,
      collapse_key: 'chat_' + cleanRoomId
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
