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
 */

/*
 * Fabian Ihle (fabian.ihle@uni-tuebingen.de)
 */

import {
    PortTxRxMap,
    RxMappingMode,
    Stream,
    StreamSettings,
} from "./Interfaces";

export interface ExpectedRoute {
    txPort: number;
    txChannel: number;
    rxPort: number;
    rxChannel: number;
    streamId: number;
    appId: number;
}

export const expectedRoutes = (
    mode: RxMappingMode,
    portMapping: PortTxRxMap,
    streams: Stream[],
    settings: StreamSettings[],
): ExpectedRoute[] => {
    const appIds = new Map(streams.map((stream) => [stream.stream_id, stream.app_id]));

    return settings.flatMap((setting) => {
        if (!setting.active) return [];
        const appId = appIds.get(setting.stream_id);
        const target = mode === RxMappingMode.PerStream
            ? setting.rx_target
            : portMapping?.[String(setting.port)]?.[String(setting.channel)];
        if (appId === undefined || !target) return [];
        return [{
            txPort: setting.port,
            txChannel: setting.channel,
            rxPort: target.port,
            rxChannel: target.channel,
            streamId: setting.stream_id,
            appId,
        }];
    });
};

export const uniquePortPairs = (routes: ExpectedRoute[]) => {
    const pairs = new Map<string, Pick<ExpectedRoute, "txPort" | "txChannel" | "rxPort" | "rxChannel">>();
    routes.forEach(({ txPort, txChannel, rxPort, rxChannel }) => {
        pairs.set(`${txPort}/${txChannel}-${rxPort}/${rxChannel}`, {
            txPort, txChannel, rxPort, rxChannel,
        });
    });
    return Array.from(pairs.values());
};

export const sequenceMetricsReliable = (routes: ExpectedRoute[]) => {
    const rxByTx = new Map<string, Set<string>>();
    const txByRx = new Map<string, Set<string>>();
    routes.forEach(({ txPort, txChannel, rxPort, rxChannel }) => {
        const tx = `${txPort}/${txChannel}`;
        const rx = `${rxPort}/${rxChannel}`;
        if (!rxByTx.has(tx)) rxByTx.set(tx, new Set());
        if (!txByRx.has(rx)) txByRx.set(rx, new Set());
        rxByTx.get(tx)!.add(rx);
        txByRx.get(rx)!.add(tx);
    });
    return Array.from(rxByTx.values()).every((targets) => targets.size <= 1)
        && Array.from(txByRx.values()).every((sources) => sources.size <= 1);
};

export const rxAppIsUnambiguous = (routes: ExpectedRoute[], route: ExpectedRoute) => {
    const sources = new Set(
        routes
            .filter((candidate) => candidate.rxPort === route.rxPort
                && candidate.rxChannel === route.rxChannel
                && candidate.appId === route.appId)
            .map((candidate) => `${candidate.txPort}/${candidate.txChannel}`),
    );
    return sources.size <= 1;
};
