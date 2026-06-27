// get-test.js
// Public endpoint. Called by the test pages (excel.html, written-english.html)
// when a candidate clicks "Start Test". Returns ONE assessment's questions
// (never the answer key) plus its Test ID.

import { generateOneAssessment, generateBatch } from "./generate-pool.js";

const REFILL_THRESHOLD = 10; // if unused count drops below this, top up
const REFILL_TARGET = 30;    // how many unused tests we want sitting ready

async function claimFromPool(skill) {
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/claim_assessment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify({ target_skill: skill })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error("claim_assessment RPC failed: " + res.status + " " + errText);
  }

  const data = await res.json();
  // The SQL function returns one row, or a row of all-nulls if nothing was found.
  if (!data || !data.id) return null;
  return data;
}

async function countUnused(skill) {
  const res = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/assessment_pool?skill=eq.${skill}&status=eq.unused&select=id`,
    {
      headers: {
        "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Prefer": "count=exact"
      }
    }
  );
  if (!res.ok) {
    console.error("countUnused failed:", res.status);
    // Fail toward refilling, not toward silence: if we can't confirm the pool
    // is healthy, treat it as empty so the existing refill logic (below) runs
    // a full batch. Worst case we generate some tests we didn't strictly need;
    // the alternative (returning a "looks fine" number) risks the pool quietly
    // draining to zero with nothing left to trigger a refill.
    return 0;
  }
  const contentRange = res.headers.get("content-range"); // e.g. "0-4/5"
  const total = contentRange ? parseInt(contentRange.split("/")[1], 10) : 0;
  return total;
}

// Strips the answer key out, in case it's ever present, before sending to the browser.
function publicShape(row) {
  return {
    testId: row.id,
    skill: row.skill,
    questions: row.questions
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Only GET requests allowed" });
  }

  const { skill } = req.query;
  if (!skill || (skill !== "excel" && skill !== "written-english")) {
    return res.status(400).json({ error: "A valid skill is required" });
  }

  try {
    let claimed = await claimFromPool(skill);

    if (!claimed) {
      // Pool was empty — generate one right now so the candidate isn't stuck.
      // This is the only case where generation happens "live" with a wait.
      claimed = await generateOneAssessment(skill);
      // Mark it used immediately so a refill batch (which runs next) can't hand it out too.
      await fetch(`${process.env.SUPABASE_URL}/rest/v1/assessment_pool?id=eq.${claimed.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({ status: "used" })
      });
    }

    // Send the response to the candidate right away — they should not wait
    // for any of the refill logic below.
    res.status(200).json(publicShape(claimed));

    // ---- Everything from here runs AFTER the candidate already has their test ----
    const remaining = await countUnused(skill);
    if (remaining < REFILL_THRESHOLD) {
      const needed = REFILL_TARGET - remaining;
      // Intentionally not awaited from the request's perspective — response
      // already went out above. Vercel keeps the function alive briefly to
      // let this finish; errors here are logged, not shown to any candidate.
      await generateBatch(skill, needed);
    }
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      return res.status(500).json({ error: "Could not load a test right now. Please try again." });
    }
  }
    }
