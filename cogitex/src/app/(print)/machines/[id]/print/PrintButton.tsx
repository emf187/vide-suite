"use client";

/**
 * Progressive-enhancement print trigger for the dossier. The page prints
 * clean WITHOUT this (Ctrl+P / Cmd+P on any browser); the button is the
 * convenience path. The button hides itself when printing its own page.
 */
export default function PrintButton() {
  return (
    <button type="button" className="secondary print-only-button" onClick={() => window.print()}>
      PRINT / SAVE AS PDF
    </button>
  );
}
