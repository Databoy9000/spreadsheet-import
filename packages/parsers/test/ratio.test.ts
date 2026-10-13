import { describe, expect, it } from "vitest";
import { createVocabulary, parseQuantity, parseRatio, parseRatioHeader } from "../src/index.js";

/**
 * The vocabulary belongs to the caller. UN/CEFACT codes are used here only
 * because they make a realistic example; nothing in this package knows them.
 */
const vocabulary = createVocabulary([
  { value: "PCE", label: "Stuk", alternateMatches: ["stuk", "stuks", "st", "aantal", "piece", "pieces", "XPP"] },
  { value: "MTK", label: "Vierkante meter", alternateMatches: ["m2", "vierkante meter", "sqm"] },
  { value: "MTR", label: "Meter", alternateMatches: ["m", "lm", "lopende meter", "strekkende meter"] },
  { value: "KGM", label: "Kilogram", alternateMatches: ["kg", "kilo"] },
  { value: "PAL", label: "Pallet", alternateMatches: ["pallet", "pal", "palette"] },
  { value: "ROL", label: "Rol", alternateMatches: ["rol", "rollen", "roll"] },
  { value: "BX", label: "Doos", alternateMatches: ["doos", "dozen", "box"] },
  { value: "PK", label: "Pak", alternateMatches: ["pak", "pakken", "pack"] },
]);

describe("parseRatioHeader", () => {
  it("reads the headers that actually appear in supplier files", () => {
    expect(parseRatioHeader("Stuks per m2", vocabulary)).toMatchObject({ of: "PCE", per: "MTK" });
    expect(parseRatioHeader("m2 per pallet", vocabulary)).toMatchObject({ of: "MTK", per: "PAL" });
    expect(parseRatioHeader("Stuks per pallet", vocabulary)).toMatchObject({ of: "PCE", per: "PAL" });
    expect(parseRatioHeader("Kg per pallet", vocabulary)).toMatchObject({ of: "KGM", per: "PAL" });
    expect(parseRatioHeader("m2 per rol", vocabulary)).toMatchObject({ of: "MTK", per: "ROL" });
    expect(parseRatioHeader("m2 per stuk", vocabulary)).toMatchObject({ of: "MTK", per: "PCE" });
    expect(parseRatioHeader("m2 per pak", vocabulary)).toMatchObject({ of: "MTK", per: "PK" });
  });

  describe("the connector is not part of the grammar", () => {
    it.each([
      "Stuks per m2",
      "Stuks / m2",
      "Stuks/m2",
      "stuks m2",
      "Aantal stuks à m2",
      "Stuks pro m2",
      "Stuks (per m2)",
      "aantal stuks | m2",
      "STUKS PER M2",
      "stuks  per   m²",
    ])("reads %j", header => {
      expect(parseRatioHeader(header, vocabulary)).toMatchObject({ of: "PCE", per: "MTK" });
    });
  });

  it("prefers the longest spelling", () => {
    // "lopende meter" must not be read as "meter", which would still be MTR
    // here but would leave a stray word behind for a vocabulary where it did not.
    expect(parseRatioHeader("stuks per lopende meter", vocabulary)).toMatchObject({
      of: "PCE",
      per: "MTR",
      perText: "lopende meter",
    });
  });

  it("returns null when the header does not name exactly two units", () => {
    // One unit: a plain quantity column, not a ratio.
    expect(parseRatioHeader("Prijs per m2", vocabulary)).toBeNull();
    expect(parseRatioHeader("Dikte", vocabulary)).toBeNull();
    expect(parseRatioHeader("m2", vocabulary)).toBeNull();
    // None.
    expect(parseRatioHeader("Omschrijving", vocabulary)).toBeNull();
    expect(parseRatioHeader("", vocabulary)).toBeNull();
  });

  it("refuses a header naming three units rather than picking two", () => {
    expect(parseRatioHeader("stuks per doos per pallet", vocabulary)).toBeNull();
  });

  it("refuses a self-referential header", () => {
    expect(parseRatioHeader("m2 per m2", vocabulary)).toBeNull();
  });

  it("keeps the order the header states", () => {
    expect(parseRatioHeader("m2 per stuk", vocabulary)).toMatchObject({ of: "MTK", per: "PCE" });
    expect(parseRatioHeader("stuk per m2", vocabulary)).toMatchObject({ of: "PCE", per: "MTK" });
  });
});

describe("parseRatio", () => {
  it("produces both directions from a real cell", () => {
    const result = parseRatio("Stuks per m2", "11,8 stuks", { vocabulary });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // One square metre holds 11.8 pieces.
    expect(result.forward.toString()).toBe("MTK>PCE:11.8");
    expect(result.inverse.toString()).toBe("PCE>MTK:0.08474576271");
  });

  it("reads a unit stuck to the number", () => {
    const result = parseRatio("m2 per pallet", "21m²", { vocabulary });
    expect(result.ok && result.forward.toString()).toBe("PAL>MTK:21");
  });

  it("accepts a cell with no unit at all", () => {
    const result = parseRatio("Stuks per pallet", "240", { vocabulary });
    expect(result.ok && result.forward.toString()).toBe("PAL>PCE:240");
  });

  it("handles a comma decimal and a dot decimal alike", () => {
    expect(parseRatio("m2 per pallet", "15,6 m²", { vocabulary }).ok).toBe(true);
    expect(parseRatio("m2 per pallet", "259.20M2", { vocabulary }).ok).toBe(true);
  });

  describe("the cell's unit is checked against the header", () => {
    it("accepts a matching unit", () => {
      expect(parseRatio("Stuks per m2", "11,8 stuks", { vocabulary }).ok).toBe(true);
    });

    it("rejects a contradicting unit instead of trusting either side", () => {
      // A column headed "Stuks per m2" holding "21 m²" is misaligned. Recording
      // 21 pieces per square metre would be worse than refusing.
      const result = parseRatio("Stuks per m2", "21 m²", { vocabulary });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("unexpected-unit");
      expect(result.message).toContain("Expected PCE");
    });

    it("can be told not to check", () => {
      const result = parseRatio("Stuks per m2", "21 m²", { vocabulary, validateCellUnit: false });
      expect(result.ok && result.forward.toString()).toBe("MTK>PCE:21");
    });

    it("ignores a unit it does not recognise rather than failing", () => {
      // "12.60 (2R.)" — the qualifier is not a unit and not a contradiction.
      const result = parseRatio("m2 per pak", "12.60 (2R.)", { vocabulary });
      expect(result.ok && result.forward.toString()).toBe("PK>MTK:12.6");
    });
  });

  it("refuses a header that is not a ratio", () => {
    const result = parseRatio("Dikte", "8 cm", { vocabulary });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not-a-ratio-header");
  });

  it("refuses a zero factor, which has no inverse", () => {
    const result = parseRatio("Stuks per m2", "0", { vocabulary });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("zero-factor");
  });

  it("reports an empty cell rather than inventing a conversion", () => {
    const result = parseRatio("Stuks per m2", "", { vocabulary });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("empty");
  });

  it("enforces plausibility bounds", () => {
    const result = parseRatio("Stuks per m2", "100000 stuks", { vocabulary, max: 10_000 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("out-of-range");
  });

  it("round-trips: forward times inverse is one", () => {
    const result = parseRatio("Stuks per m2", "11,8 stuks", { vocabulary });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.forward.factor * result.inverse.factor).toBeCloseTo(1, 9);
  });
});

describe("parseQuantity", () => {
  it("anchors the number instead of stripping non-digits", () => {
    // Stripping gives 352 — a plausible-looking, entirely wrong number.
    const result = parseQuantity("35 m2", { vocabulary });
    expect(result.ok && result.value).toBe(35);
    expect(result.ok && result.unit).toBe("MTK");
  });

  it.each([
    ["11,8 stuks", 11.8, "PCE"],
    ["21m²", 21, "MTK"],
    ["980 kg", 980, "KGM"],
    ["259.20M2", 259.2, "MTK"],
    ["1 cm", 1, undefined],
    ["8cm", 8, undefined],
  ])("reads %j as %s", (input, value, unit) => {
    const result = parseQuantity(input, { vocabulary });
    expect(result.ok && result.value).toBe(value);
    expect(result.ok && result.unit).toBe(unit);
  });

  it("keeps a trailing qualifier as residue rather than dropping it", () => {
    const result = parseQuantity("12.60 (2R.)", { vocabulary });
    expect(result.ok && result.value).toBe(12.6);
    expect(result.ok && result.residue).toBe("(2R.)");
  });

  it("keeps the unit text even when the vocabulary does not know it", () => {
    const result = parseQuantity("5 mm", { vocabulary });
    expect(result.ok && result.unitText).toBe("mm");
    expect(result.ok && result.unit).toBeUndefined();
  });

  it("can insist on a known unit", () => {
    const result = parseQuantity("5 mm", { vocabulary, requireKnownUnit: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unknown-unit");
  });

  it("assumes a unit only when the cell states none", () => {
    expect(parseQuantity("240", { vocabulary, assumeUnit: "PCE" })).toMatchObject({ unit: "PCE" });
    expect(parseQuantity("240 kg", { vocabulary, assumeUnit: "PCE" })).toMatchObject({ unit: "KGM" });
  });

  it("catches a value that cannot be what the column claims", () => {
    // An R-value column holding "36M2" parses as 36 — numerically fine,
    // physically absurd. Only a bound catches it.
    const result = parseQuantity("36M2", { vocabulary, max: 10 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("out-of-range");
  });

  it("passes a real number straight through", () => {
    expect(parseQuantity(18.45, {})).toMatchObject({ ok: true, value: 18.45 });
  });

  it("reports text with no number", () => {
    const result = parseQuantity("op bestelling", { vocabulary });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not-a-number");
  });
});
