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
 * Steffen Lindner (steffen.lindner@uni-tuebingen.de)
 */


import axios from "axios"
import { AxiosResponse } from "axios"
import Config from "../config";
import { ReactNode, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ToastVariant } from "./Interfaces";

// Per-tab session id so the controller can count open web sessions even
// when they share one IP (e.g. SSH tunnels). sessionStorage is per
// tab/window; the controller subtracts the requester's own session, so a
// single open tab shows no warning. crypto.randomUUID is unavailable
// outside secure contexts (plain http), hence the Math.random fallback.
const getSessionId = () => {
    let id = sessionStorage.getItem("p4tg-session-id")
    if (id === null) {
        id = typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2) + Date.now().toString(36)
        sessionStorage.setItem("p4tg-session-id", id)
    }
    return id
}

const instance = axios.create({
    baseURL: Config.API_URL,
    headers: { "X-Session-Id": getSessionId() }
})

interface Request {
    route: string,
    body?: any,
    token?: string
}

const getHeader = (token?: string) => {
    const headers: {} = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'headers': {
            'Authorization': token
        },
        timeout: 0
    }

    return headers
}


const AxiosInterceptor = ({ onError, children, onOffline, onOnline }: { onError: (message: string, bg: ToastVariant) => void, onOffline: () => void, onOnline: () => void, children: ReactNode }) => {

    useEffect(() => {

        const resInterceptor = (response: AxiosResponse) => {
            onOnline()
            return response;
        };

        const errInterceptor = (error: any) => {
            if (!("response" in error) || ("code" in error && error.code === "ERR_NETWORK")) {
                onOffline();
            }
            else if (error.response.status === 400) {
                console.log(error.response)
                onError(error.response.data.message, "danger")
            }
            else if (error.response.status === 401) {
                onError(error.response.data.message, "danger")
            }
            else if (error.response.status === 422) {
                onError(error.response.data, "danger")
            }
            else if (error.response.status === 500) {
                if ("data" in error.response && "message" in error.response.data) {
                    onError("Internal Server Error: " + error.response.data.message, "danger")
                } else {
                    onError("Internal Server Error.", "danger")
                }
            }
            else if (error.response.status === 404) {
                onError("Request endpoint not found.", "danger")
            }
            else {
                const message = error.response?.data?.message
                    ?? `Request failed with HTTP ${error.response.status}.`
                onError(message, "danger")
            }

            return Promise.resolve();
        };

        const interceptor = instance.interceptors.response.use(
            resInterceptor,
            errInterceptor
        );

        return () => instance.interceptors.response.eject(interceptor);
    }, []);

    return children;
};

const get = async (request: Request): Promise<AxiosResponse | undefined> => {
    try {
        return await instance.get(request.route, getHeader(request.token));
    } catch (error) {
        // Let interceptor handle it
        return undefined;
    }
};


const post = async (request: Request) => {
    return await instance.post(request.route, request.body, getHeader(request.token))
}

const del = async (request: Request) => {
    return await instance.delete(request.route, getHeader(request.token))
}

const put = async (request: Request) => {
    return await instance.put(request.route, request.body, getHeader(request.token))
}


export default instance
export { AxiosInterceptor, get, post, del, put }
