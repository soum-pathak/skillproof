// generate-pool.js
// This file is NOT a public API endpoint — it has no `export default handler`.
// It exports one plain function, generateOneAssessment(), which other backend
// files (get-test.js) import and call directly. No browser ever reaches this
// file, and it never gets its own URL.

import { getTemplate } from "./templates.js";

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

    if (geminiRes.status !== 503 || attempt === maxAttempts) {
      throw new Error("Gemini request failed: " + geminiRes.status);
    }

    await new Promise(r => setTimeout(r, attempt * 2000));
  }
}

// Generates ONE new assessment for the given skill and saves it to the pool.
// Returns the saved row (including its new Test ID) on success.
export async function generateOneAssessment(skill) {
  const template = getTemplate(skill);

  const geminiData = await callGemini(template.generatorPrompt);
  let raw = geminiData.candidates[0].content.parts[0].text.trim();
  raw = raw.replace(/```json|```/g, "").trim();
  const generated = JSON.parse(raw);

  // Split what we generated into "what the candidate sees" vs "the answer key",
  // since these get stored in separate columns and only one is ever shown publicly.
  let questions, answerKey;
  if (skill === "excel") {
    questions = {
      datasetText: generated.datasetText,
      columnMap: generated.columnMap,
      questions: generated.questions
    };
    answerKey = generated.answerKey;
  } else if (skill === "written-english") {
    questions = {
      scenarioText: generated.scenarioText
    };
    answerKey = generated.rubric;
  } else {
    throw new Error(`generateOneAssessment: unknown skill "${skill}"`);
  }

  const saveRes = await fetch(`${process.env.SUPABASE_URL}/rest/v1/assessment_pool`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Prefer": "return=representation"
    },
    body: JSON.stringify({
      skill,
      questions,
      answer_key: answerKey,
      status: "unused"
    })
  });

  if (!saveRes.ok) {
    const errText = await saveRes.text();
    throw new Error("Supabase save failed: " + saveRes.status + " " + errText);
  }

  const saved = await saveRes.json();
  return saved[0];
}

// Generates several assessments in a row for the given skill.
// Used for background pool refills. Failures for individual attempts are
// logged but don't stop the rest of the batch from trying.
export async function generateBatch(skill, count) {
  const results = [];
  for (let i = 0; i < count; i++) {
    try {
      const row = await generateOneAssessment(skill);
      results.push(row);
    } catch (err) {
      console.error(`generateBatch: attempt ${i + 1} for "${skill}" failed:`, err);
    }
  }
  return results;
    }
      
