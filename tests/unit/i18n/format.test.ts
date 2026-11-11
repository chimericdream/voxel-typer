/** The message formatter behind t() (src/i18n/format.ts, docs/impl/contracts.md §11). */
import { describe, expect, it } from "vitest";
import { formatMessage } from "../../../src/i18n/format";

describe("interpolation", () => {
  it("fills {name} params with strings and numbers", () => {
    expect(formatMessage("Hi {name}! You found {n} gems.", { name: "Sam", n: 3 })).toBe(
      "Hi Sam! You found 3 gems.",
    );
  });

  it("allows spaces inside the braces and repeats", () => {
    expect(formatMessage("{ a } and {a}", { a: "x" })).toBe("x and x");
  });

  it("leaves text without placeholders alone", () => {
    expect(formatMessage("Meadow Home")).toBe("Meadow Home");
    expect(formatMessage("")).toBe("");
  });

  it("keeps {name} visible when the param is missing", () => {
    expect(formatMessage("Hi {name}!")).toBe("Hi {name}!");
    expect(formatMessage("Hi {name}!", { other: 1 })).toBe("Hi {name}!");
  });

  it("formats 0 and negative numbers", () => {
    expect(formatMessage("{n}", { n: 0 })).toBe("0");
    expect(formatMessage("{n}", { n: -2.5 })).toBe("-2.5");
  });
});

describe("plural", () => {
  const blocks = "{count, plural, one {# block} other {# blocks}}";

  it("picks one/other by English rules", () => {
    expect(formatMessage(blocks, { count: 1 })).toBe("1 block");
    expect(formatMessage(blocks, { count: 0 })).toBe("0 blocks");
    expect(formatMessage(blocks, { count: 2 })).toBe("2 blocks");
    expect(formatMessage(blocks, { count: 1.5 })).toBe("1.5 blocks");
  });

  it("accepts numeric strings", () => {
    expect(formatMessage(blocks, { count: "1" })).toBe("1 block");
    expect(formatMessage(blocks, { count: "7" })).toBe("7 blocks");
  });

  it("falls back to other for a value that isn't a number", () => {
    expect(formatMessage(blocks, { count: "lots" })).toBe("lots blocks");
  });

  it("checks =N branches before categories", () => {
    const msg = "{n, plural, =0 {No gems yet} one {One gem} other {# gems}}";
    expect(formatMessage(msg, { n: 0 })).toBe("No gems yet");
    expect(formatMessage(msg, { n: 1 })).toBe("One gem");
    expect(formatMessage(msg, { n: 5 })).toBe("5 gems");
  });

  it("uses other when the category's branch is absent", () => {
    expect(formatMessage("{n, plural, other {# stars}}", { n: 1 })).toBe("1 stars");
  });

  it("allows text and params around and inside branches", () => {
    const msg = "{name} has {count, plural, one {# block} other {# blocks}} for {place}.";
    expect(formatMessage(msg, { name: "Ana", count: 4, place: "the tower" })).toBe(
      "Ana has 4 blocks for the tower.",
    );
    expect(
      formatMessage("{count, plural, one {{who} found # gem} other {{who} found # gems}}", {
        count: 1,
        who: "Kai",
      }),
    ).toBe("Kai found 1 gem");
  });

  it("nests plurals, with # meaning the innermost count", () => {
    const msg =
      "{a, plural, one {# cart and {b, plural, one {# gem} other {# gems}}} other {# carts}}";
    expect(formatMessage(msg, { a: 1, b: 3 })).toBe("1 cart and 3 gems");
  });

  it("tolerates line breaks and extra spaces in the syntax", () => {
    const msg = "{count,plural,\n  one   {# block}\n  other {# blocks}\n}";
    expect(formatMessage(msg, { count: 2 })).toBe("2 blocks");
  });

  it("keeps the placeholder when the count param is missing", () => {
    expect(formatMessage(`I have ${blocks}`)).toBe("I have {count}");
  });

  it("treats # outside a plural as a plain character", () => {
    expect(formatMessage("Level #{n}", { n: 2 })).toBe("Level #2");
  });
});

describe("escaping", () => {
  it("leaves ordinary apostrophes alone", () => {
    expect(formatMessage("Let's dig, {name}!", { name: "Jo" })).toBe("Let's dig, Jo!");
    expect(formatMessage("You're 'great'")).toBe("You're 'great'");
  });

  it("turns '' into one apostrophe", () => {
    expect(formatMessage("It''s {n}", { n: 1 })).toBe("It's 1");
  });

  it("quotes braces with apostrophes", () => {
    expect(formatMessage("Type '{' then '}'")).toBe("Type { then }");
    expect(formatMessage("'{name}' is {name}", { name: "Ivy" })).toBe("{name} is Ivy");
    expect(formatMessage("'{it''s}'")).toBe("{it's}");
  });

  it("quotes # inside a plural branch", () => {
    expect(formatMessage("{n, plural, other {'#'# done}}", { n: 2 })).toBe("#2 done");
  });

  it("does not parse param values", () => {
    const tricky = "{name} '{' # ''";
    expect(formatMessage("Hi {name}", { name: tricky })).toBe(`Hi ${tricky}`);
    expect(formatMessage("{n, plural, other {# x}}", { n: "{n}" })).toBe("{n} x");
  });

  it("does not HTML-escape (Preact does that)", () => {
    expect(formatMessage("{a}", { a: "<b>&</b>" })).toBe("<b>&</b>");
  });

  it("keeps malformed syntax as literal text instead of throwing", () => {
    expect(formatMessage("Oops {")).toBe("Oops {");
    expect(formatMessage("Oops }")).toBe("Oops }");
    expect(formatMessage("{not a name}")).toBe("{not a name}");
    expect(formatMessage("{1}")).toBe("{1}");
    expect(formatMessage("{n, select, a {x}}", { n: "a" })).toBe("{n, select, a {x}}");
    expect(formatMessage("{n, plural, one {x}", { n: 1 })).toBe("{n, plural, one {x}");
    expect(formatMessage("{n, plural, some {x}}", { n: 1 })).toBe("{n, plural, some {x}}");
    expect(formatMessage("{n, plural, one {a} one {b}}", { n: 1 })).toBe(
      "{n, plural, one {a} one {b}}",
    );
    expect(formatMessage("{n, plural, }", { n: 1 })).toBe("{n, plural, }");
    expect(formatMessage("'{ unterminated")).toBe("{ unterminated");
  });
});
