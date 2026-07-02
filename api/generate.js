const SPEECHGEN_URL = "https://speechgen.io/index.php?r=api/text";
const ALLOWED_VOICES = new Set(["Arnold", "Andrew"]);

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

  if (!script) {
    return res.status(400).json({ error: "script is required." });
  }

  if (script.length > 2000) {
    return res.status(400).json({
      error: "SpeechGen /text accepts up to 2,000 characters. Split this into smaller audio tracks."
    });
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

  return res.status(200).json({
    filename,
    audio_url: result.file,
    duration_seconds: result.duration,
    format: result.format,
    cost: result.cost,
    remaining_balance: result.balans,
    voices: {
      atc: "Arnold",
      pilot: "Andrew"
    }
  });
}
