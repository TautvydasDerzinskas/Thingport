// GENERATED from frontend/src/studio/expressions.ts by scripts/sync-studio.mjs. Don't edit it here:
// change frontend/src/studio/ and run npm run studio:sync.
// Formulas over a design's named parameters, such as `wall * 2 + 10`: what a feature's number can be in place of a
// plain one, so that changing a parameter changes every size worked out from it.
//
// A formula is text a person or an AI typed, so it's read by a small parser of its own and never run as code; the
// browser and the server work it out the same way. Angles are in degrees, as everywhere in Studio.
//
// Formulas know their units, as CAD's do: a number can carry one (2 in, 5 mm, 45 deg), each parameter has its own, and
// a length field takes only a length. A bare number added to a length is a length in the design's units, and is kept
// with that unit written after it, so a formula means the same size whatever units the design is shown in later.

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
/** The length units a design is shown in, and a number in a formula can carry. */
export type LengthUnit = "mm" | "cm" | "in";
/** Millimetres in one of each. */
export const MM_PER: Record<LengthUnit, number> = { mm: 1, cm: 10, in: 25.4 };
/** A parameter's unit: a length, an angle in degrees, or none, for a plain number such as a count. */
export type ParameterUnit = LengthUnit | "deg" | "none";
export const PARAMETER_UNITS: ParameterUnit[] = ["mm", "cm", "in", "deg", "none"];
type NumberUnit = LengthUnit | "deg";
const UNITS = new Set<string>(["mm", "cm", "in", "deg"]);
const RESERVED = new Set(["pi", ...FUNCTIONS, ...UNITS]);

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
  | { kind: "number"; value: number; unit?: NumberUnit }
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
    // ° is deg, as in 45°.
    if (char === "°") {
      tokens.push({ kind: "name", text: "deg", at, end: at + 1 });
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
      const unit = tokens[i].kind === "name" && UNITS.has(tokens[i].text) ? tokens[i++] : null;
      return {
        kind: "number",
        value: Number(token.text),
        ...(unit ? { unit: unit.text as NumberUnit } : {}),
        start: token.at,
        end: unit?.end ?? token.end,
      };
    }
    if (token.kind === "name") {
      i++;
      if (is("(")) return call(token);
      if (ONE.has(token.text) || MANY.has(token.text))
        fail(text, token.at, `${token.text} is a function: give it its number in brackets, as ${token.text}(…)`);
      if (UNITS.has(token.text))
        fail(text, token.at, `${token.text} is a unit: put it right after a number, as 2 ${token.text}`);
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

/** A parameter as a formula sees it: its value in mm if it's a length, else in degrees or as it is. */
export type ParameterQuantity = { value: number; length: boolean };

/** What a field takes: a length, in mm, or a plain number (an angle in degrees, a count, a scale). */
export type FieldKind = "length" | "number";

/** A value with its dimension: `power` 1 for a length (in mm), 2 for an area, 0 for a plain number. `loose` is a
 *  bare number not yet given a unit, which takes on the dimension of what it's added to. */
type Quantity = { value: number; power: number; loose: boolean };

const dimension = (power: number) =>
  power === 0 ? "a plain number" : power === 1 ? "a length" : power === 2 ? "an area" : `a length^${power}`;

/**
 * Works a formula out, with these parameters. Bare numbers that turn out to be lengths are taken in `bare`, and each is
 * handed to `mark`. Throws, saying where, on a name that's no parameter, a division by zero, a result that isn't a
 * finite number, units that don't go together (a length plus a plain number), a formula that can't be read, and one
 * over 500 characters.
 */
function work(
  text: string,
  parameters: Readonly<Record<string, ParameterQuantity>>,
  want: FieldKind,
  bare: LengthUnit,
  mark: (node: Node) => void,
): number {
  const looseOf = new Map<Node, boolean>();
  const parameter = (name: string, at: number): Quantity => {
    if (name === "pi") return { value: Math.PI, power: 0, loose: false };
    if (Object.hasOwn(parameters, name)) {
      const found = parameters[name];
      if (found && Number.isFinite(found.value))
        return { value: found.value, power: found.length ? 1 : 0, loose: false };
      fail(text, at, `The parameter "${name}" has no finite value`);
    }
    const guess = closest(name, [...Object.keys(parameters), "pi"]);
    throw new Error(
      `There's no parameter called "${name}" (${where(text, at)}).${guess ? ` Did you mean "${guess}"?` : ""}`,
    );
  };
  const quote = (node: Node) => `"${text.slice(node.start, node.end)}"`;
  // A bare number, or a sum or product of them, given a dimension: its first number in each term carries the unit.
  const adopt = (node: Node, power: number): void => {
    if (!looseOf.get(node)) return;
    if (node.kind === "number") {
      if (power !== 1) fail(text, node.start, `${quote(node)} needs a unit here: write it after the number`);
      mark(node);
    } else if (node.kind === "negate") adopt(node.operand, power);
    else if (node.kind === "operator") {
      if (node.operator === "+" || node.operator === "-" || node.operator === "%") {
        adopt(node.left, power);
        adopt(node.right, power);
      } else if (node.operator === "*" || node.operator === "/") adopt(node.left, power);
      else fail(text, node.start, `${quote(node)} needs its units written in`);
    } else if (node.kind === "call") {
      if (node.name === "sqrt") fail(text, node.start, `${quote(node)} needs its units written in`);
      node.args.forEach((arg) => adopt(arg, power));
    }
  };
  // Two values added, taken from or compared: the same dimension, a bare number taking on the other's.
  const unify = (nodes: Node[], values: Quantity[], at: number, verb: string): Quantity[] => {
    const firm = values.find((each) => !each.loose);
    if (!firm) return values;
    return values.map((each, k) => {
      if (each.loose) {
        if (firm.power === 0) return { ...each, loose: false };
        adopt(nodes[k], firm.power);
        return { value: each.value * MM_PER[bare] ** firm.power, power: firm.power, loose: false };
      }
      if (each.power !== firm.power)
        fail(text, at, `Can't ${verb} ${dimension(firm.power)} and ${dimension(each.power)}`);
      return each;
    });
  };
  const plain = (node: Node, value: Quantity, what: string) => {
    if (value.power !== 0)
      fail(text, node.start, `${what} takes a plain number, and ${quote(node)} is ${dimension(value.power)}`);
  };
  const compute = (node: Node): Quantity => {
    switch (node.kind) {
      case "number":
        if (node.unit === "deg") return { value: node.value, power: 0, loose: false };
        if (node.unit) return { value: node.value * MM_PER[node.unit], power: 1, loose: false };
        return { value: node.value, power: 0, loose: true };
      case "name":
        return parameter(node.name, node.start);
      case "negate": {
        const inner = value(node.operand);
        return { ...inner, value: -inner.value };
      }
      case "call": {
        const args = node.args.map(value);
        const many = MANY.get(node.name);
        if (many) {
          const same = unify(node.args, args, node.start, "compare");
          return {
            value: many(...same.map((each) => each.value)),
            power: same[0].power,
            loose: same.every((each) => each.loose),
          };
        }
        const [arg] = args;
        if (["sin", "cos", "tan", "asin", "acos", "atan"].includes(node.name)) {
          plain(node.args[0], arg, node.name);
          return { value: ONE.get(node.name)!(arg.value), power: 0, loose: false };
        }
        if (node.name === "sqrt") {
          if (arg.power % 2) fail(text, node.start, `sqrt of ${dimension(arg.power)} has no unit`);
          return { value: Math.sqrt(arg.value), power: arg.power / 2, loose: arg.loose };
        }
        return { value: ONE.get(node.name)!(arg.value), power: arg.power, loose: arg.loose };
      }
      case "operator": {
        const left = value(node.left);
        const right = value(node.right);
        if ((node.operator === "/" || node.operator === "%") && right.value === 0)
          fail(
            text,
            node.at,
            node.right.kind === "number" ? "Division by zero" : `Division by zero: ${quote(node.right)} comes to 0`,
          );
        const loose = left.loose && right.loose;
        if (node.operator === "+" || node.operator === "-" || node.operator === "%") {
          const verb = node.operator === "+" ? "add" : node.operator === "-" ? "take" : "divide";
          const [a, b] = unify([node.left, node.right], [left, right], node.at, verb);
          const result =
            node.operator === "+" ? a.value + b.value : node.operator === "-" ? a.value - b.value : a.value % b.value;
          return { value: result, power: a.power, loose };
        }
        if (node.operator === "*") return { value: left.value * right.value, power: left.power + right.power, loose };
        if (node.operator === "/") return { value: left.value / right.value, power: left.power - right.power, loose };
        plain(node.right, right, "A power");
        if (left.power && !Number.isInteger(right.value))
          fail(
            text,
            node.at,
            `${quote(node.left)} is ${dimension(left.power)}: it can only be raised to a whole power`,
          );
        return { value: left.value ** right.value, power: left.power * right.value, loose };
      }
    }
  };
  // Every step is checked, so the message points at the part that went wrong, not at the whole formula.
  const value = (node: Node): Quantity => {
    const result = compute(node);
    looseOf.set(node, result.loose);
    if (!Number.isFinite(result.value)) fail(text, node.start, `${quote(node)} doesn't come to a finite number`);
    return result;
  };
  const root = parse(text);
  let result = value(root);
  if (result.loose && want === "length") {
    adopt(root, 1);
    result = { value: result.value * MM_PER[bare], power: 1, loose: false };
  }
  const needs = want === "length" ? 1 : 0;
  if (result.power !== needs)
    throw new Error(`It needs ${dimension(needs)}, and "${text}" comes to ${dimension(result.power)}.`);
  return result.value;
}

/**
 * The value of a formula for a field: in mm for a length, else in degrees or as it is. A formula has numbers, which
 * can carry a unit (mm, cm, in, deg or °), parameters' names, + - * / and % (the remainder, with the first number's
 * sign), ^ for a power (taken right to left, and before a sign in front of it: -2^2 is -4), brackets, pi, and the
 * functions min(a, b, …), max(…), abs, sqrt, round, floor and ceil (lengths to whole mm; halves away from zero), sin,
 * cos and tan of an angle in degrees, and asin, acos and atan giving one. A bare number that's a length is in mm, as a
 * kept formula's are (see withUnits). Throws, saying where, when it can't be worked out or its units don't fit.
 */
export function evaluateExpression(
  text: string,
  parameters: Readonly<Record<string, ParameterQuantity>>,
  want: FieldKind,
): number {
  return work(text, parameters, want, "mm", () => undefined);
}

/**
 * The formula as it's kept: each bare number that's a length given `unit`, the design's, written after it, as CAD
 * keeps a typed 10 as 10 in. So it means the same size whatever units the design is shown in later. Throws as
 * evaluateExpression does.
 */
export function withUnits(
  text: string,
  parameters: Readonly<Record<string, ParameterQuantity>>,
  want: FieldKind,
  unit: LengthUnit,
): string {
  const marked: Node[] = [];
  work(text, parameters, want, unit, (node) => marked.push(node));
  let out = text;
  for (const node of marked.toSorted((a, b) => b.end - a.end))
    out = `${out.slice(0, node.end)} ${unit}${out.slice(node.end)}`;
  return out;
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
 *  characters, and not pi, a function's name or a unit's. */
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
    const meaning = name === "pi" ? "the number pi" : UNITS.has(name) ? `the unit ${name}` : `the function ${name}()`;
    throw new Error(`"${name}" can't be a parameter's name: in a formula it's ${meaning}.`);
  }
}
