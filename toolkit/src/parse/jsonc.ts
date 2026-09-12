import { FrontmatterValue } from "../domain/copilot-artifact";

const QUOTE = '"';
const BACKSLASH = "\\";
const SLASH = "/";
const ASTERISK = "*";
const NEWLINE = "\n";
const COMMA = ",";
const BLOCK_COMMENT_END = "*/";
const CLOSING_BRACES = new Set(["}",
  "]"]);
const WHITESPACE = /\s/;

interface ConsumedText {
  readonly text: string;
  readonly nextIndex: number;
}

function consumeString(raw: string, startIndex: number): ConsumedText {
  let index = startIndex + 1;
  let isEscaped = false;

  while (index < raw.length) {
    const char = raw[index] ?? "";
    if (isEscaped) {
      isEscaped = false;
    } else if (char === BACKSLASH) {
      isEscaped = true;
    } else if (char === QUOTE) {
      index += 1;
      break;
    }
    index += 1;
  }

  return { text: raw.slice(startIndex, index), nextIndex: index };
}

function skipLineComment(raw: string, startIndex: number): number {
  let index = startIndex;
  while (index < raw.length && raw[index] !== NEWLINE) {
    index += 1;
  }
  return index;
}

function skipBlockComment(raw: string, startIndex: number): number {
  const endIndex = raw.indexOf(BLOCK_COMMENT_END, startIndex + 2);
  return endIndex === -1 ? raw.length : endIndex + BLOCK_COMMENT_END.length;
}

function isTrailingComma(raw: string, commaIndex: number): boolean {
  let index = commaIndex + 1;
  while (index < raw.length && WHITESPACE.test(raw[index] ?? "")) {
    index += 1;
  }
  return CLOSING_BRACES.has(raw[index] ?? "");
}

export function stripJsonComments(raw: string): string {
  const output: string[] = [];
  let index = 0;

  while (index < raw.length) {
    const char = raw[index] ?? "";
    const next = raw[index + 1] ?? "";

    if (char === QUOTE) {
      const consumed = consumeString(raw, index);
      output.push(consumed.text);
      index = consumed.nextIndex;
      continue;
    }
    if (char === SLASH && next === SLASH) {
      index = skipLineComment(raw, index);
      continue;
    }
    if (char === SLASH && next === ASTERISK) {
      index = skipBlockComment(raw, index);
      continue;
    }
    if (char === COMMA && isTrailingComma(raw, index)) {
      index += 1;
      continue;
    }

    output.push(char);
    index += 1;
  }

  return output.join("");
}

export function parseJsonc(raw: string): FrontmatterValue {
  return JSON.parse(stripJsonComments(raw)) as FrontmatterValue;
}
