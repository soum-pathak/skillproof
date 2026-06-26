async function callGemini(prompt) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }
    );

    if (geminiRes.ok) {
      return await geminiRes.json();
    }

    // 503 means Google's server is just temporarily busy — worth trying again.
    // Any other error code means something is actually wrong, so stop right away.
    if (geminiRes.status !== 503 || attempt === maxAttempts) {
      throw new Error("Gemini request failed: " + geminiRes.status);
    }

    // Wait a little longer each retry, so we're not hammering an already-busy server
    await new Promise(r => setTimeout(r, attempt * 2000));
  }
}
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  const { name, answer } = req.body;
  if (!answer || !answer.trim()) {
    return res.status(400).json({ error: "Answer is required" });
  }

  const TASK_TEXT = "A customer emails you, upset that their order arrived five days late. Write a short, professional reply (3-5 sentences) that apologizes, explains you'll look into what happened, and offers a fair next step.";

  const prompt = `You are a strict but fair evaluator of professional written English for job-readiness testing.

TASK GIVEN TO THE CANDIDATE:
"${TASK_TEXT}"

CANDIDATE'S RESPONSE:
"""${answer}"""

Grade this on grammar & spelling, clarity & structure, professional tone, and vocabulary.

Respond with ONLY valid JSON, no markdown formatting, no backticks, in exactly this shape:
{"score": <integer 0-100>, "tier": "Bronze|Silver|Gold", "feedback": "<2-3 sentences of specific, constructive feedback>"}

Tier rule: 0-59 = Bronze, 60-79 = Silver, 80-100 = Gold.`;

  try {
    const geminiData = await callGemini(prompt);
    let raw = geminiData.candidates[0].content.parts[0].text.trim();
    raw = raw.replace(/```json|```/g, "").trim();
    const result = JSON.parse(raw);

    const saveRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/results`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Prefer": "return=representation"
      },
      body: JSON.stringify({
        name: (name || "Anonymous").slice(0, 60),
        score: result.score,
        tier: result.tier,
        feedback: result.feedback,
        skill: "written-english"
      })
    });
    if (!saveRes.ok) throw new Error("Supabase save failed: " + saveRes.status);

    const saved = await saveRes.json();

    return res.status(200).json({
      score: result.score,
      tier: result.tier,
      feedback: result.feedback,
      id: saved[0].id
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Grading failed. Please try again." });
  }
        }
