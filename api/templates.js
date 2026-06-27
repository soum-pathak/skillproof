// templates.js
// One entry per skill. Each entry tells Gemini exactly what SHAPE of test to
// generate (how many questions, what each question must test, the difficulty)
// while leaving the actual wording, names, numbers, and scenarios open.
//
// To add a new skill later: copy one of these blocks, change the prompt text
// to describe that skill's question shapes, and add it to the exports object
// at the bottom. No other file needs to change for a new skill to work.
//
// Skills like "sql" below also declare "privateFields" — an array naming
// which top-level fields in the generated JSON are private (answer key /
// internal reasoning) vs public (shown to the candidate). generate-pool.js
// uses this, via splitGeneratedOutput() below, to split generated output
// generically for any skill that declares it. Skills that don't declare
// privateFields (excel, written-english) are unaffected — generate-pool.js
// keeps using its original hardcoded logic for those two, exactly as before.

export const templates = {
  "excel": {
    skill: "excel",
    generatorPrompt: `You are creating ONE Excel/spreadsheet skill test. Invent a small, realistic business context (pick ANY plausible business type and randomize it — e.g. a bakery, a hardware store, a freelance design studio, a gym, a clinic, a logistics company — do not default to generic "sales" data every time).

Generate a dataset as a markdown table with 8 rows of data (plus a header row), 4 columns. Choose column names that fit your business context (for example: Product/Item, Region/Branch/Category, a Quantity-style numeric column, and a Price/Cost-style numeric column). Use realistic, varied values — different names, different numbers each time.

Then write exactly 4 questions about that dataset, increasing in difficulty, each testing a DIFFERENT one of these 4 skills in this exact order:
1. A basic single-cell formula (multiplying two columns for one specific row)
2. A SUMIF-style formula (summing one numeric column filtered by a category value)
3. A COUNTIF-style formula (counting rows matching a numeric condition, e.g. greater than some threshold)
4. An XLOOKUP or VLOOKUP-style formula (looking up a value in one column to return a value from another column, for one named row)

Pick a realistic numeric threshold for question 3 and a realistic named row for question 4, based on the actual dataset you generated.

Respond with ONLY valid JSON, no markdown formatting, no backticks, in exactly this shape:
{
  "datasetText": "<the markdown table as a single string, including header row>",
  "columnMap": "<one short sentence mapping column letters A/B/C/D to column names and stating data starts at row 2>",
  "questions": [
    { "qnum": 1, "label": "Basic formula", "text": "<question 1 text, referencing real column/row names from your dataset>" },
    { "qnum": 2, "label": "SUMIF", "text": "<question 2 text>" },
    { "qnum": 3, "label": "COUNTIF", "text": "<question 3 text>" },
    { "qnum": 4, "label": "XLOOKUP/VLOOKUP", "text": "<question 4 text>" }
  ],
  "answerKey": {
    "q1": "<the correct formula for question 1, using real cell references>",
    "q2": "<the correct formula for question 2>",
    "q3": "<the correct formula for question 3>",
    "q4": "<the correct formula for question 4>"
  }
}`
  },

  "written-english": {
    skill: "written-english",
    generatorPrompt: `You are creating ONE professional written-English skill test. Invent ONE realistic workplace writing scenario, picking randomly from this kind of range (vary it each time, do not always pick the same one): a late delivery complaint, a billing/refund dispute, a scheduling conflict, a product defect complaint, a miscommunication between coworkers, a request to reschedule a meeting, a vendor late-payment follow-up, a service cancellation request.

Invent a plausible customer/colleague name and a specific, concrete detail (a date, an order number, a product name, or similar) so the scenario feels real, not generic.

The candidate's task is always the same SHAPE: write a short, professional reply (3-5 sentences) that acknowledges the issue, addresses it appropriately (apology, explanation, or solution as fits the scenario), and offers a clear, fair next step.

Respond with ONLY valid JSON, no markdown formatting, no backticks, in exactly this shape:
{
  "scenarioText": "<the full scenario + instructions to the candidate, 2-4 sentences, written the way a task prompt should read>",
  "rubric": {
    "grammarSpelling": "<1 short sentence describing what to check for grammar/spelling in this specific scenario>",
    "clarityStructure": "<1 short sentence on what a clear, well-structured reply should cover for THIS scenario specifically>",
    "professionalTone": "<1 short sentence on what an appropriately professional tone looks like for THIS scenario>",
    "keyPointsExpected": "<1 short sentence listing the 2-3 specific things a strong reply to THIS scenario must address>"
  }
}`
  },

  "sql": {
    skill: "sql",
    label: "SQL",
    description:
      "SQL querying skill: candidate is given a realistic business scenario with 2-3 related tables of sample data, and must write 4 SQL queries of increasing difficulty.",

    generatorPrompt: `
You are generating ONE practice SQL assessment for a skills-testing platform.

Your output MUST be valid JSON only — no markdown formatting, no code fences, no explanation text outside the JSON. (If you need to show your arithmetic checking, see the "self_check" field described below — that is the ONLY place reasoning text is allowed.)

STEP 1 — Pick a realistic business scenario.
Choose ONE business context, different each time you are called. Examples of
variety to draw from (do not always pick the same one — rotate across calls):
e-commerce store, bank/fintech, hospital/clinic, airline, public library,
ride-sharing app, SaaS subscription company, hotel booking, food delivery,
gym/fitness studio, university course enrollment, logistics/shipping company,
streaming service, retail inventory, insurance claims.

Invent a specific, named business (not generic placeholders like "Company A")
and a one-sentence "context" describing the candidate's role investigating
something realistic for that business (e.g. "You're a data analyst at
[invented name], a ride-sharing startup, looking into driver performance.").

STEP 2 — Design 2 or 3 related tables.
- Tables must have a real relationship (e.g. a shared id column used for
  joining) — never design tables that don't actually connect to each other.
- Each table needs 4-6 rows of REALISTIC, varied sample data. Avoid
  repetitive or obviously-patterned values (e.g. don't make every fare
  $10.00, don't make every rating a 5). Use plausible names, dates, and
  numbers that vary across rows, similar to what you'd see in a real dataset.
- Every column needs a clear "type" (text, integer, decimal, date, boolean).
- Pick different table/column names and different row data EVERY time you
  are called, even for the same business type, so two generations are never
  the same test.

STEP 3 — Write exactly 4 questions, in this fixed order of difficulty:
  1. id "q1", type "select_filter" — a basic SELECT with a WHERE filter on
     one table.
  2. id "q2", type "join" — requires joining two of the tables together.
  3. id "q3", type "group_by_aggregate" — requires GROUP BY plus an
     aggregate function (SUM, COUNT, or AVG).
  4. id "q4", type "advanced" — requires one of: a HAVING clause, a
     subquery, or a window function. Pick whichever fits the scenario best.

Each question needs:
  - "prompt": a plain-English instruction (not SQL) describing what to find.
  - "expected_columns": the column names the correct result should contain.

STEP 4 — Write the answer key.
For EACH question (keyed by its id: "q1", "q2", "q3", "q4"), provide:
  - "correct_logic": one sentence describing the required logic in plain
    English (e.g. "Group trips by driver_id, SUM(fare), ORDER BY DESC").
  - "reference_query": one correct, complete SQL query that answers the
    prompt.
  - "expected_result": the ACTUAL rows your reference_query would return
    when run against the tables you generated in STEP 2. This must be
    computed by literally tracing your reference_query row-by-row against
    your own generated table data. An empty array is a valid and acceptable
    expected_result if no rows qualify — do not force a non-empty result.
  - "grading_notes": brief notes for a grader, covering: (a) any
    syntactically different but equally valid ways to write this query
    (e.g. "INNER JOIN or plain JOIN both fine"), (b) whether row ORDER
    matters for this specific question (only mark order as required if the
    prompt explicitly asks for sorting/ranking), and (c) anything that
    would make an empty/zero result valid rather than a sign of a wrong
    answer.

STEP 5 — Self-check (required before producing final output).
Before finalizing, re-trace each reference_query against your generated
table rows by hand, one row at a time, and confirm expected_result is
exactly correct — recompute any SUM/COUNT/AVG directly from the rows you
wrote, do not estimate. If you find a mismatch, fix expected_result (or fix
the table data) so they agree, then re-verify.

Include this self-check as a "self_check" field at the top level of your
JSON, containing a short plain-text trace of your row-by-row verification
for q3 and q4 specifically (the two questions involving aggregation, where
arithmetic mistakes are most likely). This field is for internal review and
will not be shown to candidates.

FINAL OUTPUT — return ONLY this JSON structure, nothing else:
{
  "scenario": { "title": "...", "context": "..." },
  "tables": [
    { "name": "...", "columns": [ { "name": "...", "type": "..." } ], "rows": [ {...}, ... ] }
  ],
  "questions": [
    { "id": "q1", "type": "select_filter", "prompt": "...", "expected_columns": ["..."] },
    { "id": "q2", "type": "join", "prompt": "...", "expected_columns": ["..."] },
    { "id": "q3", "type": "group_by_aggregate", "prompt": "...", "expected_columns": ["..."] },
    { "id": "q4", "type": "advanced", "prompt": "...", "expected_columns": ["..."] }
  ],
  "answer_key": {
    "q1": { "correct_logic": "...", "reference_query": "...", "expected_result": [...], "grading_notes": "..." },
    "q2": { "correct_logic": "...", "reference_query": "...", "expected_result": [...], "grading_notes": "..." },
    "q3": { "correct_logic": "...", "reference_query": "...", "expected_result": [...], "grading_notes": "..." },
    "q4": { "correct_logic": "...", "reference_query": "...", "expected_result": [...], "grading_notes": "..." }
  },
  "self_check": "..."
}
`.trim(),

    // Tells generate-pool.js which top-level fields are private. Everything
    // else at the top level (scenario, tables, questions) is public.
    // "self_check" is also private — it's reasoning for our own review,
    // never something a candidate should see.
    privateFields: ["answer_key", "self_check"],
  }
};

export function getTemplate(skill) {
  const t = templates[skill];
  if (!t) throw new Error(`No template found for skill: ${skill}`);
  return t;
}

// Generic public/private split, for any skill whose template declares
// "privateFields" (currently: "sql"; any future skill can opt in too).
// Given the raw JSON object Gemini generated, returns
// { questions, answerKey } where "answerKey" contains only the fields
// listed in privateFields, and "questions" contains everything else.
//
// Skills that do NOT declare privateFields (excel, written-english) are not
// affected by this function — generate-pool.js keeps using its original
// hardcoded logic for those two, unchanged.
export function splitGeneratedOutput(template, generated) {
  const privateFields = template.privateFields || [];
  const questions = {};
  const answerKey = {};

  for (const key of Object.keys(generated)) {
    if (privateFields.includes(key)) {
      answerKey[key] = generated[key];
    } else {
      questions[key] = generated[key];
    }
  }

  // For skills with multiple privateFields (e.g. sql's ["answer_key",
  // "self_check"]), answerKey ends up as { answer_key: {...}, self_check:
  // "..." } — both stored together in the database's single answer_key
  // column. grade-sql.js should read answerKey.answer_key for grading, and
  // may optionally log answerKey.self_check for its own sanity-checking.

  return { questions, answerKey };
}
