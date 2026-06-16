#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const routeFile = path.resolve(process.cwd(), 'server/src/routes/sink-dink-media-output.ts');
let source = await fs.readFile(routeFile, 'utf8');
let changed = false;

function replaceOnce(search, replacement, label) {
  if (source.includes(replacement)) return;
  if (!source.includes(search)) {
    console.warn(`[patch-media-output-low-resource] skipped ${label}: search text not found`);
    return;
  }
  source = source.replace(search, replacement);
  changed = true;
  console.log(`[patch-media-output-low-resource] applied ${label}`);
}

replaceOnce(
  'const duration = Math.max(10, Math.min(60, totalSceneDuration || requestedDuration));',
  'const duration = Math.max(8, Math.min(30, totalSceneDuration || requestedDuration));',
  'duration-cap-30s'
);

replaceOnce(
  "return `drawtext=fontfile=${FONT_FILE}:text='${escapeDrawText(scene.overlayText)}':fontcolor=white:fontsize=62:x=(w-text_w)/2:y=${y}:box=1:boxcolor=0x111827@0.68:boxborderw=40:enable='between(t\\,${start}\\,${end})'`;",
  "return `drawtext=fontfile=${FONT_FILE}:text='${escapeDrawText(scene.overlayText)}':fontcolor=white:fontsize=44:x=(w-text_w)/2:y=${y}:box=1:boxcolor=0x111827@0.70:boxborderw=24:enable='between(t\\,${start}\\,${end})'`;",
  'scene-font-low-resource'
);

replaceOnce(
  "filters.push(`drawtext=fontfile=${FONT_FILE}:text='SINK DINK INDIA':fontcolor=0xa7f3d0:fontsize=38:x=70:y=90:enable='between(t\\,0\\,${duration})'`);",
  "filters.push(`drawtext=fontfile=${FONT_FILE}:text='SINK DINK INDIA':fontcolor=0xa7f3d0:fontsize=28:x=48:y=70:enable='between(t\\,0\\,${duration})'`);",
  'header-font-low-resource'
);

replaceOnce(
  "filters.push(`drawtext=fontfile=${FONT_FILE}:text='TEST OUTPUT • HUMAN APPROVAL REQUIRED':fontcolor=0xfde68a:fontsize=30:x=70:y=h-140:enable='between(t\\,0\\,${duration})'`);",
  "filters.push(`drawtext=fontfile=${FONT_FILE}:text='TEST OUTPUT • HUMAN APPROVAL REQUIRED':fontcolor=0xfde68a:fontsize=22:x=48:y=h-100:enable='between(t\\,0\\,${duration})'`);",
  'footer-font-low-resource'
);

replaceOnce(
  'const args = ["-y", "-f", "lavfi", "-i", `color=c=0x0f172a:s=1080x1920:r=30:d=${duration}`];',
  'const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=0x0f172a:s=720x1280:r=24:d=${duration}`];',
  '720p-24fps-input'
);

replaceOnce(
  'args.push("-vf", filters.join(","), "-t", String(duration), "-c:v", "libx264", "-pix_fmt", "yuv420p");',
  'args.push("-vf", filters.join(","), "-t", String(duration), "-c:v", "libx264", "-preset", "ultrafast", "-crf", "32", "-threads", "1", "-pix_fmt", "yuv420p");',
  'x264-low-resource-settings'
);

replaceOnce(
  'const result = await runCommand("ffmpeg", args, dir, 90_000);',
  'const result = await runCommand("ffmpeg", args, dir, 45_000);',
  'ffmpeg-timeout-45s'
);

replaceOnce(
  'return result.ok ? out : null;\n}\n\nfunction fileUrl',
  'if (!result.ok) {\n    await fs.writeFile(path.join(dir, "render_error.txt"), result.stderr || result.stdout || "ffmpeg render failed").catch(() => undefined);\n  }\n  return result.ok ? out : null;\n}\n\nfunction fileUrl',
  'render-error-artifact'
);

if (changed) {
  await fs.writeFile(routeFile, source, 'utf8');
  console.log('[patch-media-output-low-resource] done');
} else {
  console.log('[patch-media-output-low-resource] no changes needed');
}
