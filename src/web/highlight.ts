export type TokenKind = "keyword" | "string" | "number" | "comment" | "plain";

export type Token = { kind: TokenKind; text: string };

const KEYWORDS = new Set([
  "export",
  "default",
  "function",
  "const",
  "let",
  "var",
  "if",
  "else",
  "for",
  "return",
  "of",
  "in",
  "new",
  "true",
  "false",
  "null",
  "undefined",
  "break",
  "continue",
]);

const PATTERN =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;

export function highlight(code: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;

  for (const match of code.matchAll(PATTERN)) {
    const start = match.index ?? 0;

    if (start > last) tokens.push({ kind: "plain", text: code.slice(last, start) });
    const [text, comment, string, number, word] = match;

    if (comment) tokens.push({ kind: "comment", text });
    else if (string) tokens.push({ kind: "string", text });
    else if (number) tokens.push({ kind: "number", text });
    else tokens.push({ kind: word && KEYWORDS.has(word) ? "keyword" : "plain", text });
    last = start + text.length;
  }

  if (last < code.length) tokens.push({ kind: "plain", text: code.slice(last) });

  return tokens;
}
