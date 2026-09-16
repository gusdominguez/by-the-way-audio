import { put } from "@vercel/blob";
import ffmpegPath from "ffmpeg-static";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, unlink, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";

const SPEECHGEN_URL = "https://speechgen.io/index.php?r=api/text";
const ALLOWED_VOICES = new Set(["Arnold", "Andrew"]);
const execFileAsync = promisify(execFile);

function buildVhfFilter(intensity) {
  const amount = intensity / 100;
  const lowpass = Math.round(3400 - amount * 500);
  const noiseAmplitude = (0.0025 + amount * 0.012).toFixed(4);

  return [
    `[0:a]highpass=f=300,lowpass=f=${lowpass},` +
      "acompressor=threshold=0.08:ratio=3:attack=5:release=80:makeup=1.2," +
      "aresample=44100,pan=mono|c0=c0[voice]",
    `anoisesrc=color=white:amplitude=${noiseAmplitude}:sample_rate=44100,` +
      "highpass=f=300,lowpass=f=3400[noise]",
    "[voice][noise]amix=inputs=2:duration=first:dropout_transition=0," +
      "alimiter=limit=0.95,aresample=44100,pan=mono|c0=c0[out]"
  ].join(";");
}

async function applyVhfEffect(sourceUrl, filename, intensity) {
  const temporaryId = crypto.randomUUID();
  const sourcePath = path.join(os.tmpdir(), `${temporaryId}-source.mp3`);
  const processedPath = path.join(os.tmpdir(), `${temporaryId}-processed.mp3`);

  try {
    const sourceResponse = await fetch(sourceUrl);
    if (!sourceResponse.ok) {
      throw new Error(`Could not download SpeechGen audio (${sourceResponse.status}).`);
    }

    await writeFile(sourcePath, Buffer.from(await sourceResponse.arrayBuffer()));

    await execFileAsync(ffmpegPath, [
      "-y",
      "-i",
      sourcePath,
      "-filter_complex",
      buildVhfFilter(intensity),
      "-map",
      "[out]",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "96k",
      "-ar",
      "44100",
      "-ac",
      "1",
      processedPath
    ]);

    const processedAudio = await readFile(processedPath);
    const blob = await put(`aviation-audio/${filename}`, processedAudio, {
      access: "public",
      addRandomSuffix: true,
      contentType: "audio/mpeg"
    });

    return blob.url;
  } finally {
    await Promise.all([
      unlink(sourcePath).catch(() => {}),
      unlink(processedPath).catch(() => {})
    ]);
  }
}

function unauthorized(res) {
  return res.status(401).json({ error: "Unauthorized." });
}

function getBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }
  return req.body;
}

function normaliseScript(script) {
  return String(script || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function validateDialogVoices(script) {
  const regex = /<dialog\s+voice\s*=\s*['"]([^'"]+)['"]\s*>/gi;
  let match;
  const found = new Set();

  while ((match = regex.exec(script)) !== null) {
    found.add(match[1].trim());
  }

  for (const voice of found) {
    if (!ALLOWED_VOICES.has(voice)) {
      return {
        ok: false,
        error: `Only Arnold and Andrew are allowed. Unsupported voice: ${voice}`
      };
    }
  }

  const openingTags = (script.match(/<dialog\b/gi) || []).length;
  const closingTags = (script.match(/<\/dialog>/gi) || []).length;

  if (openingTags !== closingTags) {
    return {
      ok: false,
      error: "The number of <dialog> and </dialog> tags does not match."
    };
  }

  return { ok: true };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const expectedKey = String(process.env.GPT_ACTION_KEY || "").trim();
const authorization = String(req.headers.authorization || "").trim();
const customKey = String(req.headers["x-btw-api-key"] || "").trim();
const bearerKey = authorization.replace(/^Bearer\s+/i, "").trim();

if (
  !expectedKey ||
  (bearerKey !== expectedKey && customKey !== expectedKey)
) {
  return res.status(401).json({
    error: "Unauthorized.",
    diagnostic: {
      gpt_action_key_configured: Boolean(expectedKey),
      authorization_header_received: Boolean(authorization),
      custom_header_received: Boolean(customKey)
    }
  });
  }

  let body;
  try {
    body = getBody(req);
  } catch {
    return res.status(400).json({ error: "Invalid JSON body." });
  }

  const script = normaliseScript(body.script);
  const filename = String(body.filename || "by_the_way_audio.mp3")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  const vhfEffect = body.vhf_effect === undefined ? true : body.vhf_effect !== false;
  const vhfIntensity = body.vhf_intensity === undefined ? 75 : Number(body.vhf_intensity);

  if (!script) {
    return res.status(400).json({ error: "script is required." });
  }

  if (script.length > 2000) {
    return res.status(400).json({
      error: "SpeechGen /text accepts up to 2,000 characters. Split this into smaller audio tracks."
    });
  }

  if (!Number.isFinite(vhfIntensity) || vhfIntensity < 0 || vhfIntensity > 100) {
    return res.status(400).json({ error: "vhf_intensity must be a number from 0 to 100." });
  }

  const validation = validateDialogVoices(script);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  if (!process.env.SPEECHGEN_TOKEN || !process.env.SPEECHGEN_EMAIL || !process.env.GPT_ACTION_KEY) {
    return res.status(500).json({ error: "The server is missing required environment variables." });
  }

  const form = new URLSearchParams({
    token: process.env.SPEECHGEN_TOKEN,
    email: process.env.SPEECHGEN_EMAIL,
    voice: "Arnold",
    text: script,
    format: "mp3",
    speed: "0.96",
    pitch: "0",
    pause_sentence: "260",
    pause_paragraph: "500",
    sample_rate: "44100",
    bitrate: "192",
    channels: "1"
  });

  let speechgenResponse;
  let result;

  try {
    speechgenResponse = await fetch(SPEECHGEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString()
    });

    const raw = await speechgenResponse.text();
    try {
      result = JSON.parse(raw);
    } catch {
      return res.status(502).json({
        error: "SpeechGen returned an invalid response.",
        detail: raw.slice(0, 500)
      });
    }
  } catch (error) {
    return res.status(502).json({
      error: "Could not contact SpeechGen.",
      detail: error.message
    });
  }

  if (!speechgenResponse.ok || result.status !== 1) {
    return res.status(502).json({
      error: result?.error || "SpeechGen generation failed."
    });
  }

  let audioUrl = result.file;
  if (vhfEffect) {
    try {
      audioUrl = await applyVhfEffect(result.file, filename, vhfIntensity);
    } catch (error) {
      return res.status(502).json({
        error: "SpeechGen audio was generated, but VHF processing failed.",
        detail: error.message
      });
    }
  }

  return res.status(200).json({
    filename,
    audio_url: audioUrl,
    duration_seconds: result.duration,
    format: result.format,
    cost: result.cost,
    remaining_balance: result.balans,
    vhf_applied: vhfEffect,
    vhf_intensity: vhfEffect ? vhfIntensity : 0,
    voices: {
      atc: "Arnold",
      pilot: "Andrew"
    }
  });
}
