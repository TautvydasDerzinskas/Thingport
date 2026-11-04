import { describe, expect, it } from "vitest";
import { checkParameterName, evaluateExpression, expressionNames } from "./expressions";

// Formulas over a design's parameters: worked out the way arithmetic is written, in degrees, and refused with a
// message that says where when they can't be.

const parameters = { wall: 1.6, height: 40, width: 25, _r2: 3 };
const value = (text: string) => evaluateExpression(text, parameters);

describe("Studio expressions", () => {
  it("reads numbers as they're usually written", () => {
    expect(value("10")).toBe(10);
    expect(value("  2.5 ")).toBe(2.5);
    expect(value(".5")).toBe(0.5);
    expect(value("5.")).toBe(5);
    expect(value("1.5e2")).toBe(150);
    expect(value("2E-3")).toBe(0.002);
  });

  it("works out the parameters' values", () => {
    expect(value("wall * 2 + 10")).toBeCloseTo(13.2, 12);
    expect(value("height/2-_r2")).toBe(17);
    expect(evaluateExpression("x", { x: -4 })).toBe(-4);
  });

  it("multiplies and divides before it adds, left to right", () => {
    expect(value("2 + 3 * 4")).toBe(14);
    expect(value("(2 + 3) * 4")).toBe(20);
    expect(value("10 - 4 - 3")).toBe(3);
    expect(value("100 / 10 / 5")).toBe(2);
    expect(value("10 % 4 * 3")).toBe(6);
    expect(value("-7 % 3")).toBe(-1);
    expect(value("2 * (3 + (4 - 1)) / 3")).toBe(4);
  });

  it("takes powers right to left, and before a sign in front", () => {
    expect(value("2 ^ 3 ^ 2")).toBe(512);
    expect(value("-2^2")).toBe(-4);
    expect(value("(-2)^2")).toBe(4);
    expect(value("2^-1")).toBe(0.5);
    expect(value("2 * 3^2")).toBe(18);
    expect(value("-wall^2")).toBeCloseTo(-2.56, 12);
  });

  it("reads signs in front, more than one too", () => {
    expect(value("-3 * -2")).toBe(6);
    expect(value("--2")).toBe(2);
    expect(value("+5")).toBe(5);
    expect(value("10 - -wall")).toBeCloseTo(11.6, 12);
  });

  it("has min, max and the rounding functions", () => {
    expect(value("min(3, 1, 2)")).toBe(1);
    expect(value("max(3, 1, 2)")).toBe(3);
    expect(value("min(7)")).toBe(7);
    expect(value("max(wall, min(10, height / 2))")).toBe(10);
    expect(value("abs(-4)")).toBe(4);
    expect(value("sqrt(16)")).toBe(4);
    expect(value("round(2.5)")).toBe(3);
    expect(value("round(-2.5)")).toBe(-3);
    expect(value("round(2.4)")).toBe(2);
    expect(value("floor(-1.5)")).toBe(-2);
    expect(value("ceil(1.2)")).toBe(2);
  });

  it("takes and gives angles in degrees, exactly at whole quarter turns", () => {
    expect(value("sin(30)")).toBeCloseTo(0.5, 12);
    expect(value("cos(60)")).toBeCloseTo(0.5, 12);
    expect(value("tan(45)")).toBeCloseTo(1, 12);
    expect(value("cos(90)")).toBe(0);
    expect(value("sin(180)")).toBe(0);
    expect(value("sin(-90)")).toBe(-1);
    expect(value("cos(360)")).toBe(1);
    expect(value("asin(1)")).toBeCloseTo(90, 12);
    expect(value("acos(0)")).toBeCloseTo(90, 12);
    expect(value("atan(1)")).toBeCloseTo(45, 12);
    expect(value("2 * pi * width")).toBeCloseTo(2 * Math.PI * 25, 12);
  });

  it("says which name is no parameter, and the one it probably meant", () => {
    expect(() => value("wal * 2 + 10")).toThrow(
      `There's no parameter called "wal" (at character 1 of "wal * 2 + 10"). Did you mean "wall"?`,
    );
    expect(() => value("wall + Height")).toThrow(/character 8 .*Did you mean "height"\?/);
    expect(() => value("PI * 2")).toThrow(/Did you mean "pi"\?/);
    expect(() => value("depth")).toThrow(/^There's no parameter called "depth" \(at character 1 of "depth"\)\.$/);
    // Nothing inherited from an object counts as one.
    expect(() => evaluateExpression("constructor", {})).toThrow(/no parameter called "constructor"/);
    expect(() => evaluateExpression("x", { x: Number.NaN })).toThrow(/"x" has no finite value/);
  });

  it("refuses division by zero and results that aren't finite numbers, saying where", () => {
    expect(() => value("10 / 0")).toThrow(`Division by zero (at character 4 of "10 / 0").`);
    expect(() => value("wall / (height - 40)")).toThrow(
      `Division by zero: "(height - 40)" comes to 0 (at character 6 of "wall / (height - 40)").`,
    );
    expect(() => value("7 % 0")).toThrow(/Division by zero/);
    expect(() => value("1 + sqrt(-1)")).toThrow(
      `"sqrt(-1)" doesn't come to a finite number (at character 5 of "1 + sqrt(-1)").`,
    );
    expect(() => value("tan(90)")).toThrow(/doesn't come to a finite number/);
    expect(() => value("asin(2)")).toThrow(/doesn't come to a finite number/);
    expect(() => value("1e308 * 10")).toThrow(/"1e308 \* 10" doesn't come to a finite number/);
    expect(() => value("1e999")).toThrow(/doesn't come to a finite number/);
  });

  it("says where a formula can't be read", () => {
    expect(() => value("2 *")).toThrow(`A number, a name or "(" was expected (at the end of "2 *").`);
    expect(() => value("2 * )")).toThrow(/expected, not "\)" \(at character 5/);
    expect(() => value("2 wall")).toThrow(`An operator (+ - * / % ^) was expected (at character 3 of "2 wall").`);
    expect(() => value("1.5.5")).toThrow(/operator .*at character 4 of "1.5.5"/);
    expect(() => value("(2 + 3")).toThrow(`A ")" was expected (at the end of "(2 + 3").`);
    expect(() => value("(2 3)")).toThrow(/An operator or "\)" was expected/);
    expect(() => value("2 + 3)")).toThrow(/This "\)" has no "\(" to close/);
    expect(() => value("1, 2")).toThrow(/A "," goes only between a function's numbers/);
    expect(() => value("2 ** 3")).toThrow(/Powers are written with \^/);
    expect(() => value("2 # 3")).toThrow(`"#" can't be used in a formula (at character 3 of "2 # 3").`);
    expect(() => value("2 × 3")).toThrow(/"×" can't be used in a formula: write \*/);
    expect(() => value("")).toThrow(/empty/);
    expect(() => value("   ")).toThrow(/empty/);
    expect(() => value("1+".repeat(250) + "1")).toThrow(/500 characters long at most; this one is 501/);
    expect(() => value(`${"a".repeat(41)} + 1`)).toThrow(/longer than a parameter's name can be/);
  });

  it("says what's wrong with a function's call", () => {
    expect(() => value("foo(1)")).toThrow(/There's no function called "foo"; there are min, max, abs, sqrt/);
    expect(() => value("sqrt(1, 2)")).toThrow(/sqrt takes one number, not 2/);
    expect(() => value("abs()")).toThrow(/abs takes one number, not 0/);
    expect(() => value("min()")).toThrow(/min takes one number or more/);
    expect(() => value("sqrt + 1")).toThrow(/sqrt is a function: give it its number in brackets/);
    expect(() => value("pi(2)")).toThrow(/pi is a number, not a function/);
    expect(() => value("max(1, 2")).toThrow(/A "\)" was expected \(at the end/);
    expect(() => value("max(1 2)")).toThrow(/An operator, "," or "\)" was expected/);
  });

  it("lists the parameters a formula uses, each once, without pi", () => {
    expect(expressionNames("wall * 2 + max(wall, height) - pi * r")).toEqual(["wall", "height", "r"]);
    expect(expressionNames("-(a + b) ^ c % sin(d)")).toEqual(["a", "b", "c", "d"]);
    expect(expressionNames("10 + 2")).toEqual([]);
    // It reads the formula, but needs no values: an unknown name is just a name.
    expect(expressionNames("nothing / 0")).toEqual(["nothing"]);
    expect(() => expressionNames("wall +")).toThrow(/at the end/);
  });

  it("takes as a parameter's name only what a formula can use as one", () => {
    for (const name of ["wall", "_x1", "Wall_Height", "a".repeat(40)])
      expect(() => checkParameterName(name)).not.toThrow();
    expect(() => checkParameterName("")).toThrow(/needs a name/);
    expect(() => checkParameterName("2x")).toThrow(/doesn't start with a digit/);
    expect(() => checkParameterName("my-wall")).toThrow(/letters, digits and _/);
    expect(() => checkParameterName("wall height")).toThrow(/letters, digits and _/);
    expect(() => checkParameterName("a".repeat(41))).toThrow(/40 characters long at most; "a+…" is 41/);
    expect(() => checkParameterName("pi")).toThrow(/it's the number pi/);
    for (const name of [
      "min",
      "max",
      "abs",
      "sqrt",
      "round",
      "floor",
      "ceil",
      "sin",
      "cos",
      "tan",
      "asin",
      "acos",
      "atan",
    ])
      expect(() => checkParameterName(name)).toThrow(`in a formula it's the function ${name}()`);
  });
});
