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

  const { name, testId, q1, q2, q3, q4, elapsedSeconds, userId, authenticitySummary } = req.body;
  if (!testId) {
    return res.status(400).json({ error: "testId is required" });
  }
  if (!q1 || !q2 || !q3 || !q4) {
    return res.status(400).json({ error: "All four answers are required" });
  }

  let assessment;
  try {
    assessment = await fetchAssessment(testId);
  } catch (err) {
    console.error(err);
    return res.status(404).json({ error: "Could not find this test. It may have expired — please start a new one." });
  }

  if (assessment.skill !== "excel") {
    return res.status(400).json({ error: "This testId is not an Excel assessment" });
  }

  const { datasetText, columnMap, questions } = assessment.questions;
  const answerKey = assessment.answer_key;

  const timeNote = (typeof elapsedSeconds === "number")
    ? `The candidate took ${elapsedSeconds} seconds to complete all four questions.`
    : "No timing data was recorded.";

  const prompt = `You are a strict but fair evaluator of practical Excel/spreadsheet skill for job-readiness testing. The candidate cannot use a real spreadsheet — they typed formulas as plain text. Judge each formula by reasoning about whether its logic and syntax would produce the correct result if entered in Excel or Google Sheets. Minor syntax variations (e.g. different quote styles, VLOOKUP vs XLOOKUP, absolute vs relative references) are acceptable if the logic is correct.

DATASET the candidate was working from:
${datasetText}
${columnMap}

QUESTION 1 (${questions[0].label}): ${questions[0].text}
Correct answer is logically equivalent to: ${answerKey.q1}
CANDIDATE'S ANSWER: """${q1}"""

QUESTION 2 (${questions[1].label}): ${questions[1].text}
Correct answer is logically equivalent to: ${answerKey.q2}
CANDIDATE'S ANSWER: """${q2}"""

QUESTION 3 (${questions[2].label}): ${questions[2].text}
Correct answer is logically equivalent to: ${answerKey.q3}
CANDIDATE'S ANSWER: """${q3}"""

QUESTION 4 (${questions[3].label}): ${questions[3].text}
Correct answer is logically equivalent to: ${answerKey.q4}
CANDIDATE'S ANSWER: """${q4}"""

TIMING: ${timeNote} A reasonable time for someone competent is 2-5 minutes (120-300 seconds). Apply at most a small bonus (a few points) for fast AND fully correct work, or a small penalty (a few points) for unusually slow completion (over 10 minutes / 600 seconds). Correctness of the formulas should always matter far more than speed.

Grade primarily on correctness and completion across all 4 questions, with a minor adjustment for time as described above.

Respond with ONLY valid JSON, no markdown formatting, no backticks, in exactly this shape:
{"score": <integer 0-100>, "tier": "Bronze|Silver|Gold", "feedback": "<3-4 sentences, briefly noting which question(s) were right or wrong and why, plus a one-line note on pacing>"}

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
      skill: "excel",
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
