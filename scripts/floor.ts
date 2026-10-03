import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { z } from "zod";
import { FLOOR_KEY, FLOOR_PROMPT, IMAGE_MODEL } from "../src/worker/art";

const account = z.string().min(1).parse(process.env.CLOUDFLARE_ACCOUNT_ID);

const token = z.string().min(1).parse(process.env.CLOUDFLARE_API_TOKEN);

const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${IMAGE_MODEL}`;

const response = await fetch(url, {
  method: "POST",
  headers: { authorization: `Bearer ${token}` },
  body: JSON.stringify({ prompt: FLOOR_PROMPT, steps: 8 }),
});

const reply = z.object({ result: z.object({ image: z.string() }) }).parse(await response.json());

const path = "src/web/public/floor.jpg";

writeFileSync(path, Buffer.from(reply.result.image, "base64"));

const upload = spawnSync(
  "wrangler",
  ["r2", "object", "put", `zoo-sprites/${FLOOR_KEY}`, "--file", path, "--content-type", "image/jpeg", "--remote"],
  { stdio: "inherit" },
);

process.exit(upload.status ?? 1);
