import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const privatePaths = files.filter(
  (f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith('.env.example'),
);
if (privatePaths.length)
  throw new Error('Arquivo de credenciais rastreado: ' + privatePaths.join(', '));
const secrets = [process.env.DATABASE_URL, process.env.TICKET_SERVICE_KEY].filter(
  (s): s is string => !!s && s.length > 15,
);
for (const file of files) {
  if (/\.(png|jpg|webp)$/.test(file)) continue;
  const content = readFileSync(file, 'utf8');
  if (secrets.some((secret) => content.includes(secret)))
    throw new Error('Credencial local encontrada em ' + file);
}
console.log(
  'Verificação aprovada: arquivos privados e credenciais locais fora dos arquivos versionados.',
);
