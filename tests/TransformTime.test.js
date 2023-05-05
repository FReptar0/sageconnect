import { minutesToMilliseconds } from "../src/utils/TransformTime";
const { expect, describe, test } = require("@jest/globals");

describe("minutesToMilliseconds", () => {
    test("throws an error when input is 0", () => {
        expect(() => minutesToMilliseconds(0)).toThrow("Input cannot be 0");
    });


    test("returns the correct value when input is positive", () => {
        expect(minutesToMilliseconds(1)).toBe(60000);
        expect(minutesToMilliseconds(2.5)).toBe(150000);
    });

    test("throws an error when input is negative", () => {
        expect(() => minutesToMilliseconds(-1)).toThrow("Input cannot be negative");
    });

});
