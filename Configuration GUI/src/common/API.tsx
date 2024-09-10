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

import axios from "axios";
import { AxiosResponse } from "axios";
import Config from "../config";
import { useEffect } from "react";

const instance = axios.create({
  baseURL: Config.API_URL,
});

interface Request {
  route: string;
  body?: any;
  token?: string;
}

const getHeader = (token?: string) => {
  const headers: {} = {
    Accept: "application/json",
    "Content-Type": "application/json",
    headers: {
      Authorization: token,
    },
    timeout: 0,
  };

  return headers;
};

const AxiosInterceptor = ({
  onError,
  children,
  onOffline,
  onOnline,
}: {
  onError: (message: string) => void;
  onOffline: () => void;
  onOnline: () => void;
  children: JSX.Element;
}) => {
  useEffect(() => {
    const resInterceptor = (response: AxiosResponse) => {
      onOnline();
      return response;
    };

    const errInterceptor = (error: any) => {
      if (
        !("response" in error) ||
        ("code" in error && error.code === "ERR_NETWORK")
      ) {
        onOffline();
      }

      if (error.response.status === 400) {
        console.log(error.response);
        onError(error.response.data.message);
      } else if (error.response.status === 401) {
        onError(error.response.data.message);
      } else if (error.response.status === 422) {
        onError(error.response.data);
      } else if (error.response.status === 500) {
        if ("data" in error.response && "message" in error.repsonse.data) {
          onError("Internal Server Error: " + error.response.data.message);
        } else {
          onError("Internal Server Error.");
        }
      } else if (error.response.status === 404) {
        onError("Request endpoint not found.");
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

const get = async (request: Request) => {
  return await instance.get(request.route, getHeader(request.token));
};

const post = async (request: Request) => {
  return await instance.post(
    request.route,
    request.body,
    getHeader(request.token)
  );
};

const del = async (request: Request) => {
  return await instance.delete(request.route, getHeader(request.token));
};

const put = async (request: Request) => {
  return await instance.put(
    request.route,
    request.body,
    getHeader(request.token)
  );
};

export default instance;
export { AxiosInterceptor, get, post, del, put };
