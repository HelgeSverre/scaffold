// CLI output helpers using brand palette (docs/BRAND.md)
const esc = (code: string) => (s: string) => `\x1b[${code}m${s}\x1b[0m`;

const teal = esc("38;2;20;184;166");     // Primary #14B8A6
const emerald = esc("38;2;16;185;129");  // Success #10B981
const slate = esc("38;2;148;163;184");   // Muted   #94A3B8
const red = esc("38;2;239;68;68");       // Error   #EF4444
const amber = esc("38;2;245;158;11");    // Warning #F59E0B
const bold = esc("1");

export const log = {
  brand: () => console.log(`\n  ${bold("scaffold")}${teal(".")}\n`),
  step:  (msg: string, detail?: string) =>
    console.log(`  ${emerald("✓")} ${msg}${detail ? ` ${slate(detail)}` : ""}`),
  info:  (label: string, value: string) =>
    console.log(`  ${slate(label)}  ${value}`),
  link:  (url: string) =>
    console.log(`  ${teal("→")} ${url}`),
  done:  (msg: string) =>
    console.log(`\n  ${msg}\n`),
  shortcut: (key: string, desc: string) =>
    console.log(`  ${teal(key.padEnd(6))} ${slate(desc)}`),
  warn:  (msg: string) =>
    console.warn(`  ${amber("⚠")} ${msg}`),
  error: (msg: string) =>
    console.error(`  ${red("✗")} ${msg}`),
  ai: (msg: string, detail?: string) =>
    console.log(`  ${teal("⟡")} ${msg}${detail ? ` ${slate(detail)}` : ""}`),
  item:  (msg: string) =>
    console.log(`     - ${slate(msg)}`),
  blank: () => console.log(),
};
