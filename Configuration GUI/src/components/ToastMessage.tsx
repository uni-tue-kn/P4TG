import { useEffect, useState } from "react"
import { Toast, ToastContainer } from "react-bootstrap"
import { ToastVariant } from "../common/Interfaces"

interface Props {
    message: string
    show: boolean
    delay?: number
    bg: ToastVariant
    time: string,
}

const ToastMessage = ({ message, show, delay = 3000, bg, time }: Props) => {
    const [visible, setVisible] = useState(show)

    useEffect(() => {
        setVisible(show)
    }, [show])

    return (
        <ToastContainer position="top-end" className="p-3" style={{ zIndex: 9999 }}>
            <Toast
                onClose={() => {
                    setVisible(false)
                    message = ""
                }}
                show={visible}
                delay={delay}
                autohide
                bg={bg}
            >
                <Toast.Header>
                    <strong className="me-auto">{{
                        success: "Success",
                        danger: "Error",
                        info: "Info",
                        warning: "Warning"
                    }[bg]}</strong>
                    <small>{time}</small>
                </Toast.Header>
                <Toast.Body className="text-white">{message}</Toast.Body>
            </Toast>
        </ToastContainer>
    )
}

export default ToastMessage
