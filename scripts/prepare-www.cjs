// 把网页运行所需文件复制到 www，供 Capacitor 打包安卓 APK
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const www = path.join(root, "www");

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}
function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else copy(s, d);
  }
}

rmrf(www);
fs.mkdirSync(www, { recursive: true });
for (const f of ["index.html", "app.js", "cloud.js", "sw.js", "manifest.webmanifest"]) {
  copy(path.join(root, f), path.join(www, f));
}
copyDir(path.join(root, "lib"), path.join(www, "lib"));
copyDir(path.join(root, "icons"), path.join(www, "icons"));
console.log("www prepared");
