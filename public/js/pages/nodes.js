const notice = document.querySelector('#node-token-notice');
const showToken = (text) => {
  notice.textContent = text;
  notice.classList.remove('hidden');
};
const reload = () => window.location.reload();

async function api(url, options = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

document.querySelector('#node-refresh')?.addEventListener('click', reload);
document.querySelector('#node-create')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    const data = await api('/api/nodes', { method: 'POST', body: JSON.stringify(body) });
    showToken(`Node registered. SAVE THIS TOKEN NOW: ${data.token}`);
    setTimeout(reload, 2500);
  } catch (err) {
    showToken(`Error: ${err.message}`);
  }
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-node-disable],[data-node-enable],[data-node-rotate],[data-node-delete]');
  if (!button) return;
  const id = button.dataset.nodeDisable || button.dataset.nodeEnable || button.dataset.nodeRotate || button.dataset.nodeDelete;
  try {
    if (button.dataset.nodeRotate) {
      const data = await api(`/api/nodes/${encodeURIComponent(id)}/token`, { method: 'POST', body: '{}' });
      showToken(`NEW TOKEN for ${id}: ${data.token}`);
      return;
    }
    if (button.dataset.nodeDelete && !confirm(`Delete node ${id}?`)) return;
    const action = button.dataset.nodeDisable ? 'disable' : button.dataset.nodeEnable ? 'enable' : null;
    if (action) await api(`/api/nodes/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: '{}' });
    else await api(`/api/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    reload();
  } catch (err) {
    showToken(`Error: ${err.message}`);
  }
});
