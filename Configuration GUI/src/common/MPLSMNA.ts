/* Copyright 2022-present University of Tuebingen, Chair of Communication Networks
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * 
 * Fabian Ihle (fabian.ihle@uni-tuebingen.de)
 * 
 */

import { DefaultMPLSHeader, MPLSHeader } from "./Interfaces";

export const MNA_BSPL_LABEL = 4;

export enum MNAIhsScope {
    I2E = 0,
    HBH = 1,
    Select = 2,
    Reserved = 3,
}

export type MNAEditorRole = "plain" | "formatA" | "formatB" | "formatC" | "formatD";

export interface MNAFormatBConfig {
    opcode: number;
    data: number;
    ihs: MNAIhsScope;
    u: boolean;
    nasl: number;
    nal: number;
}

export interface MNAFormatCConfig {
    opcode: number;
    data: number;
    u: boolean;
    nal: number;
}

export interface MNAFormatDConfig {
    data: number;
}

export interface MNAEditorEntry {
    plain: MPLSHeader;
    isNasi: boolean;
    formatB: MNAFormatBConfig;
    formatC: MNAFormatCConfig;
    formatD: MNAFormatDConfig;
}

export interface MNAComputedRow {
    index: number;
    role: MNAEditorRole;
    plain: MPLSHeader;
    isNasi: boolean;
    formatB: MNAFormatBConfig;
    formatC: MNAFormatCConfig;
    formatD: MNAFormatDConfig;
    ownerIndex: number | null;
    canBeNasi: boolean;
    nasiDisabledReason: string | null;
    maxNasl: number;
    maxNal: number;
}

export interface MNAComputedState {
    rows: MNAComputedRow[];
    encodedStack: MPLSHeader[];
    error: string | null;
    hasNas: boolean;
}

const defaultFormatB = (): MNAFormatBConfig => ({
    opcode: 0,
    data: 0,
    ihs: MNAIhsScope.I2E,
    u: false,
    nasl: 0,
    nal: 0,
});

const defaultFormatC = (): MNAFormatCConfig => ({
    opcode: 0,
    data: 0,
    u: false,
    nal: 0,
});

const defaultFormatD = (): MNAFormatDConfig => ({
    data: 0,
});

export const createDefaultMNAEditorEntries = (stack: MPLSHeader[], length: number): MNAEditorEntry[] =>
    Array.from({ length }, (_, index) => {
        const plain = stack[index] ? { ...stack[index] } : DefaultMPLSHeader();
        return {
            plain,
            isNasi: false,
            formatB: defaultFormatB(),
            formatC: defaultFormatC(),
            formatD: defaultFormatD(),
        };
    });

const clamp = (value: number, min: number, max: number) => {
    if (Number.isNaN(value)) {
        return min;
    }
    return Math.min(Math.max(value, min), max);
};

const encodeFormatA = (plain: MPLSHeader): MPLSHeader => ({
    label: MNA_BSPL_LABEL,
    tc: plain.tc,
    ttl: plain.ttl,
});

const decodeFormatB = (header: MPLSHeader): MNAFormatBConfig => {
    return {
        opcode: (header.label >>> 13) & 0x7f,
        data: header.label & 0x1fff,
        ihs: (header.tc & 0x3) as MNAIhsScope,
        u: ((header.ttl >>> 3) & 0x1) === 1,
        nasl: (header.ttl >>> 4) & 0xf,
        nal: header.ttl & 0x7,
    };
};

const decodeFormatC = (header: MPLSHeader): MNAFormatCConfig => {
    return {
        opcode: (header.label >>> 13) & 0x7f,
        data: (((header.label & 0x1fff) << 7) | ((header.tc & 0x7) << 4) | ((header.ttl >>> 4) & 0xf)) >>> 0,
        u: ((header.ttl >>> 3) & 0x1) === 1,
        nal: header.ttl & 0x7,
    };
};

const decodeFormatD = (header: MPLSHeader): MNAFormatDConfig => {
    if ((header.label & (1 << 19)) === 0) {
        throw new Error("Invalid Format D encoding.");
    }

    return {
        data: (((header.label & 0x7ffff) << 11) | ((header.tc & 0x7) << 8) | (header.ttl & 0xff)) >>> 0,
    };
};

const encodeFormatB = (config: MNAFormatBConfig): MPLSHeader => ({
    label: (((config.opcode & 0x7f) << 13) | (config.data & 0x1fff)) >>> 0,
    tc: config.ihs & 0x3,
    ttl: (((config.nasl & 0xf) << 4) | ((config.u ? 1 : 0) << 3) | (config.nal & 0x7)) >>> 0,
});

const encodeFormatC = (config: MNAFormatCConfig): MPLSHeader => ({
    label: (((config.opcode & 0x7f) << 13) | ((config.data >>> 7) & 0x1fff)) >>> 0,
    tc: (config.data >>> 4) & 0x7,
    ttl: ((((config.data & 0xf) << 4) | ((config.u ? 1 : 0) << 3) | (config.nal & 0x7))) >>> 0,
});

const encodeFormatD = (config: MNAFormatDConfig): MPLSHeader => ({
    label: (((1 << 19) | ((config.data >>> 11) & 0x7ffff))) >>> 0,
    tc: (config.data >>> 8) & 0x7,
    ttl: config.data & 0xff,
});

export const decodeMNAEditorEntries = (stack: MPLSHeader[], length: number): { entries: MNAEditorEntry[]; error: string | null } => {
    const entries = createDefaultMNAEditorEntries(stack, length);

    if (length === 0) {
        return { entries, error: null };
    }

    let index = 0;
    while (index < length) {
        const current = stack[index] ?? DefaultMPLSHeader();
        if (current.label !== MNA_BSPL_LABEL) {
            entries[index].plain = { ...current };
            index += 1;
            continue;
        }

        if (index === 0) {
            return {
                entries: createDefaultMNAEditorEntries(stack, length),
                error: "The top-of-stack LSE cannot be the MNA sub-stack indicator.",
            };
        }

        if (index === length - 1) {
            return {
                entries: createDefaultMNAEditorEntries(stack, length),
                error: "The last LSE cannot be the MNA sub-stack indicator.",
            };
        }

        entries[index].isNasi = true;
        entries[index].plain = { ...current };

        const formatBIndex = index + 1;
        const formatBHeader = stack[formatBIndex] ?? DefaultMPLSHeader();
        const formatB = decodeFormatB(formatBHeader);
        const remainingAfterB = length - (formatBIndex + 1);

        if (formatB.nasl > remainingAfterB) {
            return {
                entries: createDefaultMNAEditorEntries(stack, length),
                error: "NASL exceeds the remaining MPLS stack depth.",
            };
        }

        if (formatB.nal > formatB.nasl) {
            return {
                entries: createDefaultMNAEditorEntries(stack, length),
                error: "NAL exceeds NASL in the encoded MNA stack.",
            };
        }

        entries[formatBIndex].formatB = formatB;

        let offset = formatBIndex + 1;
        for (let dIndex = 0; dIndex < formatB.nal; dIndex += 1) {
            try {
                entries[offset].formatD = decodeFormatD(stack[offset] ?? DefaultMPLSHeader());
            } catch (_error) {
                return {
                    entries: createDefaultMNAEditorEntries(stack, length),
                    error: "A Format D row does not contain a valid in-stack data encoding.",
                };
            }
            offset += 1;
        }

        let consumedWithinNas = formatB.nal;
        while (consumedWithinNas < formatB.nasl) {
            if (offset >= length) {
                return {
                    entries: createDefaultMNAEditorEntries(stack, length),
                    error: "The encoded MNA stack ends before NASL is satisfied.",
                };
            }

            const formatC = decodeFormatC(stack[offset] ?? DefaultMPLSHeader());
            if (formatC.nal > formatB.nasl - consumedWithinNas - 1) {
                return {
                    entries: createDefaultMNAEditorEntries(stack, length),
                    error: "A Format C NAL exceeds the remaining rows in the NAS.",
                };
            }

            entries[offset].formatC = formatC;
            offset += 1;
            consumedWithinNas += 1;

            for (let dIndex = 0; dIndex < formatC.nal; dIndex += 1) {
                if (offset >= length) {
                    return {
                        entries: createDefaultMNAEditorEntries(stack, length),
                        error: "The encoded MNA stack ends before Format D data is complete.",
                    };
                }
                try {
                    entries[offset].formatD = decodeFormatD(stack[offset] ?? DefaultMPLSHeader());
                } catch (_error) {
                    return {
                        entries: createDefaultMNAEditorEntries(stack, length),
                        error: "A Format D row does not contain a valid in-stack data encoding.",
                    };
                }
                offset += 1;
                consumedWithinNas += 1;
            }
        }

        index = offset;
    }

    return { entries, error: null };
};

export const computeMNAState = (entries: MNAEditorEntry[]): MNAComputedState => {
    const rows: MNAComputedRow[] = entries.map((entry, index) => ({
        index,
        role: "plain",
        plain: { ...entry.plain },
        isNasi: entry.isNasi,
        formatB: { ...entry.formatB },
        formatC: { ...entry.formatC },
        formatD: { ...entry.formatD },
        ownerIndex: null,
        canBeNasi: index > 0 && index < entries.length - 1,
        nasiDisabledReason: null,
        maxNasl: Math.max(entries.length - index - 2, 0),
        maxNal: 0,
    }));

    if (entries.length === 0) {
        return {
            rows,
            encodedStack: [],
            error: null,
            hasNas: false,
        };
    }

    let hasNas = false;
    let error: string | null = null;
    const occupied = new Set<number>();

    for (let index = 0; index < rows.length; index += 1) {
        if (!rows[index].isNasi) {
            continue;
        }

        hasNas = true;
        if (index === 0) {
            error = "The top-of-stack LSE cannot be the MNA sub-stack indicator.";
            break;
        }

        if (index === rows.length - 1) {
            error = "The last LSE cannot be the MNA sub-stack indicator.";
            break;
        }

        if (occupied.has(index) || occupied.has(index + 1)) {
            error = "MNA sub-stacks must not overlap.";
            break;
        }

        const formatBIndex = index + 1;
        const formatBRow = rows[formatBIndex];
        const maxNasl = rows.length - formatBIndex - 1;
        const nasl = clamp(formatBRow.formatB.nasl, 0, maxNasl);
        const nal = clamp(formatBRow.formatB.nal, 0, nasl);

        formatBRow.formatB.nasl = nasl;
        formatBRow.formatB.nal = nal;
        formatBRow.maxNasl = maxNasl;
        formatBRow.maxNal = nasl;
        rows[index].role = "formatA";
        rows[index].ownerIndex = index;
        rows[index].canBeNasi = false;
        formatBRow.role = "formatB";
        formatBRow.ownerIndex = index;
        formatBRow.canBeNasi = false;
        occupied.add(index);
        occupied.add(formatBIndex);

        let cursor = formatBIndex + 1;
        let consumedWithinNas = 0;

        for (let dIndex = 0; dIndex < nal; dIndex += 1) {
            if (cursor >= rows.length) {
                error = "NAL exceeds the remaining rows in the MPLS stack.";
                break;
            }
            if (occupied.has(cursor)) {
                error = "MNA sub-stacks must not overlap.";
                break;
            }

            rows[cursor].role = "formatD";
            rows[cursor].ownerIndex = formatBIndex;
            rows[cursor].canBeNasi = false;
            occupied.add(cursor);
            cursor += 1;
            consumedWithinNas += 1;
        }

        if (error) {
            break;
        }

        while (consumedWithinNas < nasl) {
            if (cursor >= rows.length) {
                error = "NASL exceeds the remaining rows in the MPLS stack.";
                break;
            }
            if (occupied.has(cursor)) {
                error = "MNA sub-stacks must not overlap.";
                break;
            }

            const formatCRow = rows[cursor];
            const remainingWithinNas = nasl - consumedWithinNas - 1;
            const formatCNal = clamp(formatCRow.formatC.nal, 0, remainingWithinNas);

            formatCRow.role = "formatC";
            formatCRow.ownerIndex = index;
            formatCRow.canBeNasi = false;
            formatCRow.maxNal = remainingWithinNas;
            formatCRow.formatC.nal = formatCNal;
            occupied.add(cursor);
            cursor += 1;
            consumedWithinNas += 1;

            for (let dIndex = 0; dIndex < formatCNal; dIndex += 1) {
                if (cursor >= rows.length) {
                    error = "NAL exceeds the remaining rows in the MPLS stack.";
                    break;
                }
                if (occupied.has(cursor)) {
                    error = "MNA sub-stacks must not overlap.";
                    break;
                }

                rows[cursor].role = "formatD";
                rows[cursor].ownerIndex = formatCRow.index;
                rows[cursor].canBeNasi = false;
                occupied.add(cursor);
                cursor += 1;
                consumedWithinNas += 1;
            }

            if (error) {
                break;
            }
        }

        if (error) {
            break;
        }
    }

    rows.forEach((row, index) => {
        if (occupied.has(index)) {
            row.canBeNasi = false;
            row.nasiDisabledReason = "This row is occupied by another NAS.";
        } else {
            row.role = "plain";
            row.ownerIndex = null;
            row.canBeNasi = index > 0 && index < rows.length - 1;
            row.nasiDisabledReason = null;
        }

        if (row.canBeNasi && index + 1 < rows.length && rows[index + 1].isNasi) {
            row.canBeNasi = false;
            row.nasiDisabledReason = "This LSE cannot be NASI while the following LSE is already NASI.";
        }

        if (index === 0) {
            row.canBeNasi = false;
            row.nasiDisabledReason = "The top-of-stack LSE cannot be NASI.";
        } else if (index === rows.length - 1) {
            row.canBeNasi = false;
            row.nasiDisabledReason = "The last LSE cannot be NASI.";
        }
    });

    if (!error && hasNas) {
        for (let index = 0; index < rows.length; index += 1) {
            if (!rows[index].isNasi) {
                continue;
            }

            if (rows[index].role !== "formatA") {
                error = "An MNA indicator is placed inside another network action sub-stack.";
                break;
            }
        }
    }

    if (!error && !hasNas) {
        error = "MNA is enabled, but the MPLS stack does not contain an MNA sub-stack.";
    }

    const encodedStack = rows.map((row) => {
        switch (row.role) {
            case "formatA":
                return encodeFormatA(row.plain);
            case "formatB":
                return encodeFormatB(row.formatB);
            case "formatC":
                return encodeFormatC(row.formatC);
            case "formatD":
                return encodeFormatD(row.formatD);
            case "plain":
            default:
                return { ...row.plain };
        }
    });

    return {
        rows,
        encodedStack,
        error,
        hasNas,
    };
};

export const getMNAValidationError = (entries: MNAEditorEntry[]): string | null =>
    computeMNAState(entries).error;
