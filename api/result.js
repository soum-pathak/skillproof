export default async function handler(req, res) {
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: "Missing id" });
  }

  try {
    const supaRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/results?id=eq.${id}&select=name,score,tier,feedback,created_at,skill`,
      {
        headers: {
          "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
        }
      }
    );

    if (!supaRes.ok) throw new Error("Supabase lookup failed: " + supaRes.status);

    const rows = await supaRes.json();
    if (rows.length === 0) {
      return res.status(404).json({ error: "Result not found" });
    }

    return res.status(200).json(rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not load result" });
  }
}
