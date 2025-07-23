import { useEffect, useState } from "react"
import { Toast, ToastContainer } from "react-bootstrap"
import { ToastVariant } from "../common/Interfaces"

interface Props {
    message: string
    show: boolean
    onClose: () => void
    delay?: number
    bg: ToastVariant
}

const ToastMessage = ({ message, show, onClose, delay = 3000, bg }: Props) => {
    const [visible, setVisible] = useState(show)

    useEffect(() => {
        setVisible(show)
    }, [show])

    return (
        <ToastContainer position="top-end" className="p-3" style={{ zIndex: 9999 }}>
            <Toast
                onClose={() => {
                    setVisible(false)
                    onClose()
                }}
                show={visible}
                delay={delay}
                autohide
                bg={bg}
            >
                <Toast.Body className="text-white">{message}</Toast.Body>
            </Toast>
        </ToastContainer>
    )
}

export default ToastMessage
