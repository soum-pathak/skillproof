// authenticity.js
//
// A small, dependency-free helper that any SkillProof test page can use to
// capture a basic "did this look like genuine effort, or was something
// suspicious going on" signal. This is NOT proof of cheating — someone
// could still read an answer off another screen and type it themselves,
// switch tabs for an innocent reason (a notification, a phone call), or
// have someone dictate an answer to them. It's a soft signal, stored
// alongside each result, shown as a plain disclosure on the result page —
// never used to block submission or silently change a score.
//
// HOW TO USE THIS ON A TEST PAGE:
//   1. Add this near the top of the page, after the other <script> tags:
//        <script src="/authenticity.js"></script>
//   2. Once the test has loaded and the answer field(s) exist in the page,
//      call:
//        attachAuthenticityTracking(["q1", "q2", "q3", "q4"]);
//      passing the id of every input/textarea the candidate types answers
//      into (for written-english.html, this would just be ["answer"]).
//      This call also starts tab-visibility tracking for the whole page —
//      no separate setup needed for that part.
//   3. Right before submitting, call:
//        const summary = getAuthenticitySummary();
//      and include `summary` in whatever you send to the grading API.
//      Check summary.pasteDetected, summary.suspectedInsertDetected, and
//      summary.tabSwitchDetected to decide whether to show a warning
//      before letting them submit.
//
// DETECTION METHODS:
//   - "paste" event: fires for a real Ctrl+V, right-click Paste, or
//     long-press Paste. Solid evidence — recorded as pasteDetected.
//   - Sudden large jump in field length on an "input" event, with no
//     matching paste event: catches insertions that don't fire a real
//     paste event at all — e.g. Android's Gboard clipboard-suggestion
//     chip, some autofill flows, voice-to-text drops. Weaker, inferred
//     evidence — recorded separately as suspectedInsertDetected.
//   - "visibilitychange" event: fires when the browser tab is backgrounded
//     (switched away from) or the app is backgrounded on mobile — e.g.
//     checking another tab, app, or asking someone else for help. Also
//     inferred, not proof — recorded as tabSwitchDetected, with a count
//     and total time spent away.

(function () {
  // Tracks state per field id.
  const fieldState = {};

  // Any single human keystroke is realistically 1 character (sometimes 2
  // for things like autocomplete-expanding a key combo). A jump bigger than
  // this in one "input" event, with no real paste event behind it, is a
  // strong sign text was inserted some other way (clipboard chip, autofill,
  // voice typing, etc).
  const SUSPECT_JUMP_THRESHOLD = 8;

  // Page-level (not per-field) tab-visibility tracking.
  const visibilityState = {
    switchCount: 0,
    totalHiddenMs: 0,
    hiddenSince: null,
    attached: false
  };

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

  function handleVisibilityChange() {
    if (document.hidden) {
      // Tab/app just got backgrounded — start timing how long it's away.
      visibilityState.hiddenSince = Date.now();
      visibilityState.switchCount += 1;
    } else if (visibilityState.hiddenSince !== null) {
      // Came back — add however long it was away to the running total.
      visibilityState.totalHiddenMs += Date.now() - visibilityState.hiddenSince;
      visibilityState.hiddenSince = null;
    }
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

    // Tab-visibility tracking is page-level, so it's only attached once,
    // regardless of how many fields are passed in or how many times this
    // function gets called.
    if (!visibilityState.attached) {
      document.addEventListener("visibilitychange", handleVisibilityChange);
      visibilityState.attached = true;
    }
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

    // If the tab is hidden at the exact moment someone calls this (unlikely,
    // since you can't click Submit on a backgrounded tab, but guarded for
    // safety), count the time up to now rather than losing it.
    let totalHiddenMs = visibilityState.totalHiddenMs;
    if (visibilityState.hiddenSince !== null) {
      totalHiddenMs += Date.now() - visibilityState.hiddenSince;
    }

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
      // Inferred from the tab/app being backgrounded during the test —
      // also not proof (could be a notification, a phone call, an
      // accidental switch), but a real signal worth disclosing.
      tabSwitchDetected: visibilityState.switchCount > 0,
      tabSwitchCount: visibilityState.switchCount,
      totalTabHiddenMs: totalHiddenMs,
      totalKeystrokes: totalKeystrokes,
      typingDurationMs: (earliestStart !== null && latestEnd !== null) ? (latestEnd - earliestStart) : null
    };
  };
})();
