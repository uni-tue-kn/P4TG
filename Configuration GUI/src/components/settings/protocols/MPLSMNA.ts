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

import { DefaultMPLSHeader, MPLSHeader } from "../../../common/Interfaces";

export const MNA_BSPL_LABEL = 4;
export const MNA_POST_STACK_TYPE = 1;
// Non-standard pfn value used by P4TG to disambiguate PSMHT from DetNet d-CW
// in the Tofino 2 parser (d-CW fixes version=0, so pfn=5 can never alias).
export const MNA_PSMHT_PFN = 0x5;

export enum MNAIhsScope {
    I2E = 0,
    HBH = 1,
    Select = 2,
    Reserved = 3,
}

export type MNAEditorRole =
    | "plain"
    | "formatA"
    | "formatB"
    | "formatC"
    | "formatD"
    | "psmht"
    | "psna"
    | "psData";

export interface MNAFormatBConfig {
    opcode: number;
    data: number;
    ihs: MNAIhsScope;
    p: boolean;
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

export interface MNAPostStackHeaderConfig {
    psmhLen: number;
}

export interface MNAPostStackActionConfig {
    opcode: number;
    psNal: number;
    data: number;
}

export interface MNAPostStackDataConfig {
    data: number;
}

export interface MNAEditorEntry {
    plain: MPLSHeader;
    isNasi: boolean;
    isPsmht: boolean;
    formatB: MNAFormatBConfig;
    formatC: MNAFormatCConfig;
    formatD: MNAFormatDConfig;
    psmht: MNAPostStackHeaderConfig;
    psna: MNAPostStackActionConfig;
    psData: MNAPostStackDataConfig;
}

export interface MNAComputedRow {
    index: number;
    role: MNAEditorRole;
    plain: MPLSHeader;
    isNasi: boolean;
    isPsmht: boolean;
    formatB: MNAFormatBConfig;
    formatC: MNAFormatCConfig;
    formatD: MNAFormatDConfig;
    psmht: MNAPostStackHeaderConfig;
    psna: MNAPostStackActionConfig;
    psData: MNAPostStackDataConfig;
    ownerIndex: number | null;
    canBeNasi: boolean;
    nasiDisabledReason: string | null;
    canBePsmht: boolean;
    psmhtDisabledReason: string | null;
    maxNasl: number;
    maxNal: number;
    maxPsmhLen: number;
    maxPsNal: number;
}

export interface MNAComputedState {
    rows: MNAComputedRow[];
    encodedStack: MPLSHeader[];
    error: string | null;
    hasNas: boolean;
    hasPostStack: boolean;
}

export interface MNAFeatureOptions {
    allowPostStack?: boolean;
}

const defaultFormatB = (): MNAFormatBConfig => ({
    opcode: 0,
    data: 0,
    ihs: MNAIhsScope.I2E,
    p: false,
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

const defaultPostStackHeader = (): MNAPostStackHeaderConfig => ({
    psmhLen: 1,
});

const defaultPostStackAction = (): MNAPostStackActionConfig => ({
    opcode: 0,
    psNal: 0,
    data: 0,
});

const defaultPostStackData = (): MNAPostStackDataConfig => ({
    data: 0,
});

export const createDefaultMNAEditorEntries = (stack: MPLSHeader[], length: number): MNAEditorEntry[] =>
    Array.from({ length }, (_, index) => {
        const plain = stack[index] ? { ...stack[index] } : DefaultMPLSHeader();
        return {
            plain,
            isNasi: false,
            isPsmht: false,
            formatB: defaultFormatB(),
            formatC: defaultFormatC(),
            formatD: defaultFormatD(),
            psmht: defaultPostStackHeader(),
            psna: defaultPostStackAction(),
            psData: defaultPostStackData(),
        };
    });

const clamp = (value: number, min: number, max: number) => {
    if (Number.isNaN(value)) {
        return min;
    }
    return Math.min(Math.max(value, min), max);
};

export const normalizePostStackEntries = (entries: MNAEditorEntry[]) => {
    const firstPsmhtIndex = entries.findIndex((entry) => entry.isPsmht);
    if (firstPsmhtIndex === -1) {
        return;
    }

    const explicitMarkers = entries
        .map((entry, index) => (entry.isPsmht ? index : -1))
        .filter((index) => index !== -1);
    const explicitMarkerSet = new Set(explicitMarkers);
    const normalizedMarkers = new Set<number>();
    let currentStart = firstPsmhtIndex;

    while (currentStart < entries.length - 1) {
        normalizedMarkers.add(currentStart);

        let nextExplicit = -1;
        for (const marker of explicitMarkers) {
            if (marker > currentStart) {
                nextExplicit = marker;
                break;
            }
        }

        const totalRemaining = entries.length - currentStart - 1;
        if (totalRemaining <= 0) {
            break;
        }

        let psmhLen = explicitMarkerSet.has(currentStart)
            ? entries[currentStart].psmht.psmhLen
            : totalRemaining;

        if (nextExplicit !== -1) {
            psmhLen = Math.min(psmhLen, nextExplicit - currentStart - 1);
        }

        psmhLen = clamp(psmhLen, 1, totalRemaining);

        let nextStart = currentStart + 1 + psmhLen;
        if (nextExplicit === -1) {
            const tailLength = entries.length - nextStart;
            if (tailLength === 1 && psmhLen < totalRemaining) {
                psmhLen += 1;
                nextStart += 1;
            }
        }

        entries[currentStart].psmht.psmhLen = psmhLen;
        currentStart = nextStart;
    }

    entries.forEach((entry, index) => {
        entry.isPsmht = normalizedMarkers.has(index);
    });
};

const cloneEntriesWithFeatureOptions = (
    entries: MNAEditorEntry[],
    options?: MNAFeatureOptions,
): MNAEditorEntry[] => {
    const allowPostStack = options?.allowPostStack ?? true;

    return entries.map((entry) => ({
        plain: { ...entry.plain },
        isNasi: entry.isNasi,
        isPsmht: allowPostStack ? entry.isPsmht : false,
        formatB: {
            ...entry.formatB,
            p: allowPostStack ? entry.formatB.p : false,
        },
        formatC: { ...entry.formatC },
        formatD: { ...entry.formatD },
        psmht: { ...entry.psmht },
        psna: { ...entry.psna },
        psData: { ...entry.psData },
    }));
};

const plainHeaderWithoutBos = (header: MPLSHeader): MPLSHeader => ({
    label: header.label,
    tc: header.tc,
    ttl: header.ttl,
});

const rawBosBit = (header: MPLSHeader) => (header.bos === true ? 1 : 0);

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
        p: ((header.tc >>> 2) & 0x1) === 1,
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
    tc: ((((config.p ? 1 : 0) << 2) | (config.ihs & 0x3))) >>> 0,
    ttl: (((config.nasl & 0xf) << 4) | ((config.u ? 1 : 0) << 3) | (config.nal & 0x7)) >>> 0,
});

const encodeFormatC = (config: MNAFormatCConfig): MPLSHeader => ({
    label: (((config.opcode & 0x7f) << 13) | ((config.data >>> 7) & 0x1fff)) >>> 0,
    tc: ((config.data >>> 4) & 0x7) >>> 0,
    ttl: ((((config.data & 0xf) << 4) | ((config.u ? 1 : 0) << 3) | (config.nal & 0x7))) >>> 0,
});

const encodeFormatD = (config: MNAFormatDConfig): MPLSHeader => ({
    label: (((1 << 19) | ((config.data >>> 11) & 0x7ffff))) >>> 0,
    tc: (config.data >>> 8) & 0x7,
    ttl: config.data & 0xff,
});

const decodePsmht = (header: MPLSHeader): MNAPostStackHeaderConfig => {
    const pfn = (header.label >>> 16) & 0xf;
    const reserved = (header.label >>> 12) & 0xf;
    const psmhLen = (header.label >>> 4) & 0xff;
    const type = (((header.label & 0xf) << 12) | ((header.tc & 0x7) << 9) | (rawBosBit(header) << 8) | (header.ttl & 0xff)) >>> 0;

    if (pfn !== MNA_PSMHT_PFN || reserved !== 0 || type !== MNA_POST_STACK_TYPE) {
        throw new Error("Invalid PSMHT encoding.");
    }

    return {
        psmhLen,
    };
};

const encodePsmht = (config: MNAPostStackHeaderConfig): MPLSHeader => ({
    label: (((MNA_PSMHT_PFN & 0xf) << 16) | ((config.psmhLen & 0xff) << 4)) >>> 0,
    tc: 0,
    bos: false,
    ttl: MNA_POST_STACK_TYPE,
});

const decodePsna = (header: MPLSHeader): MNAPostStackActionConfig => {
    const reserved = (header.label >>> 11) & 0x3;

    if (reserved !== 0) {
        throw new Error("Invalid PSNA encoding.");
    }

    return {
        opcode: (header.label >>> 13) & 0x7f,
        psNal: (header.label >>> 4) & 0x7f,
        data: ((((header.label & 0xf) << 12) | ((header.tc & 0x7) << 9) | (rawBosBit(header) << 8) | (header.ttl & 0xff))) >>> 0,
    };
};

const encodePsna = (config: MNAPostStackActionConfig): MPLSHeader => ({
    label: ((((config.opcode & 0x7f) << 13) | ((config.psNal & 0x7f) << 4) | ((config.data >>> 12) & 0xf))) >>> 0,
    tc: (config.data >>> 9) & 0x7,
    bos: ((config.data >>> 8) & 0x1) === 1,
    ttl: config.data & 0xff,
});

const decodePsData = (header: MPLSHeader): MNAPostStackDataConfig => ({
    data: ((((header.label & 0xfffff) << 12) | ((header.tc & 0x7) << 9) | (rawBosBit(header) << 8) | (header.ttl & 0xff))) >>> 0,
});

const encodePsData = (config: MNAPostStackDataConfig): MPLSHeader => ({
    label: (config.data >>> 12) & 0xfffff,
    tc: (config.data >>> 9) & 0x7,
    bos: ((config.data >>> 8) & 0x1) === 1,
    ttl: config.data & 0xff,
});

const decodeNasRegion = (entries: MNAEditorEntry[], stack: MPLSHeader[], endExclusive: number): string | null => {
    let index = 0;

    while (index < endExclusive) {
        const current = stack[index] ?? DefaultMPLSHeader();
        entries[index].plain = { ...current };

        if (current.label !== MNA_BSPL_LABEL) {
            index += 1;
            continue;
        }

        if (index === 0) {
            return "The top-of-stack LSE cannot be the MNA sub-stack indicator.";
        }

        if (index + 1 >= endExclusive) {
            return "The last in-stack row cannot be the MNA sub-stack indicator.";
        }

        entries[index].isNasi = true;

        const formatBIndex = index + 1;
        const formatBHeader = stack[formatBIndex] ?? DefaultMPLSHeader();
        const formatB = decodeFormatB(formatBHeader);
        const remainingAfterB = endExclusive - (formatBIndex + 1);

        if (formatB.nasl > remainingAfterB) {
            return "NASL exceeds the remaining MPLS stack depth.";
        }

        if (formatB.nal > formatB.nasl) {
            return "NAL exceeds NASL in the encoded MNA stack.";
        }

        entries[formatBIndex].formatB = formatB;

        let offset = formatBIndex + 1;
        for (let dIndex = 0; dIndex < formatB.nal; dIndex += 1) {
            if (offset >= endExclusive) {
                return "The encoded MNA stack ends before Format D data is complete.";
            }

            try {
                entries[offset].formatD = decodeFormatD(stack[offset] ?? DefaultMPLSHeader());
            } catch (_error) {
                return "A Format D row does not contain a valid in-stack data encoding.";
            }
            offset += 1;
        }

        let consumedWithinNas = formatB.nal;
        while (consumedWithinNas < formatB.nasl) {
            if (offset >= endExclusive) {
                return "The encoded MNA stack ends before NASL is satisfied.";
            }

            const formatC = decodeFormatC(stack[offset] ?? DefaultMPLSHeader());
            if (formatC.nal > formatB.nasl - consumedWithinNas - 1) {
                return "A Format C NAL exceeds the remaining rows in the NAS.";
            }

            entries[offset].formatC = formatC;
            offset += 1;
            consumedWithinNas += 1;

            for (let dIndex = 0; dIndex < formatC.nal; dIndex += 1) {
                if (offset >= endExclusive) {
                    return "The encoded MNA stack ends before Format D data is complete.";
                }

                try {
                    entries[offset].formatD = decodeFormatD(stack[offset] ?? DefaultMPLSHeader());
                } catch (_error) {
                    return "A Format D row does not contain a valid in-stack data encoding.";
                }
                offset += 1;
                consumedWithinNas += 1;
            }
        }

        index = offset;
    }

    return null;
};

const decodePostStackRegion = (entries: MNAEditorEntry[], stack: MPLSHeader[], startIndex: number, length: number): string | null => {
    let cursor = startIndex;

    while (cursor < length) {
        let psmht: MNAPostStackHeaderConfig;
        try {
            psmht = decodePsmht(stack[cursor] ?? DefaultMPLSHeader());
        } catch (_error) {
            return "The stored MPLS stack contains an explicit BoS boundary, but the trailing rows do not form a valid post-stack MNA encoding.";
        }

        entries[cursor].isPsmht = true;
        entries[cursor].psmht = psmht;

        if (psmht.psmhLen === 0) {
            return "A Post-Stack MNA Header must contain at least one Post-Stack Network Action.";
        }

        const remainingAfterHeader = length - cursor - 1;
        if (psmht.psmhLen > remainingAfterHeader) {
            return "PSMH-Len exceeds the remaining post-stack rows.";
        }

        let offset = cursor + 1;
        let consumedWithinPsmh = 0;

        while (consumedWithinPsmh < psmht.psmhLen) {
            if (offset >= length) {
                return "The encoded post-stack header ends before PSMH-Len is satisfied.";
            }

            let psna: MNAPostStackActionConfig;
            try {
                psna = decodePsna(stack[offset] ?? DefaultMPLSHeader());
            } catch (_error) {
                return "A post-stack row does not contain a valid PSNA encoding.";
            }

            if (psna.psNal > psmht.psmhLen - consumedWithinPsmh - 1) {
                return "PS-NAL exceeds the remaining rows in the current post-stack header.";
            }

            entries[offset].psna = psna;
            offset += 1;
            consumedWithinPsmh += 1;

            for (let dataIndex = 0; dataIndex < psna.psNal; dataIndex += 1) {
                if (offset >= length) {
                    return "The encoded post-stack header ends before post-stack continuation data is complete.";
                }

                entries[offset].psData = decodePsData(stack[offset] ?? DefaultMPLSHeader());
                offset += 1;
                consumedWithinPsmh += 1;
            }
        }

        cursor = offset;
    }

    return null;
};

export const decodeMNAEditorEntries = (
    stack: MPLSHeader[],
    length: number,
    options?: MNAFeatureOptions,
): { entries: MNAEditorEntry[]; error: string | null } => {
    const allowPostStack = options?.allowPostStack ?? true;

    if (length === 0) {
        return {
            entries: createDefaultMNAEditorEntries(stack, length),
            error: null,
        };
    }

    if (!allowPostStack) {
        const entries = createDefaultMNAEditorEntries(stack, length);
        const error = decodeNasRegion(entries, stack, length);
        return {
            entries: error ? createDefaultMNAEditorEntries(stack, length) : entries,
            error,
        };
    }

    const explicitBosCandidates: number[] = [];
    for (let index = 0; index < length - 1; index += 1) {
        if (stack[index]?.bos === true) {
            explicitBosCandidates.push(index);
        }
    }

    for (const bosIndex of explicitBosCandidates) {
        const entries = createDefaultMNAEditorEntries(stack, length);
        const nasError = decodeNasRegion(entries, stack, bosIndex + 1);
        if (nasError) {
            continue;
        }

        const postStackError = decodePostStackRegion(entries, stack, bosIndex + 1, length);
        if (!postStackError) {
            return { entries, error: null };
        }
    }

    if (explicitBosCandidates.length > 0) {
        return {
            entries: createDefaultMNAEditorEntries(stack, length),
            error: "The stored MPLS stack contains an explicit BoS boundary, but the trailing rows do not form a valid post-stack MNA encoding.",
        };
    }

    const entries = createDefaultMNAEditorEntries(stack, length);
    const error = decodeNasRegion(entries, stack, length);
    return {
        entries: error ? createDefaultMNAEditorEntries(stack, length) : entries,
        error,
    };
};

export const computeMNAState = (entries: MNAEditorEntry[], options?: MNAFeatureOptions): MNAComputedState => {
    const sanitizedEntries = cloneEntriesWithFeatureOptions(entries, options);

    const rows: MNAComputedRow[] = sanitizedEntries.map((entry, index) => ({
        index,
        role: "plain",
        plain: { ...entry.plain },
        isNasi: entry.isNasi,
        isPsmht: entry.isPsmht,
        formatB: { ...entry.formatB },
        formatC: { ...entry.formatC },
        formatD: { ...entry.formatD },
        psmht: { ...entry.psmht },
        psna: { ...entry.psna },
        psData: { ...entry.psData },
        ownerIndex: null,
        canBeNasi: false,
        nasiDisabledReason: null,
        canBePsmht: false,
        psmhtDisabledReason: null,
        maxNasl: 0,
        maxNal: 0,
        maxPsmhLen: 0,
        maxPsNal: 0,
    }));

    if (entries.length === 0) {
        return {
            rows,
            encodedStack: [],
            error: null,
            hasNas: false,
            hasPostStack: false,
        };
    }

    const psmhtIndices = rows.filter((row) => row.isPsmht).map((row) => row.index);
    const firstPsmhtIndex = psmhtIndices.length > 0 ? psmhtIndices[0] : -1;
    const hasPostStack = firstPsmhtIndex !== -1;
    const inStackEndExclusive = hasPostStack ? firstPsmhtIndex : rows.length;

    let hasNas = false;
    let error: string | null = null;
    const occupied = new Set<number>();

    for (let index = 0; index < inStackEndExclusive; index += 1) {
        if (!rows[index].isNasi) {
            continue;
        }

        hasNas = true;
        if (index === 0) {
            error = "The top-of-stack LSE cannot be the MNA sub-stack indicator.";
            break;
        }

        if (index + 1 >= inStackEndExclusive) {
            error = "The last in-stack row cannot be the MNA sub-stack indicator.";
            break;
        }

        if (occupied.has(index) || occupied.has(index + 1)) {
            error = "MNA sub-stacks must not overlap.";
            break;
        }

        const formatBIndex = index + 1;
        const formatBRow = rows[formatBIndex];
        const maxNasl = inStackEndExclusive - formatBIndex - 1;
        const nasl = clamp(formatBRow.formatB.nasl, 0, maxNasl);
        const nal = clamp(formatBRow.formatB.nal, 0, nasl);

        formatBRow.formatB.nasl = nasl;
        formatBRow.formatB.nal = nal;
        formatBRow.maxNasl = maxNasl;
        formatBRow.maxNal = nasl;
        rows[index].role = "formatA";
        rows[index].ownerIndex = index;
        formatBRow.role = "formatB";
        formatBRow.ownerIndex = index;
        occupied.add(index);
        occupied.add(formatBIndex);

        let cursor = formatBIndex + 1;
        let consumedWithinNas = 0;

        for (let dIndex = 0; dIndex < nal; dIndex += 1) {
            if (cursor >= inStackEndExclusive) {
                error = "NAL exceeds the remaining rows in the MPLS stack.";
                break;
            }
            if (occupied.has(cursor)) {
                error = "MNA sub-stacks must not overlap.";
                break;
            }

            rows[cursor].role = "formatD";
            rows[cursor].ownerIndex = formatBIndex;
            occupied.add(cursor);
            cursor += 1;
            consumedWithinNas += 1;
        }

        if (error) {
            break;
        }

        while (consumedWithinNas < nasl) {
            if (cursor >= inStackEndExclusive) {
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
            formatCRow.maxNal = remainingWithinNas;
            formatCRow.formatC.nal = formatCNal;
            occupied.add(cursor);
            cursor += 1;
            consumedWithinNas += 1;

            for (let dIndex = 0; dIndex < formatCNal; dIndex += 1) {
                if (cursor >= inStackEndExclusive) {
                    error = "NAL exceeds the remaining rows in the MPLS stack.";
                    break;
                }
                if (occupied.has(cursor)) {
                    error = "MNA sub-stacks must not overlap.";
                    break;
                }

                rows[cursor].role = "formatD";
                rows[cursor].ownerIndex = formatCRow.index;
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

    if (!error) {
        for (let index = inStackEndExclusive; index < rows.length; index += 1) {
            if (rows[index].isNasi) {
                error = "Rows at or after the post-stack boundary cannot be NASI.";
                break;
            }
        }
    }

    if (!error && hasPostStack) {
        if (firstPsmhtIndex === 0) {
            error = "The first row cannot be a Post-Stack MNA Header.";
        } else if (firstPsmhtIndex === rows.length - 1) {
            error = "The last row cannot be a Post-Stack MNA Header.";
        }
    }

    if (!error) {
        for (let markerIndex = 0; markerIndex < psmhtIndices.length; markerIndex += 1) {
            const startIndex = psmhtIndices[markerIndex];
            const nextMarker = markerIndex + 1 < psmhtIndices.length ? psmhtIndices[markerIndex + 1] : rows.length;
            const available = nextMarker - startIndex - 1;
            const psmhtRow = rows[startIndex];

            if (occupied.has(startIndex)) {
                error = "Post-stack MNA headers must not overlap with in-stack MNA encodings.";
                break;
            }

            if (startIndex === 0) {
                error = "The first row cannot be a Post-Stack MNA Header.";
                break;
            }

            if (available <= 0) {
                error = "A Post-Stack MNA Header must have at least one following PSNA row.";
                break;
            }

            psmhtRow.role = "psmht";
            psmhtRow.ownerIndex = startIndex;
            psmhtRow.maxPsmhLen = available;
            psmhtRow.psmht.psmhLen = clamp(psmhtRow.psmht.psmhLen, 1, available);
            occupied.add(startIndex);

            let cursor = startIndex + 1;
            let consumedWithinPsmh = 0;

            while (consumedWithinPsmh < psmhtRow.psmht.psmhLen) {
                if (cursor >= rows.length || cursor >= nextMarker) {
                    error = "PSMH-Len exceeds the remaining logical stack depth.";
                    break;
                }
                if (occupied.has(cursor)) {
                    error = "Post-stack MNA groups must not overlap.";
                    break;
                }

                const psnaRow = rows[cursor];
                const remainingWithinPsmh = psmhtRow.psmht.psmhLen - consumedWithinPsmh - 1;
                const psNal = clamp(psnaRow.psna.psNal, 0, Math.min(127, remainingWithinPsmh));

                psnaRow.role = "psna";
                psnaRow.ownerIndex = startIndex;
                psnaRow.maxPsNal = remainingWithinPsmh;
                psnaRow.psna.psNal = psNal;
                occupied.add(cursor);
                cursor += 1;
                consumedWithinPsmh += 1;

                for (let dataIndex = 0; dataIndex < psNal; dataIndex += 1) {
                    if (cursor >= rows.length || cursor >= nextMarker) {
                        error = "PS-NAL exceeds the remaining rows in the current post-stack header.";
                        break;
                    }
                    if (occupied.has(cursor)) {
                        error = "Post-stack MNA groups must not overlap.";
                        break;
                    }

                    rows[cursor].role = "psData";
                    rows[cursor].ownerIndex = psnaRow.index;
                    occupied.add(cursor);
                    cursor += 1;
                    consumedWithinPsmh += 1;
                }

                if (error) {
                    break;
                }
            }

            if (error) {
                break;
            }
        }
    }

    rows.forEach((row, index) => {
        if (!occupied.has(index)) {
            row.role = "plain";
            row.ownerIndex = null;
        }

        const isFirstRow = index === 0;
        const isLastRow = index === rows.length - 1;
        const inPostStackRegion = hasPostStack && index >= firstPsmhtIndex;
        const isFree = !occupied.has(index);

        if (!isFree) {
            row.canBeNasi = false;
            row.nasiDisabledReason = "This row is occupied by another MNA structure.";
            row.canBePsmht = false;
            row.psmhtDisabledReason = "This row is occupied by another MNA structure.";
            return;
        }

        row.canBeNasi = !isFirstRow && index + 1 < inStackEndExclusive;
        row.nasiDisabledReason = null;

        if (inPostStackRegion) {
            row.canBeNasi = false;
            row.nasiDisabledReason = "Rows at or after the post-stack boundary cannot be NASI.";
        } else if (isFirstRow) {
            row.canBeNasi = false;
            row.nasiDisabledReason = "The top-of-stack LSE cannot be NASI.";
        } else if (index + 1 >= inStackEndExclusive) {
            row.canBeNasi = false;
            row.nasiDisabledReason = hasPostStack
                ? "The last in-stack row before the post-stack boundary cannot be NASI."
                : "The last LSE cannot be NASI.";
        } else if (index + 1 < rows.length && rows[index + 1].isNasi) {
            row.canBeNasi = false;
            row.nasiDisabledReason = "This LSE cannot be NASI while the following LSE is already NASI.";
        }

        row.canBePsmht = !isFirstRow && !isLastRow && (!hasPostStack || inPostStackRegion);
        row.psmhtDisabledReason = null;

        if (isFirstRow) {
            row.canBePsmht = false;
            row.psmhtDisabledReason = "The first row cannot be a Post-Stack MNA Header.";
        } else if (isLastRow) {
            row.canBePsmht = false;
            row.psmhtDisabledReason = "The last row cannot be a Post-Stack MNA Header.";
        } else if (hasPostStack && index < firstPsmhtIndex) {
            row.canBePsmht = false;
            row.psmhtDisabledReason = "Additional post-stack headers may only start inside the trailing post-stack region.";
        } else if (index + 1 < rows.length && rows[index + 1].isPsmht) {
            row.canBePsmht = false;
            row.psmhtDisabledReason = "A Post-Stack MNA Header requires at least one following PSNA row.";
        }
    });

    if (!error && hasNas) {
        for (let index = 0; index < rows.length; index += 1) {
            if (rows[index].isNasi && rows[index].role !== "formatA") {
                error = "An MNA indicator is placed inside another MNA structure.";
                break;
            }
        }
    }

    if (!error && hasPostStack) {
        for (let index = firstPsmhtIndex; index < rows.length; index += 1) {
            if (rows[index].isPsmht && rows[index].role !== "psmht") {
                error = "A Post-Stack MNA Header is placed inside another MNA structure.";
                break;
            }

            if (!occupied.has(index)) {
                error = "Rows after the first post-stack boundary must either belong to a post-stack group or start another post-stack header.";
                break;
            }
        }
    }

    if (!error && !hasNas && !hasPostStack) {
        error = "MNA is enabled, but the MPLS stack does not contain an MNA structure.";
    }

    let encodedStack = rows.map((row) => {
        switch (row.role) {
            case "formatA":
                return encodeFormatA(row.plain);
            case "formatB":
                return encodeFormatB(row.formatB);
            case "formatC":
                return encodeFormatC(row.formatC);
            case "formatD":
                return encodeFormatD(row.formatD);
            case "psmht":
                return encodePsmht(row.psmht);
            case "psna":
                return encodePsna(row.psna);
            case "psData":
                return encodePsData(row.psData);
            case "plain":
            default:
                return plainHeaderWithoutBos(row.plain);
        }
    });

    if (hasPostStack) {
        encodedStack = encodedStack.map((header, index) => {
            if (index < firstPsmhtIndex) {
                return { ...header, bos: false };
            }
            return header;
        });

        const boundaryIndex = firstPsmhtIndex - 1;
        encodedStack[boundaryIndex] = {
            ...encodedStack[boundaryIndex],
            bos: true,
        };
    }

    return {
        rows,
        encodedStack,
        error,
        hasNas,
        hasPostStack,
    };
};

export const stripPostStackEncoding = (stack: MPLSHeader[] | undefined, length: number): MPLSHeader[] => {
    const normalizedStack = Array.from({ length }, (_, index) =>
        stack?.[index] ? { ...stack[index] } : DefaultMPLSHeader()
    );
    const decoded = decodeMNAEditorEntries(normalizedStack, length, {
        allowPostStack: true,
    });
    const computedWithPostStack = computeMNAState(decoded.entries, {
        allowPostStack: true,
    });
    const firstPsmhtIndex = computedWithPostStack.rows.find((row) => row.role === "psmht")?.index ?? -1;
    const firstExplicitBosIndex = normalizedStack.findIndex((header, index) =>
        index < length - 1 && header?.bos === true
    );
    const clearStartIndex = firstPsmhtIndex !== -1 ? firstPsmhtIndex : (
        firstExplicitBosIndex !== -1 ? firstExplicitBosIndex + 1 : -1
    );

    if (clearStartIndex === -1) {
        return computeMNAState(decoded.entries, {
            allowPostStack: false,
        }).encodedStack;
    }

    const cleanedEntries = cloneEntriesWithFeatureOptions(decoded.entries, {
        allowPostStack: false,
    });
    const defaultEntries = createDefaultMNAEditorEntries([], length);
    for (let index = clearStartIndex; index < length; index += 1) {
        cleanedEntries[index] = defaultEntries[index];
    }

    return computeMNAState(cleanedEntries, {
        allowPostStack: false,
    }).encodedStack;
};

export const getMNAValidationError = (entries: MNAEditorEntry[], options?: MNAFeatureOptions): string | null =>
    computeMNAState(entries, options).error;
