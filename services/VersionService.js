// services/VersionService.js

/**
 * Memastikan sheet App_Version tersedia di spreadsheet dan memiliki data awal
 */
function ensureAppVersionSheet() {
  const sheetName = CONFIG.SHEETS.APP_VERSION || 'App_Version';
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    const headers = DATABASE_SCHEMAS[sheetName] || [
      'config_key', 'latest_version', 'latest_build_number', 'min_required_version', 
      'min_required_build_number', 'is_required', 'update_title', 'release_notes', 
      'play_store_url', 'is_active', 'updated_at'
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#10B981').setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
  } else {
    ensureSheetHeaders(sheet, sheetName);
  }

  // Jika baris hanya header, tambahkan row konfigurasi awal
  if (sheet.getLastRow() <= 1) {
    const def = (CONFIG && CONFIG.APP_VERSION_DEFAULT) || {
      config_key: 'ANDROID',
      latest_version: '2.0.0',
      latest_build_number: 1,
      min_required_version: '2.0.0',
      min_required_build_number: 1,
      is_required: false,
      update_title: 'Pembaruan SATUS Mobile Tersedia',
      release_notes: 'Pembaruan stabilitas dan peningkatan performa sistem.',
      play_store_url: 'https://play.google.com/store/apps/details?id=id.vinsensiusarka.satus_mobile',
      is_active: true
    };

    sheet.appendRow([
      def.config_key || 'ANDROID',
      def.latest_version || '2.0.0',
      def.latest_build_number || 1,
      def.min_required_version || '2.0.0',
      def.min_required_build_number || 1,
      def.is_required ? 'TRUE' : 'FALSE',
      def.update_title || 'Pembaruan SATUS Mobile Tersedia',
      def.release_notes || 'Pembaruan stabilitas dan peningkatan performa sistem.',
      def.play_store_url || 'https://play.google.com/store/apps/details?id=id.vinsensiusarka.satus_mobile',
      def.is_active ? 'TRUE' : 'FALSE',
      new Date().toISOString()
    ]);
  }

  return sheet;
}

/**
 * Membaca konfigurasi versi mobile app untuk Flutter API maupun Control Panel
 * @param {Object} params - Parameter opsional (version, build_number, platform)
 * @returns {Object} JSON response
 */
function getAppVersionConfig(params) {
  try {
    params = params || {};
    const platform = String(params.platform || 'ANDROID').trim().toUpperCase();
    const cacheKey = 'app_version_config_' + platform.toLowerCase();

    let config = null;
    try {
      const cached = CacheService.getScriptCache().get(cacheKey);
      if (cached) {
        config = JSON.parse(cached);
      }
    } catch (e) {
      console.warn('Cache get error in getAppVersionConfig:', e);
    }

    if (!config) {
      ensureAppVersionSheet();
      const sheetData = getSheetData(CONFIG.SHEETS.APP_VERSION);
      // Cari seluruh baris yang sesuai platform (case-insensitive & trimmed)
      const matchingRows = (sheetData || []).filter(r => {
        const k = String(r.config_key || r.Config_Key || r.configKey || '').trim().toUpperCase();
        return k === platform;
      });
      // Ambil baris paling akhir (terbaru) jika ada lebih dari 1 baris
      const row = matchingRows.length > 0 ? matchingRows[matchingRows.length - 1] : (sheetData && sheetData[0]);

      if (row) {
        const def = (CONFIG && CONFIG.APP_VERSION_DEFAULT) || {};
        config = {
          config_key: String(row.config_key || row.Config_Key || platform).trim(),
          latest_version: String(row.latest_version || row.Latest_Version || row.latestVersion || def.latest_version || '2.0.0').trim(),
          latest_build_number: parseInt(row.latest_build_number || row.Latest_Build_Number || row.latestBuildNumber || def.latest_build_number || 1, 10) || 1,
          min_required_version: String(row.min_required_version || row.Min_Required_Version || row.minRequiredVersion || def.min_required_version || '2.0.0').trim(),
          min_required_build_number: parseInt(row.min_required_build_number || row.Min_Required_Build_Number || row.minRequiredBuildNumber || def.min_required_build_number || 1, 10) || 1,
          is_required: String(row.is_required || row.Is_Required).toUpperCase() === 'TRUE' || row.is_required === true,
          update_title: String(row.update_title || row.Update_Title || def.update_title || 'Pembaruan SATUS Mobile Tersedia').trim(),
          release_notes: String(row.release_notes || row.Release_Notes || def.release_notes || '').trim(),
          play_store_url: String(row.play_store_url || row.Play_Store_Url || def.play_store_url || 'https://play.google.com/store/apps/details?id=id.vinsensiusarka.satus_mobile').trim(),
          is_active: String(row.is_active || row.Is_Active).toUpperCase() === 'TRUE' || row.is_active === true,
          updated_at: row.updated_at || row.Updated_At || new Date().toISOString()
        };
      } else {
        config = { ...(CONFIG.APP_VERSION_DEFAULT || {}) };
      }

      // Simpan ke CacheService selama 300 detik (5 menit)
      try {
        CacheService.getScriptCache().put(cacheKey, JSON.stringify(config), 300);
      } catch (e) {}
    }

    // Jika client menyertakan informasi versi saat ini, lakukan komparasi otomatis
    const clientVersion = String(params.version || '').trim();
    const clientBuild = parseInt(params.build_number || params.buildNumber, 10);

    let hasUpdate = false;
    let isMandatory = false;

    if (!isNaN(clientBuild) && clientBuild > 0) {
      if (config.latest_build_number > clientBuild) {
        hasUpdate = true;
      }
      if (clientBuild < config.min_required_build_number || (hasUpdate && config.is_required)) {
        isMandatory = true;
      }
    } else if (clientVersion) {
      if (compareVersions(config.latest_version, clientVersion) > 0) {
        hasUpdate = true;
      }
      if (compareVersions(clientVersion, config.min_required_version) < 0 || (hasUpdate && config.is_required)) {
        isMandatory = true;
      }
    }

    return {
      success: true,
      message: 'Konfigurasi versi aplikasi berhasil dimuat',
      data: {
        ...config,
        client_version: clientVersion || null,
        client_build_number: !isNaN(clientBuild) ? clientBuild : null,
        has_update: hasUpdate,
        is_required: isMandatory || config.is_required,
        update_type: isMandatory ? 'REQUIRED' : (hasUpdate ? 'FLEXIBLE' : 'NONE')
      }
    };
  } catch (err) {
    console.error('getAppVersionConfig error:', err);
    return {
      success: false,
      message: 'Gagal memuat konfigurasi versi: ' + err.message,
      data: CONFIG.APP_VERSION_DEFAULT || {}
    };
  }
}

/**
 * Memperbarui konfigurasi versi mobile app (Mendukung Session Token Manager ATAU CI/CD Deploy Key)
 * @param {string} token - Session auth token atau deploy key
 * @param {Object} dataUpdate - Data baru untuk versi aplikasi
 */
function updateAppVersionConfig(token, dataUpdate) {
  try {
    dataUpdate = dataUpdate || {};

    // Otentikasi Ganda: Periksa CI/CD Deploy Key ATAU Session Token Manager
    let authorizedUser = null;
    let isAuthorizedByDeployKey = false;

    const providedKey = String(
      dataUpdate.deploy_key || 
      dataUpdate.api_key || 
      dataUpdate.deployKey || 
      dataUpdate.secret_key || 
      token || 
      ''
    ).trim();

    let configuredDeployKey = '';
    try {
      if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
        configuredDeployKey = PropertiesService.getScriptProperties().getProperty('CI_DEPLOY_KEY') || '';
      }
    } catch (e) {
      console.warn('Could not read ScriptProperties for CI_DEPLOY_KEY:', e);
    }
    if (!configuredDeployKey && CONFIG && CONFIG.CI_DEPLOY_KEY) {
      configuredDeployKey = CONFIG.CI_DEPLOY_KEY;
    }

    if (providedKey && configuredDeployKey && providedKey === configuredDeployKey) {
      isAuthorizedByDeployKey = true;
      authorizedUser = { userId: 'CI-CD-SYSTEM', role: CONFIG.ROLES.MANAGER, nama: 'GitHub Actions CI/CD' };
    } else {
      const session = verifyToken(token);
      if (!session) {
        return { success: false, error_code: 'UNAUTHORIZED', message: 'Sesi login telah berakhir atau deploy key tidak valid.' };
      }
      if (session.role !== CONFIG.ROLES.MANAGER) {
        return { success: false, error_code: 'FORBIDDEN', message: 'Akses ditolak. Hanya Manager atau CI/CD yang dapat mengatur versi aplikasi.' };
      }
      authorizedUser = session;
    }

    const platform = String(dataUpdate.platform || dataUpdate.config_key || 'ANDROID').trim().toUpperCase();
    const latestVersion = String(dataUpdate.latest_version || dataUpdate.version || '2.0.0').trim();
    const latestBuild = parseInt(dataUpdate.latest_build_number || dataUpdate.build_number || 1, 10);
    const isRequired = dataUpdate.is_required === true || String(dataUpdate.is_required).toUpperCase() === 'TRUE';

    ensureAppVersionSheet();
    const sheetName = CONFIG.SHEETS.APP_VERSION;
    const sheet = getSheet(sheetName);
    const values = sheet.getDataRange().getValues();
    const headers = values[0] || [];

    function findHeaderCol(name) {
      const norm = String(name).toLowerCase().replace(/[\s_-]/g, '');
      return headers.findIndex(h => String(h).toLowerCase().replace(/[\s_-]/g, '') === norm);
    }

    const colConfigKey = findHeaderCol('config_key');
    const colMinVersion = findHeaderCol('min_required_version');
    const colMinBuild = findHeaderCol('min_required_build_number');
    const colUpdateTitle = findHeaderCol('update_title');
    const colReleaseNotes = findHeaderCol('release_notes');
    const colPlayStore = findHeaderCol('play_store_url');
    const colIsActive = findHeaderCol('is_active');

    let targetRow = -1;
    let existingRowData = null;
    const duplicateRowIndices = [];

    for (let i = 1; i < values.length; i++) {
      const keyVal = colConfigKey >= 0 ? values[i][colConfigKey] : values[i][0];
      if (String(keyVal || '').trim().toUpperCase() === platform) {
        if (targetRow === -1) {
          targetRow = i + 1;
          existingRowData = values[i];
        } else {
          duplicateRowIndices.push(i + 1);
        }
      }
    }

    // Penentuan Nilai Versi Minimum (Preservasi jika bukan update wajib)
    let minVersion = '';
    let minBuild = 1;

    if (isRequired) {
      minVersion = latestVersion;
      minBuild = latestBuild;
    } else {
      if (dataUpdate.min_required_version !== undefined || dataUpdate.min_version !== undefined) {
        minVersion = String(dataUpdate.min_required_version || dataUpdate.min_version).trim();
      } else if (existingRowData && colMinVersion >= 0 && existingRowData[colMinVersion]) {
        minVersion = String(existingRowData[colMinVersion]).trim();
      } else {
        minVersion = latestVersion;
      }

      if (dataUpdate.min_required_build_number !== undefined || dataUpdate.min_build !== undefined) {
        minBuild = parseInt(dataUpdate.min_required_build_number || dataUpdate.min_build, 10) || 1;
      } else if (existingRowData && colMinBuild >= 0 && existingRowData[colMinBuild]) {
        minBuild = parseInt(existingRowData[colMinBuild], 10) || 1;
      } else {
        minBuild = latestBuild;
      }
    }

    const defaultPlayStore = (CONFIG && CONFIG.APP_VERSION_DEFAULT && CONFIG.APP_VERSION_DEFAULT.play_store_url) 
      || 'https://play.google.com/store/apps/details?id=id.vinsensiusarka.satus_mobile';

    const updateTitle = dataUpdate.update_title !== undefined
      ? String(dataUpdate.update_title).trim()
      : (existingRowData && colUpdateTitle >= 0 && existingRowData[colUpdateTitle] 
          ? String(existingRowData[colUpdateTitle]).trim() 
          : 'Pembaruan SATUS Mobile Tersedia');

    const releaseNotes = dataUpdate.release_notes !== undefined
      ? String(dataUpdate.release_notes).trim()
      : (existingRowData && colReleaseNotes >= 0 && existingRowData[colReleaseNotes] 
          ? String(existingRowData[colReleaseNotes]).trim() 
          : '');

    let playStoreUrl = dataUpdate.play_store_url !== undefined
      ? String(dataUpdate.play_store_url).trim()
      : (existingRowData && colPlayStore >= 0 && existingRowData[colPlayStore] 
          ? String(existingRowData[colPlayStore]).trim() 
          : defaultPlayStore);
    if (!playStoreUrl || playStoreUrl.includes('com.satus.app')) {
      playStoreUrl = defaultPlayStore;
    }

    const isActive = dataUpdate.is_active !== undefined
      ? (dataUpdate.is_active !== false && String(dataUpdate.is_active).toUpperCase() !== 'FALSE')
      : (existingRowData && colIsActive >= 0 
          ? (String(existingRowData[colIsActive]).toUpperCase() === 'TRUE' || existingRowData[colIsActive] === true) 
          : true);

    const updatedAt = new Date().toISOString();

    const rowData = new Array(headers.length).fill('');
    headers.forEach((h, idx) => {
      const norm = String(h).toLowerCase().replace(/[\s_-]/g, '');
      switch (norm) {
        case 'configkey': rowData[idx] = platform; break;
        case 'latestversion': rowData[idx] = latestVersion; break;
        case 'latestbuildnumber': rowData[idx] = latestBuild; break;
        case 'minrequiredversion': rowData[idx] = minVersion; break;
        case 'minrequiredbuildnumber': rowData[idx] = minBuild; break;
        case 'isrequired': rowData[idx] = isRequired ? 'TRUE' : 'FALSE'; break;
        case 'updatetitle': rowData[idx] = updateTitle; break;
        case 'releasenotes': rowData[idx] = releaseNotes; break;
        case 'playstoreurl': rowData[idx] = playStoreUrl; break;
        case 'isactive': rowData[idx] = isActive ? 'TRUE' : 'FALSE'; break;
        case 'updatedat': rowData[idx] = updatedAt; break;
        default: rowData[idx] = ''; break;
      }
    });

    if (targetRow > 1) {
      sheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);
    } else {
      sheet.appendRow(rowData);
    }

    // Bersihkan baris duplikat jika ada (dari baris paling bawah ke atas)
    for (let d = duplicateRowIndices.length - 1; d >= 0; d--) {
      try {
        sheet.deleteRow(duplicateRowIndices[d]);
      } catch (e) {
        console.warn('Could not delete duplicate version row:', e);
      }
    }

    // Invalidate Cache & Update CacheService segera
    delete cachedSheetData[sheetName];
    const cacheKey = 'app_version_config_' + platform.toLowerCase();
    try {
      CacheService.getScriptCache().remove(cacheKey);
      CacheService.getScriptCache().put(cacheKey, JSON.stringify({
        config_key: platform,
        latest_version: latestVersion,
        latest_build_number: latestBuild,
        min_required_version: minVersion,
        min_required_build_number: minBuild,
        is_required: isRequired,
        update_title: updateTitle,
        release_notes: releaseNotes,
        play_store_url: playStoreUrl,
        is_active: isActive,
        updated_at: updatedAt
      }), 300);
    } catch (e) {}

    // Audit Log
    const logDesc = 'Update Konfigurasi Versi Mobile (' + platform + '): v' + latestVersion + '+' + latestBuild + ', Wajib: ' + isRequired + (isAuthorizedByDeployKey ? ' (via CI/CD Deploy Key)' : '');
    auditLog(authorizedUser.userId, authorizedUser.role, 'UPDATE_APP_VERSION', platform, logDesc);

    const updatedConfig = {
      config_key: platform,
      latest_version: latestVersion,
      latest_build_number: latestBuild,
      min_required_version: minVersion,
      min_required_build_number: minBuild,
      is_required: isRequired,
      update_title: updateTitle,
      release_notes: releaseNotes,
      play_store_url: playStoreUrl,
      is_active: isActive,
      updated_at: updatedAt
    };

    return {
      success: true,
      message: 'Konfigurasi versi SATUS Mobile berhasil diperbarui!',
      data: updatedConfig
    };
  } catch (err) {
    console.error('updateAppVersionConfig error:', err);
    return { success: false, error_code: 'SERVER_ERROR', message: err.message };
  }
}

/**
 * Helper komparasi dua semver string (misal '1.0.1' vs '1.0.0')
 * Returns: 1 if a > b, -1 if a < b, 0 if equal
 */
function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}
