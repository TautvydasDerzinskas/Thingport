// PrusaSlicer's and OrcaSlicer's `compatible_printers_condition`, the small expression language a preset uses to say
// which printers it goes with ("printer_notes=~/.*MK4.*/ and nozzle_diameter[0]==0.4"), parsed and evaluated here
// rather than with eval. An unknown variable throws: the preset isn't taken as compatible.

const TOKEN =
  /\s*(?:(\d+\.\d*|\d*\.\d+|\d+)|("(?:[^"\\]|\\.)*")|([A-Za-z_][A-Za-z0-9_]*)|(==|!=|<=|>=|=~|!~|&&|\|\||[<>!()[\]]))/y;
const WORDS = new Set(["and", "or", "not"]);

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) {
      i++;
      continue;
    }
    const last = out.at(-1);
    if (src[i] === "/" && last?.kind === "op" && (last.value === "=~" || last.value === "!~")) {
      let j = i + 1;
      while (j < src.length && src[j] !== "/") j += src[j] === "\\" ? 2 : 1;
      out.push({ kind: "re", value: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(src);
    if (!m || TOKEN.lastIndex === i) throw new Error(`bad token at ${JSON.stringify(src.slice(i, i + 20))}`);
    const [, num, string, ident, op] = m;
    if (num !== undefined) out.push({ kind: "num", value: Number(num) });
    else if (string !== undefined) out.push({ kind: "str", value: JSON.parse(string) });
    else if (ident !== undefined) {
      const low = ident.toLowerCase();
      if (WORDS.has(low)) out.push({ kind: "op", value: low });
      else if (low === "true" || low === "false") out.push({ kind: "bool", value: low === "true" });
      else out.push({ kind: "id", value: ident });
    } else out.push({ kind: "op", value: op });
    i = TOKEN.lastIndex;
  }
  return out;
}

const isNumber = (x) => typeof x === "number";
// The placeholder parser compares as text when either side is text ("0.4" == 0.4 holds).
const asText = (x) => (isNumber(x) ? x.toFixed(6).replace(/\.?0+$/, "") : String(x));

export class Condition {
  constructor(src) {
    this.tokens = tokenize(src);
    this.at = 0;
    this.ast = this.or();
    if (this.at !== this.tokens.length) throw new Error("trailing tokens");
  }

  peek() {
    return this.tokens[this.at] ?? { kind: null, value: null };
  }

  isOp(...values) {
    const t = this.peek();
    return t.kind === "op" && values.includes(t.value);
  }

  take() {
    return this.tokens[this.at++] ?? { kind: null, value: null };
  }

  or() {
    let node = this.and();
    while (this.isOp("or", "||")) {
      this.take();
      node = ["or", node, this.and()];
    }
    return node;
  }

  and() {
    let node = this.unary();
    while (this.isOp("and", "&&")) {
      this.take();
      node = ["and", node, this.unary()];
    }
    return node;
  }

  unary() {
    if (this.isOp("not", "!")) {
      this.take();
      return ["not", this.unary()];
    }
    return this.compare();
  }

  compare() {
    const left = this.primary();
    if (this.isOp("==", "!=", "<", ">", "<=", ">=", "=~", "!~")) {
      const op = this.take().value;
      return ["cmp", op, left, this.primary()];
    }
    return left;
  }

  primary() {
    const t = this.take();
    if (t.kind === "op" && t.value === "(") {
      const node = this.or();
      const close = this.take();
      if (close.kind !== "op" || close.value !== ")") throw new Error("missing )");
      return node;
    }
    if (t.kind === "num" || t.kind === "str" || t.kind === "bool" || t.kind === "re") return ["lit", t.value];
    if (t.kind === "id") {
      if (this.isOp("[")) {
        this.take();
        const index = this.take();
        const close = this.take();
        if (close.kind !== "op" || close.value !== "]") throw new Error("missing ]");
        return ["var", t.value, Number(index.value)];
      }
      return ["var", t.value, null];
    }
    throw new Error(`unexpected ${t.kind} ${t.value}`);
  }

  /** Whether the printer whose settings are `env` matches. */
  test(env) {
    return Boolean(this.evaluate(env, this.ast));
  }

  evaluate(env, node) {
    switch (node[0]) {
      case "or":
        return Boolean(this.evaluate(env, node[1]) || this.evaluate(env, node[2]));
      case "and":
        return Boolean(this.evaluate(env, node[1]) && this.evaluate(env, node[2]));
      case "not":
        return !this.evaluate(env, node[1]);
      case "lit":
        return node[1];
      case "var": {
        if (!Object.hasOwn(env, node[1])) throw new Error(`unknown variable ${node[1]}`);
        const value = env[node[1]];
        if (!Array.isArray(value)) return value;
        const index = node[2] ?? 0;
        return index < value.length ? value[index] : value.at(-1);
      }
      case "cmp": {
        const a = this.evaluate(env, node[2]);
        const b = this.evaluate(env, node[3]);
        const op = node[1];
        if (op === "=~" || op === "!~") {
          const hit = new RegExp(`^(?:${b})$`, "s").test(String(a));
          return op === "=~" ? hit : !hit;
        }
        let eq;
        let lt;
        if (isNumber(a) && isNumber(b)) {
          eq = Math.abs(a - b) <= 1e-6;
          lt = a < b && !eq;
        } else {
          eq = asText(a) === asText(b);
          lt = asText(a) < asText(b);
        }
        if (op === "==") return eq;
        if (op === "!=") return !eq;
        if (op === "<") return lt;
        if (op === ">") return !lt && !eq;
        if (op === "<=") return lt || eq;
        return !lt;
      }
      default:
        throw new Error(`unknown node ${node[0]}`);
    }
  }
}
