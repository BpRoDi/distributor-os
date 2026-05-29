import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const serverDir = join(process.cwd(), ".next", "server");
const chunksDir = join(serverDir, "chunks");

if (!existsSync(chunksDir)) {
  process.exit(0);
}

let copied = 0;

function copyNumericChunks(dir) {
  for (const entry of readdirSync(dir)) {
    const source = join(dir, entry);
    const stats = statSync(source);

    if (stats.isDirectory()) {
      copyNumericChunks(source);
      continue;
    }

    if (!/^\d+\.js$/.test(entry)) continue;

    const target = join(serverDir, basename(entry));
    copyFileSync(source, target);
    copied += 1;
  }
}

mkdirSync(serverDir, { recursive: true });
copyNumericChunks(chunksDir);

if (copied) {
  console.log(`Fixed Next server chunk paths: copied ${copied} chunk file${copied === 1 ? "" : "s"}.`);
}
