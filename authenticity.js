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

(function () {
  // Tracks state per field id, e.g. { q1: { pasteCount, pastedChars, firstKeystrokeAt, lastKeystrokeAt, keystrokes }, ... }
  const fieldState = {};

  function ensureField(id) {
    if (!fieldState[id]) {
      fieldState[id] = {
        pasteCount: 0,
        pastedChars: 0,
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
      ensureField(id);
      el.addEventListener("paste", function (event) { handlePaste(id, event); });
      el.addEventListener("keydown", function () { handleKeydown(id); });
    });
  };

  // Call this right before submitting, to get a plain-object summary safe
  // to send straight to a grading API as JSON.
  window.getAuthenticitySummary = function () {
    const fieldsWithPaste = [];
    let pasteCount = 0;
    let totalPastedChars = 0;
    let earliestStart = null;
    let latestEnd = null;
    let totalKeystrokes = 0;

    Object.keys(fieldState).forEach(function (id) {
      const s = fieldState[id];
      if (s.pasteCount > 0) fieldsWithPaste.push(id);
      pasteCount += s.pasteCount;
      totalPastedChars += s.pastedChars;
      totalKeystrokes += s.keystrokes;
      if (s.firstKeystrokeAt !== null) {
        if (earliestStart === null || s.firstKeystrokeAt < earliestStart) earliestStart = s.firstKeystrokeAt;
      }
      if (s.lastKeystrokeAt !== null) {
        if (latestEnd === null || s.lastKeystrokeAt > latestEnd) latestEnd = s.lastKeystrokeAt;
      }
    });

    return {
      pasteDetected: pasteCount > 0,
      pasteCount: pasteCount,
      totalPastedChars: totalPastedChars,
      fieldsWithPaste: fieldsWithPaste,
      totalKeystrokes: totalKeystrokes,
      typingDurationMs: (earliestStart !== null && latestEnd !== null) ? (latestEnd - earliestStart) : null
    };
  };
})();
