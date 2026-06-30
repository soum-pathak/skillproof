async function callGemini(prompt) {
  const maxAttempts = 4;
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
    // 429 means we've hit a rate limit (too many requests too quickly) — also
    // worth trying again, but rate limits usually need a longer pause to
    // clear than a simple server hiccup does, so it gets a longer wait below.
    // Any other error code means something is actually wrong, so stop right away.
    const isRetryable = geminiRes.status === 503 || geminiRes.status === 429;
    if (!isRetryable || attempt === maxAttempts) {
      throw new Error("Gemini request failed: " + geminiRes.status);
    }

    // Rate limits (429) get a longer, larger backoff than a busy-server
    // retry (503) would, since clearing a per-minute rate limit usually
    // takes several seconds, not a couple.
    const waitMs = geminiRes.status === 429 ? attempt * 5000 : attempt * 2000;
    await new Promise(r => setTimeout(r, waitMs));
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

// Renders a table's rows as a compact pipe-separated block so it's cheap
// (in tokens) but still fully explicit for Gemini to trace queries against.
function formatTableForPrompt(table) {
  const colNames = (table.columns || []).map(c => c.name);
  let text = `Table: ${table.name}\nColumns: ${colNames.join(", ")}\nRows:\n`;
  (table.rows || []).forEach(row => {
    text += colNames.map(name => `${name}=${row[name]}`).join(", ") + "\n";
  });
  return text;
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

  if (assessment.skill !== "sql") {
    return res.status(400).json({ error: "This testId is not a SQL assessment" });
  }

  const { scenario, tables, questions } = assessment.questions;
  // templates.js's "sql" entry declares privateFields: ["answer_key", "self_check"],
  // so the saved answer_key column is itself an object containing both of
  // those fields — the real per-question key lives one level deeper than
  // it does for excel/written-english. self_check isn't used for grading
  // here; it was only generated for our own manual sanity-checking.
  const answerKey = assessment.answer_key.answer_key;

  const tablesText = (tables || []).map(formatTableForPrompt).join("\n");

  const timeNote = (typeof elapsedSeconds === "number")
    ? `The candidate took ${elapsedSeconds} seconds to complete all four questions.`
    : "No timing data was recorded.";

  const prompt = `You are a strict but fair evaluator of practical SQL skill for job-readiness testing. The candidate typed SQL queries as plain text; they did not run them against a real database. Judge each query by reasoning about whether it would actually execute correctly against the tables below and produce a result matching the listed expected_result. Minor syntactic differences (e.g. JOIN vs INNER JOIN, different column aliases, different but equivalent WHERE/HAVING phrasing) are acceptable if the logic and final result would be correct. Use each question's grading_notes to decide what variation is acceptable — especially whether row ORDER matters and whether an empty result is valid.

SCENARIO: ${scenario ? scenario.title + " — " + scenario.context : "(no scenario provided)"}

TABLES the candidate was working from:
${tablesText}

QUESTION 1 (${questions[0].type}): ${questions[0].prompt}
Expected columns: ${(questions[0].expected_columns || []).join(", ")}
Correct logic: ${answerKey.q1.correct_logic}
Reference query: ${answerKey.q1.reference_query}
Expected result: ${JSON.stringify(answerKey.q1.expected_result)}
Grading notes: ${answerKey.q1.grading_notes}
CANDIDATE'S ANSWER: """${q1}"""

QUESTION 2 (${questions[1].type}): ${questions[1].prompt}
Expected columns: ${(questions[1].expected_columns || []).join(", ")}
Correct logic: ${answerKey.q2.correct_logic}
Reference query: ${answerKey.q2.reference_query}
Expected result: ${JSON.stringify(answerKey.q2.expected_result)}
Grading notes: ${answerKey.q2.grading_notes}
CANDIDATE'S ANSWER: """${q2}"""

QUESTION 3 (${questions[2].type}): ${questions[2].prompt}
Expected columns: ${(questions[2].expected_columns || []).join(", ")}
Correct logic: ${answerKey.q3.correct_logic}
Reference query: ${answerKey.q3.reference_query}
Expected result: ${JSON.stringify(answerKey.q3.expected_result)}
Grading notes: ${answerKey.q3.grading_notes}
CANDIDATE'S ANSWER: """${q3}"""

QUESTION 4 (${questions[3].type}): ${questions[3].prompt}
Expected columns: ${(questions[3].expected_columns || []).join(", ")}
Correct logic: ${answerKey.q4.correct_logic}
Reference query: ${answerKey.q4.reference_query}
Expected result: ${JSON.stringify(answerKey.q4.expected_result)}
Grading notes: ${answerKey.q4.grading_notes}
CANDIDATE'S ANSWER: """${q4}"""

TIMING: ${timeNote} A reasonable time for someone competent is 3-7 minutes (180-420 seconds), since SQL queries take longer to compose than single Excel formulas. Apply at most a small bonus (a few points) for fast AND fully correct work, or a small penalty (a few points) for unusually slow completion (over 12 minutes / 720 seconds). Correctness of the queries should always matter far more than speed.

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
      skill: "sql",
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
