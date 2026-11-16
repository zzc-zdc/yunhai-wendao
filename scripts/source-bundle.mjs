import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = process.cwd();
const paths = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .sort();
const languages = {
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.json': 'json',
  '.html': 'html',
  '.css': 'css',
  '.yml': 'yaml',
  '.md': 'markdown',
};
let document =
  '# 云海问道 · 完整项目源码\n\n本文件由实际仓库逐文件生成，未省略实现。依赖通过 package-lock.json 固定，node_modules 与构建产物不重复展开。\n\n```text\n' +
  paths.join('\n') +
  '\n```\n';
for (const file of paths) {
  const buffer = await fs.readFile(path.join(root, file));
  if (buffer.includes(0)) continue;
  document += `\n## ${file}\n\n\`\`\`\`${languages[path.extname(file)] || 'text'}\n${buffer.toString('utf8')}\n\`\`\`\`\n`;
}
await fs.mkdir('artifacts', { recursive: true });
await fs.writeFile('artifacts/完整源码.md', document, 'utf8');
console.log(`Wrote ${paths.length} files to artifacts/完整源码.md`);
