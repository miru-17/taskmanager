import { describeRule, nextOccurrence, weekdayOf, type Rule } from "../src/modules/recurrence/schedule";

const rule = (r: Partial<Rule>): Rule => ({ frequency: "DAILY", interval: 1, weekdays: [], monthDay: null, ...r });

describe("recurrence schedule", () => {
  it("knows weekdays (Monday = 0)", () => {
    expect(weekdayOf("2026-11-02")).toBe(0); // Monday
    expect(weekdayOf("2026-11-08")).toBe(6); // Sunday
  });

  it("daily, every N days", () => {
    expect(nextOccurrence(rule({}), "2026-12-31")).toBe("2027-01-01");
    expect(nextOccurrence(rule({ interval: 3 }), "2026-11-03")).toBe("2026-11-06");
  });

  it("weekly on chosen days, then jumps N weeks", () => {
    const monWedFri = rule({ frequency: "WEEKLY", weekdays: [0, 2, 4] });
    expect(nextOccurrence(monWedFri, "2026-11-02")).toBe("2026-11-04"); // Mon → Wed
    expect(nextOccurrence(monWedFri, "2026-11-06")).toBe("2026-11-09"); // Fri → next Mon
    const biweeklyTue = rule({ frequency: "WEEKLY", interval: 2, weekdays: [1] });
    expect(nextOccurrence(biweeklyTue, "2026-11-03")).toBe("2026-11-17");
    // No weekdays given: same weekday as the from date
    expect(nextOccurrence(rule({ frequency: "WEEKLY" }), "2026-11-05")).toBe("2026-11-12");
  });

  it("monthly keeps its anchor day and clamps short months", () => {
    const end = rule({ frequency: "MONTHLY", monthDay: 31 });
    expect(nextOccurrence(end, "2027-01-31")).toBe("2027-02-28");
    expect(nextOccurrence(end, "2027-02-28")).toBe("2027-03-31"); // back to the 31st, not stuck on the 28th
    expect(nextOccurrence(rule({ frequency: "MONTHLY", interval: 3, monthDay: 15 }), "2026-11-15")).toBe("2027-02-15");
    expect(nextOccurrence(rule({ frequency: "MONTHLY", monthDay: 31 }), "2028-01-31")).toBe("2028-02-29"); // leap year
  });

  it("yearly, including 29 February", () => {
    expect(nextOccurrence(rule({ frequency: "YEARLY", monthDay: 29 }), "2028-02-29")).toBe("2029-02-28");
    expect(nextOccurrence(rule({ frequency: "YEARLY" }), "2026-11-03")).toBe("2027-11-03");
  });

  it("describes rules in plain words", () => {
    expect(describeRule(rule({ frequency: "WEEKLY", weekdays: [4, 0] }))).toBe("Every week on Mon, Fri");
    expect(describeRule(rule({ frequency: "MONTHLY", interval: 2, monthDay: 1 }))).toBe("Every 2 months on day 1");
  });
});
