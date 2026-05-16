import fs from "fs";
import path from "path";

const root = process.cwd();
const need = ["index.html", "script.js", "style.css"];
const rootFiles = Object.fromEntries(
  need.map((f) => [f, fs.existsSync(path.join(root, f))])
);

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const hasCss = /href=["']style\.css["']/.test(html);
const hasJs = /src=["']script\.js["']/.test(html);

const code = fs.readFileSync(path.join(root, "script.js"), "utf8");
const absPatterns = [
  /file:\/\//i,
  /["']file:\/\//i,
  /["'][A-Za-z]:\//,
  /["']\/(?:Users|home)\//i,
  /videoUrl:\s*["'][^"']*(?:file:\/\/|[A-Za-z]:\\|\/Users\/|\/home\/)/i,
];
const absHits = absPatterns
  .map((re, i) => ({ i, hit: re.test(code) }))
  .filter((x) => x.hit);

const reUrl = /videoUrl:\s*"([^"]+)"/g;
const urls = [];
let m;
while ((m = reUrl.exec(code))) urls.push(m[1]);

const nonRel = urls.filter((u) => !/^videos\/[^/]+$/.test(u));

const files = fs
  .readdirSync(path.join(root, "videos"))
  .filter((x) => x.endsWith(".mp4"))
  .sort();
const set = new Set(files);
const missing = urls.filter((u) => !set.has(u.slice("videos/".length)));
const extra = files.filter((f) => !urls.includes("videos/" + f));

const sizes = files
  .map((f) => {
    const p = path.join(root, "videos", f);
    return { f, bytes: fs.statSync(p).size };
  })
  .sort((a, b) => b.bytes - a.bytes);

function mb(b) {
  return (b / (1024 * 1024)).toFixed(2) + " MB";
}

console.log(
  JSON.stringify(
    {
      rootFiles,
      indexLinks: { styleCss: hasCss, scriptJs: hasJs },
      absolutePathSuspicious: absHits,
      videoUrlCount: urls.length,
      nonRelativeVideoUrls: nonRel,
      missingOnDisk: missing,
      diskMp4NotReferencedInVideosArray: extra,
      largest5: sizes.slice(0, 5).map((x) => ({ file: x.f, size: mb(x.bytes), bytes: x.bytes })),
      totalVideosBytes: sizes.reduce((a, x) => a + x.bytes, 0),
    },
    null,
    2
  )
);
