// Hook electron-builder : grave l'icône Pipou (cœur) + les métadonnées sur
// l'exe de l'app APRÈS le packaging, AVANT que NSIS ne l'empaquette.
//
// Pourquoi ici et pas via electron-builder directement : on a mis
// win.signAndEditExecutable=false pour éviter l'extraction de winCodeSign
// (liens symboliques macOS -> échoue sans droits admin/Dev Mode sous Windows).
// Du coup l'exe garderait l'icône Electron par défaut. On la regrave donc
// nous-mêmes avec rcedit (binaire autonome, sans winCodeSign).

const path = require('path')
// rcedit v5 est un module ESM : l'export utile est la fonction nommée `rcedit`.
const { rcedit } = require('rcedit')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const app = context.packager.appInfo
  const exe = path.join(context.appOutDir, `${app.productFilename}.exe`)
  const icon = path.join(__dirname, '..', 'assets', 'icon.ico')
  try {
    await rcedit(exe, {
      icon,
      'version-string': {
        ProductName: 'PipouLauncher',
        FileDescription: 'PipouLauncher',
        CompanyName: 'Pipou',
        OriginalFilename: `${app.productFilename}.exe`
      },
      'file-version': app.version,
      'product-version': app.version
    })
    console.log(`  • icône Pipou gravée sur ${app.productFilename}.exe`)
  } catch (e) {
    console.warn(`  ! rcedit a échoué (${e.message}) — l'exe gardera l'icône Electron.`)
  }
}
