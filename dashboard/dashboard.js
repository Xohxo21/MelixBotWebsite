// ============================================================
// Melix Dashboard - Shared Library
// ============================================================

// ---- CONFIG ----
const CONFIG = {
  // Backend API URL (set to Vercel deployment or localhost for dev)
  API_BASE: 'https://backend-dash-nine.vercel.app',

  // Hardcoded Staff Discord User IDs
  // Add or remove IDs to control who has staff access
  STAFF_IDS: [
    '1536227937504989255',   // Example staff member
    // Add more staff Discord IDs below:
    // '123456789012345678',
    // '987654321098765432',
  ],

  CLIENT_ID: '1536227937504989255',
};

// ---- AUTH ----
const Auth = {
  getToken() {
    return localStorage.getItem('melix_dash_token');
  },

  setToken(token) {
    localStorage.setItem('melix_dash_token', token);
  },

  clearToken() {
    localStorage.removeItem('melix_dash_token');
    localStorage.removeItem('melix_selected_guild');
  },

  isLoggedIn() {
    return !!this.getToken();
  },

  async getUser() {
    const token = this.getToken();
    if (!token) return null;
    try {
      const res = await fetch(`${CONFIG.API_BASE}/api/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        this.clearToken();
        return null;
      }
      return await res.json();
    } catch {
      return null;
    }
  },

  logout() {
    this.clearToken();
    window.location.href = '/dashboard/';
  },
};

// ---- API CLIENT ----
const API = {
  async request(path, options = {}) {
    const token = Auth.getToken();
    const headers = {
      ...(options.headers || {}),
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(`${CONFIG.API_BASE}${path}`, {
      ...options,
      headers,
    });
    if (res.status === 401) {
      Auth.clearToken();
      window.location.href = '/dashboard/';
      throw new Error('Unauthorized');
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
  },

  getMe() { return this.request('/api/me'); },
  getGuilds() { return this.request('/api/guilds'); },
  getGuild(id) { return this.request(`/api/guild/${id}`); },
  getGuildStaff(id) { return this.request(`/api/guild/${id}/staff`); },
};

// ---- GUILD STORAGE ----
const GuildStore = {
  getSelected() {
    const raw = localStorage.getItem('melix_selected_guild');
    return raw ? JSON.parse(raw) : null;
  },

  setSelected(guild) {
    localStorage.setItem('melix_selected_guild', JSON.stringify(guild));
  },

  clear() {
    localStorage.removeItem('melix_selected_guild');
  },
};

// ---- HELPERS ----
function $(sel, parent = document) { return parent.querySelector(sel); }
function $$(sel, parent = document) { return Array.from(parent.querySelectorAll(sel)); }

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}



