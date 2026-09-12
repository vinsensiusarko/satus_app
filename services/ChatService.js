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

    const currentUserId = String(session.userId || '');
    const users = getSheetData(CONFIG.SHEETS.USERS);
    const members = getSheetData(CONFIG.SHEETS.MEMBERS);

    // Map data member untuk lookup cepat berdasarkan user_id
    const memberMap = {};
    if (Array.isArray(members)) {
      members.forEach(m => {
        const uid = String(m.user_id || m.member_id || '');
        if (uid) {
          memberMap[uid] = m;
        }
      });
    }

    const q = query ? String(query).toLowerCase().trim() : '';
    const rf = roleFilter ? String(roleFilter).toUpperCase().trim() : '';

    const results = [];

    users.forEach(u => {
      const uid = String(u.user_id || '');
      const ustatus = String(u.status || '').toUpperCase();
      const urole = String(u.role || '').toUpperCase();
      const unama = String(u.nama || '');
      const uphoto = String(u.photo_url || '');

      // Lewati akun sendiri atau akun yang tidak aktif
      if (!uid || uid === currentUserId || ustatus !== 'AKTIF') {
        return;
      }

      // Filter role jika diminta
      if (rf && rf !== 'ALL' && urole !== rf) {
        return;
      }

      // Cari metadata kelas & nis untuk siswa
      const memberInfo = memberMap[uid] || {};
      const nis = memberInfo.nis ? String(memberInfo.nis) : '';
      const kelas = memberInfo.kelas ? String(memberInfo.kelas) : '';

      // Filter query pencarian (nama, nis, username)
      if (q) {
        const matchesNama = unama.toLowerCase().includes(q);
        const matchesNis = nis.toLowerCase().includes(q);
        const matchesUsername = String(u.username || '').toLowerCase().includes(q);
        if (!matchesNama && !matchesNis && !matchesUsername) {
          return;
        }
      }

      results.push({
        userId: uid,
        nama: unama,
        role: urole,
        photoUrl: uphoto,
        nis: nis,
        kelas: kelas
      });
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
