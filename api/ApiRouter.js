// api/ApiRouter.gs

/**
 * ============================================================
 * SATUS Mobile API Router
 * Dispatches HTTP requests from Mobile App (Flutter)
 * ============================================================
 */

/**
 * Parses parameters from GET (query params) or POST (JSON body or form data)
 */
function parseApiParams(e) {
  const params = {};

  // 1. URL Query parameters (e.parameter)
  if (e && e.parameter) {
    for (const key in e.parameter) {
      params[key] = e.parameter[key];
    }
  }

  // 2. JSON Body from HTTP POST (e.postData.contents)
  if (e && e.postData && e.postData.contents) {
    try {
      const jsonBody = JSON.parse(e.postData.contents);
      if (typeof jsonBody === 'object' && jsonBody !== null) {
        for (const k in jsonBody) {
          params[k] = jsonBody[k];
        }
      }
    } catch (err) {
      // Body is not JSON, might already be parsed into e.parameter
    }
  }

  return params;
}

/**
 * Main API Request Dispatcher
 * @param {Object} e Event object from doGet or doPost
 * @param {string} method 'GET' or 'POST'
 * @returns {TextOutput} JSON response
 */
function handleApiRequest(e, method) {
  try {
    const params = parseApiParams(e);
    const action = String(params.action || params.endpoint || 'ping').trim().toLowerCase();

    let result = null;

    switch (action) {
      // 1. HEALTH CHECK / PING
      case 'ping':
      case 'health':
        result = {
          success: true,
          message: 'SATUS Mobile API is online',
          data: {
            app: 'SATUS - Kantong Hijau',
            institution: 'SMP Muhammadiyah 1 Magetan',
            version: '1.0.0',
            availableRoles: [CONFIG.ROLES.MANAGER, CONFIG.ROLES.KASIR, CONFIG.ROLES.SISWA],
            method: method,
            serverTime: new Date().toISOString()
          }
        };
        break;

      // 2. UNIFIED ROLE LOGIN (role is optional or validated)
      case 'login':
        result = apiLogin(params);
        break;

      // 3. ROLE-SPECIFIC LOGIN ENDPOINTS
      case 'login_manager':
      case 'login-manager':
      case 'manager_login':
        result = apiLoginRole(params, CONFIG.ROLES.MANAGER);
        break;

      case 'login_kasir':
      case 'login-kasir':
      case 'kasir_login':
        result = apiLoginRole(params, CONFIG.ROLES.KASIR);
        break;

      case 'login_siswa':
      case 'login-siswa':
      case 'siswa_login':
        result = apiLoginRole(params, CONFIG.ROLES.SISWA);
        break;

      // 4. TOKEN & SESSION VERIFICATION
      case 'verify_token':
      case 'verify-token':
      case 'check_token':
      case 'check_session':
        result = apiVerifyToken(params);
        break;

      // 5. GET USER PROFILE
      case 'profile':
      case 'me':
      case 'get_profile':
        result = apiGetProfile(params);
        break;

      // 6. CHANGE PASSWORD
      case 'change_password':
      case 'change-password':
        result = apiChangePassword(params);
        break;

      // 7. LOGOUT
      case 'logout':
        result = apiLogout(params);
        break;

      // 8. MANAGER DASHBOARD DATA
      case 'dashboard':
      case 'get_dashboard':
      case 'getdashboarddata':
      case 'dashboard_manager':
        result = getDashboardData(params.token);
        break;

      // 9. VOID REQUESTS (Persetujuan Pembatalan Transaksi)
      case 'void_requests':
      case 'get_void_requests':
      case 'getvoidrequests':
        result = getVoidRequests(params.token);
        break;

      case 'review_void':
      case 'review_void_request':
      case 'reviewvoidrequest':
        result = reviewVoidRequest(
          params.token,
          params.voidId || params.void_id,
          params.voidAction || params.action_type || params.status || 'APPROVED',
          params.rejectReason || params.reason || ''
        );
        break;

      // 10. SEED REQUESTS (Pengajuan Bibit & Target Pohon)
      case 'seed_requests':
      case 'get_seed_requests':
      case 'getseedrequests':
        result = getSeedRequests(params.token);
        break;

      case 'seeds':
      case 'get_seeds':
      case 'getseedlist':
        result = getSeedList(params.token);
        break;

      case 'request_seed':
      case 'request_seed_conversion':
      case 'requestseedconversion':
        result = requestSeedConversion(
          params.token,
          params.seedId || params.seed_id,
          parseInt(params.quantity || params.qty || 1, 10)
        );
        break;

      case 'siswa_seed_requests':
      case 'my_seed_requests':
      case 'getsiswaseedrequests':
        result = getSiswaSeedRequests(params.token);
        break;

      case 'set_target':
      case 'settarget':
      case 'save_target':
        result = setTarget(
          params.token,
          params.name || params.targetName || params.target_name,
          parseFloat(params.amount || params.targetAmount || params.target_amount)
        );
        break;

      case 'review_seed':
      case 'review_seed_request':
      case 'reviewseedrequest': {
        const seedAction = (params.seedAction || params.action_type || params.status || 'APPROVED').toUpperCase();
        if (seedAction === 'APPROVED') {
          result = approveSeedRequest(params.token, params.requestId || params.request_id);
        } else {
          result = rejectSeedRequest(params.token, params.requestId || params.request_id, params.rejectReason || params.reason || '');
        }
        break;
      }

      case 'update_seed_target':
      case 'updateseedtarget':
        result = updateSeedTarget(params.token, parseInt(params.target || params.targetBibit, 10));
        break;

      // 11. MEMBER MANAGEMENT
      case 'members':
      case 'get_members':
      case 'getmemberlist':
      case 'getmembers':
        result = getMemberList(params.token);
        break;

      case 'approve_member':
      case 'approvemember':
        result = approveMember(params.token, params.memberId || params.member_id);
        break;

      case 'reject_member':
      case 'rejectmember':
        result = updateMemberStatus(params.token, params.memberId || params.member_id, CONFIG.MEMBER_STATUS.NONAKTIF);
        break;

      case 'update_member_status':
      case 'updatememberstatus':
        result = updateMemberStatus(params.token, params.memberId || params.member_id, params.status);
        break;

      // 12. WASTE PRICES
      case 'waste_prices':
      case 'get_waste_prices':
      case 'getallwasteprices':
      case 'getwasteprices':
        result = getAllWastePrices(params.token);
        break;

      case 'update_waste_price':
      case 'updatewasteprice':
      case 'setwasteprice':
        result = setWastePrice(
          params.token,
          params.wasteType || params.waste_type,
          params.unit || (String(params.wasteType).toUpperCase().includes('JELANTAH') ? 'L' : 'Kg'),
          parseFloat(params.price || params.pricePerUnit)
        );
        break;

      // 13. PRODUCTS CATALOG
      case 'products':
      case 'get_products':
      case 'getproductlist':
      case 'getproducts':
        result = getProductList(params.token);
        break;

      // 14. LAPORAN PERIODIK
      case 'laporan':
      case 'get_laporan':
      case 'getlaporanmanager':
        result = getLaporanManager(params.token, params.period || 'bulanan');
        break;

      // 15. AUDIT LOGS
      case 'audit_logs':
      case 'get_audit_logs':
      case 'getauditlogs':
        result = getAuditLogs(params.token);
        break;

      // 16. KASIR: SEARCH MEMBER & RECENT MUTASI
      case 'find_member':
      case 'search_member':
      case 'findmember':
      case 'searchmember':
        result = findMember(params.token, params.query || params.q || params.memberId || params.member_id);
        break;

      case 'member_recent_transactions':
      case 'getmemberrecenttransactions':
        result = getMemberRecentTransactions(
          params.token,
          params.memberId || params.member_id,
          parseInt(params.limit || 5, 10)
        );
        break;

      // 17. KASIR: TRANSACTIONS EXECUTION
      case 'setor_tunai':
      case 'createsetortunai':
        result = createSetorTunai(
          params.token,
          params.memberId || params.member_id,
          parseFloat(params.amount)
        );
        break;

      case 'setor_sampah':
      case 'createsetorsampah':
        result = createSetorSampah(
          params.token,
          params.memberId || params.member_id,
          params.wasteType || params.waste_type,
          parseFloat(params.quantity || params.qty)
        );
        break;

      case 'tarik_tunai':
      case 'createtariktunai':
        result = createTarikTunai(
          params.token,
          params.memberId || params.member_id,
          parseFloat(params.amount)
        );
        break;

      case 'belanja':
      case 'create_belanja':
      case 'createbelanja': {
        let items = params.items || params.cart || [];
        if (typeof items === 'string') {
          try { items = JSON.parse(items); } catch (_) { items = []; }
        }
        result = createBelanja(
          params.token,
          params.memberId || params.member_id,
          items,
          params.walletType || params.wallet_type || 'TABUNGAN'
        );
        break;
      }

      case 'request_void':
      case 'requestvoid':
      case 'requestvoidtransaction':
        result = requestVoidTransaction(
          params.token,
          params.transactionId || params.transaction_id,
          params.reason
        );
        break;

      case 'transactions':
      case 'get_transactions':
      case 'gettransactions':
      case 'kasir_transactions':
        result = getDashboardData(params.token);
        break;

      // 18. UNKNOWN ENDPOINT
      default:
        result = {
          success: false,
          error_code: 'UNKNOWN_ACTION',
          message: `Endpoint action '${action}' tidak dikenali. Daftar endpoint yang tersedia: ping, login, login_manager, login_kasir, login_siswa, verify_token, profile, change_password, logout, dashboard, void_requests, review_void, seed_requests, review_seed, update_seed_target, members, approve_member, waste_prices, update_waste_price, products, laporan, audit_logs, find_member, member_recent_transactions, setor_tunai, setor_sampah, tarik_tunai, belanja, request_void, transactions.`
        };
        break;
    }

    return createJsonResponse(result);
  } catch (error) {
    console.error('API Router Error:', error);
    return createJsonResponse({
      success: false,
      error_code: 'INTERNAL_ERROR',
      message: error.message || 'Internal API Router Error'
    });
  }
}

/**
 * Formats JSON response and adds meta info
 */
function createJsonResponse(obj) {
  const output = Object.assign({
    meta: {
      timestamp: new Date().toISOString(),
      apiVersion: '1.0.0',
      system: 'SATUS Mobile API'
    }
  }, obj);

  return ContentService.createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}
