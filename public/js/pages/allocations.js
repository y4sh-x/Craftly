const notice = document.querySelector('#allocation-notice');
const show = (message) => { notice.textContent = message; notice.classList.remove('hidden'); };
const reload = () => window.location.reload();
async function api(url, options = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
document.querySelector('#allocation-refresh')?.addEventListener('click', reload);
document.querySelector('#allocation-create')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await api('/api/allocations', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget).entries())) }); reload(); }
  catch (err) { show(`Error: ${err.message}`); }
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-release],[data-delete]'); if (!b) return;
  const id = b.dataset.release || b.dataset.delete;
  if (b.dataset.delete && !confirm(`Delete allocation ${id}?`)) return;
  try { await api(`/api/allocations/${encodeURIComponent(id)}/${b.dataset.release ? 'release' : ''}`, { method: b.dataset.release ? 'POST' : 'DELETE', body: b.dataset.release ? '{}' : undefined }); reload(); }
  catch (err) { show(`Error: ${err.message}`); }
});
