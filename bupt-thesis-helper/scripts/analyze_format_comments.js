'use strict';

/**
 * 从带批注的格式检测报告 docx 读取 word/comments.xml，按关键词归类，便于对照 format_docx 能力。
 * 用法: node scripts/analyze_format_comments.js --input <报告.docx>
 */
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
    if (!n || n.startsWith('--')) {
      args[k] = true;
    } else {
      args[k] = n;
      i += 1;
    }
  }
  return args;
}

function decodeXml(t) {
  return String(t || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');
}

function extractCommentsFromDocx(buf) {
  return JSZip.loadAsync(buf).then((zip) => {
    const f = zip.file('word/comments.xml');
    if (!f) return [];
    return f.async('string').then((s) => {
      const re = /<w:comment\b[^>]*w:id="(\d+)"[^>]*>([\s\S]*?)<\/w:comment>/g;
      const out = [];
      let m;
      while ((m = re.exec(s)) !== null) {
        const inner = m[2];
        const texts = [];
        const tre = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
        let tm;
        while ((tm = tre.exec(inner)) !== null) {
          texts.push(decodeXml(tm[1]));
        }
        out.push(texts.join('').replace(/\s+/g, ' ').trim());
      }
      return out;
    });
  });
}

function classify(text) {
  const t = String(text || '');
  if (/封面|任务书|成绩|诚信|独创|学号|指导教师|学院|专业/.test(t) && /封面|1-\d/.test(t)) return 'cover';
  if (/目录|二级目录|一级目录|三级目录|TOC|toc\s*\d/i.test(t)) return 'toc';
  if (/摘要|ABSTRACT|关键词|KEY\s*WORDS/i.test(t)) return 'abstract_keyword';
  if (/页眉|页脚|页码|罗马|阿拉伯|横线|I,\s*II/i.test(t)) return 'header_footer';
  if (/图题|表题|题注|^图\s|表\s|楷体|题注/.test(t)) return 'caption';
  if (/参考文献|7714/.test(t)) return 'reference';
  if (/嵌入|环绕|图片|版式/.test(t)) return 'figure_layout';
  if (/字数|字符|不足|超标|万字/.test(t)) return 'word_count';
  if (/空白行|空行/.test(t)) return 'blank_paragraphs';
  if (/左缩进|首行|悬挂|17\.|文本之前|磅/.test(t)) return 'indent_spacing';
  if (/一级标题|二级标题|三级标题|段前|段后|章|标题\d/.test(t)) return 'heading';
  if (/正文|绪论|结论/.test(t) && /错误|严重/.test(t)) return 'body_other';
  return 'other';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args.input || args._[0];
  if (!input || !fs.existsSync(input)) {
    console.error('请指定: node scripts/analyze_format_comments.js --input <报告.docx>');
    process.exit(1);
  }
  const buf = fs.readFileSync(path.resolve(input));
  extractCommentsFromDocx(buf).then((rows) => {
    const counts = {};
    const samples = {};
    for (const row of rows) {
      const c = classify(row);
      counts[c] = (counts[c] || 0) + 1;
      if (!samples[c]) samples[c] = [];
      if (samples[c].length < 4) samples[c].push(row.slice(0, 160));
    }
    console.log(JSON.stringify({ total: rows.length, counts, samples }, null, 2));
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

main();
