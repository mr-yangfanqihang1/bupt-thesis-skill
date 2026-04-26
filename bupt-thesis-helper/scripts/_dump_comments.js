'use strict';
const fs = require('fs');
const JSZip = require('jszip');

function textFrom(xml) {
  const parts = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m;
  while ((m = re.exec(String(xml || ''))) !== null) {
    parts.push(m[1].replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  }
  return parts.join('').trim();
}

async function main() {
  const p = process.argv[2];
  const z = await JSZip.loadAsync(fs.readFileSync(p));
  const c = z.file('word/comments.xml');
  if (!c) {
    console.log('NO comments.xml');
    const names = Object.keys(z.files).filter((n) => /comment/i.test(n));
    console.log('comment-like:', names.slice(0, 30));
    return;
  }
  const xml = await c.async('string');
  const blocks = xml.match(/<w:comment\b[\s\S]*?<\/w:comment>/g) || [];
  blocks.forEach((b, i) => {
    const id = (b.match(/w:id="([^"]+)"/) || [])[1];
    const author = (b.match(/w:author="([^"]*)"/) || [])[1];
    const date = (b.match(/w:date="([^"]*)"/) || [])[1];
    const t = textFrom(b);
    console.log('\n---', i + 1, 'id=', id, 'author=', author, date);
    console.log(t);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
