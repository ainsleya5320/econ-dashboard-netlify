import { useEffect } from "react";
import { PHONE_QUERY } from "./dense.jsx";

// ============================================================================
// RESPONSIVE TABLES — make every table on the site readable on a phone without
// rewriting ninety of them.
//
// DataTable gives the best result and the panels that use it should keep it,
// but converting the rest by hand means ninety bespoke column definitions, each
// one a chance to break a working panel. There is a shortcut that costs
// nothing: every table already names its own columns, in its thead. Copy each
// header onto the cells beneath it as data-label, and CSS can turn a row into a
// labelled block on a narrow screen — the same shape DataTable produces, minus
// the hand-tuning.
//
// Only runs under the phone breakpoint. On a wide screen this does nothing at
// all and the tables render exactly as they always have.
// ============================================================================

function stamp(root) {
  for (const table of root.querySelectorAll("table")) {
    const heads = [...table.querySelectorAll("thead th")].map(th => (th.textContent || "").trim());
    if (!heads.length) { table.dataset.reflow = "plain"; continue; }
    table.dataset.reflow = "labelled";
    for (const row of table.querySelectorAll("tbody tr")) {
      const cells = [...row.children];
      // A single wide cell is a section heading (" Assets", "Liabilities"), not
      // data — leave it as a heading rather than labelling it with a column name.
      if (cells.length === 1 || cells.some(c => c.colSpan > 1)) { row.dataset.section = "1"; continue; }
      delete row.dataset.section;
      cells.forEach((cell, i) => {
        const lbl = heads[i];
        // The first column is the row's identity and reads as the card's
        // heading, so it needs no label above it. Blank headers (spacer or
        // bar columns) get none either.
        if (!lbl || i === 0) { cell.removeAttribute("data-label"); return; }
        if (cell.getAttribute("data-label") !== lbl) cell.setAttribute("data-label", lbl);
      });
    }
  }
}

export function useResponsiveTables() {
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    let raf = 0, observer = null;

    const run = () => { raf = 0; try { stamp(document.body); } catch { /* never break a render over this */ } };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(run); };

    const start = () => {
      if (observer) return;
      run();
      // Panels arrive asynchronously as their feeds resolve, and tabs swap the
      // whole subtree, so a one-shot pass is not enough. Coalesced into a frame
      // so a burst of mutations costs one pass.
      observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true });
    };
    const stop = () => {
      if (!observer) return;
      observer.disconnect();
      observer = null;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    };

    const sync = () => (mq.matches ? start() : stop());
    sync();
    mq.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      stop();
      mq.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
    };
  }, []);
}
