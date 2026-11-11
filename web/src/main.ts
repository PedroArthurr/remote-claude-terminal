import { PROTOCOL_VERSION, type HealthResponse } from '@ccc/shared';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <h1 class="title">cc<span>-</span>cockpit</h1>
  <div class="status" data-state="pending"><i class="dot"></i><span>connecting…</span></div>
`;

const status = app.querySelector<HTMLDivElement>('.status')!;
const label = status.querySelector('span')!;

async function checkHealth(): Promise<void> {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const h = (await res.json()) as HealthResponse;
    const mismatch = h.protocol !== PROTOCOL_VERSION ? ' · protocol mismatch' : '';
    status.dataset.state = 'ok';
    label.textContent = `server ok · up ${h.uptimeSec}s${mismatch}`;
  } catch {
    status.dataset.state = 'down';
    label.textContent = 'server offline';
  }
}

void checkHealth();
setInterval(checkHealth, 5000);
