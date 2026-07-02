export default function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  return res.status(200).json({
    ok: true,
    service: "By The Way Aviation Audio",
    voices: {
      atc: "Arnold",
      pilot: "Andrew"
    }
  });
}
