use rbfrt::error::RBFRTError;
use rbfrt::error::RBFRTError::GenericError;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum P4TGError {
    #[error("An error occurred. Check your input. Message: {message}")]
    Error { message: String },
}

impl From<P4TGError> for RBFRTError {
    fn from(value: P4TGError) -> Self {
        GenericError {
            message: format!("{value:?}"),
        }
    }
}
