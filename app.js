// ========== CONFIGURATION ==========
function getBaseUrl() {
  const urlInput = document.getElementById('global-base-url');
  return urlInput ? urlInput.value.trim() : '';
}

// Utilities
const getTs = () => new Date().toISOString();
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return alert(msg);
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Custom Fetch Wrapper 
async function apiFetch(endpoint, options = {}) {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    showToast('BASE URL Server tidak boleh kosong!', 'error');
    throw new Error('BASE URL is empty');
  }

  // Membersihkan endpoint (misal: `/presence/status?user_id=123` menjadi `presence/status` dan parameternya)
  let cleanEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
  let path = cleanEndpoint;
  let queryStr = "";
  if (cleanEndpoint.includes('?')) {
    [path, queryStr] = cleanEndpoint.split('?');
    queryStr = "&" + queryStr; // parameter tambahan
  }

  // Format URL khusus untuk GAS Swap Test
  const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  // 1. urlPrimary: menggunakan parameter query
  let urlPrimary = `${cleanBaseUrl}?endpoint=${path}${queryStr}`;
  // 2. urlFallback: menggunakan REST style (path)
  let fallbackQueryStr = queryStr ? "?" + queryStr.substring(1) : "";
  let urlFallback = `${cleanBaseUrl}/${path}${fallbackQueryStr}`;

  const isPost = options.method === 'POST';
  const fetchOptions = {
    method: options.method || 'GET',
    redirect: 'follow', // required for Google Apps Script
    ...options
  };

  // GAS Specific logic: if POST, use content-type text/plain to avoid CORS preflight issues 
  if (isPost) {
    if (!fetchOptions.headers) fetchOptions.headers = {};
    fetchOptions.headers['Content-Type'] = 'text/plain';
  }

  const doFetch = async (url) => {
    console.log(`[API Request] ${fetchOptions.method} ${url}`, isPost && options.body ? JSON.parse(options.body) : '');

    const response = await fetch(url, fetchOptions);
    const rawText = await response.text();
    console.log(`[API Raw Response from ${url}]`, rawText);

    let result;
    try {
      result = JSON.parse(rawText);
    } catch (e) {
      throw new Error(`InvalidJSON: ${rawText.substring(0, 50)}`);
    }

    if (result && !result.ok && result.error) {
      const errLower = result.error.toLowerCase();
      if (errLower.includes('unknown endpoint') || errLower.includes('unknown_endpoint')) {
        throw new Error(`EndpointError: ${result.error}`);
      }
      throw new Error(`ServerError: ${result.error}`);
    }

    return result;
  };

  try {
    // Coba target utama dulu (Query Mode)
    return await doFetch(urlPrimary);
  } catch (error) {
    console.warn(`[Fallback Triggered] Primary URL failed (${error.message}). Retrying with Fallback URL...`);

    // Jika benar-benar error dari logic bisnis server (seperti token_expired), jangan di-retry ke fallback
    if (error.message.startsWith('ServerError:')) {
      const actualError = error.message.replace('ServerError: ', '');
      showToast(`${actualError}`, 'error'); // Tampilkan error asli server
      throw new Error(actualError);
    }

    // Coba fallback target (Path Mode)
    try {
      return await doFetch(urlFallback);
    } catch (fallbackError) {
      console.error('Fetch Fallback Error:', fallbackError);
      let finalMsg = fallbackError.message;

      if (finalMsg.startsWith('ServerError:')) {
        finalMsg = finalMsg.replace('ServerError: ', '');
        showToast(`${finalMsg}`, 'error');
      } else if (finalMsg.startsWith('InvalidJSON:')) {
        showToast('Response Server bukan format JSON yang valid.', 'error');
        finalMsg = "Invalid JSON Response";
      } else {
        showToast(`Gagal menghubungi server: ${finalMsg}`, 'error');
      }
      throw new Error(finalMsg);
    }
  }
}

function getDeviceId() {
  const el = document.getElementById('global-device-id');
  return el ? (el.value || 'dev-unknown') : 'dev-unknown';
}

// ========== NAVIGATION ==========
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.module-section').forEach(s => s.classList.remove('active'));

    e.currentTarget.classList.add('active');
    const target = e.currentTarget.getAttribute('data-target');
    document.getElementById(target).classList.add('active');

    // Lazy attach map if it's map section
    if (target === 'modul-3') {
      if (!mapInitialized && typeof initMap === 'function') {
        initMap();
      }
      setTimeout(() => {
        if (typeof map !== 'undefined' && map) map.invalidateSize();
      }, 200);
    }
  });
});

// ========== MODULE 1: PRESENSI QR ==========
// Dosen View
const btnGenQR = document.getElementById('btn-generate-qr');
if (btnGenQR) {
  btnGenQR.addEventListener('click', async () => {
    const course_id = document.getElementById('course-id').value;
    const session_id = document.getElementById('session-id').value;

    if (!course_id || !session_id) return showToast('Isi Course ID & Session ID!', 'error');

    const payload = {
      course_id, session_id,
      ts: getTs()
    };

    const btn = document.getElementById('btn-generate-qr');
    btn.innerText = 'Generating...';

    try {
      const res = await apiFetch('/presence/qr/generate', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const { qr_token, expires_at } = res.data;
        document.getElementById('qr-result').classList.remove('hidden');
        document.getElementById('lbl-qr-token').innerText = qr_token;
        document.getElementById('lbl-qr-expiry').innerText = new Date(expires_at).toLocaleTimeString();

        // Render QR
        const qrBox = document.getElementById('qrcode-display');
        qrBox.innerHTML = '';
        if (typeof QRCode !== 'undefined') {
          // Menggunakan qrcodejs (Library standar Google Apps Script & web pure)
          new QRCode(qrBox, {
            text: qr_token,
            width: 250, 
            height: 250, 
            colorDark: "#0b0f19", 
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
          });
        }
        showToast('QR Token Generated!', 'success');
      } else {
        showToast(`Error: ${res.error}`, 'error');
      }
    } catch (e) { console.error(e); } finally {
      btn.innerText = 'Generate QR Token';
    }
  });
}

// Scanner Logic
let html5QrcodeScanner = null;
const btnStartScan = document.getElementById('btn-start-scan');
if (btnStartScan) {
  btnStartScan.addEventListener('click', () => {
    document.getElementById('reader').classList.remove('hidden');
    document.getElementById('btn-start-scan').classList.add('hidden');
    document.getElementById('btn-stop-scan').classList.remove('hidden');

    if (typeof Html5QrcodeScanner !== 'undefined') {
      html5QrcodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: { width: 250, height: 250 } }, false);
      html5QrcodeScanner.render(onScanSuccess, onScanFailure);
    }
  });
}

const btnStopScan = document.getElementById('btn-stop-scan');
if (btnStopScan) {
  btnStopScan.addEventListener('click', () => {
    if (html5QrcodeScanner) {
      html5QrcodeScanner.clear().then(() => {
        document.getElementById('reader').classList.add('hidden');
        document.getElementById('btn-start-scan').classList.remove('hidden');
        document.getElementById('btn-stop-scan').classList.add('hidden');
      });
    }
  });
}

function onScanFailure(error) { /* ignore frequent fail events */ }
function onScanSuccess(decodedText, decodedResult) {
  document.getElementById('manual-token').value = decodedText;
  showToast(`Token Scanned: ${decodedText}`, 'success');
  if (html5QrcodeScanner) {
    document.getElementById('btn-stop-scan').click();
  }
  document.getElementById('btn-checkin').click();
}

// Checkin Request
const btnCheckin = document.getElementById('btn-checkin');
if (btnCheckin) {
  btnCheckin.addEventListener('click', async () => {
    const qr_token = document.getElementById('manual-token').value;
    const user_id = document.getElementById('user-id').value;
    const course_id = document.getElementById('course-id').value;
    const session_id = document.getElementById('session-id').value;

    if (!qr_token || !user_id) return showToast('NIM & Token wajib diisi!', 'error');

    const payload = {
      user_id, device_id: getDeviceId(),
      course_id, session_id,
      qr_token, ts: getTs()
    };

    const btn = document.getElementById('btn-checkin');
    btn.innerText = 'Sending...';

    try {
      const res = await apiFetch('/presence/checkin', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (res && res.ok) {
        showToast('Check-in Berhasil!', 'success');
        document.getElementById('status-result').classList.remove('hidden');
        const badge = document.getElementById('lbl-status');
        badge.innerText = res.data.status;
        badge.className = `badge status-${res.data.status}`;
      }
    } catch (e) { console.error(e); } finally { btn.innerText = 'Check-in'; }
  });
}

// Check Status
const btnCheckStatus = document.getElementById('btn-check-status');
if (btnCheckStatus) {
  btnCheckStatus.addEventListener('click', async () => {
    const user_id = document.getElementById('user-id').value;
    const course_id = document.getElementById('course-id').value;
    const session_id = document.getElementById('session-id').value;

    if (!user_id) return showToast('NIM wajib diisi untuk cek status', 'error');

    const btn = document.getElementById('btn-check-status');
    btn.innerText = 'Mengecek...';

    try {
      const qs = new URLSearchParams({ user_id, course_id, session_id }).toString();
      const res = await apiFetch(`/presence/status?${qs}`, { method: 'GET' });

      if (res && res.ok) {
        document.getElementById('status-result').classList.remove('hidden');
        const badge = document.getElementById('lbl-status');
        badge.innerText = res.data.status;
        badge.className = `badge status-${res.data.status}`;
        showToast('Status ditarik dari server', 'success');
      }
    } catch (e) { console.error(e); } finally { btn.innerText = 'Cek Status Saya'; }
  });
}