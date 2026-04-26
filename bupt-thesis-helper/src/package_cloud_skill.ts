// @ts-nocheck
export {};
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

const BINARY_EXTENSIONS = new Set([
  '.doc', '.docx', '.pdf',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg',
  '.zip', '.skill', '.7z', '.rar',
  '.exe', '.dll',
]);

const SKIP_DIRS = new Set(['.git', 'node_modules', '.DS_Store']);

function shouldSkip(filePath) {
  const base = path.basename(filePath);
  if (SKIP_DIRS.has(base)) return true;
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

function copyTextTree(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (shouldSkip(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyTextTree(path.join(src, child), path.join(dest, child));
    }
    return;
  }
  if (stat.isFile() && !shouldSkip(src)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
}

function verifySkillRoot(root) {
  const skillPath = path.join(root, 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    throw new Error('云端包根目录缺少 SKILL.md');
  }
  const text = fs.readFileSync(skillPath, 'utf-8');
  if (!text.startsWith('---')) {
    throw new Error('SKILL.md 必须以 YAML frontmatter（---）开头');
  }
  const allSkillFiles = [];
  function walk(dir) {
    for (const child of fs.readdirSync(dir)) {
      const full = path.join(dir, child);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (child === 'SKILL.md') allSkillFiles.push(full);
    }
  }
  walk(root);
  if (allSkillFiles.length !== 1) {
    throw new Error(`云端包必须且只能包含一个 SKILL.md，当前为 ${allSkillFiles.length} 个。`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const skillRoot = path.resolve(args.input || args._[0] || path.join(__dirname, '..'));
  const outZip = path.resolve(args.output || path.join(path.dirname(skillRoot), `${path.basename(skillRoot)}-cloud.zip`));
  const outSkill = path.resolve(args.skill || outZip.replace(/\.zip$/i, '.skill'));
  if (!fs.existsSync(skillRoot)) {
    throw new Error(`skill 目录不存在: ${skillRoot}`);
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-skill-'));
  const tmpSkillRoot = path.join(tmpRoot, 'skill');
  try {
    copyTextTree(skillRoot, tmpSkillRoot);
    verifySkillRoot(tmpSkillRoot);
    for (const out of [outZip, outSkill]) {
      if (fs.existsSync(out)) fs.rmSync(out, { force: true });
    }
    const tarEntries = ['SKILL.md', 'assets', 'references', 'scripts'];
    if (fs.existsSync(path.join(tmpSkillRoot, 'src'))) {
      tarEntries.push('src');
    }
    if (fs.existsSync(path.join(tmpSkillRoot, 'tsconfig.json'))) {
      tarEntries.push('tsconfig.json');
    }
    if (fs.existsSync(path.join(tmpSkillRoot, 'package.json'))) {
      tarEntries.push('package.json');
    }
    if (fs.existsSync(path.join(tmpSkillRoot, 'package-lock.json'))) {
      tarEntries.push('package-lock.json');
    }
    run('tar', ['-a', '-cf', outZip, '-C', tmpSkillRoot, ...tarEntries]);
    fs.copyFileSync(outZip, outSkill);
    console.log(`zip=${outZip}`);
    console.log(`skill=${outSkill}`);
    console.log('云端包已生成：不包含 docx、图片、pdf 等二进制文件。');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
