import { expect, it } from "vitest";
import { breakdownLabel, channelLookup } from "../src/background/youtube";

it("names countries and traffic sources instead of printing API codes", () => {
  expect(breakdownLabel("country", "ru", "ru")).toBe("Россия");
  expect(breakdownLabel("country", "US", "en")).toBe("United States");
  expect(breakdownLabel("country", "ZZ", "ru")).toBe("ZZ");
  expect(breakdownLabel("insightTrafficSourceType", "YT_OTHER_PAGE", "ru")).toBe(
    "Другие страницы YouTube",
  );
  // A type YouTube adds later still reads as words rather than an enum.
  expect(breakdownLabel("insightTrafficSourceType", "NEW_SOURCE", "en")).toBe(
    "new source",
  );
});

it("resolves a percent-encoded handle URL as a handle, not a paid search", () => {
  expect(
    channelLookup(
      "https://www.youtube.com/@%D0%9C%D0%B0%D1%88%D0%B0%D0%9A%D0%BE%D0%BF%D0%B0%D0%B5%D1%82",
    ),
  ).toEqual({ kind: "handle", value: "МашаКопает" });
});

it("keeps ids, plain handles and free text working", () => {
  expect(
    channelLookup("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv"),
  ).toEqual({ kind: "id", value: "UCabcdefghijklmnopqrstuv" });
  expect(channelLookup("@creator.name")).toEqual({
    kind: "handle",
    value: "creator.name",
  });
  // A literal percent sign is not an encoding and must not throw.
  expect(channelLookup("100% science")).toEqual({
    kind: "search",
    value: "100% science",
  });
});
