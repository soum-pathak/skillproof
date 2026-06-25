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
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }
    );
    if (!geminiRes.ok) throw new Error("Gemini request failed: " + geminiRes.status);

    const geminiData = await geminiRes.json();
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
        name: name || "Anonymous",
        score: result.score,
        tier: result.tier,
        feedback: result.feedback
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
