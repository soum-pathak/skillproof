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

async function fetchAssessment(testId) {
  const res = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/assessment_pool?id=eq.${testId}&select=*`,
    {
      headers: {
        "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      }
    }
  );
  if (!res.ok) throw new Error("Could not fetch assessment: " + res.status);
  const rows = await res.json();
  if (!rows || rows.length === 0) throw new Error("Assessment not found for testId: " + testId);
  return rows[0];
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST requests allowed" });
  }

  const { name, testId, answer, userId, authenticitySummary } = req.body;
  if (!testId) {
    return res.status(400).json({ error: "testId is required" });
  }
  if (!answer || !answer.trim()) {
    return res.status(400).json({ error: "Answer is required" });
  }

  let assessment;
  try {
    assessment = await fetchAssessment(testId);
  } catch (err) {
    console.error(err);
    return res.status(404).json({ error: "Could not find this test. It may have expired — please start a new one." });
  }

  if (assessment.skill !== "written-english") {
    return res.status(400).json({ error: "This testId is not a Written English assessment" });
  }

  const { scenarioText } = assessment.questions;
  const rubric = assessment.answer_key;

  const prompt = `You are a strict but fair evaluator of professional written English for job-readiness testing.

TASK GIVEN TO THE CANDIDATE:
"${scenarioText}"

GRADING RUBRIC FOR THIS SPECIFIC SCENARIO:
- Grammar & spelling: ${rubric.grammarSpelling}
- Clarity & structure: ${rubric.clarityStructure}
- Professional tone: ${rubric.professionalTone}
- Key points a strong reply must address: ${rubric.keyPointsExpected}

CANDIDATE'S RESPONSE:
"""${answer}"""

Grade against the rubric above.

Respond with ONLY valid JSON, no markdown formatting, no backticks, in exactly this shape:
{"score": <integer 0-100>, "tier": "Bronze|Silver|Gold", "feedback": "<2-3 sentences of specific, constructive feedback, referencing whether the key points above were addressed>"}

Tier rule: 0-59 = Bronze, 60-79 = Silver, 80-100 = Gold.`;

  try {
    const geminiData = await callGemini(prompt);
    let raw = geminiData.candidates[0].content.parts[0].text.trim();
    raw = raw.replace(/```json|```/g, "").trim();
    const result = JSON.parse(raw);

    // Build the row to save. user_id is only included if a real,
    // logged-in userId was sent from the page — anonymous submissions
    // (userId is null/undefined) save exactly as they always have, with
    // user_id left out entirely (Supabase will store it as null).
    const resultRow = {
      name: (name || "Anonymous").slice(0, 60),
      score: result.score,
      tier: result.tier,
      feedback: result.feedback,
      skill: "written-english",
      test_id: testId
    };
    if (userId) {
      resultRow.user_id = userId;
    }
    // Same pattern for the authenticity signal: only attached if the page
    // actually sent one. Older clients (or a future page that doesn't load
    // authenticity.js for some reason) simply won't include this, and the
    // column stays null, same as it always has been.
    if (authenticitySummary) {
      resultRow.authenticity_data = authenticitySummary;
    }

    const saveRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/results`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Prefer": "return=representation"
      },
      body: JSON.stringify(resultRow)
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
