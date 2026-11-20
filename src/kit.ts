export { useState, useEffect, useMemo, useRef, useCallback, useReducer, Fragment } from "react";
const pal = { bg: { base: "#fff", subtle: "#f6f6f6", elevated: "#fff" }, text: { primary: "#111", secondary: "#444", tertiary: "#888", accent: "#16f" }, fill: { secondary: "#f2f2f2", hover: "#eee", accentSubtle: "#e6efff" }, border: { subtle: "#eee", default: "#ddd", strong: "#bbb" } };
const THEME = { kind: "light", ...pal, font: { family: "-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Segoe UI', Roboto, sans-serif", mono: "ui-monospace, Menlo, monospace" }, weight: { regular: 400, medium: 500, semibold: 600 }, radius: { sm: 4, md: 8, lg: 12, xl: 16, full: 9999 }, dataviz: { categorical: ["#16f", "#fb0", "#0cc"], other: "#999", negative: "#f44" } };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useTheme(): any { return THEME; }
