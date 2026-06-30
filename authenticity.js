// authenticity.js
//
// A small, dependency-free helper that any SkillProof test page can use to
// capture a basic "did this look like genuine typing, or was it pasted in"
// signal. This is NOT proof of cheating — someone could still read an
// answer off another screen and type it themselves, or have someone
// dictate it to them. It's a soft signal, stored alongside each result,
// meant to eventually show something like "no paste detected" next to a
// result as one (not the only) trust signal.
//
// HOW TO USE THIS ON A TEST PAGE:
//   1. Add this near the top of the page, after the other <script> tags:
//        <script src="/authenticity.js"></script>
//   2. Once the test has loaded and the answer field(s) exist in the page,
//      call:
//        attachAuthenticityTracking(["q1", "q2", "q3", "q4"]);
//      passing the id of every input/textarea the candidate types answers
//      into (for written-english.html, this would just be ["answer"]).
//   3. Right before submitting, call:
//        const summary = getAuthenticitySummary();
//      and include `summary` in whatever you send to the grading API.
//      `summary.pasteDetected` (true/false) tells you whether to show the
//      "we noticed pasted content" warning before letting them submit.
//
// DETECTION METHODS (two, kept separate on purpose):
//   - "paste" event: fires for a real Ctrl+V, right-click Paste, or
//     long-press Paste. This is solid evidence — recorded as pasteDetected.
//   - Sudden large jump in field length on an "input" event, with no
//     matching paste event: this catches insertions that don't fire a
//     real paste event at all — e.g. Android's Gboard clipboard-suggestion
//     chip, some autofill flows, voice-to-text drops. This is weaker,
//     inferred evidence (we're guessing from a length jump, not seeing an
//     actual clipboard action) — recorded separately as
//     suspectedInsertDetected, so the two are never confused with each other.

(function () {
  // Tracks state per field id.
  const fieldState = {};

  // Any single human keystroke is realistically 1 character (sometimes 2
  // for things like autocomplete-expanding a key combo). A jump bigger than
  // this in one "input" event, with no real paste event behind it, is a
  // strong sign text was inserted some other way (clipboard chip, autofill,
  // voice typing, etc).
  const SUSPECT_JUMP_THRESHOLD = 8;

  function ensureField(id) {
    if (!fieldState[id]) {
      fieldState[id] = {
        pasteCount: 0,
        pastedChars: 0,
        suspectedInsertCount: 0,
        suspectedInsertChars: 0,
        lastValueLength: 0,
        justSawRealPaste: false,
        firstKeystrokeAt: null,
        lastKeystrokeAt: null,
        keystrokes: 0
      };
    }
    return fieldState[id];
  }

  function handlePaste(id, event) {
    const state = ensureField(id);
    state.pasteCount += 1;
    // clipboardData isn't available in every browser/context — fall back to
    // "we know a paste happened, just not how much text" rather than erroring.
    let pastedText = "";
    try {
      pastedText = (event.clipboardData || window.clipboardData).getData("text") || "";
    } catch (err) {
      pastedText = "";
    }
    state.pastedChars += pastedText.length;
    // Mark this so the very next "input" event on this field (which will
    // fire right after this paste) isn't also counted as a separate
    // "suspected" insert — it's the same paste, already recorded properly.
    state.justSawRealPaste = true;
  }

  function handleInput(id, event) {
    const state = ensureField(id);
    const el = event.target;
    const newLength = (el.value || "").length;
    const delta = newLength - state.lastValueLength;

    if (state.justSawRealPaste) {
      // This input event belongs to the paste we already recorded above —
      // skip it so we don't double-count the same insertion.
      state.justSawRealPaste = false;
    } else if (delta >= SUSPECT_JUMP_THRESHOLD) {
      // A big jump with no real paste event behind it — likely a
      // clipboard-suggestion-chip insert, autofill, or similar.
      state.suspectedInsertCount += 1;
      state.suspectedInsertChars += delta;
    }

    state.lastValueLength = newLength;
  }

  function handleKeydown(id) {
    const state = ensureField(id);
    const now = Date.now();
    if (state.firstKeystrokeAt === null) {
      state.firstKeystrokeAt = now;
    }
    state.lastKeystrokeAt = now;
    state.keystrokes += 1;
  }

  // Call this once, after the field(s) you want to watch already exist in the page.
  window.attachAuthenticityTracking = function (fieldIds) {
    (fieldIds || []).forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return; // field not on this page yet / wrong id — skip quietly, never break the page over this
      const state = ensureField(id);
      state.lastValueLength = (el.value || "").length;
      el.addEventListener("paste", function (event) { handlePaste(id, event); });
      el.addEventListener("input", function (event) { handleInput(id, event); });
      el.addEventListener("keydown", function () { handleKeydown(id); });
    });
  };

  // Call this right before submitting, to get a plain-object summary safe
  // to send straight to a grading API as JSON.
  window.getAuthenticitySummary = function () {
    const fieldsWithPaste = [];
    const fieldsWithSuspectedInsert = [];
    let pasteCount = 0;
    let totalPastedChars = 0;
    let suspectedInsertCount = 0;
    let totalSuspectedInsertChars = 0;
    let earliestStart = null;
    let latestEnd = null;
    let totalKeystrokes = 0;

    Object.keys(fieldState).forEach(function (id) {
      const s = fieldState[id];
      if (s.pasteCount > 0) fieldsWithPaste.push(id);
      if (s.suspectedInsertCount > 0) fieldsWithSuspectedInsert.push(id);
      pasteCount += s.pasteCount;
      totalPastedChars += s.pastedChars;
      suspectedInsertCount += s.suspectedInsertCount;
      totalSuspectedInsertChars += s.suspectedInsertChars;
      totalKeystrokes += s.keystrokes;
      if (s.firstKeystrokeAt !== null) {
        if (earliestStart === null || s.firstKeystrokeAt < earliestStart) earliestStart = s.firstKeystrokeAt;
      }
      if (s.lastKeystrokeAt !== null) {
        if (latestEnd === null || s.lastKeystrokeAt > latestEnd) latestEnd = s.lastKeystrokeAt;
      }
    });

    return {
      // Confirmed via a real browser paste event — strong evidence.
      pasteDetected: pasteCount > 0,
      pasteCount: pasteCount,
      totalPastedChars: totalPastedChars,
      fieldsWithPaste: fieldsWithPaste,
      // Inferred from a sudden large jump in field length with no matching
      // paste event — weaker, but catches Gboard's clipboard-suggestion
      // chip and similar insertion paths a real "paste" event would miss.
      suspectedInsertDetected: suspectedInsertCount > 0,
      suspectedInsertCount: suspectedInsertCount,
      totalSuspectedInsertChars: totalSuspectedInsertChars,
      fieldsWithSuspectedInsert: fieldsWithSuspectedInsert,
      totalKeystrokes: totalKeystrokes,
      typingDurationMs: (earliestStart !== null && latestEnd !== null) ? (latestEnd - earliestStart) : null
    };
  };
})();
