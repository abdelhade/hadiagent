'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const { loadAssignments, saveAssignments, setFilePath } = require('./assignment-store');

describe('assignment-store', () => {
    let tmpDir;
    let assignmentsFile;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assignment-store-test-'));
        assignmentsFile = path.join(tmpDir, 'assignments.json');
        setFilePath(assignmentsFile);
    });

    afterEach(async () => {
        setFilePath(null);
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    describe('loadAssignments()', () => {
        it('returns {} when file does not exist', async () => {
            const result = await loadAssignments();
            expect(result).toEqual({});
        });

        it('returns parsed JSON when file exists', async () => {
            const data = { '12': 'Kitchen Printer', '15': 'Bar Printer' };
            await fs.writeFile(assignmentsFile, JSON.stringify(data), 'utf8');

            const result = await loadAssignments();
            expect(result).toEqual(data);
        });

        it('returns empty object for empty assignments file', async () => {
            await fs.writeFile(assignmentsFile, '{}', 'utf8');
            const result = await loadAssignments();
            expect(result).toEqual({});
        });

        it('throws on invalid JSON', async () => {
            await fs.writeFile(assignmentsFile, 'not-valid-json', 'utf8');
            await expect(loadAssignments()).rejects.toThrow();
        });
    });

    describe('saveAssignments()', () => {
        it('writes assignments to file', async () => {
            const data = { '1': 'Printer A', '2': 'Printer B' };
            await saveAssignments(data);

            const raw = await fs.readFile(assignmentsFile, 'utf8');
            expect(JSON.parse(raw)).toEqual(data);
        });

        it('creates directory if it does not exist', async () => {
            const nestedFile = path.join(tmpDir, 'nested', 'deep', 'assignments.json');
            setFilePath(nestedFile);

            const data = { '5': 'Test Printer' };
            await saveAssignments(data);

            const raw = await fs.readFile(nestedFile, 'utf8');
            expect(JSON.parse(raw)).toEqual(data);
        });

        it('saves empty assignments object', async () => {
            await saveAssignments({});
            const result = await loadAssignments();
            expect(result).toEqual({});
        });

        it('overwrites existing assignments', async () => {
            await saveAssignments({ '1': 'Old Printer' });
            await saveAssignments({ '1': 'New Printer', '2': 'Another Printer' });

            const result = await loadAssignments();
            expect(result).toEqual({ '1': 'New Printer', '2': 'Another Printer' });
        });

        it('does not leave a .tmp file after successful save', async () => {
            await saveAssignments({ '1': 'Printer' });

            await expect(fs.access(assignmentsFile + '.tmp')).rejects.toThrow();
        });
    });

    describe('round-trip', () => {
        it('save then load returns deeply equal object', async () => {
            const data = { '12': 'Kitchen Printer', '15': 'Bar Printer', '7': '' };
            await saveAssignments(data);
            const loaded = await loadAssignments();
            expect(loaded).toEqual(data);
        });
    });
});
