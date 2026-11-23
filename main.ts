// gta6-meme-x-01 entry program (Node 22, standard library only).
//
// The entry itself is a post on X; this repository only has to hand in the
// post's address. The grader runs this file with MAKEFUN_BOT_DIR pointing at
// the repository and MAKEFUN_OUTPUT_DIR at the folder it reads results from,
// so the whole job is: copy POST.json from the first folder into the second,
// byte for byte, and fail loudly if it is not there.

import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const botDir = process.env.MAKEFUN_BOT_DIR || '/bot';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

mkdirSync(outputDir, { recursive: true });

const source = join(botDir, 'POST.json');
const target = join(outputDir, 'POST.json');
try {
  copyFileSync(source, target);
} catch (err) {
  console.error('could not copy POST.json from ' + botDir + ': ' + err.message);
  process.exit(1);
}
