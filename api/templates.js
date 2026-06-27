// templates.js
// One entry per skill. Each entry tells Gemini exactly what SHAPE of test to
// generate (how many questions, what each question must test, the difficulty)
// while leaving the actual wording, names, numbers, and scenarios open.
//
// To add a new skill later: copy one of these blocks, change the prompt text
// to describe that skill's question shapes, and add it to the exports object
// at the bottom. No other file needs to change for a new skill to work.

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
  }
};

export function getTemplate(skill) {
  const t = templates[skill];
  if (!t) throw new Error(`No template found for skill: ${skill}`);
  return t;
}
