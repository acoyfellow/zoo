import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ARROW = String.fromCharCode(0x2192);

const BANNED_PHRASES = [
  "In today's rapidly evolving landscape",
  "In the realm of",
  "When it comes to",
  "At its core",
  "Let's dive into",
  "It's worth noting",
  "It's important to note",
  "A testament to",
  "This is where",
  "Whether you're",
  "In conclusion",
  "Overall",
  "Ultimately",
  "I hope this helps",
  "cut through the noise",
  "game-changer",
  "paradigm shift",
  "wake-up call",
];

const BANNED_WORDS = [
  "seamless",
  "robust",
  "revolutionary",
  "game-changer",
  "cutting-edge",
  "leverage",
  "unlock",
  "supercharge",
  "effortless",
  "blazing",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) return sourceFiles(path);

    return /\.(svelte|ts)$/.test(entry) ? [path] : [];
  });
}

function hitsIn(path: string): string[] {
  const lines = readFileSync(path, "utf8").split("\n");

  return lines.flatMap((line, index) => {
    const lower = line.toLowerCase();

    const found = [
      ...(line.includes(ARROW) ? ["arrow U+2192"] : []),
      ...BANNED_PHRASES.filter((phrase) => lower.includes(phrase.toLowerCase())),
      ...BANNED_WORDS.filter((word) => new RegExp(`\\b${word}`, "i").test(line)),
    ];

    return found.map((term) => `${path}:${index + 1}: ${term}`);
  });
}

const files = [
  "README.md",
  "src/web/index.html",
  ...sourceFiles("src/web"),
  ...sourceFiles("src/front"),
  ...sourceFiles("src/worker"),
];

const hits = files.flatMap(hitsIn);

for (const hit of hits) console.error(hit);

if (hits.length > 0) process.exit(1);

console.log(`copy-check: ${files.length} files clean`);
