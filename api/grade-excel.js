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

  const { name, q1, q2, q3, q4, elapsedSeconds } = req.body;
  if (!q1 || !q2 || !q3 || !q4) {
    return res.status(400).json({ error: "All four answers are required" });
  }

  const DATASET_TEXT = `Row | Product   | Region | Units Sold | Price
2   | Notebook  | North  | 120        | 4.50
3   | Pen Set   | North  | 340        | 2.20
4   | Notebook  | South  | 95         | 4.50
5   | Stapler   | South  | 60         | 7.80
6   | Pen Set   | East   | 210        | 2.20
7   | Stapler   | East   | 40         | 7.80
8   | Notebook  | East   | 150        | 4.50
9   | Pen Set   | South  | 75         | 2.20
(Column A = Product, B = Region, C = Units Sold, D = Price. Data starts at row 2.)`;

  const timeNote = (typeof elapsedSeconds === "number")
    ? `The candidate took ${elapsedSeconds} seconds to complete all four questions.`
    : "No timing data was recorded.";

  const prompt = `You are a strict but fair evaluator of practical Excel/spreadsheet skill for job-readiness testing. The candidate cannot use a real spreadsheet — they typed formulas as plain text. Judge each formula by reasoning about whether its logic and syntax would produce the correct result if entered in Excel or Google Sheets. Minor syntax variations (e.g. different quote styles, VLOOKUP vs XLOOKUP, absolute vs relative references) are acceptable if the logic is correct.

DATASET the candidate was working from:
${DATASET_TEXT}

QUESTION 1 (basic formula): Calculate total revenue (Units Sold × Price) for row 2 (Notebook, North). Correct answer is logically equivalent to =C2*D2.
CANDIDATE'S ANSWER: """${q1}"""

QUESTION 2 (SUMIF): Total Units Sold for the North region only. Correct answer is logically equivalent to =SUMIF(B2:B9,"North",C2:C9).
CANDIDATE'S ANSWER: """${q2}"""

QUESTION 3 (COUNTIF): Count rows where Units Sold > 100. Correct answer is logically equivalent to =COUNTIF(C2:C9,">100").
CANDIDATE'S ANSWER: """${q3}"""

QUESTION 4 (XLOOKUP/VLOOKUP): Find the Price of "Stapler". Correct answer is logically equivalent to =XLOOKUP("Stapler",A2:A9,D2:D9) or =VLOOKUP("Stapler",A2:D9,4,FALSE).
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
        skill: "excel"
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

