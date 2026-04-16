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