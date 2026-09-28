// Builds starway-standalone.html: the whole site in one HTML file (stylesheets and scripts,
// including the embedded panorama, inlined), so it opens by double-click with nothing else.
// usage (repository root): node tools/build-single.cjs [siteDir=.] [out=starway-standalone.html]
const fs = require('fs');
const path = require('path');
const site = path.resolve(process.argv[2] || '.');
const out = path.resolve(process.argv[3] || path.join(site, 'starway-standalone.html'));
const read = rel => fs.readFileSync(path.join(site, rel), 'utf8');
let html = read('index.html'), styles = 0, scripts = 0;
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) => { styles++; return `<style>\n${read(href)}\n</style>`; });
html = html.replace(/<script src="([^"]+)"( defer)?><\/script>/g, (m, src) => {
  const code = read(src);
  if (/<\/script/i.test(code)) throw new Error(`${src} contains </script`);
  scripts++;
  return `<script>/* ${src} */\n${code}\n</script>`;
});
if (/href="assets\/|src="assets\//.test(html)) throw new Error('a reference to assets/ is left');
fs.writeFileSync(out, html);
console.log(`${path.basename(out)}: ${styles} stylesheets, ${scripts} scripts, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
