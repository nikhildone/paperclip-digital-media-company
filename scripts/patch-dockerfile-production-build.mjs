import { readFileSync, writeFileSync } from 'node:fs';

const file = 'Dockerfile';
let text = readFileSync(file, 'utf8');
const oldLine = 'RUN pnpm run build';
const newBlock = `RUN pnpm run preflight:workspace-links \\
  && pnpm --filter @paperclipai/ui... build \\
  && pnpm --filter @paperclipai/server... build \\
  && PAPERCLIP_RELEASE_REUSE_UI_DIST=1 pnpm --filter @paperclipai/server prepare:ui-dist`;
if (!text.includes(newBlock)) {
  text = text.replace(oldLine, newBlock);
}
const check = 'RUN test -f server/ui-dist/index.html || (echo "ERROR: server UI output missing" && exit 1)';
if (!text.includes(check)) {
  text = text.replace('RUN test -f packages/shared/dist/index.js || (echo "ERROR: shared build output missing" && exit 1)', 'RUN test -f packages/shared/dist/index.js || (echo "ERROR: shared build output missing" && exit 1)\n' + check);
}
writeFileSync(file, text);
console.log('Dockerfile production build patch applied');
