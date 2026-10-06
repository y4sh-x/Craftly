const json = async (url, options = {}) => {
  const r = await fetch(url, { headers: { 'content-type': 'application/json' }, ...options });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || data.message || `HTTP ${r.status}`);
  return data;
};

const form = document.querySelector('#db-host-create');
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(form).entries());
  if (!body.port) delete body.port;
  try {
    await json('/api/database-hosts', { method: 'POST', body: JSON.stringify(body) });
    location.reload();
  } catch (err) { alert(err.message); }
});

document.querySelector('#db-host-refresh')?.addEventListener('click', () => location.reload());
document.querySelectorAll('[data-db-host-delete]').forEach((button) => {
  button.addEventListener('click', async () => {
    if (!confirm('Delete this database host and its Docker container? The host must contain no assigned databases.')) return;
    try { await json(`/api/database-hosts/${encodeURIComponent(button.dataset.dbHostDelete)}`, { method: 'DELETE' }); location.reload(); }
    catch (err) { alert(err.message); }
  });
});
