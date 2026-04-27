const path = require('path');
const fs = require('fs');
const os = require('os');

jest.mock('../../src/config', () => {
    const nodePath = require('path');
    const nodeOs = require('os');
    return {
        paths: { logs: nodePath.join(nodeOs.tmpdir(), `sageconnect-test-logs-${process.pid}`) },
    };
});

jest.mock('../../src/utils/TimezoneHelper', () => {
    let mockedDate = '2026-04-27';
    return {
        getCurrentDateString: jest.fn(() => mockedDate),
        getCurrentDateFormatted: jest.fn(() => mockedDate.replace(/-/g, '')),
        __setMockDate: (d) => { mockedDate = d; },
    };
});

describe('LogGenerator file-handle cache', () => {
    let createLoggerSpy;
    let LogGenerator;
    let winston;
    const tmpRoot = path.join(os.tmpdir(), `sageconnect-test-logs-${process.pid}`);

    beforeEach(() => {
        jest.resetModules();
        winston = require('winston');
        createLoggerSpy = jest.spyOn(winston, 'createLogger');
        LogGenerator = require('../../src/utils/LogGenerator');
        require('../../src/utils/TimezoneHelper').__setMockDate('2026-04-27');
    });

    afterEach(() => {
        if (LogGenerator && typeof LogGenerator._closeAll === 'function') {
            LogGenerator._closeAll();
        }
        createLoggerSpy.mockRestore();
        try {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        } catch (_e) { /* ignore */ }
    });

    test('reuses the same logger across N calls with the same (date, fileName)', () => {
        for (let i = 0; i < 50; i++) {
            LogGenerator.logGenerator('TestFile', 'info', `msg ${i}`);
        }
        expect(createLoggerSpy).toHaveBeenCalledTimes(1);
    });

    test('creates a separate logger per fileName', () => {
        LogGenerator.logGenerator('AlphaFile', 'info', 'a');
        LogGenerator.logGenerator('BetaFile', 'info', 'b');
        LogGenerator.logGenerator('AlphaFile', 'warn', 'a2');
        LogGenerator.logGenerator('BetaFile', 'error', 'b2');
        expect(createLoggerSpy).toHaveBeenCalledTimes(2);
    });

    test('rotates loggers when date changes (closes old, creates new)', () => {
        const tz = require('../../src/utils/TimezoneHelper');

        LogGenerator.logGenerator('Rotating', 'info', 'day1-a');
        LogGenerator.logGenerator('Rotating', 'info', 'day1-b');
        expect(createLoggerSpy).toHaveBeenCalledTimes(1);

        tz.__setMockDate('2026-04-28');

        LogGenerator.logGenerator('Rotating', 'info', 'day2-a');
        LogGenerator.logGenerator('Rotating', 'info', 'day2-b');
        expect(createLoggerSpy).toHaveBeenCalledTimes(2);
    });

    test('writes log file content to disk under sageconnect/<date>/<fileName>.log', () => {
        LogGenerator.logGenerator('PersistFile', 'info', 'persist test message');
        const expectedPath = path.join(tmpRoot, 'sageconnect', '2026-04-27', 'PersistFile.log');
        return new Promise((resolve) => setTimeout(resolve, 50)).then(() => {
            expect(fs.existsSync(expectedPath)).toBe(true);
            const content = fs.readFileSync(expectedPath, 'utf8');
            expect(content).toMatch(/persist test message/);
        });
    });

    test('respects per-call log level (info/warn/error all written)', () => {
        LogGenerator.logGenerator('LevelTest', 'info', 'INFO_MSG');
        LogGenerator.logGenerator('LevelTest', 'warn', 'WARN_MSG');
        LogGenerator.logGenerator('LevelTest', 'error', 'ERROR_MSG');

        const expectedPath = path.join(tmpRoot, 'sageconnect', '2026-04-27', 'LevelTest.log');
        return new Promise((resolve) => setTimeout(resolve, 50)).then(() => {
            const content = fs.readFileSync(expectedPath, 'utf8');
            expect(content).toMatch(/INFO_MSG/);
            expect(content).toMatch(/WARN_MSG/);
            expect(content).toMatch(/ERROR_MSG/);
        });
    });
});
