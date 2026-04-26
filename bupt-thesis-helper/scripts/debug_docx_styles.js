'use strict';

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t.startsWith('--')) {
      args._.push(t);
      continue;
    }
    const k = t.slice(2);
    const n = argv[i + 1];
    if (!n || n.startsWith('--')) args[k] = true;
    else {
      args[k] = n;
      i += 1;
    }
  }
  return args;
}

function decodeXml(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');
}

function attr(xml, name) {
  const escaped = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = String(xml || '').match(new RegExp(`\\b${escaped}="([^"]*)"`, 'i'));
  return m ? decodeXml(m[1]) : '';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args.input || args._[0];
  const ids = String(args.ids || '32,34,1').split(',').map((x) => x.trim()).filter(Boolean);
  if (!input) throw new Error('Usage: node scripts/debug_docx_styles.js --input <docx> [--ids 32,34]');
  const zip = await JSZip.loadAsync(fs.readFileSync(path.resolve(input)));
  const styles = await zip.file('word/styles.xml').async('string');
  for (const id of ids) {
    const re = new RegExp(`<w:style\\b[^>]*\\bw:styleId="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>[\\s\\S]*?<\\/w:style>`, 'i');
    const m = styles.match(re);
    if (!m) {
      console.log(`\nstyleId=${id}: NOT FOUND`);
      continue;
    }
    const block = m[0];
    const name = attr((block.match(/<w:name\b[^>]*\/>/) || [''])[0], 'w:val');
    const basedOn = attr((block.match(/<w:basedOn\b[^>]*\/>/) || [''])[0], 'w:val');
    const next = attr((block.match(/<w:next\b[^>]*\/>/) || [''])[0], 'w:val');
    const pPr = (block.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/) || [''])[0];
    const rPr = (block.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/) || [''])[0];
    console.log(`\nstyleId=${id}`);
    console.log(`name=${name || '(none)'}`);
    console.log(`basedOn=${basedOn || '(none)'}`);
    console.log(`next=${next || '(none)'}`);
    console.log(`pPr=${pPr.replace(/\s+/g, ' ').slice(0, 500) || '(none)'}`);
    console.log(`rPr=${rPr.replace(/\s+/g, ' ').slice(0, 500) || '(none)'}`);
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
