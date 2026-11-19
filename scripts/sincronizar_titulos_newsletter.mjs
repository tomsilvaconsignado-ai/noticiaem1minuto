// Copia src/lib/editorias.ts para supabase/functions/newsletter/titulos.ts (a Edge Function
// não consegue importar arquivos de fora da própria pasta). Rode após alterar editorias.ts.
import { readFileSync, writeFileSync } from 'node:fs';
const origem = readFileSync('src/lib/editorias.ts', 'utf8').split('\n').filter(l => !l.startsWith('import type')).join('\n');
writeFileSync('supabase/functions/newsletter/titulos.ts', [
  '// CÓPIA GERADA de src/lib/editorias.ts para a Edge Function (Deno não importa arquivos de fora da pasta).',
  '// Para atualizar: node scripts/sincronizar_titulos_newsletter.mjs',
  'type Article = { id: string; title: string; subtitle?: string; content: string };',
  origem,
].join('\n'));
console.log('titulos.ts atualizado');
