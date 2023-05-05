const { describe, test, expect } = require("@jest/globals");
const { sendMail } = require("../src/utils/EmailSender");

describe("sendMail function", () => {
    test("should send email successfully", async () => {
        const subject = "Test email";
        const text = "This is a test email";
        const result = await sendMail(subject, text);
        expect(result.accepted).toHaveLength(1);
        expect(result.rejected).toHaveLength(0);
    });

    /*  NOTE: If the email is valid, the test will not pass
        uncomment the code below to test the error
        you should comment the previous test */

    /*     test("should throw error if email is not sent successfully", async () => {
            const subject = "Invalid email";
            const text = "This email should not be sent";
            const result = await sendMail(subject, text);
            expect(result).toBeInstanceOf(Error);
        }); */
});
