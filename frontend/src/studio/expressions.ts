// Formulas over a design's named parameters, such as `wall * 2 + 10`: what a feature's number can be in place of a
// plain one, so that changing a parameter changes every size worked out from it.
//
// A formula is text a person or an AI typed, so it's read by a small parser of its own and never run as code; the
// browser and the server work it out the same way. Angles are in degrees, as everywhere in Studio.

/** The longest formula read: far more than a size needs, and short enough to quote whole in a message. */
export const FORMULA_LENGTH = 500;
/** The longest a parameter's name can be. */
export const PARAMETER_NAME_LENGTH = 40;

const DEGREES = Math.PI / 180;
// Exact at whole quarter turns, so cos(90) is 0, and dividing by it is the division by zero it looks like.
const quarter = (x: number) => (((x / 90) % 4) + 4) % 4;
const sin = (x: number) => (x % 90 === 0 ? [0, 1, 0, -1][quarter(x)] : Math.sin(x * DEGREES));
const cos = (x: number) => (x % 90 === 0 ? [1, 0, -1, 0][quarter(x)] : Math.cos(x * DEGREES));
const tan = (x: number) => (x % 90 === 0 ? sin(x) / cos(x) : Math.tan(x * DEGREES));

// Maps, not objects, so a name like "constructor" is no function.
const ONE = new Map<string, (x: number) => number>([
  ["abs", Math.abs],
  ["sqrt", Math.sqrt],
  // Halves away from zero, as a person rounds: Math.round takes -2.5 up to -2.
  ["round", (x) => Math.sign(x) * Math.round(Math.abs(x))],
  ["floor", Math.floor],
  ["ceil", Math.ceil],
  ["sin", sin],
  ["cos", cos],
  ["tan", tan],
  ["asin", (x) => Math.asin(x) / DEGREES],
  ["acos", (x) => Math.acos(x) / DEGREES],
  ["atan", (x) => Math.atan(x) / DEGREES],
]);
const MANY = new Map<string, (...values: number[]) => number>([
  ["min", Math.min],
  ["max", Math.max],
]);
const FUNCTIONS = [...MANY.keys(), ...ONE.keys()];
const RESERVED = new Set(["pi", ...FUNCTIONS]);

const NUMBER = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SYMBOLS = "+-*/%^(),";
// The look-alikes a formula is sometimes written with, and what's meant by them.
const LOOK_ALIKES: Record<string, string> = { "×": "*", "·": "*", "÷": "/", "−": "-", "–": "-" };
const COMMA = 'A "," goes only between a function\'s numbers, as in min(a, b)';

type Token = { kind: "number" | "name" | "symbol" | "end"; text: string; at: number; end: number };
/** A piece of a formula, with where it is in the text (start inclusive, end exclusive) for messages. */
type Node = { start: number; end: number } & (
  | { kind: "number"; value: number }
  | { kind: "name"; name: string }
  | { kind: "negate"; operand: Node }
  | { kind: "operator"; operator: string; at: number; left: Node; right: Node }
  | { kind: "call"; name: string; args: Node[] }
);

function where(text: string, at: number): string {
  return at >= text.length ? `at the end of "${text}"` : `at character ${at + 1} of "${text}"`;
}

function fail(text: string, at: number, message: string): never {
  throw new Error(`${message} (${where(text, at)}).`);
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const take = (pattern: RegExp, at: number) => {
    pattern.lastIndex = at;
    return pattern.exec(text)?.[0];
  };
  for (let at = 0; at < text.length;) {
    const char = String.fromCodePoint(text.codePointAt(at)!);
    if (/\s/.test(char)) {
      at++;
      continue;
    }
    const number = take(NUMBER, at);
    const name = number ? undefined : take(NAME, at);
    if (name && name.length > PARAMETER_NAME_LENGTH)
      fail(text, at, `"${name}" is longer than a parameter's name can be (${PARAMETER_NAME_LENGTH} characters)`);
    const word = number ?? name;
    if (word) tokens.push({ kind: number ? "number" : "name", text: word, at, end: at + word.length });
    else if (SYMBOLS.includes(char)) tokens.push({ kind: "symbol", text: char, at, end: at + 1 });
    else
      fail(text, at, `"${char}" can't be used in a formula${LOOK_ALIKES[char] ? `: write ${LOOK_ALIKES[char]}` : ""}`);
    at += word?.length ?? char.length;
  }
  tokens.push({ kind: "end", text: "", at: text.length, end: text.length });
  return tokens;
}

/** The formula read into its pieces, by recursive descent, loosest-binding first. */
function parse(text: string): Node {
  if (text.length > FORMULA_LENGTH)
    throw new Error(`A formula can be ${FORMULA_LENGTH} characters long at most; this one is ${text.length}.`);
  if (!text.trim()) throw new Error("The formula is empty: give it a number, a parameter's name, or a sum of them.");
  const tokens = tokenize(text);
  let i = 0;
  const is = (symbol: string) => tokens[i].kind === "symbol" && tokens[i].text === symbol;
  const join = (left: Node, operator: Token, right: Node): Node => ({
    kind: "operator",
    operator: operator.text,
    at: operator.at,
    left,
    right,
    start: left.start,
    end: right.end,
  });
  const expect = (symbol: string, otherwise: string): Token => {
    if (is(symbol)) return tokens[i++];
    const token = tokens[i];
    if (token.kind === "end") return fail(text, token.at, `A "${symbol}" was expected`);
    return fail(text, token.at, token.text === "," ? COMMA : otherwise);
  };

  const sum = (): Node => {
    let node = product();
    while (is("+") || is("-")) {
      const operator = tokens[i++];
      node = join(node, operator, product());
    }
    return node;
  };
  const product = (): Node => {
    let node = signed();
    while (is("*") || is("/") || is("%")) {
      const operator = tokens[i++];
      node = join(node, operator, signed());
    }
    return node;
  };
  // A sign in front takes in the power after it, so -2^2 is -(2^2).
  const signed = (): Node => {
    const sign = tokens[i];
    if (is("+")) {
      i++;
      return signed();
    }
    if (!is("-")) return power();
    i++;
    const operand = signed();
    return { kind: "negate", operand, start: sign.at, end: operand.end };
  };
  // Right to left, and the exponent may have a sign of its own: 2^-1.
  const power = (): Node => {
    const base = atom();
    if (!is("^")) return base;
    const operator = tokens[i++];
    return join(base, operator, signed());
  };
  const atom = (): Node => {
    const token = tokens[i];
    if (token.kind === "number") {
      i++;
      return { kind: "number", value: Number(token.text), start: token.at, end: token.end };
    }
    if (token.kind === "name") {
      i++;
      if (is("(")) return call(token);
      if (ONE.has(token.text) || MANY.has(token.text))
        fail(text, token.at, `${token.text} is a function: give it its number in brackets, as ${token.text}(…)`);
      return { kind: "name", name: token.text, start: token.at, end: token.end };
    }
    if (is("(")) {
      i++;
      const inner = sum();
      const close = expect(")", 'An operator or ")" was expected');
      return { ...inner, start: token.at, end: close.end };
    }
    if (is("*") && i > 0 && tokens[i - 1].text === "*") fail(text, token.at, "Powers are written with ^, as 2^3");
    return fail(
      text,
      token.at,
      token.kind === "end"
        ? 'A number, a name or "(" was expected'
        : `A number, a name or "(" was expected, not "${token.text}"`,
    );
  };
  const call = (name: Token): Node => {
    if (name.text === "pi") fail(text, name.at, "pi is a number, not a function: write it without brackets");
    if (!ONE.has(name.text) && !MANY.has(name.text))
      fail(text, name.at, `There's no function called "${name.text}"; there are ${FUNCTIONS.join(", ")}`);
    i++;
    const args: Node[] = [];
    if (!is(")"))
      for (;;) {
        args.push(sum());
        if (!is(",")) break;
        i++;
      }
    const close = expect(")", 'An operator, "," or ")" was expected');
    if (MANY.has(name.text) ? !args.length : args.length !== 1)
      fail(
        text,
        name.at,
        MANY.has(name.text)
          ? `${name.text} takes one number or more, between commas`
          : `${name.text} takes one number, not ${args.length}`,
      );
    return { kind: "call", name: name.text, args, start: name.at, end: close.end };
  };

  const node = sum();
  const rest = tokens[i];
  if (rest.kind !== "end")
    fail(
      text,
      rest.at,
      rest.text === ")"
        ? 'This ")" has no "(" to close'
        : rest.text === ","
          ? COMMA
          : "An operator (+ - * / % ^) was expected",
    );
  return node;
}

/** How many letters to add, take away or change to turn one word into the other. */
function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

/** The name a mistyped one most likely meant: the same but for case, or a letter or two off a longer name. */
function closest(name: string, names: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of names) {
    const distance = editDistance(name.toLowerCase(), candidate.toLowerCase());
    if (distance <= 2 && distance < name.length / 2 && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The value of a formula, with these parameters' values; throws, saying where, when it can't be worked out. A formula
 * has numbers, parameters' names, + - * / and % (the remainder, with the first number's sign), ^ for a power (taken
 * right to left, and before a sign in front of it: -2^2 is -4), brackets, pi, and the functions min(a, b, …), max(…),
 * abs, sqrt, round (halves away from zero), floor, ceil, sin, cos and tan of an angle in degrees, and asin, acos and
 * atan giving one. Throws on a name that's no parameter, a division by zero, a result that isn't a finite number, a
 * formula that can't be read, and one over 500 characters.
 */
export function evaluateExpression(text: string, parameters: Readonly<Record<string, number>>): number {
  const parameter = (name: string, at: number): number => {
    if (name === "pi") return Math.PI;
    if (Object.hasOwn(parameters, name)) {
      const value = parameters[name];
      if (typeof value === "number" && Number.isFinite(value)) return value;
      fail(text, at, `The parameter "${name}" has no finite value`);
    }
    const guess = closest(name, [...Object.keys(parameters), "pi"]);
    throw new Error(
      `There's no parameter called "${name}" (${where(text, at)}).${guess ? ` Did you mean "${guess}"?` : ""}`,
    );
  };
  const compute = (node: Node): number => {
    switch (node.kind) {
      case "number":
        return node.value;
      case "name":
        return parameter(node.name, node.start);
      case "negate":
        return -value(node.operand);
      case "call": {
        const args = node.args.map(value);
        const many = MANY.get(node.name);
        return many ? many(...args) : ONE.get(node.name)!(args[0]);
      }
      case "operator": {
        const left = value(node.left);
        const right = value(node.right);
        if ((node.operator === "/" || node.operator === "%") && right === 0)
          fail(
            text,
            node.at,
            node.right.kind === "number"
              ? "Division by zero"
              : `Division by zero: "${text.slice(node.right.start, node.right.end)}" comes to 0`,
          );
        if (node.operator === "+") return left + right;
        if (node.operator === "-") return left - right;
        if (node.operator === "*") return left * right;
        if (node.operator === "/") return left / right;
        if (node.operator === "%") return left % right;
        return left ** right;
      }
    }
  };
  // Every step is checked, so the message points at the part that went wrong, not at the whole formula.
  const value = (node: Node): number => {
    const result = compute(node);
    if (!Number.isFinite(result))
      fail(text, node.start, `"${text.slice(node.start, node.end)}" doesn't come to a finite number`);
    return result;
  };
  return value(parse(text));
}

/** The parameter names a formula uses, each once, in the order they first appear; throws when it can't be read. */
export function expressionNames(text: string): string[] {
  const names = new Set<string>();
  const visit = (node: Node): void => {
    if (node.kind === "name" && node.name !== "pi") names.add(node.name);
    else if (node.kind === "negate") visit(node.operand);
    else if (node.kind === "operator") {
      visit(node.left);
      visit(node.right);
    } else if (node.kind === "call") node.args.forEach(visit);
  };
  visit(parse(text));
  return [...names];
}

/** Throws unless `name` can be a parameter's name: letters, digits and _, not starting with a digit, at most 40
 *  characters, and not pi or a function's name. */
export function checkParameterName(name: string): void {
  if (!name) throw new Error("A parameter needs a name.");
  if (name.length > PARAMETER_NAME_LENGTH)
    throw new Error(
      `A parameter's name can be ${PARAMETER_NAME_LENGTH} characters long at most; ` +
        `"${name.slice(0, PARAMETER_NAME_LENGTH)}…" is ${name.length}.`,
    );
  if (!IDENTIFIER.test(name))
    throw new Error(
      `"${name}" can't be a parameter's name: a name is letters, digits and _, ` +
        "and doesn't start with a digit, as wall_2.",
    );
  if (RESERVED.has(name)) {
    const meaning = name === "pi" ? "the number pi" : `the function ${name}()`;
    throw new Error(`"${name}" can't be a parameter's name: in a formula it's ${meaning}.`);
  }
}
