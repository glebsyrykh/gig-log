const API_BASE = '/api';

function getAdminToken() {
  return localStorage.getItem('giglog-admin-token') || '';
}

export function setAdminToken(token) {
  localStorage.setItem('giglog-admin-token', token);
}

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

function adminHeaders() {
  return { 'X-Admin-Token': getAdminToken() };
}

// Public
export const fetchVenues = () => request('/venues');
export const fetchEvents = () => request('/events');

// Admin
export const createVenue = (v) => request('/admin/venues', { method: 'POST', body: JSON.stringify(v), headers: adminHeaders() });
export const updateVenue = (id, v) => request(`/admin/venues/${id}`, { method: 'PUT', body: JSON.stringify(v), headers: adminHeaders() });
export const deleteVenue = (id) => request(`/admin/venues/${id}`, { method: 'DELETE', headers: adminHeaders() });
export const createEvent = (e) => request('/admin/events', { method: 'POST', body: JSON.stringify(e), headers: adminHeaders() });
export const updateEvent = (id, e) => request(`/admin/events/${id}`, { method: 'PUT', body: JSON.stringify(e), headers: adminHeaders() });
export const deleteEvent = (id) => request(`/admin/events/${id}`, { method: 'DELETE', headers: adminHeaders() });
export const mergeVenuesAPI = (targetId, sourceIds) => request('/admin/venues/merge', { method: 'POST', body: JSON.stringify({ targetId, sourceIds }), headers: adminHeaders() });
export const exportJSON = () => request('/admin/export', { headers: adminHeaders() });
export const exportCSVUrl = () => `${API_BASE}/admin/export?format=csv`;
export const importData = (data) => request('/admin/import', { method: 'POST', body: JSON.stringify(data), headers: adminHeaders() });
