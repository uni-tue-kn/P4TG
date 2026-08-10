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

import { Toast, ToastContainer } from "react-bootstrap"
import styled from "styled-components"
import { ToastVariant } from "../common/Interfaces"

interface Props {
    message: string
    show: boolean
    delay?: number
    bg: ToastVariant
    onClose: () => void
}

const variants: Record<ToastVariant, { accent: string, tint: string, icon: string, title: string }> = {
    success: {
        accent: "var(--color-okay)",
        tint: "rgba(39, 174, 96, 0.16)",
        icon: "bi-check-circle-fill",
        title: "Success",
    },
    danger: {
        accent: "var(--bs-danger)",
        tint: "rgba(220, 53, 69, 0.16)",
        icon: "bi-x-octagon-fill",
        title: "Error",
    },
    info: {
        accent: "#0d6efd",
        tint: "rgba(13, 110, 253, 0.16)",
        icon: "bi-info-circle-fill",
        title: "Info",
    },
    warning: {
        accent: "var(--color-yellow)",
        tint: "rgba(255, 193, 7, 0.18)",
        icon: "bi-exclamation-triangle-fill",
        title: "Warning",
    },
}

const LowerToastContainer = styled(ToastContainer)`
    bottom: clamp(2rem, 8vh, 5rem) !important;
    left: 50% !important;
    padding: 0;
    position: fixed !important;
    right: auto !important;
    transform: translateX(-50%);
    width: min(calc(100vw - 2rem), 32rem);
    z-index: 9999;
`

const FloatingToast = styled(Toast) <{ $accent: string }>`
    background: var(--color-background);
    border: 1px solid color-mix(in srgb, var(--color-text) 16%, transparent);
    border-left: 5px solid ${props => props.$accent};
    border-radius: 0.75rem;
    box-shadow: 0 1rem 2.75rem rgba(0, 0, 0, 0.3);
    color: var(--color-text);
    max-width: none;
    overflow: hidden;
    width: 100%;
`

const ToastContent = styled.div`
    align-items: center;
    display: grid;
    gap: 0.875rem;
    grid-template-columns: auto minmax(0, 1fr) auto;
    min-height: 4.5rem;
    padding: 0.9rem 1rem;
`

const ToastIcon = styled.div<{ $accent: string, $tint: string }>`
    align-items: center;
    background: ${props => props.$tint};
    border-radius: 50%;
    color: ${props => props.$accent};
    display: flex;
    font-size: 1.35rem;
    height: 2.5rem;
    justify-content: center;
    width: 2.5rem;
`

const ToastTitle = styled.div`
    font-size: 1rem;
    font-weight: 700;
    line-height: 1.25;
    margin-bottom: 0.15rem;
`

const ToastText = styled.div`
    color: var(--color-text);
    line-height: 1.35;
    opacity: 0.78;
    overflow-wrap: anywhere;
`

const CloseButton = styled.button`
    align-self: start;
    margin: 0.1rem 0 0 0.25rem;
`

const ERROR_TOAST_DELAY = 12_000

const ToastMessage = ({ message, show, delay = 4000, bg, onClose }: Props) => {
    const variant = variants[bg]
    const toastDelay = bg === "danger" ? ERROR_TOAST_DELAY : delay

    return (
        <LowerToastContainer>
            <FloatingToast
                onClose={onClose}
                show={show}
                delay={toastDelay}
                autohide
                $accent={variant.accent}
                role={bg === "danger" ? "alert" : "status"}
                aria-live={bg === "danger" ? "assertive" : "polite"}
                aria-atomic="true"
            >
                <ToastContent>
                    <ToastIcon $accent={variant.accent} $tint={variant.tint} aria-hidden="true">
                        <i className={`bi ${variant.icon}`} />
                    </ToastIcon>
                    <div>
                        <ToastTitle>{variant.title}</ToastTitle>
                        <ToastText>{message}</ToastText>
                    </div>
                    <CloseButton type="button" className="btn-close" onClick={onClose} aria-label="Close notification" />
                </ToastContent>
            </FloatingToast>
        </LowerToastContainer>
    )
}

export default ToastMessage
