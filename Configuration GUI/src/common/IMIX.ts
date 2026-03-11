import { GenerationUnit } from "./Interfaces";

export type IMIXIPVersion = 4 | 6;

export type IMIXConfig = {
    totalRate: number,
    unit: GenerationUnit,
    ipVersion: IMIXIPVersion,
};

export type IMIXStreamSpec = {
    frameSize: number,
    packetWeight: number,
};

// P4TG does not expose 594B as a selectable frame size, so this uses a native approximation.
export const IMIX_STREAM_SPECS: IMIXStreamSpec[] = [
    { frameSize: 64, packetWeight: 7 },
    { frameSize: 512, packetWeight: 4 },
    { frameSize: 1518, packetWeight: 1 },
];

export const IMIX_STREAM_COUNT = IMIX_STREAM_SPECS.length;
export const IMIX_DESCRIPTION = "7x64B, 4x512B, 1x1518B";

export const splitImixRate = (totalRate: number, unit: GenerationUnit): number[] => {
    const weights = IMIX_STREAM_SPECS.map((spec) =>
        unit === GenerationUnit.Mpps ? spec.packetWeight : spec.packetWeight * spec.frameSize
    );
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const allocatedRates: number[] = [];
    let assignedRate = 0;

    IMIX_STREAM_SPECS.forEach((_, index) => {
        if (index === IMIX_STREAM_SPECS.length - 1) {
            allocatedRates.push(Number((totalRate - assignedRate).toFixed(6)));
            return;
        }

        const rate = Number(((totalRate * weights[index]) / totalWeight).toFixed(6));
        allocatedRates.push(rate);
        assignedRate += rate;
    });

    return allocatedRates;
};
