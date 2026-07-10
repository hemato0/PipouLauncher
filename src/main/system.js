// Optimisations système au lancement (Windows).
//   - Priorité du processus : éphémère (per-process), sûr, aucune persistance.
//   - Préférence GPU par-application : écrit HKCU\...\UserGpuPreferences pour que
//     Windows lance Minecraft sur le GPU DÉDIÉ (portables bi-GPU). Sans admin,
//     réversible, et strictement opt-in côté UI.

const { execFile } = require('child_process')
const os = require('os')

const GPU_KEY = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences'

// Applique une priorité au processus déjà lancé. 'above' par défaut : accélère
// Minecraft sans affamer l'OS (on évite volontairement High/Realtime).
function setProcessPriority(pid, level = 'above') {
  const map = {
    above: os.constants.priority.PRIORITY_ABOVE_NORMAL,
    high: os.constants.priority.PRIORITY_HIGH,
    normal: os.constants.priority.PRIORITY_NORMAL
  }
  try {
    os.setPriority(pid, map[level] != null ? map[level] : map.above)
    return true
  } catch (_) {
    return false
  }
}

// petit wrapper Promise autour de reg.exe (args en tableau = pas d'injection).
function reg(args) {
  return new Promise((resolve) => {
    execFile('reg', args, (err, stdout) => resolve({ ok: !err, stdout: stdout || '', error: err && err.message }))
  })
}

// Force le GPU haute-performance (dédié) pour l'exécutable Java donné.
async function setGpuPreference(exePath) {
  if (process.platform !== 'win32') return { ok: false, reason: 'non-windows' }
  // GpuPreference=2 => High performance (dGPU). 1 => éco (iGPU). 0 => auto.
  return await reg(['add', GPU_KEY, '/v', exePath, '/t', 'REG_SZ', '/d', 'GpuPreference=2;', '/f'])
}

// Retire la préférence (revient au choix automatique de Windows).
async function clearGpuPreference(exePath) {
  if (process.platform !== 'win32') return { ok: false, reason: 'non-windows' }
  return await reg(['delete', GPU_KEY, '/v', exePath, '/f'])
}

// Lit si le GPU dédié est déjà forcé pour cet exécutable.
async function getGpuPreference(exePath) {
  if (process.platform !== 'win32') return false
  const r = await reg(['query', GPU_KEY, '/v', exePath])
  return r.ok && /GpuPreference=2/i.test(r.stdout)
}

module.exports = { setProcessPriority, setGpuPreference, clearGpuPreference, getGpuPreference }
