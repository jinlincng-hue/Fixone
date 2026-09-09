const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const dirs = [
  path.join(__dirname, 'public', 'uploads'),
  path.join(__dirname, 'public', 'assets', 'images'),
];

let totalBefore = 0;
let totalAfter = 0;
let count = 0;

function walk(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walk(full));
    else if (/\.(png|jpg|jpeg)$/i.test(entry.name)) results.push(full);
  }
  return results;
}

(async () => {
  const files = [];
  for (const d of dirs) {
    if (fs.existsSync(d)) files.push(...walk(d));
  }
  console.log(`Found ${files.length} images`);

  for (const file of files) {
    try {
      const before = fs.statSync(file).size;
      const ext = path.extname(file).toLowerCase();
      
      if (ext === '.png') {
        // 压缩PNG：palette模式 + 高质量压缩
        await sharp(file)
          .png({ quality: 80, compressionLevel: 9, palette: true, effort: 10 })
          .toFile(file + '.tmp');
        fs.renameSync(file + '.tmp', file);
      } else {
        // JPG压缩
        await sharp(file)
          .jpeg({ quality: 80, mozjpeg: true })
          .toFile(file + '.tmp');
        fs.renameSync(file + '.tmp', file);
      }

      // 生成WebP版本
      const webpFile = file.replace(/\.(png|jpg|jpeg)$/i, '.webp');
      await sharp(file)
        .webp({ quality: 75, effort: 6 })
        .toFile(webpFile);

      const after = fs.statSync(file).size;
      totalBefore += before;
      totalAfter += after;
      count++;
      
      const saved = ((1 - after / before) * 100).toFixed(1);
      console.log(`[${count}/${files.length}] ${path.basename(file)}: ${(before/1024).toFixed(0)}KB -> ${(after/1024).toFixed(0)}KB (-${saved}%)`);
    } catch (e) {
      console.error(`FAIL ${file}: ${e.message}`);
      if (fs.existsSync(file + '.tmp')) fs.unlinkSync(file + '.tmp');
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Files: ${count}`);
  console.log(`Before: ${(totalBefore/1024/1024).toFixed(2)}MB`);
  console.log(`After:  ${(totalAfter/1024/1024).toFixed(2)}MB`);
  console.log(`Saved:  ${((1-totalAfter/totalBefore)*100).toFixed(1)}%`);
})();
